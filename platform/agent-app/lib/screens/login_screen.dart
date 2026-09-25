import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../providers/providers.dart';
import '../services/device_fingerprint_service.dart';
import '../utils/app_theme.dart';

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

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _detectingDevice = true);
    final deviceInfo = await DeviceFingerprintService.getDeviceInfo();
    setState(() => _detectingDevice = false);
    if (!mounted) return;

    final success = await ref.read(authProvider.notifier).login(
      email: _emailController.text.trim(),
      password: _passwordController.text,
      deviceInfo: deviceInfo,
    );

    if (!success && mounted) {
      final error = ref.read(authProvider).error;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Row(children: [
            const Icon(Icons.error_outline, color: Colors.white, size: 16),
            const SizedBox(width: 8),
            Expanded(child: Text(error ?? 'Login failed')),
          ]),
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

                      const SizedBox(height: 22),

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
