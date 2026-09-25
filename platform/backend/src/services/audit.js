// Audit log service — used by all routes to write immutable audit trail
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');

/**
 * Creates an immutable audit log entry.
 * This should be called after every significant action.
 */
const createAuditLog = async ({
  actorId = null,
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
    await prisma.auditLog.create({
      data: {
        actorId,
        actorRole,
        action,
        targetType,
        targetId,
        description,
        metadata,
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
