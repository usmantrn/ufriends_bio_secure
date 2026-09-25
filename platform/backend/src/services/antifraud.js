// Anti-fraud detection service
// "Trust Nothing" architecture — all checks are server-side
const logger = require('../lib/logger');

const MAX_CLOCK_DRIFT_MS = (parseInt(process.env.MAX_CLOCK_DRIFT_SECONDS) || 300) * 1000;
const MAX_VELOCITY_KMH = 200; // Max plausible travel speed

/**
 * Haversine formula — calculate distance between two GPS coordinates in km
 */
const haversineDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Validate device clock against server NTP.
 * Returns: { valid: bool, driftMs: number, flagged: bool }
 */
const validateDeviceClock = (deviceTimestamp) => {
  const serverNow = Date.now();
  const deviceTime = new Date(deviceTimestamp).getTime();
  const driftMs = Math.abs(serverNow - deviceTime);

  return {
    valid: driftMs <= MAX_CLOCK_DRIFT_MS,
    driftMs,
    flagged: driftMs > MAX_CLOCK_DRIFT_MS,
    driftSeconds: Math.round(driftMs / 1000),
  };
};

/**
 * Check if GPS coordinates are within agent's registered geofence.
 * Returns: { withinGeofence: bool, distanceKm: number }
 */
const validateGeofence = (agentGpsLat, agentGpsLng, agentRadiusKm, currentLat, currentLng) => {
  if (!agentGpsLat || !agentGpsLng) {
    // No geofence center set — skip check
    return { withinGeofence: true, distanceKm: 0, note: 'No geofence center configured' };
  }

  const distanceKm = haversineDistance(agentGpsLat, agentGpsLng, currentLat, currentLng);
  const radius = agentRadiusKm || 50;

  return {
    withinGeofence: distanceKm <= radius,
    distanceKm: Math.round(distanceKm * 10) / 10,
    radiusKm: radius,
  };
};

/**
 * Check for impossible travel (velocity anomaly).
 * Returns: { possible: bool, velocityKmh: number }
 */
const validateVelocity = (prevLat, prevLng, prevTime, currLat, currLng, currTime) => {
  if (!prevLat || !prevLng || !prevTime) {
    return { possible: true, velocityKmh: 0, note: 'No previous location to compare' };
  }

  const distanceKm = haversineDistance(prevLat, prevLng, currLat, currLng);
  const timeDiffMs = new Date(currTime) - new Date(prevTime);
  const timeDiffHours = timeDiffMs / (1000 * 60 * 60);

  if (timeDiffHours <= 0) {
    return { possible: false, velocityKmh: Infinity, note: 'Timestamps are identical or reversed' };
  }

  const velocityKmh = distanceKm / timeDiffHours;

  return {
    possible: velocityKmh <= MAX_VELOCITY_KMH,
    velocityKmh: Math.round(velocityKmh),
    distanceKm: Math.round(distanceKm * 10) / 10,
    timeDiffMinutes: Math.round(timeDiffMs / 60000),
  };
};

/**
 * Check if IP address region matches GPS-claimed region.
 * Uses a basic mapping — in production, integrate MaxMind GeoIP.
 * For demo, this returns a structured result.
 */
const validateIpVsGps = (ipAddress, gpsLat, gpsLng) => {
  // In production: call MaxMind GeoIP2 here
  // For demo: basic detection of obviously non-Nigerian IPs
  const isLocalhost = ipAddress === '127.0.0.1' || ipAddress === '::1';

  if (isLocalhost) {
    return { consistent: true, note: 'localhost — skipping IP check' };
  }

  // Nigeria IP range approximation (prefix check for demo)
  // Real implementation would use MaxMind or ip-api.com
  return {
    consistent: true, // Trust GPS for now; flag if VPN is detected client-side
    note: 'IP geolocation check pending full GeoIP integration',
    ipAddress,
  };
};

/**
 * Detect unusual enrollment hours (2am–5am Nigeria time = UTC+1)
 */
const isUnusualHour = () => {
  const nigeriaHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' })).getHours();
  return nigeriaHour >= 2 && nigeriaHour <= 5;
};

/**
 * Full enrollment anti-fraud check bundle
 */
const runEnrollmentFraudChecks = ({
  deviceTimestamp,
  mockGpsDetected = false,
  vpnDetected = false,
  gpsLat,
  gpsLng,
  agent,
  previousEnrollmentGps = null,
  previousEnrollmentTime = null,
}) => {
  const flags = [];
  const results = {};

  // 1. Clock drift check
  if (deviceTimestamp) {
    const clockCheck = validateDeviceClock(deviceTimestamp);
    results.clockCheck = clockCheck;
    if (clockCheck.flagged) {
      flags.push({
        trigger: 'TIME_MANIPULATION',
        details: `Device clock is ${clockCheck.driftSeconds}s ahead/behind server time (max allowed: ${MAX_CLOCK_DRIFT_MS / 1000}s)`,
      });
    }
  }

  // 2. Mock GPS check
  if (mockGpsDetected) {
    flags.push({
      trigger: 'MOCK_GPS_DETECTED',
      details: 'Agent app detected isFromMockProvider() = true on GPS coordinates',
    });
  }

  // 3. VPN check
  if (vpnDetected) {
    flags.push({
      trigger: 'VPN_DETECTED',
      details: 'Agent device reported active VPN or proxy connection',
    });
  }

  // 4. Geofence check
  if (gpsLat && gpsLng && agent) {
    const geoCheck = validateGeofence(
      agent.operatingGpsLat,
      agent.operatingGpsLng,
      agent.operatingRadiusKm,
      gpsLat,
      gpsLng
    );
    results.geofenceCheck = geoCheck;
    if (!geoCheck.withinGeofence) {
      flags.push({
        trigger: 'GPS_OUTSIDE_GEOFENCE',
        details: `Agent is ${geoCheck.distanceKm}km from their registered operating area (max: ${geoCheck.radiusKm}km)`,
      });
    }
  }

  // 5. Velocity check
  if (previousEnrollmentGps && gpsLat && gpsLng) {
    const velCheck = validateVelocity(
      previousEnrollmentGps.lat,
      previousEnrollmentGps.lng,
      previousEnrollmentTime,
      gpsLat,
      gpsLng,
      new Date().toISOString()
    );
    results.velocityCheck = velCheck;
    if (!velCheck.possible) {
      flags.push({
        trigger: 'IMPOSSIBLE_TRAVEL',
        details: `Agent moved ${velCheck.distanceKm}km in ${velCheck.timeDiffMinutes} minutes (${velCheck.velocityKmh}km/h — impossible)`,
      });
    }
  }

  // 6. Unusual hours check
  if (isUnusualHour()) {
    flags.push({
      trigger: 'UNUSUAL_HOURS',
      details: 'Enrollment performed between 2am–5am Nigeria time — flagged for review',
    });
  }

  return { flags, results, isClean: flags.length === 0 };
};

module.exports = {
  haversineDistance,
  validateDeviceClock,
  validateGeofence,
  validateVelocity,
  validateIpVsGps,
  runEnrollmentFraudChecks,
  isUnusualHour,
};
