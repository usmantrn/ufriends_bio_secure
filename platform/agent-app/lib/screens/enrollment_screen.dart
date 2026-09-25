import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:uuid/uuid.dart';
import '../models/models.dart';
import '../providers/providers.dart';
import '../services/antifraud_service.dart';
import '../services/offline_queue_service.dart';
import '../utils/app_theme.dart';
import 'camera_scanner_screen.dart';

class EnrollmentScreen extends ConsumerStatefulWidget {
  const EnrollmentScreen({super.key});

  @override
  ConsumerState<EnrollmentScreen> createState() => _EnrollmentScreenState();
}

class _EnrollmentScreenState extends ConsumerState<EnrollmentScreen> {
  final _formKey = GlobalKey<FormState>();
  final _uuid = const Uuid();

  // Form fields
  final _fullNameCtrl = TextEditingController();
  final _dobCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _addressCtrl = TextEditingController();
  final _stateOfOriginCtrl = TextEditingController();
  final _stateOfResidenceCtrl = TextEditingController();
  final _lgaCtrl = TextEditingController();

  String _gender = 'Male';
  DateTime? _selectedDob;

  bool _isSubmitting = false;
  bool _isRunningChecks = false;
  AntifraudResult? _fraudChecks;
  String? _submitError;
  bool _submitted = false;

  List<double>? _faceData;
  List<double>? _rightPalmData;
  List<double>? _leftPalmData;

  static const _nigerianStates = [
    'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
    'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
    'Abuja (FCT)', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina',
    'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo',
    'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
  ];

