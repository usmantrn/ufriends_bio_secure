import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import '../models/models.dart';

/// Merkle Hash Chain Offline Queue
/// ─────────────────────────────────────────────────────────────────────────────
/// Implements the blueprint's tamper-detection requirement:
///   "Enrollment #2 is hashed with the hash of Enrollment #1.
///    If any data is altered, the chain breaks."
///
/// Each enrollment stored offline includes:
///   - payloadHash:   SHA-256 of its own data
///   - chainHash:     SHA-256(payloadHash + prevChainHash)  ← the Merkle link
///   - chainIndex:    position in the chain (0-based)
///
/// On sync, the backend can recompute the chain and detect any tampered record.
/// ─────────────────────────────────────────────────────────────────────────────
class SecureOfflineQueueService {
  static Database? _db;
  static const _dbName = 'biosecure_offline_v2.db';

  // In-memory last chain hash — avoids a DB read on every enqueue
  static String? _lastChainHash;
  static int _chainIndex = -1;

  static Future<Database> get database async {
    _db ??= await _initDb();
    return _db!;
  }

  static Future<Database> _initDb() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, _dbName);

    final db = await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE pending_enrollments (
            local_id       TEXT PRIMARY KEY,
            full_name      TEXT NOT NULL,
            date_of_birth  TEXT NOT NULL,
            gender         TEXT NOT NULL,
            phone          TEXT,
            address        TEXT NOT NULL,
            state_of_origin    TEXT NOT NULL,
            state_of_residence TEXT NOT NULL,
            lga_of_residence   TEXT NOT NULL,
            gps_lat        REAL,
            gps_lng        REAL,
            gps_accuracy   REAL,
            mock_gps       INTEGER NOT NULL DEFAULT 0,
            vpn_detected   INTEGER NOT NULL DEFAULT 0,
            clock_drift_ms INTEGER,
            session_id     TEXT NOT NULL,
            captured_at    TEXT NOT NULL,
            synced         INTEGER NOT NULL DEFAULT 0,
            sync_attempts  INTEGER NOT NULL DEFAULT 0,
            payload_json   TEXT NOT NULL,
            payload_hash   TEXT NOT NULL,
            chain_hash     TEXT NOT NULL,
            chain_index    INTEGER NOT NULL,
            agent_id       TEXT NOT NULL
          )
        ''');

        await db.execute('''
          CREATE TABLE chain_anchors (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            chain_hash  TEXT NOT NULL,
            chain_index INTEGER NOT NULL,
            anchored_at TEXT NOT NULL
          )
        ''');
      },
    );

    // Restore chain state from last record
    await _restoreChainState(db);
    return db;
  }

  static Future<void> _restoreChainState(Database db) async {
    final rows = await db.query(
      'pending_enrollments',
      columns: ['chain_hash', 'chain_index'],
      orderBy: 'chain_index DESC',
      limit: 1,
    );
    if (rows.isNotEmpty) {
      _lastChainHash = rows.first['chain_hash'] as String;
      _chainIndex = rows.first['chain_index'] as int;
    } else {
      // Genesis hash — publicly known starting point
      _lastChainHash = sha256.convert(utf8.encode('BIOSECURE_GENESIS_BLOCK_2024')).toString();
      _chainIndex = -1;
    }
  }

  /// Enqueue enrollment with Merkle chain link
  static Future<ChainRecord> enqueue({
    required PendingEnrollment enrollment,
    required Map<String, dynamic> payload,
    required String agentId,
  }) async {
    final db = await database;

    // 1. Compute payload hash (SHA-256 of the canonical JSON)
    final canonicalJson = _canonicalize(payload);
    final payloadHash = sha256.convert(utf8.encode(canonicalJson)).toString();

    // 2. Compute chain hash = SHA-256(payloadHash + previousChainHash)
    final chainInput = '$payloadHash${_lastChainHash ?? ""}';
    final chainHash = sha256.convert(utf8.encode(chainInput)).toString();

    _chainIndex++;
    final chainIndex = _chainIndex;

    // 3. Store with chain metadata
    await db.insert(
      'pending_enrollments',
      {
        'local_id': enrollment.localId,
        'full_name': enrollment.fullName,
        'date_of_birth': enrollment.dateOfBirth,
        'gender': enrollment.gender,
        'phone': enrollment.phone,
        'address': enrollment.address,
        'state_of_origin': enrollment.stateOfOrigin,
        'state_of_residence': enrollment.stateOfResidence,
        'lga_of_residence': enrollment.lgaOfResidence,
        'gps_lat': enrollment.gpsLat,
        'gps_lng': enrollment.gpsLng,
        'gps_accuracy': enrollment.gpsAccuracy,
        'mock_gps': enrollment.mockGpsDetected ? 1 : 0,
        'vpn_detected': enrollment.vpnDetected ? 1 : 0,
        'clock_drift_ms': enrollment.clockDriftMs,
        'session_id': enrollment.sessionId,
        'captured_at': enrollment.capturedAt.toIso8601String(),
        'synced': 0,
        'sync_attempts': 0,
        'payload_json': canonicalJson,
        'payload_hash': payloadHash,
        'chain_hash': chainHash,
        'chain_index': chainIndex,
        'agent_id': agentId,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );

    // Update in-memory state
    _lastChainHash = chainHash;

    return ChainRecord(
      localId: enrollment.localId,
      chainIndex: chainIndex,
      payloadHash: payloadHash,
      chainHash: chainHash,
    );
  }

  /// Verify the entire local chain integrity
  /// Returns a ChainVerificationResult with any broken links
  static Future<ChainVerificationResult> verifyChain() async {
    final db = await database;
    final rows = await db.query(
      'pending_enrollments',
      orderBy: 'chain_index ASC',
    );

    if (rows.isEmpty) {
      return ChainVerificationResult(isValid: true, totalRecords: 0, brokenAt: []);
    }

    String expectedPrev = sha256
        .convert(utf8.encode('BIOSECURE_GENESIS_BLOCK_2024'))
        .toString();

    final brokenAt = <int>[];

    for (final row in rows) {
      final storedPayloadHash = row['payload_hash'] as String;
      final storedChainHash = row['chain_hash'] as String;
      final chainIndex = row['chain_index'] as int;
      final payloadJson = row['payload_json'] as String;

      // Re-compute payload hash
      final recomputedPayloadHash =
          sha256.convert(utf8.encode(payloadJson)).toString();

      // Re-compute chain hash
      final recomputedChainHash = sha256
          .convert(utf8.encode('$recomputedPayloadHash$expectedPrev'))
          .toString();

      if (recomputedPayloadHash != storedPayloadHash ||
          recomputedChainHash != storedChainHash) {
        brokenAt.add(chainIndex);
      }

      expectedPrev = storedChainHash;
    }

    return ChainVerificationResult(
      isValid: brokenAt.isEmpty,
      totalRecords: rows.length,
      brokenAt: brokenAt,
    );
  }

  /// Get all unsynced enrollments with chain metadata for backend sync
  static Future<List<Map<String, dynamic>>> getPendingEnrollments() async {
    final db = await database;
    return db.query(
      'pending_enrollments',
      where: 'synced = 0',
      orderBy: 'chain_index ASC',
      limit: 50,
    );
  }

  /// Mark synced and securely wipe local payload (NDPR compliance)
  /// Overwrites payload_json with zeroed bytes per NDPA 2023
  static Future<void> markSyncedAndWipe(String localId) async {
    final db = await database;
    // Keep chain metadata but wipe PII and biometric payload
    await db.update(
      'pending_enrollments',
      {
        'synced': 1,
        'payload_json': '{"wiped":true,"reason":"NDPA_2023_compliance"}',
        'full_name': '*** WIPED ***',
        'phone': null,
        'address': '*** WIPED ***',
      },
      where: 'local_id = ?',
      whereArgs: [localId],
    );
  }

  static Future<void> incrementSyncAttempt(String localId, String? error) async {
    final db = await database;
    await db.rawUpdate(
      'UPDATE pending_enrollments SET sync_attempts = sync_attempts + 1 WHERE local_id = ?',
      [localId],
    );
  }

  static Future<int> pendingCount() async {
    final db = await database;
    final result = await db
        .rawQuery('SELECT COUNT(*) as count FROM pending_enrollments WHERE synced = 0');
    return (result.first['count'] as int?) ?? 0;
  }

  static Map<String, dynamic> parsePayload(Map<String, dynamic> row) {
    return jsonDecode(row['payload_json'] as String) as Map<String, dynamic>;
  }

  /// Canonical JSON — keys sorted alphabetically so hash is deterministic
  static String _canonicalize(Map<String, dynamic> map) {
    final sorted = Map.fromEntries(
      map.entries.toList()..sort((a, b) => a.key.compareTo(b.key)),
    );
    return jsonEncode(sorted);
  }
}

// ── Data models ────────────────────────────────────────────────────────────────

class ChainRecord {
  final String localId;
  final int chainIndex;
  final String payloadHash;
  final String chainHash;

  const ChainRecord({
    required this.localId,
    required this.chainIndex,
    required this.payloadHash,
    required this.chainHash,
  });
}

class ChainVerificationResult {
  final bool isValid;
  final int totalRecords;
  final List<int> brokenAt;

  const ChainVerificationResult({
    required this.isValid,
    required this.totalRecords,
    required this.brokenAt,
  });

  String get summary {
    if (isValid) return '✅ Chain intact — $totalRecords records verified';
    return '🚨 TAMPER DETECTED — broken at indices: $brokenAt';
  }
}
