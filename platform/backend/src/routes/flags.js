const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireNIMCStaff } = require('../middleware/auth');
const { createAuditLog } = require('../services/audit');

// GET /api/flags — List all behavioral flags
router.get('/', async (req, res) => {
  try {
    const { status, flagType, severity, agentId, page = 1, limit = 20 } = req.query;
    const where = {};

    if (status) where.status = status;
    if (flagType) where.flagType = flagType;
    if (severity) where.severity = severity;

    if (req.user.role === 'PARTNER_ADMIN' || req.user.role === 'SUPER_AGENT') {
      where.agent = { organizationId: req.user.organizationId };
    } else if (agentId) {
      where.agentId = agentId;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [flags, total] = await Promise.all([
      prisma.flag.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { raisedAt: 'desc' },
        include: {
          agent: { select: { id: true, fullName: true, licenseNumber: true, organization: { select: { name: true } } } },
          reviewedBy: { select: { fullName: true, role: true } },
        },
      }),
      prisma.flag.count({ where }),
    ]);

    res.json({ flags, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/flags/:id/assign — Assign flag for review
router.patch('/:id/assign', requireNIMCStaff, async (req, res) => {
  try {
    const flag = await prisma.flag.update({
      where: { id: req.params.id },
      data: { status: 'UNDER_REVIEW', assignedToId: req.user.id },
    });

    await createAuditLog({
      actorId: req.user.id, actorRole: req.user.role,
      action: 'FLAG_REVIEWED', targetType: 'Flag', targetId: flag.id,
      description: `Flag ${flag.flagType} assigned to ${req.user.id} for review`,
    });

    res.json(flag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/flags/:id/resolve — Resolve a flag
router.patch('/:id/resolve', requireNIMCStaff, async (req, res) => {
  try {
    const { resolveNote, escalate = false } = req.body;

    const flag = await prisma.flag.update({
      where: { id: req.params.id },
      data: {
        status: escalate ? 'ESCALATED' : 'RESOLVED',
        reviewedById: req.user.id,
        reviewedAt: new Date(),
        resolveNote,
      },
    });

    await createAuditLog({
      actorId: req.user.id, actorRole: req.user.role,
      action: escalate ? 'FLAG_ESCALATED' : 'FLAG_RESOLVED',
      targetType: 'Flag', targetId: flag.id,
      description: `Flag ${flag.flagType} ${escalate ? 'escalated' : 'resolved'}. Note: ${resolveNote}`,
    });

    res.json(flag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/flags/summary — Flag counts by type and severity
router.get('/summary', async (req, res) => {
  try {
    const [byType, bySeverity, byStatus] = await Promise.all([
      prisma.flag.groupBy({ by: ['flagType'], _count: { id: true } }),
      prisma.flag.groupBy({ by: ['severity'], _count: { id: true }, where: { status: 'OPEN' } }),
      prisma.flag.groupBy({ by: ['status'], _count: { id: true } }),
    ]);

    res.json({ byType, bySeverity, byStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
