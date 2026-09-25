const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireRole, requireNIMCStaff } = require('../middleware/auth');
const { createAuditLog } = require('../services/audit');

// GET /api/agents — List agents (with filters)
router.get('/', async (req, res) => {
  try {
    const {
      status, state, lga, organizationId, superAgentUserId,
      search, page = 1, limit = 20
    } = req.query;

    const where = {};
    if (status) where.licenseStatus = status;
    if (state) where.operatingState = state;
    if (lga) where.operatingLGA = lga;

    // Partner roles can only see their own org's agents
    if (req.user.role === 'PARTNER_ADMIN' || req.user.role === 'SUPER_AGENT') {
      where.organizationId = req.user.organizationId;
    } else if (organizationId) {
      where.organizationId = organizationId;
    }

    if (req.user.role === 'SUPER_AGENT') {
      where.superAgentUserId = req.user.id;
    } else if (superAgentUserId) {
      where.superAgentUserId = superAgentUserId;
    }

    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { nin: { contains: search } },
        { licenseNumber: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [agents, total] = await Promise.all([
      prisma.agent.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, fullName: true, nin: true, email: true, phone: true,
          licenseNumber: true, licenseStatus: true,
          operatingState: true, operatingLGA: true,
          strikeCount: true, lastStrikeAt: true,
          organization: { select: { id: true, name: true } },
          createdAt: true, approvedAt: true,
          _count: { select: { enrollments: true, strikes: true } },
        },
      }),
      prisma.agent.count({ where }),
    ]);

    res.json({ agents, total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents/:id — Agent detail
router.get('/:id', async (req, res) => {
  try {
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      include: {
        organization: true,
        guarantors: true,
        devices: true,
        strikes: { orderBy: { issuedAt: 'desc' }, take: 20, include: { resolvedBy: { select: { fullName: true, role: true } } } },
        flags: { orderBy: { raisedAt: 'desc' }, take: 10 },
        _count: { select: { enrollments: true } },
      },
    });

    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    // Scope check for partner roles
    if ((req.user.role === 'PARTNER_ADMIN' || req.user.role === 'SUPER_AGENT')
        && agent.organizationId !== req.user.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Remove sensitive biometric data from response
    const { rgbFaceDescriptor, irFaceDescriptor, leftPalmVeinTemplate,
            rightPalmVeinTemplate, passwordHash, ...safeAgent } = agent;

    res.json(safeAgent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agents — Submit agent onboarding
router.post('/', requireRole(['PARTNER_ADMIN', 'SUPER_AGENT']), async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const {
      fullName, nin, bvn, dateOfBirth, gender, phone, email,
      address, stateOfOrigin, operatingState, operatingLGA,
      guarantors, irFaceDescriptor = [], leftPalmVeinTemplate = [],
      rightPalmVeinTemplate = [], rgbFaceDescriptor = [],
    } = req.body;

    if (!fullName || !nin || !bvn || !email || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const tempPassword = `NIMC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const agent = await prisma.agent.create({
      data: {
        fullName, nin, bvn,
        dateOfBirth: new Date(dateOfBirth),
        gender, phone,
        email: email.toLowerCase().trim(),
        passwordHash,
        address, stateOfOrigin,
        organizationId: req.user.organizationId,
        superAgentUserId: req.user.role === 'SUPER_AGENT' ? req.user.id : null,
        operatingState, operatingLGA,
        irFaceDescriptor, leftPalmVeinTemplate, rightPalmVeinTemplate, rgbFaceDescriptor,
        guarantors: guarantors ? {
          create: guarantors.map(g => ({
            fullName: g.fullName, nin: g.nin, phone: g.phone,
            email: g.email, relationship: g.relationship,
            address: g.address, state: g.state,
          })),
        } : undefined,
      },
      include: { guarantors: true },
    });

    await createAuditLog({
      actorId: req.user.id, actorRole: req.user.role,
      action: 'AGENT_SUBMITTED', targetType: 'Agent', targetId: agent.id,
      description: `New agent ${fullName} submitted for onboarding`,
      ipAddress: req.ip,
    });

    res.status(201).json({
      agent: { id: agent.id, licenseNumber: agent.licenseNumber, licenseStatus: agent.licenseStatus },
      tempPassword, // Return temp password so partner can share with agent
    });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Agent with this NIN, BVN, or email already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/agents/:id/approve — Approve an agent (NIMC/NIBSS only)
router.patch('/:id/approve', requireNIMCStaff, async (req, res) => {
  try {
    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data: {
        licenseStatus: 'ACTIVE',
        approvedById: req.user.id,
        approvedAt: new Date(),
      },
    });

    await createAuditLog({
      actorId: req.user.id, actorRole: req.user.role,
      action: 'AGENT_APPROVED', targetType: 'Agent', targetId: agent.id,
      description: `Agent ${agent.fullName} approved by ${req.user.role}`,
    });

    const io = req.app.get('io');
    if (io) {
      io.to('stakeholder-room').emit('agent:approved', { agentId: agent.id, agentName: agent.fullName });
    }

    res.json({ message: 'Agent approved', licenseNumber: agent.licenseNumber });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/agents/:id/suspend — Suspend agent
router.patch('/:id/suspend', requireNIMCStaff, async (req, res) => {
  try {
    const { reason } = req.body;
    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data: { licenseStatus: 'SUSPENDED' },
    });

    await createAuditLog({
      actorId: req.user.id, actorRole: req.user.role,
      action: 'AGENT_SUSPENDED', targetType: 'Agent', targetId: agent.id,
      description: `Agent ${agent.fullName} suspended. Reason: ${reason || 'Not specified'}`,
    });

    res.json({ message: 'Agent suspended' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/agents/:id/ban — Permanently ban agent (SUPER_ADMIN only)
router.patch('/:id/ban', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { reason } = req.body;
    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data: {
        licenseStatus: 'BANNED',
        bannedById: req.user.id,
        bannedAt: new Date(),
        banReason: reason,
      },
    });

    await createAuditLog({
      actorId: req.user.id, actorRole: req.user.role,
      action: 'AGENT_BANNED', targetType: 'Agent', targetId: agent.id,
      description: `Agent ${agent.fullName} PERMANENTLY BANNED. Reason: ${reason}`,
    });

    const io = req.app.get('io');
    if (io) {
      io.to('stakeholder-room').emit('agent:banned', {
        agentId: agent.id, agentName: agent.fullName,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({ message: 'Agent permanently banned. All enrollments flagged for review.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