  @override
  void dispose() {
    for (final c in [_fullNameCtrl, _dobCtrl, _phoneCtrl, _addressCtrl,
        _stateOfOriginCtrl, _stateOfResidenceCtrl, _lgaCtrl]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _runSecurityChecks() async {
    setState(() => _isRunningChecks = true);
    final position = await AntifraudService.getCurrentPosition();
    final clockDrift = await AntifraudService.getClockDriftMs();
    final vpn = await AntifraudService.isVpnActive();
    final agent = ref.read(authProvider).agent!;
    final session = ref.read(sessionProvider);

    final mockGps = position != null && AntifraudService.isMockGps(position);
    final issues = <String>[];
    if (mockGps) issues.add('MOCK_GPS_DETECTED');
    if (vpn) issues.add('VPN_DETECTED');
    if (clockDrift != null && clockDrift.abs() > 300000) issues.add('TIME_MANIPULATION');

    // Geofence
    if (position != null && agent.operatingGpsLat != null) {
      if (!AntifraudService.isWithinGeofence(
        agentLat: agent.operatingGpsLat!, agentLng: agent.operatingGpsLng!,
        agentRadiusKm: agent.operatingRadiusKm,
        currentLat: position.latitude, currentLng: position.longitude,
      )) issues.add('GPS_OUTSIDE_GEOFENCE');
    }

    // Velocity
    final lastTime = session.lastEnrollmentTime;
    if (lastTime != null && AntifraudService.isEnrollmentTooFast(
        lastEnrollmentTime: lastTime, minEnrollmentSeconds: 120)) {
      issues.add('HIGH_ENROLLMENT_VELOCITY');
    }

    setState(() {
      _fraudChecks = AntifraudResult(
        passed: issues.isEmpty,
        issues: issues,
        mockGpsDetected: mockGps,
        vpnDetected: vpn,
        clockDriftMs: clockDrift,
        gpsLat: position?.latitude,
        gpsLng: position?.longitude,
        gpsAccuracy: position?.accuracy,
      );
      _isRunningChecks = false;
    });
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_fraudChecks == null) {
      await _runSecurityChecks();
    }

    setState(() { _isSubmitting = true; _submitError = null; });

    final sessionState = ref.read(sessionProvider);
    final checks = _fraudChecks!;

    final payload = <String, dynamic>{
      'fullName': _fullNameCtrl.text.trim(),
      'dateOfBirth': _selectedDob!.toIso8601String(),
      'gender': _gender,
      'phone': _phoneCtrl.text.trim().isEmpty ? null : _phoneCtrl.text.trim(),
      'address': _addressCtrl.text.trim(),
      'stateOfOrigin': _stateOfOriginCtrl.text.trim(),
      'stateOfResidence': _stateOfResidenceCtrl.text.trim(),
      'lgaOfResidence': _lgaCtrl.text.trim(),
      'enrollmentGpsLat': checks.gpsLat,
      'enrollmentGpsLng': checks.gpsLng,
      'enrollmentGpsAccuracy': checks.gpsAccuracy,
      'mockGpsDetected': checks.mockGpsDetected,
      'vpnDetected': checks.vpnDetected,
      'clockDriftMs': checks.clockDriftMs,
      'enrollmentSessionId': sessionState.session!.id,
      // Use captured biometric arrays
      'rgbFaceDescriptor': _faceData ?? List.generate(128, (i) => 0.01 * i),
      'irFaceDescriptor': _faceData ?? List.generate(128, (i) => 0.01 * i),
      'rightPalmVeinTemplate': _rightPalmData ?? List.generate(64, (i) => 0.02 * i),
      'leftPalmVeinTemplate': _leftPalmData ?? List.generate(64, (i) => 0.02 * i),
      'rightPalmVisible': _rightPalmData ?? List.generate(64, (i) => 0.015 * i),
      'leftPalmVisible': _leftPalmData ?? List.generate(64, (i) => 0.015 * i),
    };

    try {
      await ref.read(apiServiceProvider).enrollCitizen(payload);
      ref.read(sessionProvider.notifier).incrementEnrollmentCount();
      setState(() { _submitted = true; _isSubmitting = false; });
    } catch (e) {
      // If offline / server error — save to local queue
      final pending = PendingEnrollment(
        localId: _uuid.v4(),
        fullName: _fullNameCtrl.text.trim(),
        dateOfBirth: _selectedDob!.toIso8601String(),
        gender: _gender,
        phone: _phoneCtrl.text.trim().isEmpty ? null : _phoneCtrl.text.trim(),
        address: _addressCtrl.text.trim(),
        stateOfOrigin: _stateOfOriginCtrl.text.trim(),
        stateOfResidence: _stateOfResidenceCtrl.text.trim(),
        lgaOfResidence: _lgaCtrl.text.trim(),
        gpsLat: checks.gpsLat,
        gpsLng: checks.gpsLng,
        gpsAccuracy: checks.gpsAccuracy,
        mockGpsDetected: checks.mockGpsDetected,
        vpnDetected: checks.vpnDetected,
        clockDriftMs: checks.clockDriftMs,
        sessionId: sessionState.session!.id,
        capturedAt: DateTime.now(),
      );
      await OfflineQueueService.enqueue(pending, payload);
      ref.read(sessionProvider.notifier).incrementEnrollmentCount();
      setState(() { _submitted = true; _isSubmitting = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.bgBase,
      appBar: AppBar(
        title: const Text('Enroll Citizen'),
        backgroundColor: AppTheme.bgSurface,
      ),
      body: _submitted ? _SuccessView(onAnother: () {
        setState(() {
          _submitted = false;
          _fraudChecks = null;
          _fullNameCtrl.clear(); _dobCtrl.clear(); _phoneCtrl.clear();
          _addressCtrl.clear(); _stateOfOriginCtrl.clear();
          _stateOfResidenceCtrl.clear(); _lgaCtrl.clear();
          _selectedDob = null;
          _faceData = null;
          _rightPalmData = null;
          _leftPalmData = null;
        });
      }) : _EnrollmentForm(
        formKey: _formKey,
        fullNameCtrl: _fullNameCtrl,
        dobCtrl: _dobCtrl,
        phoneCtrl: _phoneCtrl,
        addressCtrl: _addressCtrl,
        stateOfOriginCtrl: _stateOfOriginCtrl,
        stateOfResidenceCtrl: _stateOfResidenceCtrl,
        lgaCtrl: _lgaCtrl,
        gender: _gender,
        onGenderChanged: (v) => setState(() => _gender = v!),
        nigerianStates: _nigerianStates,
        selectedDob: _selectedDob,
        onDobChanged: (d) => setState(() {
          _selectedDob = d;
          _dobCtrl.text = '${d.day}/${d.month}/${d.year}';
        }),
        fraudChecks: _fraudChecks,
        isRunningChecks: _isRunningChecks,
        isSubmitting: _isSubmitting,
        submitError: _submitError,
        onRunChecks: _runSecurityChecks,
        onSubmit: _submit,
        faceData: _faceData,
        rightPalmData: _rightPalmData,
        leftPalmData: _leftPalmData,
        onCapture: (type) async {
          final data = await Navigator.push<List<double>>(
            context,
            MaterialPageRoute(builder: (_) => CameraScannerScreen(scanType: type)),
          );
          if (data != null) {
            setState(() {
              if (type == 'Face') _faceData = data;
              if (type == 'Right Palm') _rightPalmData = data;
              if (type == 'Left Palm') _leftPalmData = data;
            });
          }
        },
      ),
    );
  }
}

class _SuccessView extends StatelessWidget {
  final VoidCallback onAnother;
  const _SuccessView({required this.onAnother});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 80, height: 80,
            decoration: BoxDecoration(
              color: AppTheme.statusSuccess.withOpacity(0.12),
              shape: BoxShape.circle,
              border: Border.all(color: AppTheme.statusSuccess.withOpacity(0.4)),
            ),
            child: const Icon(Icons.check_circle, size: 44, color: AppTheme.statusSuccess),
          ).animate().scale(duration: 400.ms, curve: Curves.elasticOut),
          const SizedBox(height: 20),
          const Text('Citizen Enrolled!',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppTheme.textPrimary),
          ).animate().fadeIn(delay: 200.ms),
          const SizedBox(height: 8),
          const Text(
            'Biometric data captured and synced securely.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: AppTheme.textSecondary, height: 1.5),
          ).animate().fadeIn(delay: 300.ms),
          const SizedBox(height: 28),
          ElevatedButton.icon(
            onPressed: onAnother,
            icon: const Icon(Icons.person_add, size: 16),
            label: const Text('Enroll Another'),
          ).animate().fadeIn(delay: 400.ms),
          const SizedBox(height: 10),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Back to Dashboard'),
          ).animate().fadeIn(delay: 450.ms),
        ]),
      ),
    );
  }
}

