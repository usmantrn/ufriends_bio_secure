// NIMC/NIBSS Platform — Demo Seed Script
// Generates realistic Nigerian data for competition demo

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const prisma = new PrismaClient();

// ── Nigerian States + LGAs ──────────────────────────────────────────
const NIGERIAN_STATES = [
  { state: 'Lagos', lgas: ['Ikeja', 'Surulere', 'Victoria Island', 'Alimosho', 'Badagry', 'Epe', 'Eti-Osa'] },
  { state: 'Abuja (FCT)', lgas: ['Abuja Municipal', 'Bwari', 'Gwagwalada', 'Kuje', 'Kwali'] },
  { state: 'Kano', lgas: ['Kano Municipal', 'Fagge', 'Gwale', 'Dala', 'Nasarawa', 'Ungogo'] },
  { state: 'Rivers', lgas: ['Port Harcourt', 'Obio-Akpor', 'Eleme', 'Ikwerre', 'Okrika'] },
  { state: 'Oyo', lgas: ['Ibadan North', 'Ibadan South-East', 'Ogbomosho North', 'Akinyele'] },
  { state: 'Anambra', lgas: ['Awka North', 'Awka South', 'Onitsha North', 'Nnewi North'] },
  { state: 'Kaduna', lgas: ['Kaduna North', 'Kaduna South', 'Chikun', 'Igabi', 'Zaria'] },
  { state: 'Delta', lgas: ['Warri South', 'Oshimili South', 'Ethiope East', 'Sapele'] },
];

// Nigerian GPS coordinates (approx centers)
const STATE_GPS = {
  'Lagos': { lat: 6.5244, lng: 3.3792 },
  'Abuja (FCT)': { lat: 9.0579, lng: 7.4951 },
  'Kano': { lat: 12.0022, lng: 8.5920 },
  'Rivers': { lat: 4.8156, lng: 7.0498 },
  'Oyo': { lat: 7.3775, lng: 3.9470 },
  'Anambra': { lat: 6.2104, lng: 7.0694 },
  'Kaduna': { lat: 10.5222, lng: 7.4394 },
  'Delta': { lat: 5.5329, lng: 5.8987 },
};

// ── Name Banks ──────────────────────────────────────────────────────
const FIRST_NAMES = [
  'Adaeze', 'Chukwuemeka', 'Fatima', 'Ibrahim', 'Oluwaseun', 'Ngozi',
  'Taiwo', 'Babatunde', 'Amina', 'Chidi', 'Yewande', 'Musa',
  'Blessing', 'Emeka', 'Halima', 'Segun', 'Nneka', 'Usman',
  'Chidinma', 'Tunde', 'Rahmat', 'Kayode', 'Adaora', 'Aliyu',
  'Ifeoma', 'Gbenga', 'Hauwa', 'Rotimi', 'Chiamaka', 'Bashir',
];

const LAST_NAMES = [
  'Okonkwo', 'Adeyemi', 'Musa', 'Ibrahim', 'Eze', 'Bello',
  'Adebayo', 'Nwosu', 'Yusuf', 'Okafor', 'Suleiman', 'Chukwu',
  'Osei', 'Abubakar', 'Nwachukwu', 'Abdullahi', 'Obi', 'Garba',
  'Obiora', 'Lawal', 'Nnaji', 'Hassan', 'Dike', 'Idris',
];

// ── Helpers ─────────────────────────────────────────────────────────
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min, max) => parseFloat((Math.random() * (max - min) + min).toFixed(6));
const randomName = () => `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`;
const randomNIN = () => String(randInt(10000000000, 99999999999));
const randomBVN = () => String(randInt(10000000000, 99999999999));
const randomPhone = () => `+2348${randInt(10000000, 99999999)}`;
const randomEmail = (name) => `${name.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z.]/g, '')}.${randInt(10, 99)}@example.com`;
const randomDeviceToken = () => crypto.createHash('sha256').update(Math.random().toString()).digest('hex');
const randomBiometric = (dims = 128) => Array.from({ length: dims }, () => Math.random() * 2 - 1);
const randomDOB = () => {
  const year = randInt(1960, 1998);
  const month = randInt(1, 12);
  const day = randInt(1, 28);
  return new Date(year, month - 1, day);
};
const randomGpsNearState = (stateName) => {
  const center = STATE_GPS[stateName] || STATE_GPS['Abuja (FCT)'];
  return {
    lat: center.lat + randFloat(-0.3, 0.3),
    lng: center.lng + randFloat(-0.3, 0.3),
  };
};
const randomDateInPast = (daysBack) => {
  const date = new Date();
  date.setDate(date.getDate() - randInt(0, daysBack));
  date.setHours(randInt(8, 18), randInt(0, 59), 0, 0);
  return date;
};

