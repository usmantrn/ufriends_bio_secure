// Agent model — mirrors backend nimc_agents table
class AgentModel {
  final String id;
  final String fullName;
  final String email;
  final String licenseNumber;
  final String licenseStatus;
  final String operatingState;
  final String operatingLGA;
  final double? operatingGpsLat;
  final double? operatingGpsLng;
  final double operatingRadiusKm;
  final int strikeCount;
  final String? organizationId;
  final String? organizationName;

  AgentModel({
    required this.id,
    required this.fullName,
    required this.email,
    required this.licenseNumber,
    required this.licenseStatus,
    required this.operatingState,
    required this.operatingLGA,
    this.operatingGpsLat,
    this.operatingGpsLng,
    this.operatingRadiusKm = 50,
    required this.strikeCount,
    this.organizationId,
    this.organizationName,
  });

  factory AgentModel.fromJson(Map<String, dynamic> json) {
    return AgentModel(
      id: json['id'] as String,
      fullName: json['fullName'] as String,
      email: json['email'] as String,
      licenseNumber: json['licenseNumber'] as String,
      licenseStatus: json['licenseStatus'] as String,
      operatingState: json['operatingState'] as String,
      operatingLGA: json['operatingLGA'] as String,
      operatingGpsLat: (json['operatingGpsLat'] as num?)?.toDouble(),
      operatingGpsLng: (json['operatingGpsLng'] as num?)?.toDouble(),
      operatingRadiusKm: (json['operatingRadiusKm'] as num?)?.toDouble() ?? 50,
      strikeCount: json['strikeCount'] as int? ?? 0,
      organizationId: json['organizationId'] as String?,
      organizationName: json['organization']?['name'] as String?,
    );
  }

  bool get isActive => licenseStatus == 'ACTIVE';
  bool get isSuspended => licenseStatus == 'SUSPENDED';
  bool get isBanned => licenseStatus == 'BANNED';
}

// Enrollment Session model
class SessionModel {
  final String id;
  final String sessionToken;
  final DateTime startedAt;
  final DateTime expiresAt;
  final bool isActive;
  final double? startGpsLat;
  final double? startGpsLng;
  int enrollmentCount;

  SessionModel({
    required this.id,
    required this.sessionToken,
    required this.startedAt,
    required this.expiresAt,
    required this.isActive,
    this.startGpsLat,
    this.startGpsLng,
    this.enrollmentCount = 0,
  });

  factory SessionModel.fromJson(Map<String, dynamic> json) {
    return SessionModel(
      id: json['id'] as String,
      sessionToken: json['sessionToken'] as String,
      startedAt: DateTime.parse(json['startedAt'] as String),
      expiresAt: DateTime.parse(json['expiresAt'] as String),
      isActive: json['isActive'] as bool? ?? true,
      startGpsLat: (json['startGpsLat'] as num?)?.toDouble(),
      startGpsLng: (json['startGpsLng'] as num?)?.toDouble(),
      enrollmentCount: json['_count']?['enrollments'] as int? ?? 0,
    );
  }

  Duration get remaining => expiresAt.difference(DateTime.now());
  bool get isExpired => DateTime.now().isAfter(expiresAt);
  double get progressFraction {
    final total = expiresAt.difference(startedAt).inSeconds;
    final elapsed = DateTime.now().difference(startedAt).inSeconds;
    return (elapsed / total).clamp(0.0, 1.0);
  }
}

// Strike model
class StrikeModel {
  final String id;
  final int strikeNumber;
  final String trigger;
  final String details;
  final bool isResolved;
  final DateTime issuedAt;

  StrikeModel({
    required this.id,
    required this.strikeNumber,
    required this.trigger,
    required this.details,
    required this.isResolved,
    required this.issuedAt,
  });

  factory StrikeModel.fromJson(Map<String, dynamic> json) {
    return StrikeModel(
      id: json['id'] as String,
      strikeNumber: json['strikeNumber'] as int,
      trigger: json['trigger'] as String,
      details: json['details'] as String,
      isResolved: json['isResolved'] as bool? ?? false,
      issuedAt: DateTime.parse(json['issuedAt'] as String),
    );
  }
}

// Citizen (offline enrollment queue) model
class PendingEnrollment {
  final String localId;
  final String fullName;
  final String dateOfBirth;
  final String gender;
  final String? phone;
  final String address;
  final String stateOfOrigin;
  final String stateOfResidence;
  final String lgaOfResidence;
  final double? gpsLat;
  final double? gpsLng;
  final double? gpsAccuracy;
  final bool mockGpsDetected;
  final bool vpnDetected;
  final int? clockDriftMs;
  final String sessionId;
  final DateTime capturedAt;
  bool synced;

  PendingEnrollment({
    required this.localId,
    required this.fullName,
    required this.dateOfBirth,
    required this.gender,
    this.phone,
    required this.address,
    required this.stateOfOrigin,
    required this.stateOfResidence,
    required this.lgaOfResidence,
    this.gpsLat,
    this.gpsLng,
    this.gpsAccuracy,
    required this.mockGpsDetected,
    required this.vpnDetected,
    this.clockDriftMs,
    required this.sessionId,
    required this.capturedAt,
    this.synced = false,
  });

  Map<String, dynamic> toJson() => {
    'localId': localId,
    'fullName': fullName,
    'dateOfBirth': dateOfBirth,
    'gender': gender,
    'phone': phone,
    'address': address,
    'stateOfOrigin': stateOfOrigin,
    'stateOfResidence': stateOfResidence,
    'lgaOfResidence': lgaOfResidence,
    'enrollmentGpsLat': gpsLat,
    'enrollmentGpsLng': gpsLng,
    'enrollmentGpsAccuracy': gpsAccuracy,
    'mockGpsDetected': mockGpsDetected,
    'vpnDetected': vpnDetected,
    'clockDriftMs': clockDriftMs,
    'sessionId': sessionId,
    'enrollmentSessionId': sessionId,
  };
}
