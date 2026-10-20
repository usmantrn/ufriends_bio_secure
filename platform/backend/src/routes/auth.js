const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const prisma = require('../lib/prisma');
const {
  generateAccessToken,
  generateRefreshToken,
  authenticateToken,
} = require('../middleware/auth');
const { createAuditLog } = require('../services/audit');
const logger = require('../lib/logger');

// POST /api/auth/login — Web portal login (NIMC staff + Partner users)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.nimcUser.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { organization: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      logger.warn(`Failed login attempt for: ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Update last login
    await prisma.nimcUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await createAuditLog({
      actorId: user.id,
      actorRole: user.role,
      action: 'USER_LOGIN',
      targetType: 'User',
      targetId: user.id,
      description: `User ${user.fullName} logged in`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        organizationId: user.organizationId,
        organization: user.organization ? {
          id: user.organization.id,
          name: user.organization.name,
        } : null,
      },
    });
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/agent-login — Agent mobile/desktop app login
router.post('/agent-login', async (req, res) => {
  try {
    const { email, password, deviceToken, platform, deviceLabel } = req.body;

    if (!email || !password || !deviceToken) {
      return res.status(400).json({ error: 'Email, password, and deviceToken are required' });
    }

    const agent = await prisma.agent.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { devices: true },
    });

    if (!agent) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (agent.licenseStatus !== 'ACTIVE') {
      return res.status(403).json({
        error: `Account ${agent.licenseStatus.toLowerCase()}`,
        status: agent.licenseStatus,
      });
    }

    const passwordValid = await bcrypt.compare(password, agent.passwordHash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // ── Device registration (upsert by token) ─────────────────────────
    // Find device by token regardless of isActive status
    const platformUpper = (platform || 'ANDROID').toUpperCase();
    const validPlatforms = ['ANDROID', 'WINDOWS', 'LINUX', 'IOS'];
    const safePlatform = validPlatforms.includes(platformUpper) ? platformUpper : 'ANDROID';

    let device = await prisma.device.findFirst({
      where: { deviceToken, agentId: agent.id },
    });

    if (device) {
      // Existing device — reactivate and update last seen
      device = await prisma.device.update({
        where: { id: device.id },
        data: { isActive: true, lastSeenAt: new Date() },
      });
    } else {
      // Brand new device — check limit first
      const activeDeviceCount = await prisma.device.count({
        where: { agentId: agent.id, isActive: true },
      });
      const maxDevices = parseInt(process.env.MAX_DEVICES_PER_AGENT) || 10;
      if (activeDeviceCount >= maxDevices) {
        return res.status(403).json({
          error: `Maximum ${maxDevices} devices allowed. Deregister an existing device first.`,
          code: 'MAX_DEVICES_REACHED',
        });
      }
      device = await prisma.device.create({
        data: {
          agentId: agent.id,
          deviceToken,
          platform: safePlatform,
          deviceLabel: deviceLabel || `Device ${activeDeviceCount + 1}`,
          cameraVidPid: req.body.cameraVidPid || 'UNKNOWN',
          macAddress: req.body.macAddress || null,
          cpuSerial: req.body.cpuSerial || null,
          imei: req.body.imei || null,
          lastSeenAt: new Date(),
        },
      });
    }

    const { generateAgentToken, generateRefreshToken } = require('../middleware/auth');
    const jwt = require('jsonwebtoken');
    const accessToken = generateAgentToken(agent, device.id);
    // Agent refresh token — long lived
    const refreshToken = jwt.sign(
      { id: agent.id, type: 'agent_refresh' },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '30d' }
    );

    // Audit log — use try/catch so a log failure never breaks login
    try {
      await createAuditLog({
        actorId: agent.id,
        actorType: 'Agent',
        actorRole: 'AGENT',
        action: 'USER_LOGIN',
        targetType: 'Agent',
        targetId: agent.id,
        description: `Agent ${agent.fullName} logged in on device ${device.deviceLabel}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
    } catch (auditErr) {
      logger.warn('Audit log failed (non-fatal):', auditErr.message);
    }

    res.json({
      accessToken,
      refreshToken,
      deviceId: device.id,
      agent: {
        id: agent.id,
        fullName: agent.fullName,
        email: agent.email,
        licenseNumber: agent.licenseNumber,
        licenseStatus: agent.licenseStatus,
        operatingState: agent.operatingState,
        operatingLGA: agent.operatingLGA,
        operatingGpsLat: agent.operatingGpsLat,
        operatingGpsLng: agent.operatingGpsLng,
        operatingRadiusKm: agent.operatingRadiusKm,
        strikeCount: agent.strikeCount,
        organizationId: agent.organizationId,
        biometricEnrolled: agent.biometricEnrolled,
      },
    });
  } catch (err) {
    logger.error('Agent login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Cosine similarity helper ─────────────────────────────────────────────────
function cosineSimilarity(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// POST /api/auth/biometric-enroll — First-time biometric enrollment
router.post('/biometric-enroll', authenticateToken, async (req, res) => {
  try {
    if (req.user.type !== 'agent') {
      return res.status(403).json({ error: 'Agent token required' });
    }
    const { faceDescriptor, palmDescriptor } = req.body;
    if (!faceDescriptor || !Array.isArray(faceDescriptor) || faceDescriptor.length === 0) {
      return res.status(400).json({ error: 'faceDescriptor is required (array of floats)' });
    }
    if (!palmDescriptor || !Array.isArray(palmDescriptor) || palmDescriptor.length === 0) {
      return res.status(400).json({ error: 'palmDescriptor is required (array of floats)' });
    }

    const agent = await prisma.agent.findUnique({ where: { id: req.user.agentId } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    // Store the biometric templates
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        rgbFaceDescriptor: faceDescriptor,
        rightPalmVeinTemplate: palmDescriptor,
        biometricEnrolled: true,
      },
    });

    logger.info(`Biometric enrolled for agent ${agent.fullName} (${agent.id})`);

    try {
      await createAuditLog({
        actorId: agent.id,
        actorType: 'Agent',
        actorRole: 'AGENT',
        action: 'USER_UPDATED',
        targetType: 'Agent',
        targetId: agent.id,
        description: `Agent ${agent.fullName} completed biometric enrollment (face + palm)`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
    } catch (auditErr) {
      logger.warn('Audit log failed (non-fatal):', auditErr.message);
    }

    res.json({ success: true, message: 'Biometric templates enrolled successfully' });
  } catch (err) {
    logger.error('Biometric enroll error:', err);
    res.status(500).json({ error: 'Biometric enrollment failed' });
  }
});

function computeEuclideanDistance(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0) return Infinity;
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// POST /api/auth/biometric-verify — Verify biometrics against stored templates
router.post('/biometric-verify', authenticateToken, async (req, res) => {
  try {
    if (req.user.type !== 'agent') {
      return res.status(403).json({ error: 'Agent token required' });
    }
    const { faceDescriptor, palmDescriptor } = req.body;
    if (!faceDescriptor || !palmDescriptor) {
      return res.status(400).json({ error: 'faceDescriptor and palmDescriptor are required' });
    }

    const agent = await prisma.agent.findUnique({ where: { id: req.user.agentId } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (!agent.biometricEnrolled) {
      return res.status(400).json({ error: 'Agent has not enrolled biometrics yet' });
    }

    // ── Euclidean distance metric (Maximum Security, matching app1-palm) ────
    const faceDist = computeEuclideanDistance(faceDescriptor, agent.rgbFaceDescriptor);
    const palmDist = computeEuclideanDistance(palmDescriptor, agent.rightPalmVeinTemplate);

    // Strict Euclidean distance thresholds (User requested <= 0.20 for face):
    // - Genuine face: ~0.06 - 0.08 (Threshold: 0.14). Imposters: >= 0.20 (Strictly rejected)
    // - Genuine palm: ~0.45 - 0.78 depending on hand tilt/depth (Threshold: 0.85, aligned with app1-palm). Imposters: >= 1.15
    const FACE_DIST_THRESHOLD = 0.14; // Strict cutoff (< 0.20): Genuine is ~0.06-0.08, Imposter is > 0.20
    const PALM_DIST_THRESHOLD = 0.85; // Strict cutoff for 298-dim palm: Genuine is < 0.80, Random imposter is > 1.15

    const faceMatch = faceDist <= FACE_DIST_THRESHOLD;
    const palmMatch = palmDist <= PALM_DIST_THRESHOLD;
    const verified = faceMatch && palmMatch;

    // Convert Euclidean distances to intuitive confidence percentages:
    const faceScore = Math.max(0, Math.min(1.0, 1.0 - (faceDist / (FACE_DIST_THRESHOLD * 2))));
    const palmScore = Math.max(0, Math.min(1.0, 1.0 - (palmDist / (PALM_DIST_THRESHOLD * 2))));

    logger.info(`Biometric verify for ${agent.fullName}: faceDist=${faceDist.toFixed(4)} (th <= ${FACE_DIST_THRESHOLD} → ${faceMatch ? 'PASS' : 'FAIL'}) palmDist=${palmDist.toFixed(4)} (th <= ${PALM_DIST_THRESHOLD} → ${palmMatch ? 'PASS' : 'FAIL'}) → ${verified ? 'VERIFIED' : 'REJECTED'}`);

    try {
      await createAuditLog({
        actorId: agent.id,
        actorType: 'Agent',
        actorRole: 'AGENT',
        action: 'USER_LOGIN',
        targetType: 'Agent',
        targetId: agent.id,
        description: verified
          ? `Biometric PASSED: faceDist=${faceDist.toFixed(4)} (${(faceScore * 100).toFixed(1)}%) palmDist=${palmDist.toFixed(4)} (${(palmScore * 100).toFixed(1)}%)`
          : `Biometric REJECTED (Unauthorized/Imposter): faceDist=${faceDist.toFixed(4)} (max ${FACE_DIST_THRESHOLD}) palmDist=${palmDist.toFixed(4)} (max ${PALM_DIST_THRESHOLD})`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
    } catch (auditErr) {
      logger.warn('Audit log failed (non-fatal):', auditErr.message);
    }

    res.json({
      verified,
      faceScore: parseFloat(faceScore.toFixed(4)),
      palmScore: parseFloat(palmScore.toFixed(4)),
      faceDist: parseFloat(faceDist.toFixed(4)),
      palmDist: parseFloat(palmDist.toFixed(4)),
      faceMatch,
      palmMatch,
      message: verified ? 'Identity verified successfully' : 'Biometrics do not match enrolled agent',
    });
  } catch (err) {
    logger.error('Biometric verify error:', err);
    res.status(500).json({ error: 'Biometric verification failed' });
  }
});

// POST /api/auth/refresh — Refresh access token
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ error: 'Refresh token required' });

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const user = await prisma.nimcUser.findUnique({ where: { id: decoded.id } });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    const newAccessToken = generateAccessToken(user);
    res.json({ accessToken: newAccessToken });
  } catch (err) {
    return res.status(403).json({ error: 'Invalid refresh token' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, async (req, res) => {
  await createAuditLog({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: 'USER_LOGOUT',
    targetType: 'User',
    targetId: req.user.id,
    description: `User logged out`,
    ipAddress: req.ip,
  });
  res.json({ message: 'Logged out successfully' });
});

// GET /api/auth/me — Get current user (portal user OR agent)
router.get('/me', authenticateToken, async (req, res) => {
  try {
    // Agent token
    if (req.user.type === 'agent') {
      const agent = await prisma.agent.findUnique({
        where: { id: req.user.agentId },
        select: {
          id: true, fullName: true, email: true, licenseNumber: true,
          licenseStatus: true, operatingState: true, operatingLGA: true,
          operatingGpsLat: true, operatingGpsLng: true, operatingRadiusKm: true,
          strikeCount: true, organizationId: true, biometricEnrolled: true,
          organization: { select: { id: true, name: true } },
        },
      });
      return res.json(agent);
    }

    // Portal user token
    const user = await prisma.nimcUser.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, email: true, fullName: true, role: true,
        organizationId: true, lastLoginAt: true,
        organization: { select: { id: true, name: true, status: true } },
      },
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

module.exports = router;
