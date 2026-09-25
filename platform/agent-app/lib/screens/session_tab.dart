import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../providers/providers.dart';
import '../services/antifraud_service.dart';
import '../utils/app_theme.dart';

class SessionTab extends ConsumerStatefulWidget {
  const SessionTab({super.key});

  @override
  ConsumerState<SessionTab> createState() => _SessionTabState();
}

class _SessionTabState extends ConsumerState<SessionTab> {
  bool _checking = false;
  AntifraudResult? _lastCheckResult;

  Future<void> _startSession() async {
    setState(() => _checking = true);

    // Run all anti-fraud checks before starting
    final position = await AntifraudService.getCurrentPosition();
    final clockDrift = await AntifraudService.getClockDriftMs();
    final vpn = await AntifraudService.isVpnActive();
    bool mockGps = position != null && AntifraudService.isMockGps(position);

    final result = AntifraudResult(
      passed: !mockGps && !vpn && (clockDrift == null || clockDrift.abs() <= 300000),
      issues: [
        if (mockGps) 'MOCK_GPS_DETECTED',
        if (vpn) 'VPN_DETECTED',
        if (clockDrift != null && clockDrift.abs() > 300000) 'TIME_MANIPULATION',
      ],
      mockGpsDetected: mockGps,
      vpnDetected: vpn,
      clockDriftMs: clockDrift,
      gpsLat: position?.latitude,
      gpsLng: position?.longitude,
      gpsAccuracy: position?.accuracy,
    );

    setState(() { _checking = false; _lastCheckResult = result; });

    // Show warning dialog if fraud indicators found — agent can override for legitimate reasons
    if (result.issues.isNotEmpty && mounted) {
      final proceed = await _showFraudWarningDialog(result);
      if (!proceed) return;
    }

    final deviceId = ref.read(authProvider).deviceId;
    if (deviceId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Device not registered. Please log in again.')),
      );
      return;
    }

    final success = await ref.read(sessionProvider.notifier).startSession(
      deviceId: deviceId,
      gpsLat: position?.latitude,
      gpsLng: position?.longitude,
      gpsAccuracy: position?.accuracy,
      clockDriftMs: clockDrift,
      vpnDetected: vpn,
      mockGpsDetected: mockGps,
    );

    if (!success && mounted) {
      final error = ref.read(sessionProvider).error;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error ?? 'Failed to start session')),
      );
    }
  }

  Future<bool> _showFraudWarningDialog(AntifraudResult result) async {
    return await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.bgSurface,
        title: const Row(children: [
          Icon(Icons.warning_amber, color: AppTheme.statusWarning),
          SizedBox(width: 8),
          Text('Security Warning'),
        ]),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('The following issues were detected:',
            style: TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
          const SizedBox(height: 10),
          ...result.issues.map((issue) => Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(children: [
              const Icon(Icons.close, size: 14, color: AppTheme.statusDanger),
              const SizedBox(width: 6),
              Text(issue.replaceAll('_', ' '),
                style: const TextStyle(color: AppTheme.statusDanger, fontSize: 12, fontWeight: FontWeight.w600)),
            ]),
          )),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppTheme.statusDanger.withOpacity(0.07),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: AppTheme.statusDanger.withOpacity(0.25)),
            ),
            child: const Text(
              '⚠️ These will be reported to the central server. Starting a session with these conditions may result in a strike.',
              style: TextStyle(fontSize: 11, color: AppTheme.textSecondary, height: 1.5),
            ),
          ),
        ]),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.statusWarning, foregroundColor: Colors.black),
            child: const Text('Proceed Anyway'),
          ),
        ],
      ),
    ) ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final sessionState = ref.watch(sessionProvider);
    final agent = ref.watch(authProvider).agent!;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(18),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // Agent status card
        _AgentStatusCard(agent: agent).animate().fadeIn().slideY(begin: 0.05),

        const SizedBox(height: 16),

        // Session card
        if (sessionState.hasActiveSession) ...[
          _ActiveSessionCard(session: sessionState.session!)
              .animate().fadeIn(delay: 100.ms),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () async {
                final confirm = await showDialog<bool>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    backgroundColor: AppTheme.bgSurface,
                    title: const Text('End Session'),
                    content: Text(
                      'You have enrolled ${sessionState.enrollmentsThisSession} citizens this session. End it now?'),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep Going')),
                      ElevatedButton(
                        onPressed: () => Navigator.pop(ctx, true),
                        style: ElevatedButton.styleFrom(backgroundColor: AppTheme.statusDanger, foregroundColor: Colors.white),
                        child: const Text('End Session'),
                      ),
                    ],
                  ),
                );
                if (confirm == true) {
                  await ref.read(sessionProvider.notifier).endSession();
                }
              },
              icon: const Icon(Icons.stop_circle_outlined, size: 16),
              label: const Text('End Session'),
            ),
          ),
        ] else ...[
          _StartSessionCard(
            checking: _checking,
            lastResult: _lastCheckResult,
            onStart: agent.isActive ? _startSession : null,
          ).animate().fadeIn(delay: 100.ms),
        ],

        const SizedBox(height: 16),

        // Security checks info
        _SecurityChecksPanel(lastResult: _lastCheckResult)
            .animate().fadeIn(delay: 200.ms),
      ]),
    );
  }
}