// ── SEED ─────────────────────────────────────────────────────────────
async function seed() {
  console.log('🌱 Starting NIMC/NIBSS Platform seed...\n');

  // Clean existing data
  console.log('🗑️  Clearing existing data...');
  await prisma.auditLog.deleteMany();
  await prisma.flag.deleteMany();
  await prisma.strike.deleteMany();
  await prisma.citizen.deleteMany();
  await prisma.enrollmentSession.deleteMany();
  await prisma.device.deleteMany();
  await prisma.agentGuarantor.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.nimcUser.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.systemSettings.deleteMany();
  console.log('✅ Database cleared\n');

  // System settings
  await prisma.systemSettings.create({ data: {} });
  console.log('✅ System settings initialized\n');

  // ── NIMC/NIBSS Super Admin ───────────────────────────────────────
  const adminHash = await bcrypt.hash('Admin@1234', 12);
  const complianceHash = await bcrypt.hash('Comply@1234', 12);

  const superAdmin = await prisma.nimcUser.create({
    data: {
      email: 'admin@nimc.gov.ng',
      passwordHash: adminHash,
      fullName: 'Aminu Aliyu (Super Admin)',
      role: 'SUPER_ADMIN',
      phone: '+2348012345678',
      lastLoginAt: new Date(),
    },
  });

  const complianceOfficer = await prisma.nimcUser.create({
    data: {
      email: 'compliance@nibss-plc.ng',
      passwordHash: complianceHash,
      fullName: 'Ngozi Okafor (Compliance)',
      role: 'COMPLIANCE_OFFICER',
      phone: '+2348098765432',
    },
  });

  console.log('✅ NIMC/NIBSS staff created');
  console.log('   Super Admin: admin@nimc.gov.ng / Admin@1234');
  console.log('   Compliance:  compliance@nibss-plc.ng / Comply@1234\n');

  // ── Frontend Partner Organizations ──────────────────────────────
  const orgData = [
    { name: 'AccessPoint Identity Solutions Ltd', rcNumber: 'RC-1234567', state: 'Lagos', lga: 'Ikeja', directorName: 'Babatunde Adeyemi' },
    { name: 'DataBridge Nigeria Ltd', rcNumber: 'RC-2345678', state: 'Abuja (FCT)', lga: 'Abuja Municipal', directorName: 'Fatima Ibrahim' },
    { name: 'SecureID Ventures Ltd', rcNumber: 'RC-3456789', state: 'Rivers', lga: 'Port Harcourt', directorName: 'Chukwuemeka Eze' },
  ];

  const orgs = [];
  const orgAdmins = [];
  const superAgents = [];

  for (const od of orgData) {
    const gps = randomGpsNearState(od.state);
    const org = await prisma.organization.create({
      data: {
        ...od,
        address: `${randInt(1, 100)} ${rand(['Victoria', 'Marina', 'Broad', 'Allen'])} Street, ${od.lga}`,
        contactEmail: `info@${od.name.toLowerCase().replace(/\s+/g, '').slice(0, 12)}.ng`,
        contactPhone: randomPhone(),
        directorNin: randomNIN(),
        status: 'ACTIVE',
        approvedById: superAdmin.id,
        approvedAt: new Date(Date.now() - randInt(30, 120) * 24 * 60 * 60 * 1000),
        operatingGpsLat: gps.lat,
        operatingGpsLng: gps.lng,
      },
    });
    orgs.push(org);

    // Partner Admin for this org
    const adminPw = await bcrypt.hash('Partner@1234', 12);
    const partnerAdmin = await prisma.nimcUser.create({
      data: {
        email: `admin@${od.name.toLowerCase().replace(/\s+/g, '').slice(0, 10)}.ng`,
        passwordHash: adminPw,
        fullName: `${od.directorName} (Admin)`,
        role: 'PARTNER_ADMIN',
        organizationId: org.id,
        phone: randomPhone(),
      },
    });
    orgAdmins.push(partnerAdmin);

    // Super Agent for this org
    const saPw = await bcrypt.hash('SuperAgent@1234', 12);
    const superAgent = await prisma.nimcUser.create({
      data: {
        email: `superagent@${od.name.toLowerCase().replace(/\s+/g, '').slice(0, 10)}.ng`,
        passwordHash: saPw,
        fullName: `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)} (SuperAgent)`,
        role: 'SUPER_AGENT',
        organizationId: org.id,
        phone: randomPhone(),
      },
    });
    superAgents.push(superAgent);
  }

  console.log('✅ 3 Partner Organizations + 3 Admins + 3 Super Agents created');
  console.log('   Partner Admin login: admin@accesspointidentity.ng / Partner@1234\n');

  // ── Agents ───────────────────────────────────────────────────────
  const agents = [];
  const agentStatuses = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'SUSPENDED', 'PENDING', 'BANNED', 'ACTIVE', 'ACTIVE', 'ACTIVE'];

  for (let i = 0; i < 10; i++) {
    const name = randomName();
    const stateInfo = rand(NIGERIAN_STATES);
    const gps = randomGpsNearState(stateInfo.state);
    const agentPw = await bcrypt.hash('Agent@1234', 12);
    const org = orgs[i % orgs.length];
    const superAgent = superAgents[i % superAgents.length];
    const status = agentStatuses[i];

    const agent = await prisma.agent.create({
      data: {
        fullName: name,
        nin: randomNIN(),
        bvn: randomBVN(),
        dateOfBirth: randomDOB(),
        gender: rand(['Male', 'Female']),
        phone: randomPhone(),
        email: randomEmail(name),
        passwordHash: agentPw,
        address: `${randInt(1, 100)} ${rand(['Market', 'Church', 'School', 'Bank'])} Road, ${rand(stateInfo.lgas)}`,
        stateOfOrigin: rand(NIGERIAN_STATES).state,
        organizationId: org.id,
        superAgentUserId: superAgent.id,
        irFaceDescriptor: randomBiometric(128),
        leftPalmVeinTemplate: randomBiometric(256),
        rightPalmVeinTemplate: randomBiometric(256),
        rgbFaceDescriptor: randomBiometric(128),
        operatingState: stateInfo.state,
        operatingLGA: rand(stateInfo.lgas),
        operatingGpsLat: gps.lat,
        operatingGpsLng: gps.lng,
        operatingRadiusKm: 50,
        licenseStatus: status,
        strikeCount: status === 'SUSPENDED' ? 4 : status === 'BANNED' ? 5 : randInt(0, 2),
        approvedById: status !== 'PENDING' ? superAdmin.id : null,
        approvedAt: status !== 'PENDING' ? new Date(Date.now() - randInt(14, 90) * 24 * 60 * 60 * 1000) : null,
        bannedById: status === 'BANNED' ? superAdmin.id : null,
        bannedAt: status === 'BANNED' ? new Date(Date.now() - randInt(1, 7) * 24 * 60 * 60 * 1000) : null,
        banReason: status === 'BANNED' ? 'Multiple verified fraud attempts — 5 strikes accumulated' : null,
        guarantors: {
          create: [
            {
              fullName: randomName(), nin: randomNIN(), phone: randomPhone(),
              relationship: 'Employer', address: `${randInt(1, 50)} Main St`, state: stateInfo.state,
            },
            {
              fullName: randomName(), nin: randomNIN(), phone: randomPhone(),
              relationship: 'Family Member', address: `${randInt(1, 50)} Park Ave`, state: rand(NIGERIAN_STATES).state,
            },
          ],
        },
      },
    });

    // Register a device for each active agent
    if (status === 'ACTIVE') {
      await prisma.device.create({
        data: {
          agentId: agent.id,
          platform: rand(['ANDROID', 'LINUX', 'WINDOWS']),
          deviceToken: randomDeviceToken(),
          cameraVidPid: '0x05C8:0x03DF', // AR0230/OV2719 VID/PID
          macAddress: Array.from({ length: 6 }, () => randInt(0, 255).toString(16).padStart(2, '0')).join(':'),
          cpuSerial: crypto.randomBytes(8).toString('hex').toUpperCase(),
          imei: String(randInt(100000000000000, 999999999999999)),
          deviceLabel: `Agent Kiosk Device`,
          lastSeenAt: randomDateInPast(7),
        },
      });
    }

    agents.push(agent);
  }

  console.log('✅ 10 Agents created (8 active, 1 suspended, 1 banned)');

  // ── Enrollment Sessions + Citizens ───────────────────────────────
  const ACTIVE_AGENTS = agents.filter(a => a.licenseStatus === 'ACTIVE');
  let totalEnrollments = 0;

  for (const agent of ACTIVE_AGENTS) {
    const device = await prisma.device.findFirst({ where: { agentId: agent.id } });
    if (!device) continue;

    const numSessions = randInt(2, 5);
    for (let s = 0; s < numSessions; s++) {
      const sessionStart = randomDateInPast(30);
      const gps = randomGpsNearState(agent.operatingState);

      const session = await prisma.enrollmentSession.create({
        data: {
          agentId: agent.id,
          deviceId: device.id,
          agentPalmMatchScore: randFloat(0.87, 0.99),
          agentAuthTimestamp: sessionStart,
          startGpsLat: gps.lat,
          startGpsLng: gps.lng,
          startGpsAccuracy: randFloat(3, 15),
          deviceClockDeltaMs: randInt(0, 2000),
          vpnDetectedAtStart: false,
          mockGpsAtStart: false,
          isActive: false,
          startedAt: sessionStart,
          expiresAt: new Date(sessionStart.getTime() + 4 * 60 * 60 * 1000),
          endedAt: new Date(sessionStart.getTime() + randInt(1, 4) * 60 * 60 * 1000),
        },
      });

      const enrollmentsInSession = randInt(3, 8);
      for (let e = 0; e < enrollmentsInSession; e++) {
        const citizenName = randomName();
        const stateInfo = rand(NIGERIAN_STATES);
        const citizenGps = randomGpsNearState(stateInfo.state);
        const enrolledAt = new Date(sessionStart.getTime() + e * randInt(180, 600) * 1000);
        const isFlagged = Math.random() < 0.1; // 10% chance of flagged enrollment

        await prisma.citizen.create({
          data: {
            fullName: citizenName,
            dateOfBirth: randomDOB(),
            gender: rand(['Male', 'Female']),
            phone: randomPhone(),
            address: `${randInt(1, 200)} ${rand(['Church', 'Market', 'School', 'Farm'])} Road`,
            stateOfOrigin: rand(NIGERIAN_STATES).state,
            stateOfResidence: stateInfo.state,
            lgaOfResidence: rand(stateInfo.lgas),
            rgbFaceDescriptor: randomBiometric(128),
            irFaceDescriptor: randomBiometric(128),
            rightPalmVeinTemplate: randomBiometric(256),
            leftPalmVeinTemplate: randomBiometric(256),
            rightPalmVisible: randomBiometric(128),
            leftPalmVisible: randomBiometric(128),
            enrolledByAgentId: agent.id,
            enrollmentSessionId: session.id,
            enrollmentGpsLat: citizenGps.lat,
            enrollmentGpsLng: citizenGps.lng,
            enrollmentGpsAccuracy: randFloat(3, 20),
            enrollmentGpsTimestamp: enrolledAt,
            mockGpsDetected: isFlagged && Math.random() < 0.5,
            vpnDetected: isFlagged && Math.random() < 0.3,
            flaggedForReview: isFlagged,
            enrollmentStatus: 'SYNCED',
            syncedAt: enrolledAt,
            enrolledAt,
          },
        });

        totalEnrollments++;
      }
    }
  }

  console.log(`✅ ${totalEnrollments} Citizens enrolled across ${ACTIVE_AGENTS.length} agents\n`);

  // ── Strikes ──────────────────────────────────────────────────────
  const STRIKE_TRIGGERS = [
    { trigger: 'GPS_OUTSIDE_GEOFENCE', details: 'Agent GPS was 78km outside registered operating area during session' },
    { trigger: 'HIGH_ENROLLMENT_VELOCITY', details: 'Agent completed 24 enrollments in 60 minutes (limit: 20)' },
    { trigger: 'UNUSUAL_HOURS', details: 'Enrollment session started at 3:24am Nigeria time' },
    { trigger: 'MOCK_GPS_DETECTED', details: 'isFromMockProvider() returned true on agent device' },
    { trigger: 'BIOMETRIC_AUTH_FAIL', details: 'Palm vein match score: 0.62 — below threshold of 0.85' },
  ];

  for (const agent of agents.filter(a => a.strikeCount > 0)) {
    for (let sn = 1; sn <= agent.strikeCount; sn++) {
      const st = rand(STRIKE_TRIGGERS);
      await prisma.strike.create({
        data: {
          agentId: agent.id,
          strikeNumber: sn,
          trigger: st.trigger,
          details: st.details,
          metadata: { detectedAt: randomDateInPast(20).toISOString() },
          isResolved: sn === 1 && agent.strikeCount > 1, // First strike resolved
          resolvedAt: sn === 1 ? randomDateInPast(5) : null,
          resolveNote: sn === 1 ? 'Reviewed by super-agent — GPS hardware issue confirmed' : null,
          issuedAt: randomDateInPast(25),
        },
      });
    }
  }

  console.log('✅ Strikes created for suspended/banned agents');

  // ── Behavioral Flags ─────────────────────────────────────────────
  const FLAG_SCENARIOS = [
    { flagType: 'ENROLLMENT_SPEED', severity: 'HIGH', description: 'Average enrollment time: 87s over last 10 enrollments (min: 120s)' },
    { flagType: 'TIME_PATTERN', severity: 'MEDIUM', description: 'Enrollment performed at 3:15am Nigeria time — outside normal field hours' },
    { flagType: 'DEMOGRAPHIC_CLUSTER', severity: 'HIGH', description: '54 enrollments from same GPS coordinate in one day — suspected static location fraud' },
    { flagType: 'LOCATION_ANOMALY', severity: 'CRITICAL', description: 'VPN detected alongside GPS coordinates — IP region does not match GPS-claimed location' },
    { flagType: 'DUPLICATE_FACE', severity: 'CRITICAL', description: 'Enrolled face matches existing citizen record with different NIN — HARD LOCK pending review' },
  ];

  for (let i = 0; i < FLAG_SCENARIOS.length; i++) {
    const scenario = FLAG_SCENARIOS[i];
    const agent = ACTIVE_AGENTS[i % ACTIVE_AGENTS.length];
    const statusOptions = ['OPEN', 'OPEN', 'UNDER_REVIEW', 'RESOLVED', 'ESCALATED'];

    await prisma.flag.create({
      data: {
        agentId: agent.id,
        ...scenario,
        status: statusOptions[i],
        reviewedById: i >= 2 ? complianceOfficer.id : null,
        reviewedAt: i >= 2 ? randomDateInPast(3) : null,
        resolveNote: i === 3 ? 'Confirmed false positive — agent relocated to new territory' : null,
        raisedAt: randomDateInPast(14),
      },
    });
  }

  console.log('✅ Behavioral flags seeded (Speed, Time Pattern, Demographics, VPN, Duplicate)\n');

  // ── Audit Logs ───────────────────────────────────────────────────
  const auditSamples = [
    { action: 'USER_LOGIN', actorId: superAdmin.id, actorRole: 'SUPER_ADMIN', description: 'Super admin logged in from Abuja office' },
    { action: 'AGENT_APPROVED', actorId: superAdmin.id, actorRole: 'SUPER_ADMIN', description: `Agent approved for licensing`, targetType: 'Agent', targetId: agents[0].id },
    { action: 'AGENT_BANNED', actorId: superAdmin.id, actorRole: 'SUPER_ADMIN', description: 'Agent permanently banned after 5 strikes', targetType: 'Agent', targetId: agents.find(a => a.licenseStatus === 'BANNED')?.id },
    { action: 'FLAG_ESCALATED', actorId: complianceOfficer.id, actorRole: 'COMPLIANCE_OFFICER', description: 'DUPLICATE_FACE flag escalated to SUPER_ADMIN for manual review' },
    { action: 'ORG_APPROVED', actorId: superAdmin.id, actorRole: 'SUPER_ADMIN', description: 'Organization AccessPoint Identity Solutions approved', targetType: 'Organization', targetId: orgs[0].id },
    { action: 'SETTINGS_UPDATED', actorId: superAdmin.id, actorRole: 'SUPER_ADMIN', description: 'maxEnrollmentsPerHour updated from 20 to 20 (no change — test)' },
  ];

  for (const log of auditSamples) {
    await prisma.auditLog.create({
      data: { ...log, timestamp: randomDateInPast(7), ipAddress: '197.210.55.' + randInt(1, 254) },
    });
  }

  console.log('✅ Audit trail seeded\n');

  // ── Summary ──────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════');
  console.log('  SEED COMPLETE — Login Credentials');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('  STAKEHOLDER PORTAL (http://localhost:5173)');
  console.log('  ─────────────────────────────────────────');
  console.log('  Super Admin:  admin@nimc.gov.ng          / Admin@1234');
  console.log('  Compliance:   compliance@nibss-plc.ng    / Comply@1234');
  console.log('');
  console.log('  PARTNER PORTAL (http://localhost:5174)');
  console.log('  ─────────────────────────────────────────');
  console.log('  Partner Admin: admin@accesspointide.ng   / Partner@1234');
  console.log('  Super Agent:   superagent@accesspointide.ng / SuperAgent@1234');
  console.log('');
  console.log('  AGENT APP LOGIN');
  console.log('  ─────────────────────────────────────────');
  console.log('  Password: Agent@1234 (same for all agents)');
  console.log('═══════════════════════════════════════════════════\n');
}

seed()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
