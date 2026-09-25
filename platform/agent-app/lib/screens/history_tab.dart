import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../providers/providers.dart';
import '../utils/app_theme.dart';

class HistoryTab extends ConsumerStatefulWidget {
  const HistoryTab({super.key});

  @override
  ConsumerState<HistoryTab> createState() => _HistoryTabState();
}

class _HistoryTabState extends ConsumerState<HistoryTab>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<Map<String, dynamic>> _enrollments = [];
  List<dynamic> _strikes = [];
  bool _loadingEnroll = true;
  bool _loadingStrikes = true;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    _loadEnrollments();
    _loadStrikes();
  }

  Future<void> _loadEnrollments() async {
    setState(() => _loadingEnroll = true);
    try {
      final data = await ref.read(apiServiceProvider).getMyEnrollments();
      setState(() { _enrollments = data; _loadingEnroll = false; });
    } catch (_) {
      setState(() => _loadingEnroll = false);
    }
  }

  Future<void> _loadStrikes() async {
    setState(() => _loadingStrikes = true);
    try {
      final data = await ref.read(apiServiceProvider).getMyStrikes();
      setState(() { _strikes = data; _loadingStrikes = false; });
    } catch (_) {
      setState(() => _loadingStrikes = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Container(
        color: AppTheme.bgSurface,
        child: TabBar(
          controller: _tabController,
          indicatorColor: AppTheme.primary,
          labelColor: AppTheme.primary,
          unselectedLabelColor: AppTheme.textMuted,
          labelStyle: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
          tabs: [
            Tab(text: 'Enrollments (${_enrollments.length})'),
            Tab(text: 'Strikes (${_strikes.length})'),
          ],
        ),
      ),
      Expanded(
        child: TabBarView(
          controller: _tabController,
          children: [
            _EnrollmentsList(
              enrollments: _enrollments,
              loading: _loadingEnroll,
              onRefresh: _loadEnrollments,
            ),
            _StrikesList(
              strikes: _strikes,
              loading: _loadingStrikes,
              onRefresh: _loadStrikes,
            ),
          ],
        ),
      ),
    ]);
  }
}

// ─── Enrollments List ─────────────────────────────────────────────────────────

class _EnrollmentsList extends StatelessWidget {
  final List<Map<String, dynamic>> enrollments;
  final bool loading;
  final VoidCallback onRefresh;

  const _EnrollmentsList({
    required this.enrollments,
    required this.loading,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Center(
        child: CircularProgressIndicator(color: AppTheme.primary, strokeWidth: 2),
      );
    }

    if (enrollments.isEmpty) {
      return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.people_outline, size: 52, color: AppTheme.textMuted),
          const SizedBox(height: 12),
          const Text('No enrollments yet',
            style: TextStyle(color: AppTheme.textSecondary, fontSize: 14, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          const Text('Start a session to begin enrolling citizens',
            style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
          const SizedBox(height: 16),
          TextButton.icon(
            onPressed: onRefresh,
            icon: const Icon(Icons.refresh, size: 14),
            label: const Text('Refresh'),
          ),
        ]),
      );
    }

    return RefreshIndicator(
      onRefresh: () async => onRefresh(),
      color: AppTheme.primary,
      child: ListView.separated(
        padding: const EdgeInsets.all(14),
        itemCount: enrollments.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (ctx, i) {
          final e = enrollments[i];
          final isFlagged = e['flaggedForReview'] == true;
          final enrolledAt = DateTime.tryParse(e['enrolledAt'] as String? ?? '');
          final status = e['enrollmentStatus'] as String? ?? 'SYNCED';

          return Card(
            child: ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              leading: Container(
                width: 40, height: 40,
                decoration: BoxDecoration(
                  color: isFlagged
                      ? AppTheme.statusWarning.withOpacity(0.12)
                      : AppTheme.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  isFlagged ? Icons.flag : Icons.person,
                  size: 18,
                  color: isFlagged ? AppTheme.statusWarning : AppTheme.primary,
                ),
              ),
              title: Text(
                e['fullName'] as String? ?? '—',
                style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: AppTheme.textPrimary),
              ),
              subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const SizedBox(height: 3),
                Text(
                  '${e['stateOfResidence'] ?? ''} • ${e['gender'] ?? ''}',
                  style: const TextStyle(fontSize: 11, color: AppTheme.textMuted),
                ),
                if (enrolledAt != null)
                  Text(
                    _formatDate(enrolledAt),
                    style: const TextStyle(fontSize: 10.5, color: AppTheme.textMuted),
                  ),
              ]),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  _StatusBadge(status: status),
                  if (e['mockGpsDetected'] == true || e['vpnDetected'] == true)
                    const Padding(
                      padding: EdgeInsets.only(top: 3),
                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                        Icon(Icons.warning_amber, size: 10, color: AppTheme.statusWarning),
                        SizedBox(width: 2),
                        Text('Flagged signals', style: TextStyle(fontSize: 9, color: AppTheme.statusWarning)),
                      ]),
                    ),
                ],
              ),
            ),
          ).animate().fadeIn(delay: Duration(milliseconds: 40 * i));
        },
      ),
    );
  }

  String _formatDate(DateTime d) {
    final now = DateTime.now();
    final diff = now.difference(d);
    if (diff.inDays == 0) return 'Today ${d.hour}:${d.minute.toString().padLeft(2, '0')}';
    if (diff.inDays == 1) return 'Yesterday';
    return '${d.day}/${d.month}/${d.year}';
  }
}

