import 'dart:io';
import 'package:dio/dio.dart';
import '../models/models.dart';
import 'storage_service.dart';
import 'server_discovery_service.dart';

/// API client for the Ufriends BioSecure backend (port 3001)
class ApiService {
  late final Dio _dio;
  static String? _resolvedBaseUrl;

  ApiService() {
    // Start with a temporary Dio; baseUrl is set after discovery
    _dio = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
      headers: {'Content-Type': 'application/json'},
    ));

    // Resolve the server URL in background and update Dio
    _resolveUrl();

    // Request interceptor — attach JWT using StorageService
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        // Ensure URL is resolved before sending any request
        if (_resolvedBaseUrl == null) {
          _resolvedBaseUrl = await ServerDiscoveryService.resolveBaseUrl();
        }
        options.baseUrl = _resolvedBaseUrl!;

        final token = await StorageService.getAccessToken();
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (error, handler) async {
        // Clear cached URL on network failure so next request re-discovers
        if (error.type == DioExceptionType.connectionTimeout ||
            error.type == DioExceptionType.connectionError) {
          _resolvedBaseUrl = null;
          await ServerDiscoveryService.clearCache();
        }

        // 401 → attempt token refresh
        if (error.response?.statusCode == 401) {
          final refreshToken = await StorageService.getRefreshToken();
          if (refreshToken != null) {
            try {
              final baseUrl = _resolvedBaseUrl ?? await ServerDiscoveryService.resolveBaseUrl();
              final resp = await Dio().post(
                '$baseUrl/auth/refresh',
                data: {'refreshToken': refreshToken},
              );
              final newToken = resp.data['accessToken'] as String;
              final newRefresh = resp.data['refreshToken'] as String? ?? refreshToken;
              await StorageService.saveTokens(
                accessToken: newToken,
                refreshToken: newRefresh,
              );
              error.requestOptions.headers['Authorization'] = 'Bearer $newToken';
              final retried = await _dio.fetch(error.requestOptions);
              return handler.resolve(retried);
            } catch (_) {
              await StorageService.clearAll();
            }
          }
        }
        handler.next(error);
      },
    ));
  }

  Future<void> _resolveUrl() async {
    _resolvedBaseUrl = await ServerDiscoveryService.resolveBaseUrl();
    _dio.options.baseUrl = _resolvedBaseUrl!;
  }

  // ─── Auth ─────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> agentLogin({
    required String email,
    required String password,
    required String deviceToken,
    required String platform,
    required String deviceLabel,
    required String macAddress,
    required String cameraVidPid,
  }) async {
    final resp = await _dio.post('/auth/agent-login', data: {
      'email': email,
      'password': password,
      'deviceToken': deviceToken,
      'platform': platform,
      'deviceLabel': deviceLabel,
      'macAddress': macAddress,
      'cameraVidPid': cameraVidPid,
    });
    return resp.data as Map<String, dynamic>;
  }

  Future<AgentModel> getMyProfile() async {
    final resp = await _dio.get('/auth/me');
    return AgentModel.fromJson(resp.data as Map<String, dynamic>);
  }

  Future<void> logout() async {
    try {
      await _dio.post('/auth/logout');
    } catch (_) {}
  }

  // ─── Biometric enrollment & verification ──────────────────────────

  /// Enroll agent biometric templates (first login)
  Future<Map<String, dynamic>> enrollBiometric({
    required List<double> faceDescriptor,
    required List<double> palmDescriptor,
  }) async {
    final resp = await _dio.post('/auth/biometric-enroll', data: {
      'faceDescriptor': faceDescriptor,
      'palmDescriptor': palmDescriptor,
    });
    return resp.data as Map<String, dynamic>;
  }

  /// Verify agent biometrics against stored templates (subsequent logins)
  Future<Map<String, dynamic>> verifyBiometric({
    required List<double> faceDescriptor,
    required List<double> palmDescriptor,
  }) async {
    final resp = await _dio.post('/auth/biometric-verify', data: {
      'faceDescriptor': faceDescriptor,
      'palmDescriptor': palmDescriptor,
    });
    return resp.data as Map<String, dynamic>;
  }

  // ─── Sessions ─────────────────────────────────────────────────────

  Future<SessionModel> startSession({
    required String deviceId,
    required double? gpsLat,
    required double? gpsLng,
    required double? gpsAccuracy,
    required int? clockDriftMs,
    required bool vpnDetected,
    required bool mockGpsDetected,
  }) async {
    final resp = await _dio.post('/sessions/start', data: {
      'deviceId': deviceId,
      'startGpsLat': gpsLat,
      'startGpsLng': gpsLng,
      'startGpsAccuracy': gpsAccuracy,
      'deviceClockDeltaMs': clockDriftMs,
      'vpnDetectedAtStart': vpnDetected,
      'mockGpsAtStart': mockGpsDetected,
    });
    return SessionModel.fromJson(resp.data['session'] as Map<String, dynamic>);
  }

  Future<void> endSession(String sessionId) async {
    await _dio.post('/sessions/$sessionId/end');
  }

  Future<SessionModel?> getActiveSession() async {
    try {
      final resp = await _dio.get('/sessions/active');
      if (resp.data == null) return null;
      return SessionModel.fromJson(resp.data as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  // ─── Enrollments ──────────────────────────────────────────────────

  Future<Map<String, dynamic>> enrollCitizen(Map<String, dynamic> data) async {
    final resp = await _dio.post('/enrollments', data: data);
    return resp.data as Map<String, dynamic>;
  }

  Future<List<Map<String, dynamic>>> getMyEnrollments({int page = 1, int limit = 20}) async {
    final resp = await _dio.get('/enrollments', queryParameters: {'page': page, 'limit': limit});
    final list = resp.data['enrollments'] as List;
    return list.map((e) => e as Map<String, dynamic>).toList();
  }

  // ─── Strikes ──────────────────────────────────────────────────────

  Future<List<StrikeModel>> getMyStrikes() async {
    final resp = await _dio.get('/strikes?limit=10');
    final list = resp.data['strikes'] as List;
    return list.map((e) => StrikeModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  // ─── Dashboard ────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getDashboardStats() async {
    final resp = await _dio.get('/dashboard/stats');
    return resp.data as Map<String, dynamic>;
  }

  // ─── Connectivity check ───────────────────────────────────────────

  static Future<bool> isServerReachable() async {
    try {
      final baseUrl = _resolvedBaseUrl ?? await ServerDiscoveryService.resolveBaseUrl();
      final host = Uri.parse(baseUrl).host;
      final socket = await Socket.connect(host, 3001,
          timeout: const Duration(seconds: 3));
      socket.destroy();
      return true;
    } catch (_) {
      return false;
    }
  }
}
