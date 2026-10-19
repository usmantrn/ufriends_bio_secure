import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../utils/app_theme.dart';
import '../services/api_service.dart';
import 'face_liveness_screen.dart';
import 'palm_scanner_screen.dart';

/// Biometric mode — determines behavior after capture
enum BiometricMode { enrollment, verification }

/// Biometric Gate Screen
/// Shows a full-screen biometric challenge that must be passed before
/// proceeding. Used at login:
///   1. Enrollment mode — first login: captures face + palm, sends to server
///   2. Verification mode — subsequent logins: captures face + palm, verifies against stored templates
///
/// Returns true if all required biometrics were captured and processed, false if cancelled.
class BiometricGateScreen extends StatefulWidget {
  final String title;
  final String subtitle;
  final bool requireFace;
  final bool requirePalm;
  final BiometricMode mode;

  const BiometricGateScreen({
    super.key,
    this.title = 'Biometric Verification',
    this.subtitle = 'Verify your identity to continue',
    this.requireFace = true,
    this.requirePalm = true,
    this.mode = BiometricMode.verification,
  });

  @override
  State<BiometricGateScreen> createState() => _BiometricGateScreenState();
}

class _BiometricGateScreenState extends State<BiometricGateScreen> {
  List<double>? _faceData;
  List<double>? _rightPalmData;
  bool _isProcessing = false;
  String? _resultMessage;
  bool? _resultSuccess;

  bool get _allCaptured {
    if (widget.requireFace && _faceData == null) return false;
    if (widget.requirePalm && _rightPalmData == null) return false;
    return true;
  }

  Future<void> _captureFace() async {
    final data = await Navigator.push<List<double>>(
      context,
      MaterialPageRoute(builder: (_) => const FaceLivenessScreen()),
    );
    if (data != null && mounted) {
      setState(() => _faceData = data);
    }
  }

  Future<void> _capturePalm() async {
    final data = await Navigator.push<List<double>>(
      context,
      MaterialPageRoute(builder: (_) => const PalmScannerScreen(side: 'Right')),
    );
    if (data != null && mounted) {
      setState(() => _rightPalmData = data);
    }
  }

