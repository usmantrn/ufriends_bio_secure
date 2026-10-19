// Audit log service — used by all routes to write immutable audit trail
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');

/**
 * Creates an immutable audit log entry.
 * This should be called after every significant action.
 */
const createAuditLog = async ({
  actorId = null,
  actorType = null,
  actorRole = null,
  action,
  targetType = null,
  targetId = null,
  description,
  metadata = null,
  ipAddress = null,
  userAgent = null,
}) => {
  try {
    // actorId foreign-keys to NimcUser. If actor is an Agent, store in metadata instead.
    const isAgent = actorType === 'Agent' || actorRole === 'AGENT';
    const effectiveActorId = isAgent ? null : actorId;
    const effectiveMetadata = isAgent && actorId
      ? { ...(metadata || {}), agentActorId: actorId }
      : metadata;

    await prisma.auditLog.create({
      data: {
        actorId: effectiveActorId,
        actorRole,
        action,
        targetType,
        targetId,
        description,
        metadata: effectiveMetadata,
        ipAddress,
        userAgent,
        timestamp: new Date(),
      },
    });
  } catch (err) {
    // Never let audit log failure block the main action
    logger.error('Failed to create audit log:', { action, actorId, err: err.message });
  }
};

module.exports = { createAuditLog };
