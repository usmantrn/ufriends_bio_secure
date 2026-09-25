-- NIMC/NIBSS Platform — Direct SQL Schema Creation
-- Creates only nimc_* prefixed tables, does NOT touch existing tables

-- Enums
DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'COMPLIANCE_OFFICER', 'PARTNER_ADMIN', 'SUPER_AGENT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AgentLicenseStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'BANNED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'LINUX', 'WINDOWS');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "StrikeTrigger" AS ENUM (
    'NON_IR_DEVICE', 'WRONG_CAMERA_VID_PID', 'GPS_OUTSIDE_GEOFENCE', 'MOCK_GPS_DETECTED',
    'VPN_DETECTED', 'USB_DISCONNECT_MID_SESSION', 'HIGH_ENROLLMENT_VELOCITY', 'BIOMETRIC_AUTH_FAIL',
    'IMPOSSIBLE_TRAVEL', 'TIME_MANIPULATION', 'UNUSUAL_HOURS', 'CLOCKWORK_INTERVAL', 'MANUAL_STRIKE'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "FlagType" AS ENUM (
    'ENROLLMENT_SPEED', 'TIME_PATTERN', 'DEMOGRAPHIC_CLUSTER', 'DUPLICATE_FACE',
    'CROSS_AGENT_DEVICE', 'LOCATION_ANOMALY', 'BULK_SIMILAR_FACES'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "FlagSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "FlagStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'ESCALATED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OrganizationStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CitizenEnrollmentStatus" AS ENUM ('PENDING_SYNC', 'SYNCED', 'FLAGGED', 'LOCKED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AuditAction" AS ENUM (
    'USER_LOGIN', 'USER_LOGOUT', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED',
    'AGENT_SUBMITTED', 'AGENT_APPROVED', 'AGENT_SUSPENDED', 'AGENT_BANNED', 'AGENT_REINSTATED',
    'SESSION_STARTED', 'SESSION_EXPIRED', 'SESSION_TERMINATED',
    'CITIZEN_ENROLLED', 'CITIZEN_FLAGGED', 'CITIZEN_LOCKED', 'CITIZEN_SYNCED',
    'STRIKE_ISSUED', 'STRIKE_UNLOCKED', 'ACCOUNT_UNLOCKED',
    'FLAG_RAISED', 'FLAG_REVIEWED', 'FLAG_ESCALATED', 'FLAG_RESOLVED',
    'ORG_CREATED', 'ORG_APPROVED', 'ORG_SUSPENDED', 'SETTINGS_UPDATED', 'MANUAL_REVIEW_ASSIGNED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- System Settings
CREATE TABLE IF NOT EXISTS nimc_system_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "enrollmentSessionDurationHours" INTEGER NOT NULL DEFAULT 4,
  "maxDevicesPerAgent" INTEGER NOT NULL DEFAULT 2,
  "maxEnrollmentsPerHour" INTEGER NOT NULL DEFAULT 20,
  "minEnrollmentSeconds" INTEGER NOT NULL DEFAULT 120,
  "maxClockDriftSeconds" INTEGER NOT NULL DEFAULT 300,
  "flagSpeedWindowSize" INTEGER NOT NULL DEFAULT 10,
  "flagSpeedMinSeconds" INTEGER NOT NULL DEFAULT 120,
  "flagDemographicClusterCount" INTEGER NOT NULL DEFAULT 50,
  "strikeSessionLockThreshold" INTEGER NOT NULL DEFAULT 3,
  "strikeAccountSuspendThreshold" INTEGER NOT NULL DEFAULT 4,
  "strikePermanentBanThreshold" INTEGER NOT NULL DEFAULT 5,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedById" TEXT
);

-- Organizations
CREATE TABLE IF NOT EXISTS nimc_organizations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name TEXT NOT NULL,
  "rcNumber" TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL,
  state TEXT NOT NULL,
  lga TEXT NOT NULL,
  "contactEmail" TEXT NOT NULL,
  "contactPhone" TEXT NOT NULL,
  "directorName" TEXT NOT NULL,
  "directorNin" TEXT NOT NULL,
  status "OrganizationStatus" NOT NULL DEFAULT 'PENDING',
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP,
  "operatingGpsLat" DOUBLE PRECISION,
  "operatingGpsLng" DOUBLE PRECISION,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Users (NIMC/NIBSS + Partners)
CREATE TABLE IF NOT EXISTS nimc_users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  email TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  phone TEXT,
  role "UserRole" NOT NULL,
  "organizationId" TEXT REFERENCES nimc_organizations(id),
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "lastLoginAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE nimc_organizations ADD COLUMN IF NOT EXISTS "approvedById_ref" TEXT REFERENCES nimc_users(id);

-- Agents
CREATE TABLE IF NOT EXISTS nimc_agents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "fullName" TEXT NOT NULL,
  nin TEXT NOT NULL UNIQUE,
  bvn TEXT NOT NULL UNIQUE,
  "dateOfBirth" TIMESTAMP NOT NULL,
  gender TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  address TEXT NOT NULL,
  "stateOfOrigin" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL REFERENCES nimc_organizations(id),
  "superAgentUserId" TEXT REFERENCES nimc_users(id),
  "passportPhotoUrl" TEXT,
  "rgbFaceDescriptor" DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
  "irFaceDescriptor" DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
  "leftPalmVeinTemplate" DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
  "rightPalmVeinTemplate" DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
  "licenseNumber" TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::TEXT,
  "licenseStatus" "AgentLicenseStatus" NOT NULL DEFAULT 'PENDING',
  "approvedById" TEXT REFERENCES nimc_users(id),
  "approvedAt" TIMESTAMP,
  "bannedById" TEXT REFERENCES nimc_users(id),
  "bannedAt" TIMESTAMP,
  "banReason" TEXT,
  "operatingState" TEXT NOT NULL,
  "operatingLGA" TEXT NOT NULL,
  "operatingGpsLat" DOUBLE PRECISION,
  "operatingGpsLng" DOUBLE PRECISION,
  "operatingRadiusKm" DOUBLE PRECISION DEFAULT 50,
  "strikeCount" INTEGER NOT NULL DEFAULT 0,
  "lastStrikeAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Agent Guarantors
CREATE TABLE IF NOT EXISTS nimc_agent_guarantors (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "agentId" TEXT NOT NULL REFERENCES nimc_agents(id),
  "fullName" TEXT NOT NULL,
  nin TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  relationship TEXT NOT NULL,
  address TEXT NOT NULL,
  state TEXT NOT NULL
);

-- Devices
CREATE TABLE IF NOT EXISTS nimc_devices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "agentId" TEXT NOT NULL REFERENCES nimc_agents(id),
  platform "DevicePlatform" NOT NULL,
  "deviceToken" TEXT NOT NULL UNIQUE,
  "macAddress" TEXT,
  "cpuSerial" TEXT,
  imei TEXT,
  "cameraVidPid" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "deviceLabel" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "lastSeenAt" TIMESTAMP,
  "registeredAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Enrollment Sessions
CREATE TABLE IF NOT EXISTS nimc_enrollment_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "agentId" TEXT NOT NULL REFERENCES nimc_agents(id),
  "deviceId" TEXT NOT NULL REFERENCES nimc_devices(id),
  "sessionToken" TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::TEXT,
  "agentPalmMatchScore" DOUBLE PRECISION,
  "agentAuthTimestamp" TIMESTAMP,
  "startGpsLat" DOUBLE PRECISION,
  "startGpsLng" DOUBLE PRECISION,
  "startGpsAccuracy" DOUBLE PRECISION,
  "cellTowerIdStart" TEXT,
  "deviceClockDeltaMs" INTEGER,
  "vpnDetectedAtStart" BOOLEAN NOT NULL DEFAULT FALSE,
  "mockGpsAtStart" BOOLEAN NOT NULL DEFAULT FALSE,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "startedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "expiresAt" TIMESTAMP NOT NULL,
  "endedAt" TIMESTAMP
);

