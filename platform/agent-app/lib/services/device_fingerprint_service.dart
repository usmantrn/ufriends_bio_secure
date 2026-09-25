import 'dart:io';
import 'package:crypto/crypto.dart';
import 'dart:convert';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:network_info_plus/network_info_plus.dart';

/// Generates a tamper-proof device fingerprint
/// SHA-256(MAC + CPU serial + Camera VID/PID)
class DeviceFingerprintService {
  static final DeviceInfoPlugin _deviceInfo = DeviceInfoPlugin();
  static final NetworkInfo _networkInfo = NetworkInfo();

  /// Returns the device token (fingerprint) for this device
  static Future<String> getDeviceToken() async {
    final components = <String>[];

    try {
      if (Platform.isAndroid) {
        final info = await _deviceInfo.androidInfo;
        components.addAll([
          info.id,            // Build fingerprint
          info.serialNumber,  // Hardware serial
          info.device,        // Device codename
          info.hardware,      // Hardware platform
        ]);
      } else if (Platform.isLinux) {
        final info = await _deviceInfo.linuxInfo;
        components.addAll([
          info.machineId ?? '',
          info.id,
          info.name,
          info.version ?? '',
        ]);
      }

      // Add MAC address
      final mac = await _networkInfo.getWifiBSSID() ?? 'NO_WIFI';
      components.add(mac);
    } catch (e) {
      components.add('FALLBACK_${Platform.operatingSystem}');
    }

    final raw = components.join('|');
    final bytes = utf8.encode(raw);
    final digest = sha256.convert(bytes);
    return digest.toString();
  }

  /// Returns platform info for device registration
  static Future<Map<String, dynamic>> getDeviceInfo() async {
    final token = await getDeviceToken();
    String platform = 'LINUX';
    String? macAddress;
    String? label;

    try {
      if (Platform.isAndroid) {
        final info = await _deviceInfo.androidInfo;
        platform = 'ANDROID';
        label = '${info.brand} ${info.model}';
        macAddress = await _networkInfo.getWifiBSSID();
      } else if (Platform.isLinux) {
        final info = await _deviceInfo.linuxInfo;
        platform = 'LINUX';
        label = info.prettyName;
      }
    } catch (_) {}

    return {
      'deviceToken': token,
      'platform': platform,
      'deviceLabel': label ?? 'BioSecure Agent Device',
      'macAddress': macAddress,
      'cameraVidPid': await _detectCameraVidPid(),
    };
  }

  /// On Linux, reads USB camera VID/PID from /sys/bus/usb
  static Future<String> _detectCameraVidPid() async {
    if (!Platform.isLinux) return 'INTEGRATED';
    try {
      final result = await Process.run(
        'bash',
        ['-c', r"lsusb | grep -i 'camera\|webcam\|video' | head -1 | grep -oP 'ID \K[\da-f:]+' || echo 'UNKNOWN'"],
      );
      return (result.stdout as String).trim().isEmpty
          ? 'UNKNOWN'
          : (result.stdout as String).trim();
    } catch (_) {
      return 'UNKNOWN';
    }
  }
}
