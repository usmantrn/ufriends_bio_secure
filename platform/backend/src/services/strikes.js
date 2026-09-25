// Strike system service
const prisma = require('../lib/prisma');
const { createAuditLog } = require('./audit');
const logger = require('../lib/logger');

const STRIKE_LOCK_THRESHOLD = parseInt(process.env.STRIKE_LOCK_THRESHOLD) || 3;
const STRIKE_SUSPEND_THRESHOLD = parseInt(process.env.STRIKE_SUSPEND_THRESHOLD) || 4;
const STRIKE_BAN_THRESHOLD = parseInt(process.env.STRIKE_BAN_THRESHOLD) || 5;

/**
 * Issue a strike to an agent.
 * Handles escalation automatically.
 */
const issueStrike = async ({ agentId, sessionId = null, trigger, details, metadata = null, issuedByUserId = null, io = null }) => {
  try {
    // Get current agent state
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, fullName: true, strikeCount: true, licenseStatus: true },
    });

    if (!agent) throw new Error(`Agent ${agentId} not found`);
    if (agent.licenseStatus === 'BANNED') {
      logger.info(`Strike attempted on BANNED agent ${agentId} — ignored`);
      return { skipped: true, reason: 'Agent already permanently banned' };
    }

    const newStrikeCount = agent.strikeCount + 1;

    // Create the strike record
    const strike = await prisma.strike.create({
      data: {
        agentId,
        sessionId,
        strikeNumber: newStrikeCount,
        trigger,
        details,
        metadata,
      },
    });

    // Determine new status based on strike count
    let newStatus = agent.licenseStatus;
    let escalationLevel = null;

    if (newStrikeCount >= STRIKE_BAN_THRESHOLD) {
      newStatus = 'BANNED';
      escalationLevel = 'PERMANENT_BAN';
    } else if (newStrikeCount >= STRIKE_SUSPEND_THRESHOLD) {
      newStatus = 'SUSPENDED';
      escalationLevel = 'ACCOUNT_SUSPENDED';
    } else if (newStrikeCount === STRIKE_LOCK_THRESHOLD) {
      escalationLevel = 'SESSION_LOCKED';
    }

    // Update agent
    await prisma.agent.update({
      where: { id: agentId },
      data: {
        strikeCount: newStrikeCount,
        lastStrikeAt: new Date(),
        licenseStatus: newStatus,
      },
    });

    // Audit log
    await createAuditLog({
      actorId: issuedByUserId,
      actorRole: issuedByUserId ? 'SYSTEM' : 'SYSTEM',
      action: 'STRIKE_ISSUED',
      targetType: 'Agent',
      targetId: agentId,
      description: `Strike #${newStrikeCount} issued to agent ${agent.fullName}. Trigger: ${trigger}. ${escalationLevel ? `Escalation: ${escalationLevel}` : ''}`,
      metadata: { strikeId: strike.id, trigger, newStrikeCount, escalationLevel },
    });

    // Real-time Socket.io broadcast
    if (io) {
      io.to('stakeholder-room').emit('strike:issued', {
        agentId,
        agentName: agent.fullName,
        strikeNumber: newStrikeCount,
        trigger,
        details,
        escalationLevel,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      strike,
      newStrikeCount,
      newStatus,
      escalationLevel,
    };
  } catch (err) {
    logger.error('issueStrike error:', err);
    throw err;
  }
};

/**
 * Check who can unlock a given strike count.
 * Super-Agent: can unlock strike 1–3 ONLY
 * Partner Admin: can unlock strike 1–4
 * NIMC/NIBSS: can unlock anything
 */
const canUnlock = (userRole, agentStrikeCount) => {
  switch (userRole) {
    case 'SUPER_AGENT':
      return agentStrikeCount <= 3;
    case 'PARTNER_ADMIN':
      return agentStrikeCount <= 4;
    case 'COMPLIANCE_OFFICER':
    case 'SUPER_ADMIN':
      return true;
    default:
      return false;
  }
};

/**
 * Unlock/resolve a strike (reduce agent's strike count by 1, restore status if appropriate)
 */
const unlockStrike = async ({ strikeId, resolvedById, resolveNote, userRole, io = null }) => {
  const strike = await prisma.strike.findUnique({
    where: { id: strikeId },
    include: { agent: true },
  });

  if (!strike) throw new Error('Strike not found');
  if (strike.isResolved) throw new Error('Strike already resolved');

  // Check permission
  if (!canUnlock(userRole, strike.agent.strikeCount)) {
    throw new Error(`Your role (${userRole}) cannot unlock this strike — agent has ${strike.agent.strikeCount} strikes`);
  }

  const newStrikeCount = Math.max(0, strike.agent.strikeCount - 1);
  let newStatus = 'ACTIVE';
  if (newStrikeCount >= STRIKE_BAN_THRESHOLD) newStatus = 'BANNED';
  else if (newStrikeCount >= STRIKE_SUSPEND_THRESHOLD) newStatus = 'SUSPENDED';

  // Resolve the strike
  await prisma.strike.update({
    where: { id: strikeId },
    data: { isResolved: true, resolvedById, resolvedAt: new Date(), resolveNote },
  });

  // Update agent
  await prisma.agent.update({
    where: { id: strike.agentId },
    data: { strikeCount: newStrikeCount, licenseStatus: newStatus },
  });

  await createAuditLog({
    actorId: resolvedById,
    actorRole: userRole,
    action: 'STRIKE_UNLOCKED',
    targetType: 'Strike',
    targetId: strikeId,
    description: `Strike #${strike.strikeNumber} resolved for agent ${strike.agent.fullName}. New count: ${newStrikeCount}`,
    metadata: { newStrikeCount, newStatus },
  });

  if (io) {
    io.to('stakeholder-room').emit('strike:resolved', {
      agentId: strike.agentId,
      strikeId,
      newStrikeCount,
      newStatus,
      timestamp: new Date().toISOString(),
    });
  }

  return { strike, newStrikeCount, newStatus };
};

module.exports = { issueStrike, unlockStrike, canUnlock };
