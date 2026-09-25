const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireRole, requireNIMCStaff } = require('../middleware/auth');
const { issueStrike, unlockStrike, canUnlock } = require('../services/strikes');
const { createAuditLog } = require('../services/audit');

// GET /api/strikes — List strikes
router.get('/', async (req, res) => {
  try {
    const { agentId, trigger, resolved, page = 1, limit = 20 } = req.query;
    const where = {};

    if (trigger) where.trigger = trigger;
    if (resolved !== undefined) where.isResolved = resolved === 'true';

    // Scope for partner roles
    if (req.user.role === 'PARTNER_ADMIN' || req.user.role === 'SUPER_AGENT') {
      where.agent = { organizationId: req.user.organizationId };
      if (req.user.role === 'SUPER_AGENT') where.agent.superAgentUserId = req.user.id;
    } else if (agentId) {
      where.agentId = agentId;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [strikes, total] = await Promise.all([
      prisma.strike.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { issuedAt: 'desc' },
        include: {
          agent: { select: { id: true, fullName: true, licenseNumber: true, licenseStatus: true, strikeCount: true } },
          resolvedBy: { select: { fullName: true, role: true } },
        },
      }),
      prisma.strike.count({ where }),
    ]);

    res.json({ strikes, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/strikes/issue — Manually issue a strike (compliance officers)
router.post('/issue', requireNIMCStaff, async (req, res) => {
  try {
    const { agentId, trigger = 'MANUAL_STRIKE', details } = req.body;
    if (!agentId || !details) return res.status(400).json({ error: 'agentId and details required' });

    const io = req.app.get('io');
    const result = await issueStrike({
      agentId, trigger, details,
      issuedByUserId: req.user.id, io,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/strikes/:id/unlock — Unlock/resolve a strike
router.patch('/:id/unlock', async (req, res) => {
  try {
    const { resolveNote } = req.body;
    const io = req.app.get('io');

    const result = await unlockStrike({
      strikeId: req.params.id,
      resolvedById: req.user.id,
      userRole: req.user.role,
      resolveNote,
      io,
    });

    res.json({
      message: 'Strike unlocked successfully',
      newStrikeCount: result.newStrikeCount,
      newStatus: result.newStatus,
    });
  } catch (err) {
    if (err.message.includes('cannot unlock')) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/strikes/can-unlock/:agentId — Check if current user can unlock this agent's strikes
router.get('/can-unlock/:agentId', async (req, res) => {
  try {
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.agentId },
      select: { strikeCount: true, licenseStatus: true },
    });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const allowed = canUnlock(req.user.role, agent.strikeCount);
    res.json({
      canUnlock: allowed,
      agentStrikeCount: agent.strikeCount,
      agentStatus: agent.licenseStatus,
      userRole: req.user.role,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
