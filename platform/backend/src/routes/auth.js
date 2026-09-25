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

    // Check if this device is registered
    let device = agent.devices.find(d => d.deviceToken === deviceToken && d.isActive);

    if (!device) {
      // Is it a new device registration attempt?
      const activeDeviceCount = agent.devices.filter(d => d.isActive).length;
      const maxDevices = parseInt(process.env.MAX_DEVICES_PER_AGENT) || 2;

      if (activeDeviceCount >= maxDevices) {
        return res.status(403).json({
          error: `Maximum ${maxDevices} devices allowed. Deregister an existing device first.`,
          code: 'MAX_DEVICES_REACHED',
        });
      }

      // Register the new device — platform must be UPPERCASE to match Prisma enum
      const platformUpper = (platform || 'ANDROID').toUpperCase();
      const validPlatforms = ['ANDROID', 'WINDOWS', 'LINUX', 'IOS'];
      const safePlatform = validPlatforms.includes(platformUpper) ? platformUpper : 'ANDROID';

      device = await prisma.device.create({
        data: {
          agentId: agent.id,
          deviceToken,
          platform: safePlatform,
          deviceLabel: deviceLabel || `Device ${activeDeviceCount + 1}`,
          cameraVidPid: req.body.cameraVidPid || 'UNKNOWN',
          macAddress: req.body.macAddress,
          cpuSerial: req.body.cpuSerial,
          imei: req.body.imei,
          lastSeenAt: new Date(),
        },
      });
    } else {
      // Update last seen
      await prisma.device.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
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
      },
    });
  } catch (err) {
    logger.error('Agent login error:', err);
    res.status(500).json({ error: 'Login failed' });
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
          strikeCount: true, organizationId: true,
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
