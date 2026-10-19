import 'dart:async';
import 'dart:io';
import 'package:multicast_dns/multicast_dns.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Discovers the Ufriends BioSecure backend on the local network or ADB tunnel.
/// Probes ADB reverse proxy (127.0.0.1) and current Wi-Fi LAN IPs with fast socket tests.
class ServerDiscoveryService {
  static const _serviceName = 'biosecure-api.local';
  static const _port = 3001;
  static const _cacheKey = 'cached_server_ip';

  // Candidate IPs tested in order:
  // 1. 127.0.0.1: USB ADB reverse proxy (instant, 0ms, works whenever plugged into PC)
  // 2. 10.245.150.21: Current host Wi-Fi LAN IP
  // 3. 192.168.0.103: Alternative home Wi-Fi LAN IP
  static const _candidateIps = [
    '127.0.0.1',
    '10.245.150.21',
    '192.168.0.103',
  ];

  /// Returns the full base URL of the backend, e.g. http://10.x.x.x:3001/api
  static Future<String> resolveBaseUrl() async {
    if (Platform.isAndroid) {
      final ip = await _discoverIp();
      return 'http://$ip:$_port/api';
    }
    return 'http://localhost:$_port/api';
  }

  static Future<String> _discoverIp() async {
    // 1. Probe static candidate IPs with fast socket test
    for (final ip in _candidateIps) {
      if (await _isReachable(ip)) {
        await _cacheIp(ip);
        return ip;
      }
    }

    // 2. Try previously cached IP if different
    final cached = await _getCachedIp();
    if (cached != null && !_candidateIps.contains(cached)) {
      if (await _isReachable(cached)) return cached;
    }

    // 3. Try mDNS discovery
    try {
      final ip = await _queryMdns().timeout(const Duration(seconds: 2));
      if (ip != null && await _isReachable(ip)) {
        await _cacheIp(ip);
        return ip;
      }
    } catch (_) {}

    // 4. Fallback to active LAN IP
    return '10.245.150.21';
  }

  static Future<String?> _queryMdns() async {
    final client = MDnsClient();
    try {
      await client.start();
      await for (final record in client.lookup<IPAddressResourceRecord>(
        ResourceRecordQuery.addressIPv4(_serviceName),
      )) {
        final ip = record.address.address;
        return ip;
      }
    } finally {
      client.stop();
    }
    return null;
  }

  static Future<bool> _isReachable(String ip) async {
    try {
      final socket = await Socket.connect(ip, _port,
          timeout: const Duration(milliseconds: 600));
      socket.destroy();
      return true;
    } catch (_) {
      return false;
    }
  }

  static Future<void> _cacheIp(String ip) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_cacheKey, ip);
    } catch (_) {}
  }

  static Future<String?> _getCachedIp() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(_cacheKey);
    } catch (_) {
      return null;
    }
  }

  static Future<void> clearCache() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_cacheKey);
    } catch (_) {}
  }
}