class _AgentStatusCard extends StatelessWidget {
  final dynamic agent;
  const _AgentStatusCard({required this.agent});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(children: [
          Container(
            width: 44, height: 44,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: agent.isActive
                    ? [AppTheme.primary, AppTheme.secondary]
                    : [AppTheme.statusDanger, AppTheme.statusDanger.withOpacity(0.7)],
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.badge, color: Colors.black, size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(agent.fullName, style: Theme.of(context).textTheme.titleMedium),
            Text('${agent.operatingState}, ${agent.operatingLGA}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.textMuted)),
          ])),
          Column(children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: agent.isActive ? AppTheme.statusSuccess.withOpacity(0.12) : AppTheme.statusDanger.withOpacity(0.12),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: agent.isActive ? AppTheme.statusSuccess.withOpacity(0.3) : AppTheme.statusDanger.withOpacity(0.3),
                ),
              ),
              child: Text(agent.licenseStatus,
                style: TextStyle(
                  fontSize: 10, fontWeight: FontWeight.w700,
                  color: agent.isActive ? AppTheme.statusSuccess : AppTheme.statusDanger,
                )),
            ),
            const SizedBox(height: 4),
            Row(children: List.generate(5, (i) => Container(
              width: 8, height: 8,
              margin: const EdgeInsets.symmetric(horizontal: 1),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: i < agent.strikeCount ? AppTheme.statusDanger : AppTheme.borderDefault,
              ),
            ))),
          ]),
        ]),
      ),
    );
  }
}

class _ActiveSessionCard extends StatelessWidget {
  final dynamic session;
  const _ActiveSessionCard({required this.session});

  @override
  Widget build(BuildContext context) {
    final remaining = session.remaining;
    final hours = remaining.inHours;
    final minutes = remaining.inMinutes.remainder(60);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(children: [
          Row(children: [
            Container(
              width: 10, height: 10,
              decoration: const BoxDecoration(
                color: AppTheme.statusSuccess,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 8),
            const Text('Session Active', style: TextStyle(
              fontSize: 13, fontWeight: FontWeight.w700, color: AppTheme.statusSuccess)),
            const Spacer(),
            Text('${hours}h ${minutes}m remaining',
              style: const TextStyle(fontSize: 11, color: AppTheme.textMuted)),
          ]),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: session.progressFraction,
              backgroundColor: AppTheme.borderSubtle,
              valueColor: AlwaysStoppedAnimation<Color>(
                session.progressFraction > 0.8
                    ? AppTheme.statusWarning
                    : AppTheme.primary,
              ),
              minHeight: 5,
            ),
          ),
          const SizedBox(height: 12),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            _SessionStat(
              icon: Icons.people_outline,
              value: session.enrollmentCount.toString(),
              label: 'Enrolled',
            ),
            _SessionStat(
              icon: Icons.access_time,
              value: session.startedAt.toLocal().toString().substring(11, 16),
              label: 'Started',
            ),
          ]),
        ]),
      ),
    );
  }
}

class _SessionStat extends StatelessWidget {
  final IconData icon;
  final String value;
  final String label;
  const _SessionStat({required this.icon, required this.value, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Icon(icon, size: 14, color: AppTheme.textMuted),
      const SizedBox(width: 5),
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppTheme.textPrimary)),
        Text(label, style: const TextStyle(fontSize: 10, color: AppTheme.textMuted)),
      ]),
    ]);
  }
}

class _StartSessionCard extends StatelessWidget {
  final bool checking;
  final AntifraudResult? lastResult;
  final VoidCallback? onStart;
  const _StartSessionCard({required this.checking, this.lastResult, this.onStart});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(children: [
          const Icon(Icons.play_circle_outline, size: 48, color: AppTheme.primary),
          const SizedBox(height: 12),
          const Text('No Active Session',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppTheme.textPrimary)),
          const SizedBox(height: 6),
          const Text(
            'Start a session to begin enrolling citizens. The system will verify your GPS, device clock, and network before starting.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary, height: 1.5),
          ),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: onStart,
              icon: checking
                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                  : const Icon(Icons.verified_user, size: 16),
              label: Text(checking ? 'Running security checks…' : 'Start Enrollment Session'),
            ),
          ),
          if (onStart == null)
            const Padding(
              padding: EdgeInsets.only(top: 10),
              child: Text('Your license is not active. Contact your organization.',
                style: TextStyle(fontSize: 11, color: AppTheme.statusDanger), textAlign: TextAlign.center),
            ),
        ]),
      ),
    );
  }
}

class _SecurityChecksPanel extends StatelessWidget {
  final AntifraudResult? lastResult;
  const _SecurityChecksPanel({this.lastResult});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Security Checks', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.textSecondary, letterSpacing: 0.06)),
          const SizedBox(height: 10),
          ...[
            ('GPS Location', lastResult == null ? null : !lastResult!.mockGpsDetected),
            ('Clock Integrity', lastResult == null ? null : (lastResult!.clockDriftMs == null || lastResult!.clockDriftMs!.abs() <= 300000)),
            ('VPN / Proxy', lastResult == null ? null : !lastResult!.vpnDetected),
            ('Geofence', lastResult == null ? null : !lastResult!.issues.contains('GPS_OUTSIDE_GEOFENCE')),
          ].map((check) => Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(children: [
              Icon(
                check.$2 == null ? Icons.radio_button_unchecked :
                check.$2! ? Icons.check_circle : Icons.cancel,
                size: 14,
                color: check.$2 == null ? AppTheme.textMuted :
                check.$2! ? AppTheme.statusSuccess : AppTheme.statusDanger,
              ),
              const SizedBox(width: 8),
              Text(check.$1,
                style: TextStyle(
                  fontSize: 12.5,
                  color: check.$2 == null ? AppTheme.textMuted : AppTheme.textPrimary,
                )),
              const Spacer(),
              if (check.$2 != null)
                Text(check.$2! ? 'OK' : 'FAIL',
                  style: TextStyle(
                    fontSize: 10, fontWeight: FontWeight.w700,
                    color: check.$2! ? AppTheme.statusSuccess : AppTheme.statusDanger,
                  )),
            ]),
          )).toList(),
        ]),
      ),
    );
  }
}
