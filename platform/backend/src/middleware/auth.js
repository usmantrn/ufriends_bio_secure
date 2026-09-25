const jwt = require('jsonwebtoken');
const logger = require('../lib/logger');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

/**
 * Generate an access token for a web portal user
 */
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId || null,
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
};

/**
 * Generate a refresh token
 */
const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user.id },
    JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
};

/**
 * Generate a session token for an agent (app login)
 */
const generateAgentToken = (agent, deviceId) => {
  return jwt.sign(
    {
      agentId: agent.id,
      deviceId,
      type: 'agent',
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
};

/**
 * Middleware: authenticate web portal JWT
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    logger.warn(`Invalid token attempt: ${err.message}`);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

/**
 * Middleware: authenticate agent app JWT
 */
const authenticateAgentToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Agent token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'agent') {
      return res.status(403).json({ error: 'Not an agent token' });
    }
    req.agent = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid agent token' });
  }
};

/**
 * Middleware: require specific role(s)
 * Usage: requireRole('SUPER_ADMIN') or requireRole(['SUPER_ADMIN', 'COMPLIANCE_OFFICER'])
 */
const requireRole = (...roles) => {
  const allowedRoles = roles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(`Role check failed: ${req.user.role} tried to access ${req.path} (requires ${allowedRoles.join('/')})`);
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: req.user.role,
      });
    }
    next();
  };
};

/**
 * Middleware: require NIMC/NIBSS staff (SUPER_ADMIN or COMPLIANCE_OFFICER)
 */
const requireNIMCStaff = requireRole(['SUPER_ADMIN', 'COMPLIANCE_OFFICER']);

/**
 * Middleware: require partner portal user (PARTNER_ADMIN or SUPER_AGENT)
 */
const requirePartner = requireRole(['PARTNER_ADMIN', 'SUPER_AGENT']);

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateAgentToken,
  authenticateToken,
  authenticateAgentToken,
  requireRole,
  requireNIMCStaff,
  requirePartner,
};
