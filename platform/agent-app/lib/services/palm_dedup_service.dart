import 'package:dio/dio.dart';
import 'server_discovery_service.dart';
import 'storage_service.dart';

/// Calls the backend 1:N palm deduplication endpoint.
///
/// Two-stage pipeline (palm_vein_system_architecture.pdf):
///   Stage 1: Macro-geometric coarse filter (first 64 dims, fast reject ~85%)
///   Stage 2: Full 256-dim cosine similarity check (threshold 0.82)
///
/// Fails OPEN on network error — enrollment is never blocked offline.
/// Dedup is re-run server-side at sync time as a safety net.
class PalmDedupService {
  static final Dio _dio = Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 15),
    headers: {'Content-Type': 'application/json'},
  ));

  /// Check a 256-dim palm template against all enrolled citizens.
  static Future<PalmDedupResponse> check({
    required List<double> template,
    required String side, // 'Right' | 'Left'
    String? excludeCitizenId,
  }) async {
    try {
      final baseUrl = await ServerDiscoveryService.resolveBaseUrl();
      final token   = await StorageService.getAccessToken();

      final Map<String, dynamic> body = {
        'template': template,
        'side': side,
        if (excludeCitizenId != null) 'excludeCitizenId': excludeCitizenId,
      };

      final response = await _dio.post(
        '$baseUrl/api/palm/dedup-check',
        data: body,
        options: Options(headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        }),
      );

      return PalmDedupResponse.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      if (e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout) {
        return PalmDedupResponse.offline();
      }
      return PalmDedupResponse.error('Dedup failed: ${e.message}');
    } catch (e) {
      return PalmDedupResponse.error('Unexpected error: $e');
    }
  }
}

// ─── Response model ───────────────────────────────────────────────────────

class PalmDedupResponse {
  final bool isDuplicate;
  final bool isOffline;
  final bool hasError;
  final List<PalmMatch> matches;
  final int scanned;
  final int coarsePassed;
  final int processingMs;
  final double threshold;
  final String? errorMessage;

  const PalmDedupResponse({
    required this.isDuplicate,
    this.isOffline   = false,
    this.hasError    = false,
    this.matches     = const [],
    this.scanned     = 0,
    this.coarsePassed = 0,
    this.processingMs = 0,
    this.threshold   = 0.82,
    this.errorMessage,
  });

  factory PalmDedupResponse.fromJson(Map<String, dynamic> j) =>
      PalmDedupResponse(
        isDuplicate:  j['isDuplicate'] as bool? ?? false,
        matches:      (j['matches'] as List? ?? [])
            .map((m) => PalmMatch.fromJson(m as Map<String, dynamic>))
            .toList(),
        scanned:       j['scanned'] as int? ?? 0,
        coarsePassed:  j['coarsePassed'] as int? ?? 0,
        processingMs:  j['processingMs'] as int? ?? 0,
        threshold:     (j['threshold'] as num?)?.toDouble() ?? 0.82,
      );

  factory PalmDedupResponse.error(String msg) =>
      PalmDedupResponse(isDuplicate: false, hasError: true, errorMessage: msg);

  factory PalmDedupResponse.offline() =>
      const PalmDedupResponse(isDuplicate: false, isOffline: true);

  PalmMatch? get topMatch => matches.isEmpty ? null : matches.first;
}

class PalmMatch {
  final String citizenId;
  final String name;
  final String side;
  final double similarity;

  const PalmMatch({
    required this.citizenId,
    required this.name,
    required this.side,
    required this.similarity,
  });

  factory PalmMatch.fromJson(Map<String, dynamic> j) => PalmMatch(
    citizenId:  j['citizenId'] as String? ?? '',
    name:       j['name']      as String? ?? 'Unknown',
    side:       j['side']      as String? ?? '',
    similarity: (j['similarity'] as num?)?.toDouble() ?? 0.0,
  );

  int get similarityPercent => (similarity * 100).round();
}
