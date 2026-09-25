// ============================================
// App 1: Palm Geometry Biometric (HTTPS Server)
// ============================================

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');

// ── App Setup ────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    // Allow any HTTPS request from localhost or any local network IP
    if (origin.startsWith('https://localhost') || origin.startsWith('https://127.0.0.1') || /^https:\/\/10\./.test(origin) || /^https:\/\/192\.168\./.test(origin) || /^https:\/\/172\./.test(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/mediapipe', express.static(path.join(__dirname, 'public/models/mediapipe')));

app.use(
  session({
    store: new FileStore({
      path: path.join(__dirname, 'sessions'),  // Save sessions to /sessions folder
      ttl:  60 * 60 * 8,   // Sessions live for 8 hours
      retries: 1,
      logFn: () => {}      // Suppress verbose file-store logs
    }),
    secret: process.env.SESSION_SECRET || 'biometric_dev_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,        // HTTPS only
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8  // 8 hours
    },
  })
);

// ── Database Setup (JSON File) ───────────────────────────────────────────────
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);
const dbPath = path.join(dbDir, 'database.json');

if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, JSON.stringify({
    users: [],
    auth_logs: [],
    agents: [], // Added for NIMC agents
    nextId: { user: 1, log: 1, agent: 1 }
  }, null, 2));
}

const readDb = () => JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const writeDb = (data) => fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));

// ── Utility Functions for Biometrics ─────────────────────────────────────────

// Compare two 1D arrays of features using Euclidean Distance
function computeEuclideanDistance(vec1, vec2) {
  if (vec1.length !== vec2.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < vec1.length; i++) {
    sum += Math.pow(vec1[i] - vec2[i], 2);
  }
  return Math.sqrt(sum);
}

// Biometric Thresholds (MAXIMUM SECURITY)
function getPalmThreshold(vectorLength) {
  return vectorLength > 100 ? 1.20 : 0.20;
}
const FACE_THRESHOLD = 0.35;  // Highly strict facial descriptor threshold

// ── Routes ───────────────────────────────────────────────────────────────────

// [AGENT] Register new Agent and device fingerprint
app.post('/api/agent/register', (req, res) => {
  try {
    const { name, nin, bvn, lga, deviceFingerprint } = req.body;
    if (!name || !nin || !bvn || !lga || !deviceFingerprint) {
      return res.status(400).json({ error: 'Missing agent details' });
    }
    
    const db = readDb();
    if (!db.agents) db.agents = [];
    if (!db.nextId.agent) db.nextId.agent = 1;
    
    // Auto-generate agent ID
    const agentId = `AG-${new Date().getFullYear().toString().slice(-2)}${String(db.nextId.agent++).padStart(4, '0')}-X`;
    
    db.agents.push({
      id: agentId,
      name, nin, bvn, lga, deviceFingerprint,
      registered_at: new Date().toISOString(),
      strikes: 0,
      status: 'ACTIVE'
    });
    
    writeDb(db);
    res.json({ success: true, agentId });
  } catch (err) {
    res.status(500).json({ error: 'Server error registering agent' });
  }
});

// [ADMIN] Setup Master Admin via Biometrics
app.get('/api/admin/status', (req, res) => {
  const db = readDb();
  const hasAdmin = db.users.some(u => u.role === 'Master_Admin');
  res.json({ hasAdmin, isAdminLoggedIn: !!req.session.isAdmin });
});

