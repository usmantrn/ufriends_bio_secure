import 'dart:async';
import 'dart:math';
import 'package:sensors_plus/sensors_plus.dart';

/// Device Telemetry Service — Blueprint §4.1
/// ─────────────────────────────────────────────────────────────────────────────
/// "Device Fingerprinting: Capture gyroscope and accelerometer data during
///  enrollment. If the device is perfectly still (0,0,0) for 100 enrollments,
///  it is likely sitting on a desk running an automated spoofing script."
///
/// Collects 3 seconds of sensor readings and produces:
///   - motionScore:   0.0–1.0  (0 = perfectly still = suspicious)
///   - isRobotic:     true if variance is suspiciously low
///   - fingerprint:   compact summary for backend
/// ─────────────────────────────────────────────────────────────────────────────
class DeviceTelemetryService {
  // Minimum expected natural hand-held tremor (rad/s variance)
  static const _minNaturalGyroVariance = 0.0002;
  // Minimum expected accelerometer variance (m/s²)
  static const _minNaturalAccelVariance = 0.005;

  static const _sampleDurationMs = 3000;
  static const _sampleIntervalMs = 50;

  /// Collect sensor samples during enrollment and compute telemetry fingerprint
  static Future<TelemetryResult> collect() async {
    final gyroSamples = <List<double>>[];
    final accelSamples = <List<double>>[];

    StreamSubscription<GyroscopeEvent>? gyroSub;
    StreamSubscription<AccelerometerEvent>? accelSub;

    try {
      // Subscribe to sensors
      gyroSub = gyroscopeEventStream(
        samplingPeriod: const Duration(milliseconds: _sampleIntervalMs),
      ).listen((e) => gyroSamples.add([e.x, e.y, e.z]));

      accelSub = accelerometerEventStream(
        samplingPeriod: const Duration(milliseconds: _sampleIntervalMs),
      ).listen((e) => accelSamples.add([e.x, e.y, e.z]));

      // Collect for 3 seconds
      await Future.delayed(const Duration(milliseconds: _sampleDurationMs));
    } catch (_) {
      // Sensors unavailable (emulator/desktop) — mark as suspicious
      return TelemetryResult(
        gyroVariance: 0,
        accelVariance: 0,
        motionScore: 0.0,
        isRobotic: true,
        sampleCount: 0,
        fingerprint: 'NO_SENSORS',
        rawData: {},
      );
    } finally {
      await gyroSub?.cancel();
      await accelSub?.cancel();
    }

    if (gyroSamples.isEmpty || accelSamples.isEmpty) {
      return TelemetryResult(
        gyroVariance: 0, accelVariance: 0,
        motionScore: 0.0, isRobotic: true,
        sampleCount: 0, fingerprint: 'NO_DATA',
        rawData: {},
      );
    }

    // Compute variance for each axis
    final gyroVar = _computeVariance(gyroSamples);
    final accelVar = _computeVariance(accelSamples);

    // Motion score: 0 = still (suspicious), 1 = natural human movement
    final gyroScore = (gyroVar / (_minNaturalGyroVariance * 10)).clamp(0.0, 1.0);
    final accelScore = (accelVar / (_minNaturalAccelVariance * 10)).clamp(0.0, 1.0);
    final motionScore = (gyroScore * 0.6 + accelScore * 0.4);

    final isRobotic = gyroVar < _minNaturalGyroVariance &&
        accelVar < _minNaturalAccelVariance;

    // Compact fingerprint: gyro_variance|accel_variance|samples
    final fingerprint =
        '${gyroVar.toStringAsFixed(6)}|${accelVar.toStringAsFixed(6)}|${gyroSamples.length}';

    return TelemetryResult(
      gyroVariance: gyroVar,
      accelVariance: accelVar,
      motionScore: motionScore,
      isRobotic: isRobotic,
      sampleCount: gyroSamples.length,
      fingerprint: fingerprint,
      rawData: {
        'gyro': {
          'variance': gyroVar,
          'samples': gyroSamples.length,
          'meanX': _mean(gyroSamples.map((s) => s[0]).toList()),
          'meanY': _mean(gyroSamples.map((s) => s[1]).toList()),
          'meanZ': _mean(gyroSamples.map((s) => s[2]).toList()),
        },
        'accel': {
          'variance': accelVar,
          'samples': accelSamples.length,
          'meanX': _mean(accelSamples.map((s) => s[0]).toList()),
          'meanY': _mean(accelSamples.map((s) => s[1]).toList()),
          'meanZ': _mean(accelSamples.map((s) => s[2]).toList()),
        },
      },
    );
  }

  static double _computeVariance(List<List<double>> samples) {
    if (samples.isEmpty) return 0;
    // Flatten all axes
    final all = samples.expand((s) => s).toList();
    final mean = _mean(all);
    return all.map((v) => pow(v - mean, 2).toDouble()).reduce((a, b) => a + b) /
        all.length;
  }

  static double _mean(List<double> values) {
    if (values.isEmpty) return 0;
    return values.reduce((a, b) => a + b) / values.length;
  }
}

// ── Result model ───────────────────────────────────────────────────────────────

class TelemetryResult {
  final double gyroVariance;
  final double accelVariance;
  final double motionScore; // 0.0–1.0
  final bool isRobotic;
  final int sampleCount;
  final String fingerprint;
  final Map<String, dynamic> rawData;

  const TelemetryResult({
    required this.gyroVariance,
    required this.accelVariance,
    required this.motionScore,
    required this.isRobotic,
    required this.sampleCount,
    required this.fingerprint,
    required this.rawData,
  });

  String get assessment {
    if (isRobotic) return '🤖 ROBOTIC — Device appears to be stationary (desk script)';
    if (motionScore < 0.3) return '⚠️ LOW MOTION — Unusually still for field device';
    return '✅ NATURAL — Normal human movement detected';
  }
}
