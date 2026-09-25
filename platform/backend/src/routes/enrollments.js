const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateAgentToken } = require('../middleware/auth');
const { runEnrollmentFraudChecks } = require('../services/antifraud');
const { issueStrike } = require('../services/strikes');
const { createAuditLog } = require('../services/audit');
const logger = require('../lib/logger');

const MAX_ENROLLMENTS_PER_HOUR = parseInt(process.env.MAX_ENROLLMENTS_PER_HOUR) || 20;
const FLAG_SPEED_MIN_SECONDS = parseInt(process.env.MIN_ENROLLMENT_SECONDS) || 120;
const FLAG_SPEED_WINDOW = 10;

/**
 * Check behavioral analytics after each enrollment
 */
const checkBehavioralFlags = async (agentId, io) => {
  const recentEnrollments = await prisma.citizen.findMany({
    where: {
      enrolledByAgentId: agentId,
      enrolledAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
    },
    orderBy: { enrolledAt: 'desc' },
    take: MAX_ENROLLMENTS_PER_HOUR + 5,
  });

  // 1. Velocity check: >20 enrollments in past hour
  if (recentEnrollments.length > MAX_ENROLLMENTS_PER_HOUR) {
    await issueStrike({
      agentId,
      trigger: 'HIGH_ENROLLMENT_VELOCITY',
      details: `Agent performed ${recentEnrollments.length} enrollments in the last hour (max: ${MAX_ENROLLMENTS_PER_HOUR})`,
      metadata: { count: recentEnrollments.length, windowHours: 1 },
      io,
    });
  }

  // 2. Speed check: avg < 2 min per enrollment over last 10
  if (recentEnrollments.length >= FLAG_SPEED_WINDOW) {
    const window = recentEnrollments.slice(0, FLAG_SPEED_WINDOW);
    const oldest = window[window.length - 1].enrolledAt;
    const newest = window[0].enrolledAt;
    const totalSeconds = (new Date(newest) - new Date(oldest)) / 1000;
    const avgSeconds = totalSeconds / (FLAG_SPEED_WINDOW - 1);

    if (avgSeconds < FLAG_SPEED_MIN_SECONDS) {
      // Raise a Flag (behavioral, not a strike yet)
      const existing = await prisma.flag.findFirst({
        where: { agentId, flagType: 'ENROLLMENT_SPEED', status: 'OPEN' },
      });
      if (!existing) {
        await prisma.flag.create({
          data: {
            agentId,
            flagType: 'ENROLLMENT_SPEED',
            severity: 'HIGH',
            description: `Average enrollment time: ${Math.round(avgSeconds)}s over last ${FLAG_SPEED_WINDOW} enrollments (min acceptable: ${FLAG_SPEED_MIN_SECONDS}s)`,
            evidenceData: { avgSeconds: Math.round(avgSeconds), window: FLAG_SPEED_WINDOW },
          },
        });
        if (io) {
          io.to('stakeholder-room').emit('flag:raised', {
            agentId, flagType: 'ENROLLMENT_SPEED',
            severity: 'HIGH', timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }

  // 3. Unusual hours check (2am–5am)
  const hour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' })).getHours();
  if (hour >= 2 && hour <= 5) {
    const existing = await prisma.flag.findFirst({
      where: {
        agentId, flagType: 'TIME_PATTERN',
        raisedAt: { gt: new Date(Date.now() - 4 * 60 * 60 * 1000) },
      },
    });
    if (!existing) {
      await prisma.flag.create({
        data: {
          agentId, flagType: 'TIME_PATTERN', severity: 'MEDIUM',
          description: `Enrollment performed at ${hour}:00 Nigeria time — outside normal field hours (2am–5am)`,
        },
      });
    }
  }
};

// POST /api/enrollments — Enroll a new citizen (called from agent app)
router.post('/', authenticateAgentToken, async (req, res) => {
  try {
    const {
      sessionToken,
      fullName, dateOfBirth, gender, phone, address,
      stateOfOrigin, stateOfResidence, lgaOfResidence,
      rgbFaceDescriptor = [], irFaceDescriptor = [],
      rightPalmVeinTemplate = [], leftPalmVeinTemplate = [],
      rightPalmVisible = [], leftPalmVisible = [],
      gpsLat, gpsLng, gpsAccuracy, gpsTimestamp, cellTowerId,
      deviceTimestamp, mockGpsDetected = false, vpnDetected = false,
    } = req.body;

    const agentId = req.agent.agentId;
    const io = req.app.get('io');

    // Validate session is active
    const session = await prisma.enrollmentSession.findFirst({
      where: {
        sessionToken,
        agentId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      include: { agent: true },
    });

    if (!session) {
      return res.status(403).json({
        error: 'No valid enrollment session. Please authenticate again.',
        code: 'SESSION_EXPIRED',
      });
    }

    // Run fraud checks on this specific enrollment
    const fraudChecks = runEnrollmentFraudChecks({
      deviceTimestamp,
      mockGpsDetected,
      vpnDetected,
      gpsLat, gpsLng,
      agent: session.agent,
    });

    for (const flag of fraudChecks.flags) {
      await issueStrike({ agentId, sessionId: session.id, trigger: flag.trigger, details: flag.details, io });
    }

    // Duplicate face check against existing records (cosine similarity)
    // For demo: flag if iris/face descriptor is identical (full ML check in production)
    let duplicateOfId = null;
    let isFlaggedForReview = fraudChecks.flags.length > 0;

    if (irFaceDescriptor.length > 0) {
      // Simplified: check for exact NIN duplicate
      const ninExists = await prisma.citizen.findFirst({
        where: { nin: req.body.nin || null },
        select: { id: true },
      });
      if (ninExists && req.body.nin) {
        duplicateOfId = ninExists.id;
        isFlaggedForReview = true;

        await prisma.flag.create({
          data: {
            agentId, flagType: 'DUPLICATE_FACE', severity: 'CRITICAL',
            description: `Duplicate NIN detected during enrollment. Linked citizen: ${ninExists.id}`,
            evidenceData: { duplicateCitizenId: ninExists.id },
          },
        });
      }
    }

    // Create the citizen record
    const citizen = await prisma.citizen.create({
      data: {
        nin: req.body.nin || null,
        fullName, gender, phone, address, stateOfOrigin, stateOfResidence, lgaOfResidence,
        dateOfBirth: new Date(dateOfBirth),
        rgbFaceDescriptor, irFaceDescriptor,
        rightPalmVeinTemplate, leftPalmVeinTemplate,
        rightPalmVisible, leftPalmVisible,
        enrolledByAgentId: agentId,
        enrollmentSessionId: session.id,
        enrollmentGpsLat: gpsLat, enrollmentGpsLng: gpsLng,
        enrollmentGpsAccuracy: gpsAccuracy,
        enrollmentGpsTimestamp: gpsTimestamp ? new Date(gpsTimestamp) : null,
        enrollmentCellTowerId: cellTowerId,
        mockGpsDetected, vpnDetected,
        clockDriftMs: fraudChecks.results.clockCheck?.driftMs
          ? Math.round(fraudChecks.results.clockCheck.driftMs) : null,
        flaggedForReview: isFlaggedForReview,
        duplicateOfId,
        syncedAt: new Date(),
      },
    });

    await createAuditLog({
      actorId: null, actorRole: 'AGENT',
      action: 'CITIZEN_ENROLLED', targetType: 'Citizen', targetId: citizen.id,
      description: `Citizen ${fullName} enrolled by agent in ${lgaOfResidence}, ${stateOfResidence}`,
      metadata: { agentId, sessionId: session.id, fraudFlags: fraudChecks.flags },
    });

    // Real-time broadcast to dashboards
    if (io) {
      io.to('stakeholder-room').emit('enrollment:new', {
        citizenId: citizen.id, agentId,
        agentName: session.agent.fullName,
        state: stateOfResidence, lga: lgaOfResidence,
        gpsLat, gpsLng,
        flagged: isFlaggedForReview,
        timestamp: new Date().toISOString(),
      });
    }

    // Post-enrollment behavioral analytics
    await checkBehavioralFlags(agentId, io);

    res.status(201).json({
      citizenId: citizen.id,
      flagged: isFlaggedForReview,
      fraudFlags: fraudChecks.flags,
      message: isFlaggedForReview
        ? 'Enrollment recorded but flagged for review'
        : 'Enrollment successful',
    });
  } catch (err) {
    logger.error('Enrollment error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/enrollments/sync — Bulk sync offline enrollments
router.post('/sync', authenticateAgentToken, async (req, res) => {
  try {
    const { enrollments } = req.body;
    if (!Array.isArray(enrollments) || enrollments.length === 0) {
      return res.status(400).json({ error: 'No enrollments to sync' });
    }

    const results = [];
    for (const enrollment of enrollments) {
      try {
        // Re-validate each offline enrollment using its offline timestamp
        const fraudChecks = runEnrollmentFraudChecks({
          deviceTimestamp: enrollment.offlineTimestamp,
          mockGpsDetected: enrollment.mockGpsDetected || false,
          vpnDetected: enrollment.vpnDetected || false,
          gpsLat: enrollment.gpsLat, gpsLng: enrollment.gpsLng,
          agent: { operatingGpsLat: null, operatingGpsLng: null },
        });

        const citizen = await prisma.citizen.upsert({
          where: { id: enrollment.localId || 'new-' + Date.now() },
          update: { syncedAt: new Date(), enrollmentStatus: 'SYNCED' },
          create: {
            fullName: enrollment.fullName,
            dateOfBirth: new Date(enrollment.dateOfBirth),
            gender: enrollment.gender,
            phone: enrollment.phone,
            address: enrollment.address,
            stateOfOrigin: enrollment.stateOfOrigin,
            stateOfResidence: enrollment.stateOfResidence,
            lgaOfResidence: enrollment.lgaOfResidence,
            rgbFaceDescriptor: enrollment.rgbFaceDescriptor || [],
            irFaceDescriptor: enrollment.irFaceDescriptor || [],
            rightPalmVeinTemplate: enrollment.rightPalmVeinTemplate || [],
            leftPalmVeinTemplate: enrollment.leftPalmVeinTemplate || [],
            rightPalmVisible: enrollment.rightPalmVisible || [],
            leftPalmVisible: enrollment.leftPalmVisible || [],
            enrolledByAgentId: req.agent.agentId,
            enrollmentSessionId: enrollment.sessionId,
            enrollmentGpsLat: enrollment.gpsLat,
            enrollmentGpsLng: enrollment.gpsLng,
            enrollmentGpsTimestamp: new Date(enrollment.offlineTimestamp),
            enrollmentCellTowerId: enrollment.cellTowerId,
            mockGpsDetected: enrollment.mockGpsDetected || false,
            flaggedForReview: fraudChecks.flags.length > 0,
            syncedAt: new Date(),
            enrollmentStatus: 'SYNCED',
          },
        });

        results.push({ localId: enrollment.localId, citizenId: citizen.id, status: 'synced' });
      } catch (e) {
        results.push({ localId: enrollment.localId, status: 'error', error: e.message });
      }
    }

    res.json({ synced: results.filter(r => r.status === 'synced').length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/enrollments — List enrollments (web portal)
router.get('/', async (req, res) => {
  try {
    const { agentId, state, lga, flagged, startDate, endDate, page = 1, limit = 20 } = req.query;

    const where = {};
    if (flagged === 'true') where.flaggedForReview = true;
    if (state) where.stateOfResidence = state;
    if (lga) where.lgaOfResidence = lga;

    // Scope for partner roles
    if (req.user?.role === 'PARTNER_ADMIN' || req.user?.role === 'SUPER_AGENT') {
      where.enrolledByAgent = { organizationId: req.user.organizationId };
    } else if (agentId) {
      where.enrolledByAgentId = agentId;
    }

    if (startDate || endDate) {
      where.enrolledAt = {};
      if (startDate) where.enrolledAt.gte = new Date(startDate);
      if (endDate) where.enrolledAt.lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [enrollments, total] = await Promise.all([
      prisma.citizen.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { enrolledAt: 'desc' },
        select: {
          id: true, fullName: true, gender: true, stateOfResidence: true,
          lgaOfResidence: true, enrolledAt: true, flaggedForReview: true,
          enrollmentStatus: true, mockGpsDetected: true, vpnDetected: true,
          enrollmentGpsLat: true, enrollmentGpsLng: true,
          enrolledByAgent: { select: { id: true, fullName: true, licenseNumber: true } },
        },
      }),
      prisma.citizen.count({ where }),
    ]);

    res.json({ enrollments, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/enrollments/:id — Enrollment detail
router.get('/:id', async (req, res) => {
  try {
    const citizen = await prisma.citizen.findUnique({
      where: { id: req.params.id },
      include: {
        enrolledByAgent: {
          select: { id: true, fullName: true, licenseNumber: true, operatingState: true, operatingLGA: true },
        },
        enrollmentSession: {
          select: { id: true, startedAt: true, agentPalmMatchScore: true, vpnDetectedAtStart: true, mockGpsAtStart: true },
        },
      },
    });

    if (!citizen) return res.status(404).json({ error: 'Citizen record not found' });

    // Strip biometric template arrays (too large for general API response)
    const { rgbFaceDescriptor, irFaceDescriptor, rightPalmVeinTemplate,
            leftPalmVeinTemplate, rightPalmVisible, leftPalmVisible, ...safeRecord } = citizen;

    res.json({
      ...safeRecord,
      hasTemplates: {
        rgbFace: rgbFaceDescriptor.length > 0,
        irFace: irFaceDescriptor.length > 0,
        rightPalmVein: rightPalmVeinTemplate.length > 0,
        leftPalmVein: leftPalmVeinTemplate.length > 0,
        rightPalmVisible: rightPalmVisible.length > 0,
        leftPalmVisible: leftPalmVisible.length > 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