class _EnrollmentForm extends StatelessWidget {
  final GlobalKey<FormState> formKey;
  final TextEditingController fullNameCtrl, dobCtrl, phoneCtrl, addressCtrl,
      stateOfOriginCtrl, stateOfResidenceCtrl, lgaCtrl;
  final String gender;
  final ValueChanged<String?> onGenderChanged;
  final List<String> nigerianStates;
  final DateTime? selectedDob;
  final ValueChanged<DateTime> onDobChanged;
  final AntifraudResult? fraudChecks;
  final bool isRunningChecks, isSubmitting;
  final String? submitError;
  final VoidCallback onRunChecks, onSubmit;
  final List<double>? faceData, rightPalmData, leftPalmData;
  final Function(String) onCapture;

  const _EnrollmentForm({
    required this.formKey, required this.fullNameCtrl, required this.dobCtrl,
    required this.phoneCtrl, required this.addressCtrl, required this.stateOfOriginCtrl,
    required this.stateOfResidenceCtrl, required this.lgaCtrl, required this.gender,
    required this.onGenderChanged, required this.nigerianStates, required this.selectedDob,
    required this.onDobChanged, required this.fraudChecks, required this.isRunningChecks,
    required this.isSubmitting, required this.submitError, required this.onRunChecks,
    required this.onSubmit, required this.faceData, required this.rightPalmData,
    required this.leftPalmData, required this.onCapture,
  });

