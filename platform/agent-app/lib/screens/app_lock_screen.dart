import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../utils/app_theme.dart';
import '../providers/providers.dart';
import 'biometric_gate_screen.dart';

/// App Lock Screen — shown when continuous verification fails
/// (no face detected for 3 consecutive checks)
///
/// The agent must re-verify their identity with face biometric to unlock.
/// If they cancel or fail, they stay locked.
class AppLockScreen extends ConsumerStatefulWidget {
  const AppLockScreen({super.key});

  @override
  ConsumerState<AppLockScreen> createState() => _AppLockScreenState();
}

class _AppLockScreenState extends ConsumerState<AppLockScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulseCtrl;
  bool _isUnlocking = false;
  String? _errorMsg;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    super.dispose();
  }

  Future<void> _attemptUnlock() async {
    setState(() { _isUnlocking = true; _errorMsg = null; });

    final biometricOk = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => const BiometricGateScreen(
          title: 'Re-verify Identity',
          subtitle: 'Agent presence check failed. Re-scan your face to continue.',
          requireFace: true,
          requirePalm: false,
        ),
      ),
    );

    if (!mounted) return;

    if (biometricOk == true) {
      // Re-verified — go back to root (AuthGate will route to HomeScreen)
      if (!mounted) return;
      Navigator.pushNamedAndRemoveUntil(context, '/', (_) => false);
    } else {
      setState(() {
        _isUnlocking = false;
        _errorMsg = 'Face verification failed. Try again.';
      });
    }
  }

  Future<void> _signOut() async {
    await ref.read(authProvider.notifier).logout();
    if (mounted) {
      Navigator.pushNamedAndRemoveUntil(context, '/', (_) => false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0F),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // Lock icon with pulsing ring
              AnimatedBuilder(
                animation: _pulseCtrl,
                builder: (_, child) {
                  return Container(
                    width: 120 + _pulseCtrl.value * 20,
                    height: 120 + _pulseCtrl.value * 20,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: const Color(0xFFDC2626)
                            .withValues(alpha: 0.4 - _pulseCtrl.value * 0.3),
                        width: 2,
                      ),
                    ),
                    child: child,
                  );
                },
                child: Container(
                  width: 100, height: 100,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: const Color(0xFFDC2626).withValues(alpha: 0.15),
                    border: Border.all(
                      color: const Color(0xFFDC2626),
                      width: 2,
                    ),
                  ),
                  child: const Icon(
                    Icons.lock_outline,
                    size: 46,
                    color: Color(0xFFDC2626),
                  ),
                ),
              ),
              const SizedBox(height: 32),

              // Title
              const Text(
                'SESSION LOCKED',
                style: TextStyle(
                  color: Color(0xFFDC2626),
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 2.0,
                ),
              ).animate().fadeIn(delay: 200.ms),

              const SizedBox(height: 12),

              const Text(
                'Agent presence verification failed.\nYour session has been automatically locked for security.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white54,
                  fontSize: 13,
                  height: 1.6,
                ),
              ).animate().fadeIn(delay: 300.ms),

              const SizedBox(height: 12),

              // Security notice
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0xFFDC2626).withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: const Color(0xFFDC2626).withValues(alpha: 0.3),
                  ),
                ),
                child: Row(children: [
                  const Icon(Icons.warning_amber_rounded,
                      size: 16, color: Color(0xFFDC2626)),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text(
                      'This event has been logged. 3 failed checks = auto-lock.',
                      style: TextStyle(
                        color: Color(0xFFDC2626),
                        fontSize: 11.5,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ]),
              ).animate().fadeIn(delay: 400.ms),

              const SizedBox(height: 40),

              // Error banner
              if (_errorMsg != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 16),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFDC2626).withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: const Color(0xFFDC2626).withValues(alpha: 0.4)),
                  ),
                  child: Row(children: [
                    const Icon(Icons.error_outline,
                        color: Color(0xFFDC2626), size: 16),
                    const SizedBox(width: 8),
                    Text(_errorMsg!,
                      style: const TextStyle(
                        color: Color(0xFFDC2626), fontSize: 12.5,
                        fontWeight: FontWeight.w600)),
                  ]),
                ).animate().fadeIn(),

              // Unlock button
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _isUnlocking ? null : _attemptUnlock,
                  icon: _isUnlocking
                      ? const SizedBox(
                          width: 16, height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.black))
                      : const Icon(Icons.face_retouching_natural, size: 20),
                  label: Text(
                    _isUnlocking ? 'Verifying…' : 'Unlock with Face Scan',
                    style: const TextStyle(
                      fontWeight: FontWeight.w800, fontSize: 15),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primary,
                    foregroundColor: Colors.black,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14)),
                  ),
                ),
              ).animate().fadeIn(delay: 500.ms).slideY(begin: 0.1),

              const SizedBox(height: 12),

              TextButton(
                onPressed: _signOut,
                child: const Text(
                  'Sign Out Instead',
                  style: TextStyle(
                    color: Colors.white38, fontSize: 13),
                ),
              ).animate().fadeIn(delay: 600.ms),
            ],
          ),
        ),
      ),
    );
  }
}
