// NIMC/NIBSS Platform — Main Express Server
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { authenticateToken, requireRole } = require('./middleware/auth');
const logger = require('./lib/logger');

// Route imports
const authRoutes = require('./routes/auth');
const agentRoutes = require('./routes/agents');
const organizationRoutes = require('./routes/organizations');
const enrollmentRoutes = require('./routes/enrollments');
const sessionRoutes = require('./routes/sessions');
const strikeRoutes = require('./routes/strikes');
const flagRoutes = require('./routes/flags');
const auditRoutes = require('./routes/audit');
const dashboardRoutes = require('./routes/dashboard');
const settingsRoutes = require('./routes/settings');

const app = express();
const httpServer = http.createServer(app);

// ─────────────────────────────────────────────────────────────────
// SOCKET.IO — Real-time event broadcasting
// ─────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: [
      process.env.STAKEHOLDER_PORTAL_URL,
      process.env.PARTNER_PORTAL_URL,
    ],
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Make io available to route handlers
app.set('io', io);

io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on('join:stakeholder', () => {
    socket.join('stakeholder-room');
    logger.info(`Socket ${socket.id} joined stakeholder-room`);
  });

  socket.on('join:partner', (orgId) => {
    socket.join(`partner-room:${orgId}`);
    logger.info(`Socket ${socket.id} joined partner-room:${orgId}`);
  });

  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });
});

// ─────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } }));

app.use(cors({
  origin: (origin, callback) => {
    // Allow: web portals, mobile app (no Origin header), and local dev tools
    const allowed = [
      process.env.STAKEHOLDER_PORTAL_URL,
      process.env.PARTNER_PORTAL_URL,
    ];
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));  // 10MB for biometric template uploads
app.use(express.urlencoded({ extended: true }));

// Rate limiting — global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  message: { error: 'Too many requests, please try again later.' },
});
app.use(globalLimiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts, please try again later.' },
});

// ─────────────────────────────────────────────────────────────────
// SERVER TIME ENDPOINT (for NTP validation in agent app)
// ─────────────────────────────────────────────────────────────────
app.get('/api/server-time', (req, res) => {
  res.json({
    serverTime: new Date().toISOString(),
    timestamp: Date.now(),
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Ufriends BioSecure Platform API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/agents', authenticateToken, agentRoutes);
app.use('/api/organizations', authenticateToken, organizationRoutes);
app.use('/api/enrollments', authenticateToken, enrollmentRoutes);
app.use('/api/sessions', sessionRoutes);       // Agent app uses session routes (different auth)
app.use('/api/strikes', authenticateToken, strikeRoutes);
app.use('/api/flags', authenticateToken, flagRoutes);
app.use('/api/audit', authenticateToken, auditRoutes);
app.use('/api/dashboard', authenticateToken, dashboardRoutes);
app.use('/api/settings', authenticateToken, settingsRoutes);

// ─────────────────────────────────────────────────────────────────
// ERROR HANDLING
// ─────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ─────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Ufriends BioSecure API running on 0.0.0.0:${PORT}`);
  logger.info(`🔌 Socket.io enabled for real-time events`);
  logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
  logger.info(`📱 LAN access: http://10.146.232.21:${PORT}/api/health`);
});

module.exports = { app, io };
