import 'dart:io';
import 'package:geolocator/geolocator.dart';
import 'package:ntp/ntp.dart';

/// Anti-fraud location and time verification service
/// Implements server-side NTP validation and GPS cross-checks
class AntifraudService {
  // ─── GPS / Location ───────────────────────────────────────────────

  /// Request GPS permission and get current position
  /// Returns null if permission denied or GPS unavailable
  static Future<Position?> getCurrentPosition() async {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return null;

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) return null;
    }
    if (permission == LocationPermission.deniedForever) return null;

    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
    } catch (_) {
      return null;
    }
  }

  /// Detect mock GPS providers
  /// On Android: checks Position.isMocked
  /// On Linux: always false (desktop doesn't have mock GPS apps)
  static bool isMockGps(Position position) {
    return position.isMocked;
  }

  /// Check if GPS coordinates are within agent's authorized operating radius
  static bool isWithinGeofence({
    required double agentLat,
    required double agentLng,
    required double agentRadiusKm,
    required double currentLat,
    required double currentLng,
  }) {
    final distanceM = Geolocator.distanceBetween(
      agentLat, agentLng,
      currentLat, currentLng,
    );
    return distanceM <= (agentRadiusKm * 1000);
  }

  /// Calculate distance in km between two GPS coordinates
  static double distanceKm(double lat1, double lng1, double lat2, double lng2) {
    return Geolocator.distanceBetween(lat1, lng1, lat2, lng2) / 1000;
  }

  // ─── NTP Time Validation ──────────────────────────────────────────

  /// Get drift between device clock and NTP server (in milliseconds)
  /// Positive = device is ahead, Negative = device is behind
  static Future<int?> getClockDriftMs() async {
    try {
      final ntpTime = await NTP.getNtpOffset(
        localTime: DateTime.now(),
        lookUpAddress: 'pool.ntp.org',
        timeout: const Duration(seconds: 8),
      );
      return ntpTime; // NTP offset in ms
    } catch (e) {
      // Try backup NTP servers
      for (final server in ['time.google.com', 'time.cloudflare.com', 'ntp.ubuntu.com']) {
        try {
          final offset = await NTP.getNtpOffset(
            localTime: DateTime.now(),
            lookUpAddress: server,
            timeout: const Duration(seconds: 5),
          );
          return offset;
        } catch (_) {}
      }
      return null; // Could not reach any NTP server
    }
  }

  /// Returns true if device clock is within allowed drift (default ±5 minutes)
  static bool isClockWithinTolerance(int driftMs, {int maxDriftSeconds = 300}) {
    return driftMs.abs() <= (maxDriftSeconds * 1000);
  }

  // ─── VPN Detection ───────────────────────────────────────────────

  /// Basic VPN/proxy detection by checking for VPN network interfaces
  /// Returns true if a VPN connection is likely active
  static Future<bool> isVpnActive() async {
    try {
      final interfaces = await NetworkInterface.list();
      for (final interface in interfaces) {
        final name = interface.name.toLowerCase();
        // Common VPN interface names
        if (name.contains('tun') ||
            name.contains('tap') ||
            name.contains('vpn') ||
            name.contains('wg') ||  // WireGuard
            name.contains('ppp')) {
          return true;
        }
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  // ─── Impossible Travel Detection ─────────────────────────────────

  /// Check if movement from lastPosition to currentPosition is physically possible
  /// Returns true if travel is IMPOSSIBLE (fraud indicator)
  static bool isImpossibleTravel({
    required double lastLat,
    required double lastLng,
    required DateTime lastTime,
    required double currentLat,
    required double currentLng,
    required DateTime currentTime,
    double maxSpeedKmh = 200, // ~max commercial flight speed at ground level
  }) {
    final distKm = distanceKm(lastLat, lastLng, currentLat, currentLng);
    final timeHours = currentTime.difference(lastTime).inSeconds / 3600;
    if (timeHours <= 0) return distKm > 0.1;
    final speedKmh = distKm / timeHours;
    return speedKmh > maxSpeedKmh;
  }

  // ─── Enrollment Velocity Check ────────────────────────────────────

  /// Check if enrollment rate exceeds threshold (bot pattern detection)
  static bool isEnrollmentTooFast({
    required DateTime lastEnrollmentTime,
    required int minEnrollmentSeconds,
  }) {
    final secondsSinceLast = DateTime.now().difference(lastEnrollmentTime).inSeconds;
    return secondsSinceLast < minEnrollmentSeconds;
  }

  // ─── Comprehensive Pre-enrollment Fraud Check ─────────────────────

  /// Run all anti-fraud checks before an enrollment is submitted
  /// Returns a map of findings
  static Future<AntifraudResult> runPreEnrollmentChecks({
    required Position? currentPosition,
    required double? agentBaseLat,
    required double? agentBaseLng,
    required double agentRadiusKm,
    required DateTime? lastEnrollmentTime,
    required int minEnrollmentSeconds,
  }) async {
    final issues = <String>[];
    bool mockGps = false;
    bool vpn = false;
    int? clockDriftMs;

    // 1. Mock GPS check
    if (currentPosition != null) {
      mockGps = isMockGps(currentPosition);
      if (mockGps) issues.add('MOCK_GPS_DETECTED');
    }

    // 2. Geofence check
    if (currentPosition != null && agentBaseLat != null && agentBaseLng != null) {
      final inZone = isWithinGeofence(
        agentLat: agentBaseLat, agentLng: agentBaseLng,
        agentRadiusKm: agentRadiusKm,
        currentLat: currentPosition.latitude,
        currentLng: currentPosition.longitude,
      );
      if (!inZone) issues.add('GPS_OUTSIDE_GEOFENCE');
    }

    // 3. VPN check
    vpn = await isVpnActive();
    if (vpn) issues.add('VPN_DETECTED');

    // 4. NTP Clock check
    clockDriftMs = await getClockDriftMs();
    if (clockDriftMs != null && !isClockWithinTolerance(clockDriftMs)) {
      issues.add('TIME_MANIPULATION');
    }

    // 5. Enrollment velocity check
    if (lastEnrollmentTime != null) {
      if (isEnrollmentTooFast(
        lastEnrollmentTime: lastEnrollmentTime,
        minEnrollmentSeconds: minEnrollmentSeconds,
      )) {
        issues.add('HIGH_ENROLLMENT_VELOCITY');
      }
    }

    return AntifraudResult(
      passed: issues.isEmpty,
      issues: issues,
      mockGpsDetected: mockGps,
      vpnDetected: vpn,
      clockDriftMs: clockDriftMs,
      gpsLat: currentPosition?.latitude,
      gpsLng: currentPosition?.longitude,
      gpsAccuracy: currentPosition?.accuracy,
    );
  }
}

class AntifraudResult {
  final bool passed;
  final List<String> issues;
  final bool mockGpsDetected;
  final bool vpnDetected;
  final int? clockDriftMs;
  final double? gpsLat;
  final double? gpsLng;
  final double? gpsAccuracy;

  AntifraudResult({
    required this.passed,
    required this.issues,
    required this.mockGpsDetected,
    required this.vpnDetected,
    this.clockDriftMs,
    this.gpsLat,
    this.gpsLng,
    this.gpsAccuracy,
  });

  bool get hasWarnings => issues.isNotEmpty;
  String get summary => passed ? 'All checks passed' : issues.join(', ');
}