  Future<void> _confirm() async {
    if (!_allCaptured) return;
    setState(() {
      _isProcessing = true;
      _resultMessage = null;
      _resultSuccess = null;
    });

    try {
      final api = ApiService();

      if (widget.mode == BiometricMode.enrollment) {
        // ── ENROLLMENT: Send templates to server for storage ──
        await api.enrollBiometric(
          faceDescriptor: _faceData!,
          palmDescriptor: _rightPalmData!,
        );
        if (!mounted) return;
        setState(() {
          _resultSuccess = true;
          _resultMessage = 'Biometric enrollment complete!';
        });
        await Future.delayed(const Duration(milliseconds: 1200));
        if (mounted) Navigator.pop(context, true);
      } else {
        // ── VERIFICATION: Compare against stored templates ──
        final result = await api.verifyBiometric(
          faceDescriptor: _faceData!,
          palmDescriptor: _rightPalmData!,
        );
        if (!mounted) return;
        final verified = result['verified'] as bool? ?? false;
        final faceScore = (result['faceScore'] as num?)?.toDouble() ?? 0;
        final palmScore = (result['palmScore'] as num?)?.toDouble() ?? 0;

        if (verified) {
          setState(() {
            _resultSuccess = true;
            _resultMessage =
                'Identity verified!\nFace: ${(faceScore * 100).toStringAsFixed(1)}%  Palm: ${(palmScore * 100).toStringAsFixed(1)}%';
          });
          await Future.delayed(const Duration(milliseconds: 1200));
          if (mounted) Navigator.pop(context, true);
        } else {
          setState(() {
            _isProcessing = false;
            _resultSuccess = false;
            _resultMessage =
                'Verification failed\nFace: ${(faceScore * 100).toStringAsFixed(1)}%  Palm: ${(palmScore * 100).toStringAsFixed(1)}%\nPlease try again.';
            // Reset captures so user can retry
            _faceData = null;
            _rightPalmData = null;
          });
        }
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isProcessing = false;
        _resultSuccess = false;
        _resultMessage = 'Error: ${e.toString().length > 80 ? e.toString().substring(0, 80) : e}';
        _faceData = null;
        _rightPalmData = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isEnrollment = widget.mode == BiometricMode.enrollment;

    return Scaffold(
      backgroundColor: AppTheme.bgBase,
      appBar: AppBar(
        backgroundColor: AppTheme.bgSurface,
        title: Text(widget.title,
            style: const TextStyle(color: AppTheme.textPrimary, fontSize: 16,
                fontWeight: FontWeight.w700)),
        iconTheme: const IconThemeData(color: AppTheme.textPrimary),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(children: [
            // Header
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: AppTheme.bgSurface,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: isEnrollment
                    ? AppTheme.secondary.withOpacity(0.4)
                    : AppTheme.borderBrand),
              ),
              child: Row(children: [
                Container(
                  width: 48, height: 48,
                  decoration: BoxDecoration(
                    color: isEnrollment
                        ? AppTheme.secondary.withOpacity(0.12)
                        : AppTheme.primary.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    isEnrollment ? Icons.app_registration : Icons.security,
                    color: isEnrollment ? AppTheme.secondary : AppTheme.primary,
                    size: 26,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(widget.title,
                      style: const TextStyle(color: AppTheme.textPrimary,
                          fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 3),
                    Text(widget.subtitle,
                      style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12.5)),
                  ]),
                ),
              ]),
            ).animate().fadeIn().slideY(begin: -0.05),

            const SizedBox(height: 16),

            // Mode badge
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: isEnrollment
                    ? AppTheme.secondary.withOpacity(0.1)
                    : AppTheme.primary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: isEnrollment
                      ? AppTheme.secondary.withOpacity(0.3)
                      : AppTheme.primary.withOpacity(0.3),
                ),
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(
                  isEnrollment ? Icons.fiber_new : Icons.verified_user,
                  size: 14,
                  color: isEnrollment ? AppTheme.secondary : AppTheme.primary,
                ),
                const SizedBox(width: 6),
                Text(
                  isEnrollment
                      ? 'FIRST LOGIN — ENROLLING BIOMETRICS'
                      : 'VERIFYING AGAINST STORED TEMPLATES',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.3,
                    color: isEnrollment ? AppTheme.secondary : AppTheme.primary,
                  ),
                ),
              ]),
            ).animate().fadeIn(delay: 50.ms),

            const SizedBox(height: 20),

            // Biometric steps
            if (widget.requireFace) ...[
              _BiometricStep(
                icon: Icons.face_retouching_natural,
                label: '3D Face Liveness Check',
                description: isEnrollment
                    ? 'Capture your face template for enrollment'
                    : 'Multi-angle face scan + blink detection',
                isCaptured: _faceData != null,
                onTap: _captureFace,
                stepNumber: 1,
              ).animate().fadeIn(delay: 100.ms).slideX(begin: -0.05),
              const SizedBox(height: 12),
            ],

            if (widget.requirePalm) ...[
              _BiometricStep(
                icon: Icons.pan_tool_alt,
                label: 'Palm Ridge Scan',
                description: isEnrollment
                    ? 'Capture your palm template for enrollment'
                    : 'Palm geometry verification',
                isCaptured: _rightPalmData != null,
                onTap: _capturePalm,
                stepNumber: widget.requireFace ? 2 : 1,
              ).animate().fadeIn(delay: 150.ms).slideX(begin: -0.05),
              const SizedBox(height: 12),
            ],

            // Result message
            if (_resultMessage != null)
              Container(
                margin: const EdgeInsets.only(top: 8, bottom: 8),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: _resultSuccess == true
                      ? AppTheme.statusSuccess.withOpacity(0.08)
                      : const Color(0xFFDC2626).withOpacity(0.08),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: _resultSuccess == true
                        ? AppTheme.statusSuccess.withOpacity(0.4)
                        : const Color(0xFFDC2626).withOpacity(0.4),
                  ),
                ),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Icon(
                    _resultSuccess == true ? Icons.check_circle : Icons.error_outline,
                    size: 20,
                    color: _resultSuccess == true
                        ? AppTheme.statusSuccess
                        : const Color(0xFFDC2626),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      _resultMessage!,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        height: 1.5,
                        color: _resultSuccess == true
                            ? AppTheme.statusSuccess
                            : const Color(0xFFDC2626),
                      ),
                    ),
                  ),
                ]),
              ).animate().fadeIn().shake(duration: _resultSuccess == true ? 0.ms : 400.ms),

            const Spacer(),

            // Status text
            if (!_allCaptured && _resultMessage == null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(
                  _pendingStepsText(),
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppTheme.textMuted, fontSize: 12),
                ),
              ),

            // Confirm button
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _allCaptured && !_isProcessing ? _confirm : null,
                icon: _isProcessing
                    ? const SizedBox(width: 18, height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : Icon(isEnrollment ? Icons.save : Icons.verified_user, size: 18),
                label: Text(
                  _isProcessing
                      ? (isEnrollment ? 'Enrolling…' : 'Verifying…')
                      : (isEnrollment
                          ? 'Enroll Biometrics & Continue'
                          : 'Verify Identity & Continue'),
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
              ),
            ).animate().fadeIn(delay: 200.ms),

            const SizedBox(height: 12),

            TextButton(
              onPressed: _isProcessing ? null : () => Navigator.pop(context, false),
              child: const Text('Cancel', style: TextStyle(color: AppTheme.textMuted)),
            ),
          ]),
        ),
      ),
    );
  }

  String _pendingStepsText() {
    final pending = <String>[];
    if (widget.requireFace && _faceData == null) pending.add('face scan');
    if (widget.requirePalm && _rightPalmData == null) pending.add('palm scan');
    return 'Complete ${pending.join(' and ')} to continue';
  }
}

