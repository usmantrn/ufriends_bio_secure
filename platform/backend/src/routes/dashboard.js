const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// GET /api/dashboard/stats — Main dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const isPartner = req.user.role === 'PARTNER_ADMIN' || req.user.role === 'SUPER_AGENT';
    const orgFilter = isPartner ? { organizationId: req.user.organizationId } : {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalAgents,
      activeAgents,
      pendingAgents,
      suspendedAgents,
      bannedAgents,
      totalEnrollments,
      todayEnrollments,
      flaggedEnrollments,
      openFlags,
      criticalFlags,
      totalStrikes,
      unresolvedStrikes,
      totalOrgs,
    ] = await Promise.all([
      prisma.agent.count({ where: { ...orgFilter } }),
      prisma.agent.count({ where: { ...orgFilter, licenseStatus: 'ACTIVE' } }),
      prisma.agent.count({ where: { ...orgFilter, licenseStatus: 'PENDING' } }),
      prisma.agent.count({ where: { ...orgFilter, licenseStatus: 'SUSPENDED' } }),
      prisma.agent.count({ where: { ...orgFilter, licenseStatus: 'BANNED' } }),
      prisma.citizen.count({ where: isPartner ? { enrolledByAgent: orgFilter } : {} }),
      prisma.citizen.count({
        where: {
          ...(isPartner ? { enrolledByAgent: orgFilter } : {}),
          enrolledAt: { gte: today },
        },
      }),
      prisma.citizen.count({
        where: {
          ...(isPartner ? { enrolledByAgent: orgFilter } : {}),
          flaggedForReview: true,
        },
      }),
      prisma.flag.count({
        where: {
          status: { in: ['OPEN', 'UNDER_REVIEW'] },
          ...(isPartner ? { agent: orgFilter } : {}),
        },
      }),
      prisma.flag.count({
        where: {
          status: { in: ['OPEN', 'UNDER_REVIEW'] },
          severity: 'CRITICAL',
          ...(isPartner ? { agent: orgFilter } : {}),
        },
      }),
      prisma.strike.count({ where: isPartner ? { agent: orgFilter } : {} }),
      prisma.strike.count({ where: { isResolved: false, ...(isPartner ? { agent: orgFilter } : {}) } }),
      isPartner ? Promise.resolve(null) : prisma.organization.count(),
    ]);

    // Enrollments by state (for map)
    const enrollmentsByState = await prisma.citizen.groupBy({
      by: ['stateOfResidence'],
      _count: { id: true },
      where: isPartner ? { enrolledByAgent: orgFilter } : {},
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    });

    // Strikes by trigger type
    const strikesByTrigger = await prisma.strike.groupBy({
      by: ['trigger'],
      _count: { id: true },
      where: isPartner ? { agent: orgFilter } : {},
      orderBy: { _count: { id: 'desc' } },
    });

    // Recent enrollments for timeline chart (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dailyEnrollments = (await prisma.$queryRaw`
      SELECT DATE("enrolledAt") as date, COUNT(*) as count
      FROM nimc_citizens
      WHERE "enrolledAt" >= ${sevenDaysAgo}
      GROUP BY DATE("enrolledAt")
      ORDER BY date ASC
    `).map(row => ({ date: row.date, count: Number(row.count) }));

    res.json({
      agents: { total: totalAgents, active: activeAgents, pending: pendingAgents, suspended: suspendedAgents, banned: bannedAgents },
      enrollments: { total: totalEnrollments, today: todayEnrollments, flagged: flaggedEnrollments },
      flags: { open: openFlags, critical: criticalFlags },
      strikes: { total: totalStrikes, unresolved: unresolvedStrikes },
      organizations: totalOrgs,
      charts: {
        enrollmentsByState,
        strikesByTrigger,
        dailyEnrollments,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/map-data — GPS points for map visualization
router.get('/map-data', async (req, res) => {
  try {
    const isPartner = req.user.role === 'PARTNER_ADMIN' || req.user.role === 'SUPER_AGENT';
    const orgFilter = isPartner ? { organizationId: req.user.organizationId } : {};
    const hoursBack = parseInt(req.query.hours) || 24;
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    const enrollments = await prisma.citizen.findMany({
      where: {
        enrolledAt: { gte: since },
        enrollmentGpsLat: { not: null },
        enrollmentGpsLng: { not: null },
        ...(isPartner ? { enrolledByAgent: orgFilter } : {}),
      },
      select: {
        id: true,
        enrollmentGpsLat: true,
        enrollmentGpsLng: true,
        flaggedForReview: true,
        enrolledAt: true,
        stateOfResidence: true,
        enrolledByAgent: { select: { fullName: true, licenseNumber: true } },
      },
      take: 2000,
    });

    res.json({ points: enrollments, since: since.toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/recent-activity — Live activity feed
router.get('/recent-activity', async (req, res) => {
  try {
    const [recentEnrollments, recentStrikes, recentFlags] = await Promise.all([
      prisma.citizen.findMany({
        take: 5, orderBy: { enrolledAt: 'desc' },
        select: {
          id: true, fullName: true, stateOfResidence: true,
          enrolledAt: true, flaggedForReview: true,
          enrolledByAgent: { select: { fullName: true } },
        },
      }),
      prisma.strike.findMany({
        take: 5, orderBy: { issuedAt: 'desc' },
        select: {
          id: true, trigger: true, strikeNumber: true, issuedAt: true,
          agent: { select: { fullName: true } },
        },
      }),
      prisma.flag.findMany({
        where: { status: 'OPEN' },
        take: 5, orderBy: { raisedAt: 'desc' },
        select: {
          id: true, flagType: true, severity: true, raisedAt: true,
          agent: { select: { fullName: true } },
        },
      }),
    ]);

    res.json({ recentEnrollments, recentStrikes, recentFlags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