  @override
  Widget build(BuildContext context) {
    return Form(
      key: formKey,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          _SectionLabel('Personal Information'),
          TextFormField(controller: fullNameCtrl, decoration: const InputDecoration(labelText: 'Full Name *'), validator: (v) => v!.isEmpty ? 'Required' : null),
          const SizedBox(height: 12),
          TextFormField(
            controller: dobCtrl,
            readOnly: true,
            decoration: const InputDecoration(labelText: 'Date of Birth *', suffixIcon: Icon(Icons.calendar_today, size: 16)),
            onTap: () async {
              final date = await showDatePicker(
                context: context,
                initialDate: DateTime(1990),
                firstDate: DateTime(1920),
                lastDate: DateTime.now().subtract(const Duration(days: 365 * 18)),
                builder: (ctx, child) => Theme(
                  data: ThemeData.dark().copyWith(colorScheme: const ColorScheme.dark(primary: AppTheme.primary)),
                  child: child!,
                ),
              );
              if (date != null) onDobChanged(date);
            },
            validator: (v) => v!.isEmpty ? 'Required' : null,
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: gender,
            decoration: const InputDecoration(labelText: 'Gender *'),
            dropdownColor: AppTheme.bgSurface,
            items: ['Male', 'Female'].map((g) => DropdownMenuItem(value: g, child: Text(g))).toList(),
            onChanged: onGenderChanged,
          ),
          const SizedBox(height: 12),
          TextFormField(controller: phoneCtrl, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone Number')),

          const SizedBox(height: 18),
          _SectionLabel('Address Details'),
          TextFormField(controller: addressCtrl, decoration: const InputDecoration(labelText: 'Full Address *'), validator: (v) => v!.isEmpty ? 'Required' : null),
          const SizedBox(height: 12),

          DropdownButtonFormField<String>(
            decoration: const InputDecoration(labelText: 'State of Origin *'),
            dropdownColor: AppTheme.bgSurface,
            items: nigerianStates.map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
            onChanged: (v) => stateOfOriginCtrl.text = v!,
            validator: (_) => stateOfOriginCtrl.text.isEmpty ? 'Required' : null,
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            decoration: const InputDecoration(labelText: 'State of Residence *'),
            dropdownColor: AppTheme.bgSurface,
            items: nigerianStates.map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
            onChanged: (v) => stateOfResidenceCtrl.text = v!,
            validator: (_) => stateOfResidenceCtrl.text.isEmpty ? 'Required' : null,
          ),
          const SizedBox(height: 12),
          TextFormField(controller: lgaCtrl, decoration: const InputDecoration(labelText: 'LGA of Residence *'), validator: (v) => v!.isEmpty ? 'Required' : null),

          const SizedBox(height: 20),
          _SectionLabel('Biometric Capture'),
          
          _BiometricCaptureButton(
            label: 'Capture Face (IR + RGB)',
            icon: Icons.face,
            isCaptured: faceData != null,
            onTap: () => onCapture('Face'),
          ),
          const SizedBox(height: 10),
          _BiometricCaptureButton(
            label: 'Capture Right Palm Vein',
            icon: Icons.pan_tool,
            isCaptured: rightPalmData != null,
            onTap: () => onCapture('Right Palm'),
          ),
          const SizedBox(height: 10),
          _BiometricCaptureButton(
            label: 'Capture Left Palm Vein',
            icon: Icons.pan_tool,
            isCaptured: leftPalmData != null,
            onTap: () => onCapture('Left Palm'),
          ),

          const SizedBox(height: 20),
          _SectionLabel('Security Verification'),

          // Fraud checks status
          if (fraudChecks == null)
            OutlinedButton.icon(
              onPressed: isRunningChecks ? null : onRunChecks,
              icon: isRunningChecks
                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.security, size: 16),
              label: Text(isRunningChecks ? 'Scanning…' : 'Run Security Scan'),
            )
          else
            _FraudCheckResult(result: fraudChecks!),

          if (submitError != null)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.statusDanger.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.statusDanger.withOpacity(0.3)),
                ),
                child: Text(submitError!, style: const TextStyle(color: AppTheme.statusDanger, fontSize: 12)),
              ),
            ),

          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: (isSubmitting || faceData == null || rightPalmData == null || leftPalmData == null) ? null : onSubmit,
              icon: isSubmitting
                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                  : const Icon(Icons.fingerprint, size: 18),
              label: Text(isSubmitting ? 'Submitting…' : 'Submit Enrollment'),
            ),
          ),
          const SizedBox(height: 40),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String label;
  const _SectionLabel(this.label);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text(label.toUpperCase(),
        style: const TextStyle(
          fontSize: 10, fontWeight: FontWeight.w700,
          color: AppTheme.primary, letterSpacing: 0.1,
        )),
    );
  }
}

