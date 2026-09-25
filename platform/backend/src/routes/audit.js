const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireNIMCStaff } = require('../middleware/auth');

// GET /api/audit — Immutable audit trail
router.get('/', requireNIMCStaff, async (req, res) => {
  try {
    const { action, actorId, targetType, targetId, startDate, endDate, page = 1, limit = 50 } = req.query;
    const where = {};

    if (action) where.action = action;
    if (actorId) where.actorId = actorId;
    if (targetType) where.targetType = targetType;
    if (targetId) where.targetId = targetId;
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate);
      if (endDate) where.timestamp.lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { timestamp: 'desc' },
        include: {
          actor: { select: { fullName: true, role: true, email: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ logs, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/audit/actions — List all possible actions for filter dropdown
router.get('/actions', requireNIMCStaff, async (req, res) => {
  const actions = await prisma.auditLog.findMany({
    distinct: ['action'],
    select: { action: true },
    orderBy: { action: 'asc' },
  });
  res.json(actions.map(a => a.action));
});

module.exports = router;
