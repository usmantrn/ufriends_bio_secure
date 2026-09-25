const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/auth');
const { createAuditLog } = require('../services/audit');

// GET /api/settings — Get current system settings
router.get('/', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    let settings = await prisma.systemSettings.findFirst();
    if (!settings) {
      settings = await prisma.systemSettings.create({ data: {} });
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/settings — Update system settings
router.patch('/', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const allowedFields = [
      'enrollmentSessionDurationHours', 'maxDevicesPerAgent', 'maxEnrollmentsPerHour',
      'minEnrollmentSeconds', 'maxClockDriftSeconds', 'flagSpeedWindowSize',
      'flagSpeedMinSeconds', 'flagDemographicClusterCount',
      'strikeSessionLockThreshold', 'strikeAccountSuspendThreshold', 'strikePermanentBanThreshold',
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = parseInt(req.body[field]);
    }

    let settings = await prisma.systemSettings.findFirst();
    if (!settings) {
      settings = await prisma.systemSettings.create({ data: { ...updates, updatedById: req.user.id } });
    } else {
      settings = await prisma.systemSettings.update({
        where: { id: settings.id },
        data: { ...updates, updatedById: req.user.id },
      });
    }

    await createAuditLog({
      actorId: req.user.id, actorRole: req.user.role,
      action: 'SETTINGS_UPDATED', targetType: 'SystemSettings', targetId: settings.id,
      description: `System settings updated: ${Object.keys(updates).join(', ')}`,
      metadata: updates,
    });

    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