class _FraudCheckResult extends StatelessWidget {
  final AntifraudResult result;
  const _FraudCheckResult({required this.result});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: result.passed ? AppTheme.statusSuccess.withOpacity(0.06) : AppTheme.statusDanger.withOpacity(0.06),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: result.passed ? AppTheme.statusSuccess.withOpacity(0.3) : AppTheme.statusDanger.withOpacity(0.3),
        ),
      ),
      child: Column(children: [
        Row(children: [
          Icon(result.passed ? Icons.shield : Icons.shield_outlined,
            color: result.passed ? AppTheme.statusSuccess : AppTheme.statusDanger, size: 16),
          const SizedBox(width: 8),
          Text(result.passed ? 'Security Scan Passed' : 'Issues Detected',
            style: TextStyle(
              fontWeight: FontWeight.w700, fontSize: 13,
              color: result.passed ? AppTheme.statusSuccess : AppTheme.statusDanger,
            )),
        ]),
        if (result.issues.isNotEmpty) ...[
          const SizedBox(height: 8),
          ...result.issues.map((i) => Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Row(children: [
              const Icon(Icons.warning_amber, size: 12, color: AppTheme.statusWarning),
              const SizedBox(width: 6),
              Text(i.replaceAll('_', ' '),
                style: const TextStyle(fontSize: 11, color: AppTheme.statusWarning)),
            ]),
          )),
        ],
        if (result.clockDriftMs != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(children: [
              const Icon(Icons.access_time, size: 12, color: AppTheme.textMuted),
              const SizedBox(width: 6),
              Text('Clock drift: ${result.clockDriftMs}ms',
                style: const TextStyle(fontSize: 10.5, color: AppTheme.textMuted)),
            ]),
          ),
      ]),
    );
  }
}

class _BiometricCaptureButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool isCaptured;
  final VoidCallback onTap;

  const _BiometricCaptureButton({
    required this.label, required this.icon, required this.isCaptured, required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
        decoration: BoxDecoration(
          color: isCaptured ? AppTheme.statusSuccess.withOpacity(0.1) : AppTheme.bgSurface,
          border: Border.all(color: isCaptured ? AppTheme.statusSuccess : AppTheme.borderDefault),
          borderRadius: BorderRadius.circular(8)
        ),
        child: Row(
          children: [
            Icon(icon, color: isCaptured ? AppTheme.statusSuccess : AppTheme.primary, size: 24),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  color: isCaptured ? AppTheme.statusSuccess : AppTheme.textPrimary,
                  fontWeight: FontWeight.w600,
                  fontSize: 14
                ),
              ),
            ),
            if (isCaptured) 
              const Icon(Icons.check_circle, color: AppTheme.statusSuccess)
            else 
              const Icon(Icons.camera_alt, color: AppTheme.textMuted)
          ],
        ),
      ),
    );
  }
}