-- Citizens
CREATE TABLE IF NOT EXISTS nimc_citizens (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  nin TEXT UNIQUE,
  "fullName" TEXT NOT NULL,
  "dateOfBirth" TIMESTAMP NOT NULL,
  gender TEXT NOT NULL,
  phone TEXT,
  address TEXT NOT NULL,
  "stateOfOrigin" TEXT NOT NULL,
  "stateOfResidence" TEXT NOT NULL,
  "lgaOfResidence" TEXT NOT NULL,
  "rgbFaceDescriptor" DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
  "irFaceDescriptor" DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
  "rightPalmVeinTemplate" DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
  "leftPalmVeinTemplate" DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
  "rightPalmVisible" DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
  "leftPalmVisible" DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
  "enrolledByAgentId" TEXT NOT NULL REFERENCES nimc_agents(id),
  "enrollmentSessionId" TEXT NOT NULL REFERENCES nimc_enrollment_sessions(id),
  "enrollmentDeviceId" TEXT,
  "enrollmentGpsLat" DOUBLE PRECISION,
  "enrollmentGpsLng" DOUBLE PRECISION,
  "enrollmentGpsAccuracy" DOUBLE PRECISION,
  "enrollmentGpsTimestamp" TIMESTAMP,
  "enrollmentCellTowerId" TEXT,
  "mockGpsDetected" BOOLEAN NOT NULL DEFAULT FALSE,
  "vpnDetected" BOOLEAN NOT NULL DEFAULT FALSE,
  "clockDriftMs" INTEGER,
  "enrollmentStatus" "CitizenEnrollmentStatus" NOT NULL DEFAULT 'SYNCED',
  "flaggedForReview" BOOLEAN NOT NULL DEFAULT FALSE,
  "duplicateOfId" TEXT,
  "enrolledAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "syncedAt" TIMESTAMP
);

