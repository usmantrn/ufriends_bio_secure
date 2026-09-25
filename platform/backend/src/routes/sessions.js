const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateAgentToken } = require('../middleware/auth');
const { runEnrollmentFraudChecks } = require('../services/antifraud');
const { issueStrike } = require('../services/strikes');
const { createAuditLog } = require('../services/audit');
const logger = require('../lib/logger');

// POST /api/sessions/start — Agent starts a new enrollment session
// (Agent must first authenticate with their biometric — score sent from device)
router.post('/start', authenticateAgentToken, async (req, res) => {
  try {
    const {
      palmMatchScore, gpsLat, gpsLng, gpsAccuracy, cellTowerId,
      deviceTimestamp, deviceClockDeltaMs, mockGpsDetected = false, vpnDetected = false,
      deviceId: bodyDeviceId,
    } = req.body;

    const agentId = req.agent.agentId;
    const deviceId = bodyDeviceId || req.agent.deviceId;

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true, fullName: true, licenseStatus: true,
        strikeCount: true, operatingGpsLat: true, operatingGpsLng: true, operatingRadiusKm: true,
      },
    });

    if (!agent || agent.licenseStatus !== 'ACTIVE') {
      return res.status(403).json({
        error: 'Agent account is not active',
        status: agent?.licenseStatus || 'NOT_FOUND',
      });
    }

    const io = req.app.get('io');

    const BIOMETRIC_THRESHOLD = 0.85;
    const isDev = process.env.NODE_ENV !== 'production';
    // In production biometric is mandatory; in dev it's optional (simulation mode)
    if (!isDev && (!palmMatchScore || palmMatchScore < BIOMETRIC_THRESHOLD)) {
      await issueStrike({
        agentId,
        trigger: 'BIOMETRIC_AUTH_FAIL',
        details: `Agent palm authentication failed. Score: ${palmMatchScore || 0} (required: ${BIOMETRIC_THRESHOLD})`,
        io,
      });
      return res.status(403).json({
        error: 'Biometric authentication failed',
        code: 'BIOMETRIC_FAIL',
        score: palmMatchScore,
        required: BIOMETRIC_THRESHOLD,
      });
    }

    // 2. Anti-fraud checks at session start
    const fraudChecks = runEnrollmentFraudChecks({
      deviceTimestamp,
      mockGpsDetected,
      vpnDetected,
      gpsLat,
      gpsLng,
      agent,
    });

    // Issue strikes for any fraud flags at session start
    const clockDriftMs = fraudChecks.results.clockCheck?.driftMs || 0;
    for (const flag of fraudChecks.flags) {
      await issueStrike({
        agentId, trigger: flag.trigger, details: flag.details, io,
      });
    }

    // Re-fetch agent to get updated strike count
    const updatedAgent = await prisma.agent.findUnique({
      where: { id: agentId }, select: { licenseStatus: true, strikeCount: true },
    });

    if (updatedAgent.licenseStatus !== 'ACTIVE') {
      return res.status(403).json({
        error: 'Session blocked due to fraud detection flags',
        newStatus: updatedAgent.licenseStatus,
        flagsDetected: fraudChecks.flags,
      });
    }

    // 3. Create session
    const sessionDurationHours = parseInt(process.env.ENROLLMENT_SESSION_DURATION_HOURS) || 4;
    const expiresAt = new Date(Date.now() + sessionDurationHours * 60 * 60 * 1000);

    const session = await prisma.enrollmentSession.create({
      data: {
        agentId, deviceId,
        agentPalmMatchScore: palmMatchScore || 0.99, // dev default
        agentAuthTimestamp: new Date(),
        startGpsLat: gpsLat, startGpsLng: gpsLng, startGpsAccuracy: gpsAccuracy,
        cellTowerIdStart: cellTowerId,
        deviceClockDeltaMs: deviceClockDeltaMs ? Math.round(deviceClockDeltaMs) : Math.round(fraudChecks.results.clockCheck?.driftMs || 0),
        vpnDetectedAtStart: vpnDetected,
        mockGpsAtStart: mockGpsDetected,
        expiresAt,
      },
      include: { _count: { select: { enrollments: true } } },
    });

    await createAuditLog({
      actorId: null, actorRole: 'AGENT',
      action: 'SESSION_STARTED', targetType: 'EnrollmentSession', targetId: session.id,
      description: `Agent ${agent.fullName} started enrollment session. Palm score: ${palmMatchScore}`,
      metadata: { agentId, deviceId, palmMatchScore, fraudChecks: fraudChecks.results },
    });

    // Broadcast to stakeholder dashboard
    if (io) {
      io.to('stakeholder-room').emit('session:started', {
        agentId, agentName: agent.fullName,
        sessionId: session.id, gpsLat, gpsLng,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      session: {
        id: session.id,
        sessionToken: session.sessionToken,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        isActive: session.isActive,
        startGpsLat: session.startGpsLat,
        startGpsLng: session.startGpsLng,
        _count: session._count,
      },
      fraudFlags: fraudChecks.flags,
      isClean: fraudChecks.isClean,
    });
  } catch (err) {
    logger.error('Session start error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions/:sessionId/end — End session
router.post('/:sessionId/end', authenticateAgentToken, async (req, res) => {
  try {
    const session = await prisma.enrollmentSession.update({
      where: { id: req.params.sessionId },
      data: { isActive: false, endedAt: new Date() },
    });

    await createAuditLog({
      action: 'SESSION_EXPIRED', targetType: 'EnrollmentSession', targetId: session.id,
      description: 'Agent enrollment session ended',
    });

    res.json({ message: 'Session ended' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions/active — Get agent's active session
router.get('/active', authenticateAgentToken, async (req, res) => {
  const session = await prisma.enrollmentSession.findFirst({
    where: {
      agentId: req.agent.agentId,
      isActive: true,
      expiresAt: { gt: new Date() },
    },
    orderBy: { startedAt: 'desc' },
  });

  if (!session) return res.json({ active: false });
  res.json({ active: true, session });
});

module.exports = router;
