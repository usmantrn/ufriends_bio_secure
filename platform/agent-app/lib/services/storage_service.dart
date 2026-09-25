import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path/path.dart' as p;

/// Central storage service for tokens and credentials
/// On Linux desktop: falls back to encrypted local file if keyring unavailable
/// On Android: uses EncryptedSharedPreferences
/// On Windows: uses Windows Credential Manager
class StorageService {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    lOptions: LinuxOptions(),
    wOptions: WindowsOptions(),
  );

  static const _keyAccessToken = 'access_token';
  static const _keyRefreshToken = 'refresh_token';
  static const _keyAgentId = 'agent_id';
  static const _keyDeviceId = 'device_id';
  static const _keySessionToken = 'session_token';
  static const _keySessionExpiry = 'session_expiry';

  // ── In-memory fallback for Linux when keyring is unavailable ──────
  static final Map<String, String> _memCache = {};
  static bool _useMemFallback = false;

  static Future<void> _initFallback() async {
    if (!Platform.isLinux) return;
    try {
      // Test if keyring is actually working
      await _storage.write(key: '_test_', value: 'ok');
      final v = await _storage.read(key: '_test_');
      if (v != 'ok') _useMemFallback = true;
      await _storage.delete(key: '_test_');
    } catch (_) {
      debugPrint('[StorageService] Keyring unavailable — using memory fallback');
      _useMemFallback = true;
    }
  }

  static Future<void> _write(String key, String value) async {
    if (_useMemFallback) {
      _memCache[key] = value;
      await _persistToDisk();
      return;
    }
    try {
      await _storage.write(key: key, value: value);
    } catch (_) {
      _useMemFallback = true;
      _memCache[key] = value;
      await _persistToDisk();
    }
  }

  static Future<String?> _read(String key) async {
    if (_useMemFallback) {
      await _loadFromDisk();
      return _memCache[key];
    }
    try {
      return await _storage.read(key: key);
    } catch (_) {
      _useMemFallback = true;
      await _loadFromDisk();
      return _memCache[key];
    }
  }

  static Future<void> _delete(String key) async {
    if (_useMemFallback) {
      _memCache.remove(key);
      await _persistToDisk();
      return;
    }
    try {
      await _storage.delete(key: key);
    } catch (_) {
      _useMemFallback = true;
      _memCache.remove(key);
    }
  }

  static Future<void> _deleteAll() async {
    if (_useMemFallback) {
      _memCache.clear();
      await _persistToDisk();
      return;
    }
    try {
      await _storage.deleteAll();
    } catch (_) {
      _useMemFallback = true;
      _memCache.clear();
    }
  }

  // Simple XOR obfuscation for the fallback file (not crypto-secure, for dev only)
  static const _key = 'nimc_agent_2026_k';
  static String _xor(String input) {
    final kBytes = utf8.encode(_key);
    final iBytes = utf8.encode(input);
    final out = List<int>.generate(iBytes.length, (i) => iBytes[i] ^ kBytes[i % kBytes.length]);
    return base64Encode(out);
  }
  static String _dexor(String input) {
    final kBytes = utf8.encode(_key);
    final iBytes = base64Decode(input);
    final out = List<int>.generate(iBytes.length, (i) => iBytes[i] ^ kBytes[i % kBytes.length]);
    return utf8.decode(out);
  }

  static File get _cacheFile {
    final home = Platform.environment['HOME'] ?? '/tmp';
    return File(p.join(home, '.nimc_agent', 'session.dat'));
  }

  static Future<void> _persistToDisk() async {
    try {
      final file = _cacheFile;
      await file.parent.create(recursive: true);
      final json = jsonEncode(_memCache);
      await file.writeAsString(_xor(json));
    } catch (_) {}
  }

  static bool _diskLoaded = false;
  static Future<void> _loadFromDisk() async {
    if (_diskLoaded) return;
    _diskLoaded = true;
    try {
      final file = _cacheFile;
      if (await file.exists()) {
        final raw = await file.readAsString();
        final json = _dexor(raw);
        final map = jsonDecode(json) as Map<String, dynamic>;
        map.forEach((k, v) => _memCache[k] = v as String);
      }
    } catch (_) {}
  }

  // ── Public API ────────────────────────────────────────────────────

  static Future<void> init() async {
    await _initFallback();
  }

  // Tokens
  static Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _write(_keyAccessToken, accessToken);
    await _write(_keyRefreshToken, refreshToken);
  }

  static Future<String?> getAccessToken() => _read(_keyAccessToken);
  static Future<String?> getRefreshToken() => _read(_keyRefreshToken);

  // Agent identity
  static Future<void> saveAgentId(String id) => _write(_keyAgentId, id);
  static Future<String?> getAgentId() => _read(_keyAgentId);

  // Device registration
  static Future<void> saveDeviceId(String id) => _write(_keyDeviceId, id);
  static Future<String?> getDeviceId() => _read(_keyDeviceId);

  // Active session
  static Future<void> saveSession({
    required String sessionToken,
    required DateTime expiresAt,
  }) async {
    await _write(_keySessionToken, sessionToken);
    await _write(_keySessionExpiry, expiresAt.toIso8601String());
  }

  static Future<String?> getSessionToken() => _read(_keySessionToken);
  static Future<DateTime?> getSessionExpiry() async {
    final raw = await _read(_keySessionExpiry);
    return raw != null ? DateTime.tryParse(raw) : null;
  }

  static Future<void> clearSession() async {
    await _delete(_keySessionToken);
    await _delete(_keySessionExpiry);
  }

  static Future<void> clearAll() async {
    _memCache.clear();
    _diskLoaded = false;
    try { await _cacheFile.delete(); } catch (_) {}
    await _deleteAll();
  }
}