// ── Biometric step card ────────────────────────────────────────────────────────

class _BiometricStep extends StatelessWidget {
  final IconData icon;
  final String label;
  final String description;
  final bool isCaptured;
  final VoidCallback onTap;
  final int stepNumber;

  const _BiometricStep({
    required this.icon,
    required this.label,
    required this.description,
    required this.isCaptured,
    required this.onTap,
    required this.stepNumber,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: isCaptured ? null : onTap,
      borderRadius: BorderRadius.circular(14),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 350),
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: isCaptured
              ? AppTheme.statusSuccess.withOpacity(0.07)
              : AppTheme.bgSurface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: isCaptured ? AppTheme.statusSuccess : AppTheme.borderDefault,
            width: isCaptured ? 1.5 : 1,
          ),
        ),
        child: Row(children: [
          // Step number badge
          Container(
            width: 32, height: 32,
            decoration: BoxDecoration(
              color: isCaptured
                  ? AppTheme.statusSuccess.withOpacity(0.15)
                  : AppTheme.primary.withOpacity(0.12),
              borderRadius: BorderRadius.circular(8),
            ),
            child: isCaptured
                ? const Icon(Icons.check, color: AppTheme.statusSuccess, size: 18)
                : Center(
                    child: Text('$stepNumber',
                      style: const TextStyle(color: AppTheme.primary,
                          fontWeight: FontWeight.w800, fontSize: 14)),
                  ),
          ),
          const SizedBox(width: 14),

          // Icon + text
          Container(
            width: 40, height: 40,
            decoration: BoxDecoration(
              color: isCaptured
                  ? AppTheme.statusSuccess.withOpacity(0.1)
                  : AppTheme.primary.withOpacity(0.08),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon,
                color: isCaptured ? AppTheme.statusSuccess : AppTheme.primary,
                size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label,
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 14,
                  color: isCaptured ? AppTheme.statusSuccess : AppTheme.textPrimary,
                )),
              const SizedBox(height: 3),
              Text(description,
                style: const TextStyle(fontSize: 11.5, color: AppTheme.textMuted)),
            ]),
          ),

          // Right action
          isCaptured
              ? const Icon(Icons.check_circle, color: AppTheme.statusSuccess, size: 24)
              : Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppTheme.primary.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text('START',
                    style: TextStyle(color: AppTheme.primary, fontSize: 10,
                        fontWeight: FontWeight.w800, letterSpacing: 0.5)),
                ),
        ]),
      ),
    );
  }
}
