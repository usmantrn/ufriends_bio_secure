import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../providers/providers.dart';
import '../services/device_fingerprint_service.dart';
import '../utils/app_theme.dart';
import 'biometric_gate_screen.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _showPassword = false;
  bool _detectingDevice = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  String? _loginError;

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _detectingDevice = true; _loginError = null; });
    final deviceInfo = await DeviceFingerprintService.getDeviceInfo();
    setState(() => _detectingDevice = false);
    if (!mounted) return;

    final success = await ref.read(authProvider.notifier).login(
      email: _emailController.text.trim(),
      password: _passwordController.text,
      deviceInfo: deviceInfo,
    );

    if (success && mounted) {
      // ── Biometric gate: check if agent needs enrollment or verification ──
      final agent = ref.read(authProvider).agent;
      final isEnrolled = agent?.biometricEnrolled ?? false;

      final biometricOk = await Navigator.push<bool>(
        context,
        MaterialPageRoute(
          builder: (_) => BiometricGateScreen(
            title: isEnrolled ? 'Agent Verification' : 'Biometric Enrollment',
            subtitle: isEnrolled
                ? 'Verify your identity to access the platform'
                : 'First login — register your face and palm',
            requireFace: true,
            requirePalm: true,
            mode: isEnrolled ? BiometricMode.verification : BiometricMode.enrollment,
          ),
        ),
      );
      if (!mounted) return;
      if (biometricOk == true) {
        ref.read(authProvider.notifier).setBiometricVerified(enrolled: !isEnrolled);
      } else {
        // Agent cancelled biometric — log them out
        await ref.read(authProvider.notifier).logout();
        setState(() => _loginError = isEnrolled
            ? 'Biometric verification cancelled. Please log in again.'
            : 'Biometric enrollment cancelled. Please log in again.');
      }
      return;
    }

    if (!success && mounted) {
      final error = ref.read(authProvider).error ?? 'Login failed';
      setState(() => _loginError = error);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Row(children: [
            const Icon(Icons.error_outline, color: Colors.white, size: 16),
            const SizedBox(width: 8),
            Expanded(child: Text(error, style: const TextStyle(fontWeight: FontWeight.w600))),
          ]),
          backgroundColor: const Color(0xFFDC2626),
          duration: const Duration(seconds: 6),
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final isLoading = authState.loading || _detectingDevice;

    return Scaffold(
      backgroundColor: AppTheme.bgBase,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 52),

              // ── Brand header ─────────────────────────────────────
              Center(
                child: Column(children: [
                  Container(
                    width: 68, height: 68,
                    decoration: BoxDecoration(
                      color: AppTheme.primary,
                      borderRadius: BorderRadius.circular(18),
                      boxShadow: [
                        BoxShadow(
                          color: AppTheme.primary.withAlpha(50),
                          blurRadius: 20, spreadRadius: 2,
                        ),
                      ],
                    ),
                    child: const Icon(Icons.fingerprint, color: Colors.white, size: 34),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'Ufriends BioSecure',
                    style: TextStyle(
                      fontSize: 20, fontWeight: FontWeight.w800,
                      color: AppTheme.primary, letterSpacing: -0.4,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppTheme.secondary.withAlpha(20),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: AppTheme.secondary.withAlpha(60)),
                    ),
                    child: const Text(
                      'Agent Enrollment Platform',
                      style: TextStyle(
                        fontSize: 10.5, fontWeight: FontWeight.w600,
                        color: AppTheme.secondary, letterSpacing: 0.05,
                      ),
                    ),
                  ),
                ]),
              ).animate().fadeIn(duration: 400.ms).slideY(begin: -0.06),

              const SizedBox(height: 44),

              // ── Sign in card ──────────────────────────────────────
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: AppTheme.bgSurface,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: AppTheme.borderSubtle),
                  boxShadow: [
                    BoxShadow(
                      color: AppTheme.primary.withAlpha(10),
                      blurRadius: 20, offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Agent Sign In',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      color: AppTheme.textPrimary, fontSize: 18)),
                  const SizedBox(height: 4),
                  Text('Use your official agent credentials',
                    style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: 24),

                  Form(
                    key: _formKey,
                    child: Column(children: [
                      // Email
                      TextFormField(
                        controller: _emailController,
                        keyboardType: TextInputType.emailAddress,
                        style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
                        decoration: const InputDecoration(
                          labelText: 'Email Address',
                          prefixIcon: Icon(Icons.person_outline, size: 18, color: AppTheme.textMuted),
                        ),
                        validator: (v) {
                          if (v == null || v.isEmpty) return 'Email required';
                          if (!v.contains('@')) return 'Enter a valid email';
                          return null;
                        },
                      ),
                      const SizedBox(height: 14),

                      // Password
                      TextFormField(
                        controller: _passwordController,
                        obscureText: !_showPassword,
                        style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
                        decoration: InputDecoration(
                          labelText: 'Password',
                          prefixIcon: const Icon(Icons.lock_outline, size: 18, color: AppTheme.textMuted),
                          suffixIcon: IconButton(
                            icon: Icon(
                              _showPassword ? Icons.visibility_off : Icons.visibility,
                              size: 18, color: AppTheme.textMuted,
                            ),
                            onPressed: () => setState(() => _showPassword = !_showPassword),
                          ),
                        ),
                        validator: (v) => (v == null || v.length < 6) ? 'Password too short' : null,
                        onFieldSubmitted: (_) => _login(),
                      ),

                      const SizedBox(height: 12),

                      // Quick-fill test account
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton.icon(
                          onPressed: () {
                            setState(() {
                              _emailController.text = 'amina.obiora.91@example.com';
                              _passwordController.text = 'Agent@1234';
                            });
                          },
                          icon: const Icon(Icons.person_outline, size: 14, color: AppTheme.primary),
                          label: const Text(
                            'Fill Amina (Test Agent)',
                            style: TextStyle(fontSize: 12, color: AppTheme.primary, fontWeight: FontWeight.w600),
                          ),
                          style: TextButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            minimumSize: Size.zero,
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                        ),
                      ),

                      const SizedBox(height: 14),

                      // ── Error banner ─────────────────────────────
                      if (_loginError != null)
                        Container(
                          margin: const EdgeInsets.only(bottom: 16),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: const Color(0xFFDC2626).withOpacity(0.1),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: const Color(0xFFDC2626).withOpacity(0.4)),
                          ),
                          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            const Icon(Icons.error_outline, color: Color(0xFFDC2626), size: 18),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _loginError!,
                                style: const TextStyle(
                                  color: Color(0xFFDC2626),
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                  height: 1.4,
                                ),
                              ),
                            ),
                          ]),
                        ),

                      // Sign in button
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: isLoading ? null : _login,
                          child: isLoading
                              ? Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                                  const SizedBox(width: 16, height: 16,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)),
                                  const SizedBox(width: 10),
                                  Text(_detectingDevice ? 'Scanning device…' : 'Signing in…'),
                                ])
                              : const Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                                  Icon(Icons.login, size: 16),
                                  SizedBox(width: 8),
                                  Text('Sign In'),
                                ]),
                        ),
                      ),
                    ]),
                  ),
                ]),
              ).animate().fadeIn(delay: 150.ms).slideY(begin: 0.06),

              const SizedBox(height: 20),

              // ── Security notice ───────────────────────────────────
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppTheme.primary.withAlpha(8),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.borderBrand),
                ),
                child: Row(children: [
                  const Icon(Icons.verified_user_outlined, size: 16, color: AppTheme.primary),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'This device will be registered and fingerprinted. '
                      'All enrollment activity is tracked and audited in real time.',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppTheme.textSecondary, height: 1.5),
                    ),
                  ),
                ]),
              ).animate().fadeIn(delay: 300.ms),

              const SizedBox(height: 24),

              // ── Footer ────────────────────────────────────────────
              Center(
                child: Text(
                  '© 2026 Ufriends BioSecure',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 10),
                  textAlign: TextAlign.center,
                ),
              ).animate().fadeIn(delay: 400.ms),

              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}