app.post('/api/admin/setup', (req, res) => {
  try {
    const db = readDb();
    if (db.users.some(u => u.role === 'Master_Admin')) {
      return res.status(400).json({ error: 'Master Admin already exists.' });
    }

    const { full_name, email, right_palm_vector, left_palm_vector, face_descriptor } = req.body;
    
    if (!right_palm_vector || !left_palm_vector || !face_descriptor) {
      return res.status(400).json({ error: 'Master Admin requires multi-modal (both palms + face) biometrics.' });
    }

    // Check if biometric already exists (even though it's first user, just for safety)
    for (const u of db.users) {
      if (u.right_palm_vector && computeEuclideanDistance(right_palm_vector, u.right_palm_vector) <= getPalmThreshold(right_palm_vector.length)) {
        return res.status(409).json({ error: `Biometrics already registered to: ${u.full_name}` });
      }
    }

    const newUser = {
      id: db.nextId.user++,
      full_name: full_name || "Master Admin",
      email: email || "admin@biosecure.com",
      role: 'Master_Admin',
      enrollment_mode: 'multimodal',
      right_palm_vector,
      left_palm_vector,
      face_descriptor,
      // Agent Tracking Fields
      enrolled_by_agent_id: 'System_Admin',
      enrollment_device_fingerprint: 'Unknown',
      enrollment_gps: null,
      created_at: new Date().toISOString()
    };
    db.users.push(newUser);
    writeDb(db);
    
    req.session.isAdmin = true;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// [PUBLIC] Check if admin exists — used by setup page to gate access
app.get('/api/admin-exists', (req, res) => {
  const db = readDb();
  const adminExists = db.users.some(u => u.role === 'Master_Admin');
  res.json({ exists: adminExists });
});

// [ONE-TIME] Admin Setup — thin wrapper: validates then delegates to /api/admin/setup logic
// Accepts: { full_name, email, right_palm_vector, left_palm_vector, face_descriptor }
app.post('/api/admin-setup', (req, res) => {
  const db = readDb();
  if (db.users.some(u => u.role === 'Master_Admin')) {
    return res.status(403).json({ error: 'Admin already exists. Setup is disabled.' });
  }

  const { full_name, email, right_palm_vector, left_palm_vector, face_descriptor } = req.body;

  if (!full_name || !email)
    return res.status(400).json({ error: 'Name and email are required.' });
  if (!right_palm_vector || right_palm_vector.length < 10)
    return res.status(400).json({ error: 'Right palm scan is required.' });
  if (!left_palm_vector || left_palm_vector.length < 10)
    return res.status(400).json({ error: 'Left palm scan is required.' });
  if (!face_descriptor || face_descriptor.length < 10)
    return res.status(400).json({ error: 'Face scan is required for admin setup.' });

  try {
    const newAdmin = {
      id: db.nextId.user++,
      full_name,
      email,
      role: 'Master_Admin',
      enrollment_mode: 'multimodal',
      right_palm_vector,
      left_palm_vector,
      face_descriptor,
      enrolled_by_agent_id: 'System_Admin',
      enrollment_device_fingerprint: 'Unknown',
      enrollment_gps: null,
      created_at: new Date().toISOString()
    };

    db.users.push(newAdmin);
    writeDb(db);

    req.session.isAdmin = true;
    req.session.adminId = newAdmin.id;
    req.session.adminName = newAdmin.full_name;

    res.json({ success: true, message: 'Master Admin enrolled successfully!',
      user: { id: newAdmin.id, full_name, email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// [ADMIN] Enroll Staff — supports 'palm' and 'multimodal' enrollment modes

app.post('/api/register', (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Admin session required' });

  try {
    let {
      full_name, email, role, department, phone,
      date_of_birth, address, device_model, right_palm_vector, left_palm_vector, face_descriptor,
      enrollment_mode,  // 'palm' | 'multimodal'
      agent_id, device_fingerprint, gps  // New Agent Fields
    } = req.body;

    // ── Sanitize text inputs ──────────────────────────────────────────────────
    const sanitize = (v) => (typeof v === 'string' ? v.trim().replace(/[<>]/g, '') : v);
    full_name    = sanitize(full_name);
    email        = sanitize(email)?.toLowerCase();
    role         = sanitize(role);
    department   = sanitize(department);
    phone        = sanitize(phone);
    address      = sanitize(address);
    device_model = sanitize(device_model);

    // Validate required fields
    if (!full_name || !email || !right_palm_vector || !left_palm_vector) {
      return res.status(400).json({ error: 'Missing required fields or palm biometric data (both left and right required).' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    if (!['Staff','Student','Lecturer','Security'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role specified.' });
    }
    if (enrollment_mode === 'multimodal' && (!face_descriptor || face_descriptor.length === 0)) {
      return res.status(400).json({ error: 'Multi-modal enrollment requires a face scan.' });
    }

    const db = readDb();

    // ── STRIKE LOGIC: Agent Validation & GPS tracking ───────────────────────
    if (agent_id) {
      const agent = db.agents?.find(a => a.id === agent_id);
      if (!agent) {
        return res.status(403).json({ error: 'Invalid Agent ID.' });
      }
      
      // If the fingerprint used for enrollment doesn't match the registered device fingerprint
      if (agent.deviceFingerprint !== device_fingerprint) {
        agent.strikes = (agent.strikes || 0) + 1;
        writeDb(db); // Save strike immediately
        
        if (agent.strikes >= 3) {
           return res.status(403).json({ 
             error: `STRIKE 3: Account Suspended. Contact NIMC immediately.`,
             strike: true, count: agent.strikes
           });
        }
        
        return res.status(403).json({ 
          error: `STRIKE WARNING: Unregistered device detected. Enrollment blocked. (Strike ${agent.strikes} of 3)`,
          strike: true, count: agent.strikes
        });
      }
    }

    // Auto-generate a unique Employee ID (server-side, cannot be forged)
    const prefix = role.substring(0, 3).toUpperCase(); // e.g. STA, STU, LEC, SEC
    const year   = new Date().getFullYear().toString().slice(-2);
    const seq    = String(db.nextId.user).padStart(4, '0');
    const employee_id = `${prefix}-${year}${seq}`;

    // Check email uniqueness
    if (db.users.find(u => u.email === email)) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // ── Check palm biometric uniqueness ───────────────────────────────────────
    for (const u of db.users) {
      if (u.right_palm_vector && computeEuclideanDistance(right_palm_vector, u.right_palm_vector) <= getPalmThreshold(right_palm_vector.length)) {
        return res.status(409).json({
          error: `Right palm biometric already registered to: ${u.full_name} (${u.role})`
        });
      }
      if (u.left_palm_vector && computeEuclideanDistance(left_palm_vector, u.left_palm_vector) <= getPalmThreshold(left_palm_vector.length)) {
        return res.status(409).json({
          error: `Left palm biometric already registered to: ${u.full_name} (${u.role})`
        });
      }
      // Also cross check to prevent enrolling a right hand as a left hand
      if (u.left_palm_vector && computeEuclideanDistance(right_palm_vector, u.left_palm_vector) <= getPalmThreshold(right_palm_vector.length)) {
        return res.status(409).json({
          error: `Right palm biometric already registered as a Left palm to: ${u.full_name} (${u.role})`
        });
      }
      if (u.right_palm_vector && computeEuclideanDistance(left_palm_vector, u.right_palm_vector) <= getPalmThreshold(left_palm_vector.length)) {
        return res.status(409).json({
          error: `Left palm biometric already registered as a Right palm to: ${u.full_name} (${u.role})`
        });
      }
    }

    // ── CRITICAL: Check face biometric uniqueness (prevents face reuse) ───────
    if (enrollment_mode === 'multimodal' && face_descriptor) {
      for (const u of db.users) {
        if (u.face_descriptor && u.face_descriptor.length > 0) {
          const faceDist = computeEuclideanDistance(face_descriptor, u.face_descriptor);
          if (faceDist <= FACE_THRESHOLD) {
            return res.status(409).json({
              error: `Face biometric already registered to another account. Each person can only enroll once.`
            });
          }
        }
      }
    }

    const newUser = {
      id: db.nextId.user++,
      full_name, email, employee_id, role,
      department:      department      || '',
      phone:           phone           || '',
      date_of_birth:   date_of_birth   || '',
      address:         address         || '',
      device_model:    device_model    || 'Unknown',  // Research: camera model used for capture
      enrollment_mode: enrollment_mode || 'palm',
      right_palm_vector,
      left_palm_vector,
      face_descriptor: enrollment_mode === 'multimodal' ? face_descriptor : null,
      created_at: new Date().toISOString()
    };

    db.users.push(newUser);
    writeDb(db);

    res.json({ success: true, user: newUser, employee_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// [PUBLIC] Authenticate — auto-detects single/multi-modal based on enrolled user's mode
app.post('/api/auth', (req, res) => {
  try {
    const { palm_vector, hand_side, face_descriptor } = req.body; // hand_side is 'LEFT' or 'RIGHT'
    if (!palm_vector || palm_vector.length === 0 || !hand_side) {
      return res.status(400).json({ error: 'No palm biometric data or hand side provided.' });
    }

    const db = readDb();

    // ── Phase 1: Find best palm match ─────────────────────────────────────────
    // Supports BOTH schemas:
    //   New users: right_palm_vector / left_palm_vector (both hands captured)
    //   Old users: palm_vector only (treated as right hand)
    let bestPalmMatch = null;
    let minPalmDist   = Infinity;

    for (const user of db.users) {
      let userVector;
      if (hand_side === 'LEFT') {
        // New schema first, fall back to palm_vector for old users
        userVector = user.left_palm_vector || user.palm_vector || null;
      } else {
        userVector = user.right_palm_vector || user.palm_vector || null;
      }
      if (!userVector) continue;

      // Validate vector length matches before comparing
      if (userVector.length !== palm_vector.length) continue;

      const dist = computeEuclideanDistance(palm_vector, userVector);
      if (dist < minPalmDist) { minPalmDist = dist; bestPalmMatch = user; }
    }

    if (!bestPalmMatch || minPalmDist > getPalmThreshold(palm_vector.length)) {
      db.auth_logs.push({
        id: db.nextId.log++, user_id: null, status: 'failed',
        modality: 'palm', palm_distance: minPalmDist, face_distance: null,
        attempted_at: new Date().toISOString()
      });
      writeDb(db);
      return res.status(401).json({
        error: 'UNAUTHORIZED: Palm not recognized.',
        palm_distance: minPalmDist
      });
    }

    // ── Phase 2: If user is multimodal, validate face too ────────────────────
    if (bestPalmMatch.enrollment_mode === 'multimodal') {
      if (!face_descriptor || face_descriptor.length === 0) {
        // Client must supply face for multimodal users
        return res.json({
          requires_face: true,
          palm_match: {
            user_id: bestPalmMatch.id,
            full_name: bestPalmMatch.full_name,
            palm_distance: minPalmDist
          }
        });
      }

      const faceDist = computeEuclideanDistance(face_descriptor, bestPalmMatch.face_descriptor);

      if (faceDist > FACE_THRESHOLD) {
        db.auth_logs.push({
          id: db.nextId.log++, user_id: bestPalmMatch.id, status: 'failed',
          modality: 'multimodal', palm_distance: minPalmDist, face_distance: faceDist,
          attempted_at: new Date().toISOString()
        });
        writeDb(db);
        return res.status(401).json({
          error: 'UNAUTHORIZED: Face did not match.',
          palm_distance: minPalmDist,
          face_distance: faceDist
        });
      }

      // ✅ Both passed
      db.auth_logs.push({
        id: db.nextId.log++, user_id: bestPalmMatch.id, status: 'success',
        modality: 'multimodal', palm_distance: minPalmDist, face_distance: faceDist,
        attempted_at: new Date().toISOString()
      });
      
      // If admin, set session
      if (bestPalmMatch.role === 'Master_Admin') {
        req.session.isAdmin = true;
      }
      writeDb(db);
      
      req.session.save((err) => {
        if (err) console.error('Session save error:', err);
        return res.json({
          success: true,
          modality: 'multimodal',
          user: {
            id: bestPalmMatch.id, full_name: bestPalmMatch.full_name,
            email: bestPalmMatch.email, department: bestPalmMatch.department,
            employee_id: bestPalmMatch.employee_id, role: bestPalmMatch.role
          },
          palm_distance: minPalmDist,
          face_distance: faceDist
        });
      });
      return; // Prevent fallthrough to single-modal logic
    }

    // ── Palm-only user: grant immediately ────────────────────────────────────
    db.auth_logs.push({
      id: db.nextId.log++, user_id: bestPalmMatch.id, status: 'success',
      modality: 'palm', palm_distance: minPalmDist, face_distance: null,
      attempted_at: new Date().toISOString()
    });
    
    if (bestPalmMatch.role === 'Master_Admin') {
      req.session.isAdmin = true;
    }
    
    writeDb(db);
    
    req.session.save((err) => {
      if (err) console.error('Session save error:', err);
      return res.json({
        success: true,
        modality: 'palm',
        user: {
          id: bestPalmMatch.id, full_name: bestPalmMatch.full_name,
          email: bestPalmMatch.email, department: bestPalmMatch.department,
          employee_id: bestPalmMatch.employee_id, role: bestPalmMatch.role
        },
        palm_distance: minPalmDist,
        face_distance: null
      });
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// [DEBUG] Client error logging
app.post('/api/log', (req, res) => {
  console.log('🛑 CLIENT ERROR:', req.body.error);
  res.json({ ok: true });
});

// [ADMIN] Get Users & Logs
app.get('/api/users', (req, res) => {
  if (!req.session.isAdmin) return res.status(403).send();
  const db = readDb();
  // Strip large biometric vectors from list view for performance
  const users = db.users
    .filter(u => u.role !== 'Master_Admin')
    .map(({ palm_vector, right_palm_vector, left_palm_vector, face_descriptor, ...rest }) => rest);
  res.json({ users });
});

app.get('/api/logs', (req, res) => {
  if (!req.session.isAdmin) return res.status(403).send();
  const db = readDb();
  const logs = db.auth_logs.map(log => {
    const user = db.users.find(u => u.id === log.user_id);
    return {
      ...log,
      full_name: user ? user.full_name : 'Unknown',
      role: user ? user.role : 'N/A'
    };
  }).reverse().slice(0, 50);
  res.json({ logs });
});

// [ADMIN] Benchmark Analytics (FAR, FRR, ROC)
// Uses synthetic intra-class variation for genuine attempts, and cross-class for imposter attempts.
app.get('/api/admin/benchmark', (req, res) => {
  if (!req.session.isAdmin) return res.status(403).send();
  const db = readDb();
  
  // Extract all palm vectors (supports both old `palm_vector` and new `right_palm_vector` schemas)
  const usersWithPalm = db.users.filter(u => {
    const vec = u.right_palm_vector || u.palm_vector;
    return vec && vec.length > 0;
  }).map(u => ({
    ...u,
    _benchmarkPalmVector: u.right_palm_vector || u.palm_vector
  }));
  
  if (usersWithPalm.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 enrolled users with palm scans to generate benchmarks.' });
  }

  const genuineDistances = [];
  const imposterDistances = [];
  const NUM_SYNTHETIC_SAMPLES = 10; // 10 fake genuine attempts per user
  const NOISE_LEVEL = 0.08; // Gaussian noise standard deviation for generating fake variations

  // Helper for Box-Muller transform for Gaussian noise
  function randomGaussian(mean = 0, stdev = 1) {
    const u = 1 - Math.random(); 
    const v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stdev + mean;
  }

  // 1. Generate Genuine Attempts (Synthetic)
  for (const user of usersWithPalm) {
    for (let i = 0; i < NUM_SYNTHETIC_SAMPLES; i++) {
      // Create a noisy version of this user's palm vector
      const noisyVector = user._benchmarkPalmVector.map(val => val + randomGaussian(0, NOISE_LEVEL));
      const dist = computeEuclideanDistance(user._benchmarkPalmVector, noisyVector);
      genuineDistances.push(dist);
    }
  }

  // 2. Generate Imposter Attempts (Cross-Class)
  for (let i = 0; i < usersWithPalm.length; i++) {
    for (let j = i + 1; j < usersWithPalm.length; j++) {
      const dist = computeEuclideanDistance(usersWithPalm[i]._benchmarkPalmVector, usersWithPalm[j]._benchmarkPalmVector);
      imposterDistances.push(dist);
    }
  }

  // 3. Calculate FAR and FRR across thresholds
  const curvePoints = [];
  const STEPS = 100;
  const MAX_DIST = 1.0; // Evaluate threshold from 0 to 1.0
  let eerPoint = null;
  let minDiff = Infinity;

  // We sort them for faster evaluation or just filter
  for (let i = 0; i <= STEPS; i++) {
    const threshold = (i / STEPS) * MAX_DIST;
    
    // FRR: genuine attempts that are > threshold (falsely rejected)
    let falseRejects = 0;
    for (let d of genuineDistances) if (d > threshold) falseRejects++;
    const frr = falseRejects / genuineDistances.length;

    // FAR: imposter attempts that are <= threshold (falsely accepted)
    let falseAccepts = 0;
    for (let d of imposterDistances) if (d <= threshold) falseAccepts++;
    const far = falseAccepts / imposterDistances.length;

    // ROC metrics
    const tpr = 1 - frr;
    const fpr = far;

    const point = { threshold, far, frr, tpr, fpr };
    curvePoints.push(point);

    // Find EER where FAR ≈ FRR
    const diff = Math.abs(far - frr);
    if (diff < minDiff) {
      minDiff = diff;
      eerPoint = point;
    }
  }

  // If we couldn't find an EER crossing, use the dynamic threshold based on vector length
  const currentSysThreshold = getPalmThreshold(usersWithPalm[0]?._benchmarkPalmVector?.length || 16);
  const sysPoint = curvePoints.reduce((prev, curr) => 
    Math.abs(curr.threshold - currentSysThreshold) < Math.abs(prev.threshold - currentSysThreshold) ? curr : prev
  );

  res.json({
    success: true,
    genuine_count: genuineDistances.length,
    imposter_count: imposterDistances.length,
    current_threshold: currentSysThreshold,
    sys_far: sysPoint.far,
    sys_frr: sysPoint.frr,
    eer: (eerPoint.far + eerPoint.frr) / 2, // Average them since they might not perfectly intersect
    eer_threshold: eerPoint.threshold,
    curve: curvePoints
  });
});

// Serve HTML pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin-setup', (req, res) => res.redirect('/admin'));
app.get('/admin-setup.html', (req, res) => res.redirect('/admin'));
app.get('/auth', (req, res) => res.sendFile(path.join(__dirname, 'public', 'auth.html')));

// ── Start HTTPS Server ────────────────────────────────────────────────────────

const options = {
  key: fs.readFileSync(path.join(__dirname, 'certs', 'server.key')),
  cert: fs.readFileSync(path.join(__dirname, 'certs', 'server.cert'))
};

https.createServer(options, app).listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔒 Biometric Palm Server running at:`);
  console.log(`   Local:   https://localhost:${PORT}`);
  console.log(`   Network: https://<YOUR_PC_IP_ADDRESS>:${PORT}`);
  console.log(`\n   * Connect your phone to Wi-Fi and open the Network URL above to test the camera.`);
  console.log(`   * Accept the "Not Secure" warning to proceed to the app.\n`);
});
