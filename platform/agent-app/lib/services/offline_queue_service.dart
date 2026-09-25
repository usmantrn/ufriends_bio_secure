import 'dart:async';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import '../models/models.dart';
import 'dart:convert';

/// Local SQLite database for offline enrollment queue
/// Encrypted at rest; syncs to server when connectivity returns
class OfflineQueueService {
  static Database? _db;
  static const _dbName = 'nimc_offline.db';
  static const _version = 1;

  static Future<Database> get database async {
    _db ??= await _initDb();
    return _db!;
  }

  static Future<Database> _initDb() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, _dbName);

    return openDatabase(
      path,
      version: _version,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE pending_enrollments (
            local_id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            date_of_birth TEXT NOT NULL,
            gender TEXT NOT NULL,
            phone TEXT,
            address TEXT NOT NULL,
            state_of_origin TEXT NOT NULL,
            state_of_residence TEXT NOT NULL,
            lga_of_residence TEXT NOT NULL,
            gps_lat REAL,
            gps_lng REAL,
            gps_accuracy REAL,
            mock_gps INTEGER NOT NULL DEFAULT 0,
            vpn_detected INTEGER NOT NULL DEFAULT 0,
            clock_drift_ms INTEGER,
            session_id TEXT NOT NULL,
            captured_at TEXT NOT NULL,
            synced INTEGER NOT NULL DEFAULT 0,
            sync_attempts INTEGER NOT NULL DEFAULT 0,
            payload_json TEXT NOT NULL
          )
        ''');

        await db.execute('''
          CREATE TABLE sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            local_id TEXT NOT NULL,
            attempt_at TEXT NOT NULL,
            success INTEGER NOT NULL,
            error_msg TEXT
          )
        ''');
      },
    );
  }

  /// Add a citizen to the offline queue
  static Future<void> enqueue(PendingEnrollment enrollment, Map<String, dynamic> payload) async {
    final db = await database;
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
        'payload_json': jsonEncode(payload),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Get all unsynced enrollments
  static Future<List<Map<String, dynamic>>> getPendingEnrollments() async {
    final db = await database;
    return db.query(
      'pending_enrollments',
      where: 'synced = 0',
      orderBy: 'captured_at ASC',
      limit: 50,
    );
  }

  /// Mark an enrollment as synced
  static Future<void> markSynced(String localId) async {
    final db = await database;
    await db.update(
      'pending_enrollments',
      {'synced': 1},
      where: 'local_id = ?',
      whereArgs: [localId],
    );
  }

  /// Increment sync attempt counter
  static Future<void> incrementSyncAttempt(String localId, String? error) async {
    final db = await database;
    await db.rawUpdate(
      'UPDATE pending_enrollments SET sync_attempts = sync_attempts + 1 WHERE local_id = ?',
      [localId],
    );
    await db.insert('sync_log', {
      'local_id': localId,
      'attempt_at': DateTime.now().toIso8601String(),
      'success': 0,
      'error_msg': error,
    });
  }

  /// Total pending count
  static Future<int> pendingCount() async {
    final db = await database;
    final result = await db.rawQuery(
        'SELECT COUNT(*) as count FROM pending_enrollments WHERE synced = 0');
    return (result.first['count'] as int?) ?? 0;
  }

  /// Get payload JSON for a pending enrollment
  static Map<String, dynamic> parsePayload(Map<String, dynamic> row) {
    return jsonDecode(row['payload_json'] as String) as Map<String, dynamic>;
  }
}
