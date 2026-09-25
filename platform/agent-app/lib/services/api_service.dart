import 'dart:io';
import 'package:dio/dio.dart';
import '../models/models.dart';
import 'storage_service.dart';

/// API client for the Ufriends BioSecure backend (port 3001)
class ApiService {
  // Desktop (Linux/Windows) → localhost; Android phone → machine's LAN IP
  static String get _baseUrl {
    if (Platform.isAndroid) {
      return 'http://10.146.232.21:3001/api';
    }
    return 'http://localhost:3001/api';
  }

  late final Dio _dio;

  ApiService() {
    _dio = Dio(BaseOptions(
      baseUrl: _baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
      headers: {'Content-Type': 'application/json'},
    ));

    // Request interceptor — attach JWT using StorageService
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await StorageService.getAccessToken();
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (error, handler) async {
        // 401 → attempt token refresh
        if (error.response?.statusCode == 401) {
          final refreshToken = await StorageService.getRefreshToken();
          if (refreshToken != null) {
            try {
              final resp = await Dio().post(
                '$_baseUrl/auth/refresh',
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
    final host = Platform.isAndroid ? '10.146.232.21' : 'localhost';
    try {
      final socket = await Socket.connect(host, 3001,
          timeout: const Duration(seconds: 3));
      socket.destroy();
      return true;
    } catch (_) {
      return false;
    }
  }
}