-- Strikes
CREATE TABLE IF NOT EXISTS nimc_strikes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "agentId" TEXT NOT NULL REFERENCES nimc_agents(id),
  "sessionId" TEXT REFERENCES nimc_enrollment_sessions(id),
  "strikeNumber" INTEGER NOT NULL,
  trigger "StrikeTrigger" NOT NULL,
  details TEXT NOT NULL,
  metadata JSONB,
  "isResolved" BOOLEAN NOT NULL DEFAULT FALSE,
  "resolvedById" TEXT REFERENCES nimc_users(id),
  "resolvedAt" TIMESTAMP,
  "resolveNote" TEXT,
  "issuedById" TEXT REFERENCES nimc_users(id),
  "issuedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Flags
CREATE TABLE IF NOT EXISTS nimc_flags (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "agentId" TEXT NOT NULL REFERENCES nimc_agents(id),
  "flagType" "FlagType" NOT NULL,
  severity "FlagSeverity" NOT NULL DEFAULT 'MEDIUM',
  description TEXT NOT NULL,
  "evidenceData" JSONB,
  status "FlagStatus" NOT NULL DEFAULT 'OPEN',
  "assignedToId" TEXT,
  "reviewedById" TEXT REFERENCES nimc_users(id),
  "reviewedAt" TIMESTAMP,
  "resolveNote" TEXT,
  "raisedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS nimc_audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "actorId" TEXT REFERENCES nimc_users(id),
  "actorRole" TEXT,
  action "AuditAction" NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  description TEXT NOT NULL,
  metadata JSONB,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nimc_audit_actor ON nimc_audit_logs("actorId");
CREATE INDEX IF NOT EXISTS idx_nimc_audit_timestamp ON nimc_audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_nimc_audit_action ON nimc_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_nimc_citizens_agent ON nimc_citizens("enrolledByAgentId");
CREATE INDEX IF NOT EXISTS idx_nimc_citizens_state ON nimc_citizens("stateOfResidence");
CREATE INDEX IF NOT EXISTS idx_nimc_strikes_agent ON nimc_strikes("agentId");
CREATE INDEX IF NOT EXISTS idx_nimc_flags_agent ON nimc_flags("agentId");

SELECT 'NIMC Schema created successfully' AS result;