class _StatusBadge extends StatelessWidget {
  final String status;
  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    final colors = {
      'SYNCED': (AppTheme.statusSuccess, 'Synced'),
      'PENDING_SYNC': (AppTheme.statusWarning, 'Pending'),
      'FLAGGED': (AppTheme.statusWarning, 'Flagged'),
      'LOCKED': (AppTheme.statusDanger, 'Locked'),
    };
    final (color, label) = colors[status] ?? (AppTheme.textMuted, status);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withOpacity(0.35)),
      ),
      child: Text(label,
        style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w700, color: color)),
    );
  }
}

// ─── Strikes List ─────────────────────────────────────────────────────────────

class _StrikesList extends StatelessWidget {
  final List<dynamic> strikes;
  final bool loading;
  final VoidCallback onRefresh;

  const _StrikesList({
    required this.strikes,
    required this.loading,
    required this.onRefresh,
  });

  static const _triggerIcons = {
    'MOCK_GPS_DETECTED': (Icons.location_off, AppTheme.statusDanger),
    'VPN_DETECTED': (Icons.vpn_key, AppTheme.statusDanger),
    'GPS_OUTSIDE_GEOFENCE': (Icons.fence, AppTheme.statusWarning),
    'TIME_MANIPULATION': (Icons.access_time, AppTheme.statusDanger),
    'HIGH_ENROLLMENT_VELOCITY': (Icons.speed, AppTheme.statusWarning),
    'NON_IR_DEVICE': (Icons.camera_alt, AppTheme.statusDanger),
    'USB_DISCONNECT_MID_SESSION': (Icons.usb_off, AppTheme.statusWarning),
    'IMPOSSIBLE_TRAVEL': (Icons.flight, AppTheme.statusDanger),
    'BIOMETRIC_AUTH_FAIL': (Icons.fingerprint, AppTheme.statusDanger),
    'MANUAL_STRIKE': (Icons.gavel, AppTheme.statusWarning),
  };

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Center(child: CircularProgressIndicator(color: AppTheme.primary, strokeWidth: 2));
    }

    if (strikes.isEmpty) {
      return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 64, height: 64,
            decoration: BoxDecoration(
              color: AppTheme.statusSuccess.withOpacity(0.1),
              shape: BoxShape.circle,
              border: Border.all(color: AppTheme.statusSuccess.withOpacity(0.3)),
            ),
            child: const Icon(Icons.shield_outlined, size: 30, color: AppTheme.statusSuccess),
          ),
          const SizedBox(height: 14),
          const Text('Clean Record', style: TextStyle(
            fontSize: 15, fontWeight: FontWeight.w700, color: AppTheme.statusSuccess)),
          const SizedBox(height: 6),
          const Text('No strikes on your account', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
        ]),
      );
    }

    return RefreshIndicator(
      onRefresh: () async => onRefresh(),
      color: AppTheme.primary,
      child: ListView.separated(
        padding: const EdgeInsets.all(14),
        itemCount: strikes.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (ctx, i) {
          final s = strikes[i] as dynamic;
          final trigger = s.trigger as String;
          final isResolved = s.isResolved as bool;
          final (icon, color) = _triggerIcons[trigger] ??
              (Icons.gavel, AppTheme.statusWarning);

          return Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(children: [
                Container(
                  width: 40, height: 40,
                  decoration: BoxDecoration(
                    color: color.withOpacity(isResolved ? 0.05 : 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, size: 18,
                    color: isResolved ? AppTheme.textMuted : color),
                ),
                const SizedBox(width: 12),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Text('Strike #${s.strikeNumber}',
                      style: TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w700,
                        color: isResolved ? AppTheme.textMuted : AppTheme.textPrimary,
                      )),
                    const SizedBox(width: 8),
                    if (isResolved)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: AppTheme.statusSuccess.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppTheme.statusSuccess.withOpacity(0.3)),
                        ),
                        child: const Text('Resolved',
                          style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: AppTheme.statusSuccess)),
                      ),
                  ]),
                  const SizedBox(height: 3),
                  Text(trigger.replaceAll('_', ' '),
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: isResolved ? AppTheme.textMuted : color)),
                  const SizedBox(height: 3),
                  Text(s.details as String,
                    style: const TextStyle(fontSize: 11, color: AppTheme.textMuted, height: 1.4),
                    maxLines: 2, overflow: TextOverflow.ellipsis),
                ])),
              ]),
            ),
          ).animate().fadeIn(delay: Duration(milliseconds: 60 * i));
        },
      ),
    );
  }
}
