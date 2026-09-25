const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireRole, requireNIMCStaff } = require('../middleware/auth');
const { createAuditLog } = require('../services/audit');

// GET /api/organizations — List orgs
router.get('/', requireNIMCStaff, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const where = status ? { status } : {};
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [orgs, total] = await Promise.all([
      prisma.organization.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { agents: true, users: true } },
        },
      }),
      prisma.organization.count({ where }),
    ]);

    res.json({ organizations: orgs, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/organizations — Register a new org
router.post('/', requireNIMCStaff, async (req, res) => {
  try {
    const { name, rcNumber, address, state, lga, contactEmail, contactPhone, directorName, directorNin } = req.body;
    const org = await prisma.organization.create({
      data: { name, rcNumber, address, state, lga, contactEmail, contactPhone, directorName, directorNin },
    });

    await createAuditLog({
      actorId: req.user.id, actorRole: req.user.role,
      action: 'ORG_CREATED', targetType: 'Organization', targetId: org.id,
      description: `Organization ${name} (RC: ${rcNumber}) created`,
    });

    res.status(201).json(org);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Organization with this RC number already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/organizations/:id/approve
router.patch('/:id/approve', requireNIMCStaff, async (req, res) => {
  try {
    const org = await prisma.organization.update({
      where: { id: req.params.id },
      data: { status: 'ACTIVE', approvedById: req.user.id, approvedAt: new Date() },
    });

    await createAuditLog({
      actorId: req.user.id, actorRole: req.user.role,
      action: 'ORG_APPROVED', targetType: 'Organization', targetId: org.id,
      description: `Organization ${org.name} approved`,
    });

    res.json(org);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/organizations/:id/suspend
router.patch('/:id/suspend', requireNIMCStaff, async (req, res) => {
  try {
    const org = await prisma.organization.update({
      where: { id: req.params.id },
      data: { status: 'SUSPENDED' },
    });

    await createAuditLog({
      actorId: req.user.id, actorRole: req.user.role,
      action: 'ORG_SUSPENDED', targetType: 'Organization', targetId: org.id,
      description: `Organization ${org.name} suspended`,
    });

    res.json(org);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
