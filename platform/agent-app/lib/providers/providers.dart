import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/models.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';
import '../services/offline_queue_service.dart';

// ─── API Service Provider ─────────────────────────────────────────────────────
final apiServiceProvider = Provider<ApiService>((ref) => ApiService());

// ─── Auth State ───────────────────────────────────────────────────────────────
class AuthState {
  final AgentModel? agent;
  final String? deviceId;
  final bool loading;
  final String? error;

  const AuthState({this.agent, this.deviceId, this.loading = false, this.error});

  AuthState copyWith({AgentModel? agent, String? deviceId, bool? loading, String? error}) {
    return AuthState(
      agent: agent ?? this.agent,
      deviceId: deviceId ?? this.deviceId,
      loading: loading ?? this.loading,
      error: error,
    );
  }

  bool get isLoggedIn => agent != null;
}

class AuthNotifier extends StateNotifier<AuthState> {
  final ApiService _api;

  AuthNotifier(this._api) : super(const AuthState()) {
    _tryRestoreSession();
  }

  Future<void> _tryRestoreSession() async {
    state = state.copyWith(loading: true);
    try {
      final token = await StorageService.getAccessToken();
      if (token != null) {
        final agent = await _api.getMyProfile();
        if (agent == null) throw Exception('Profile returned null');
        final deviceId = await StorageService.getDeviceId();
        state = state.copyWith(agent: agent, deviceId: deviceId, loading: false);
      } else {
        state = state.copyWith(loading: false);
      }
    } catch (e) {
      // Clear stale tokens but preserve error so login screen can display it
      await StorageService.clearAll();
      state = state.copyWith(loading: false);
    }
  }

  Future<bool> login({
    required String email,
    required String password,
    required Map<String, dynamic> deviceInfo,
  }) async {
    state = state.copyWith(loading: true, error: null);
    try {
      final result = await _api.agentLogin(
        email: email,
        password: password,
        deviceToken: deviceInfo['deviceToken'] as String,
        platform: deviceInfo['platform'] as String,
        deviceLabel: deviceInfo['deviceLabel'] as String,
        macAddress: deviceInfo['macAddress'] as String? ?? '',
        cameraVidPid: deviceInfo['cameraVidPid'] as String? ?? 'UNKNOWN',
      );

      await StorageService.saveTokens(
        accessToken: result['accessToken'] as String,
        refreshToken: result['refreshToken'] as String,
      );
      await StorageService.saveDeviceId(result['deviceId'] as String);

      final agent = AgentModel.fromJson(result['agent'] as Map<String, dynamic>);
      await StorageService.saveAgentId(agent.id);

      state = state.copyWith(
        agent: agent,
        deviceId: result['deviceId'] as String,
        loading: false,
      );
      return true;
    } catch (e) {
      state = state.copyWith(
        loading: false,
        error: _parseError(e),
      );
      return false;
    }
  }

  Future<void> logout() async {
    await _api.logout();
    await StorageService.clearAll();
    state = const AuthState();
  }

  String _parseError(dynamic e) {
    if (e is DioException) {
      return e.response?.data?['error'] as String? ?? 'Connection failed';
    }
    return e.toString();
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref.read(apiServiceProvider));
});

// ─── Session State ────────────────────────────────────────────────────────────
class SessionState {
  final SessionModel? session;
  final bool loading;
  final String? error;
  final int enrollmentsThisSession;
  final DateTime? lastEnrollmentTime;

  const SessionState({
    this.session,
    this.loading = false,
    this.error,
    this.enrollmentsThisSession = 0,
    this.lastEnrollmentTime,
  });

  bool get hasActiveSession =>
      session != null && session!.isActive && !session!.isExpired;

  SessionState copyWith({
    SessionModel? session,
    bool? loading,
    String? error,
    int? enrollmentsThisSession,
    DateTime? lastEnrollmentTime,
  }) =>
      SessionState(
        session: session ?? this.session,
        loading: loading ?? this.loading,
        error: error,
        enrollmentsThisSession:
            enrollmentsThisSession ?? this.enrollmentsThisSession,
        lastEnrollmentTime: lastEnrollmentTime ?? this.lastEnrollmentTime,
      );
}

class SessionNotifier extends StateNotifier<SessionState> {
  final ApiService _api;

  SessionNotifier(this._api) : super(const SessionState()) {
    _checkExistingSession();
  }

  Future<void> _checkExistingSession() async {
    try {
      final session = await _api.getActiveSession();
      if (session != null && !session.isExpired) {
        state = state.copyWith(session: session);
      }
    } catch (_) {}
  }

  Future<bool> startSession({
    required String deviceId,
    required double? gpsLat,
    required double? gpsLng,
    required double? gpsAccuracy,
    required int? clockDriftMs,
    required bool vpnDetected,
    required bool mockGpsDetected,
  }) async {
    state = state.copyWith(loading: true, error: null);
    try {
      final session = await _api.startSession(
        deviceId: deviceId,
        gpsLat: gpsLat, gpsLng: gpsLng, gpsAccuracy: gpsAccuracy,
        clockDriftMs: clockDriftMs,
        vpnDetected: vpnDetected,
        mockGpsDetected: mockGpsDetected,
      );
      await StorageService.saveSession(
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
      );
      state = state.copyWith(session: session, loading: false);
      return true;
    } catch (e) {
      state = state.copyWith(loading: false, error: _parseError(e));
      return false;
    }
  }

  Future<void> endSession() async {
    if (state.session == null) return;
    try {
      await _api.endSession(state.session!.id);
    } catch (_) {}
    await StorageService.clearSession();
    state = const SessionState();
  }

  void incrementEnrollmentCount() {
    state = state.copyWith(
      enrollmentsThisSession: state.enrollmentsThisSession + 1,
      lastEnrollmentTime: DateTime.now(),
    );
  }

  String _parseError(dynamic e) {
    if (e is DioException) {
      return e.response?.data?['error'] as String? ?? 'Failed to start session';
    }
    return 'Unexpected error';
  }
}

final sessionProvider =
    StateNotifierProvider<SessionNotifier, SessionState>((ref) {
  return SessionNotifier(ref.read(apiServiceProvider));
});

// ─── Offline Queue State ───────────────────────────────────────────────────────
final pendingCountProvider = FutureProvider<int>((ref) async {
  return OfflineQueueService.pendingCount();
});
