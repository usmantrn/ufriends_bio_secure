import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:fl_chart/fl_chart.dart';
import '../providers/providers.dart';
import '../utils/app_theme.dart';

class DashboardTab extends ConsumerStatefulWidget {
  const DashboardTab({super.key});

  @override
  ConsumerState<DashboardTab> createState() => _DashboardTabState();
}

class _DashboardTabState extends ConsumerState<DashboardTab> {
  Map<String, dynamic>? _stats;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    setState(() { _loading = true; _error = null; });
    try {
      final stats = await ref.read(apiServiceProvider).getDashboardStats();
      setState(() { _stats = stats; _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final agent = ref.watch(authProvider).agent!;
    final sessionState = ref.watch(sessionProvider);

    return RefreshIndicator(
      onRefresh: _loadStats,
      color: AppTheme.primary,
      backgroundColor: AppTheme.bgSurface,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Greeting
          Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Good ${_greeting()},',
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: AppTheme.textMuted)),
              Text(agent.fullName.split(' ').first,
                style: Theme.of(context).textTheme.displayLarge),
            ])),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: sessionState.hasActiveSession
                    ? AppTheme.statusSuccess.withOpacity(0.12)
                    : AppTheme.bgSurface,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: sessionState.hasActiveSession
                      ? AppTheme.statusSuccess.withOpacity(0.4)
                      : AppTheme.borderDefault,
                ),
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Container(
                  width: 7, height: 7,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: sessionState.hasActiveSession
                        ? AppTheme.statusSuccess : AppTheme.textMuted,
                  ),
                ),
                const SizedBox(width: 6),
                Text(sessionState.hasActiveSession ? 'Session Live' : 'No Session',
                  style: TextStyle(
                    fontSize: 11, fontWeight: FontWeight.w600,
                    color: sessionState.hasActiveSession ? AppTheme.statusSuccess : AppTheme.textMuted,
                  )),
              ]),
            ),
          ]).animate().fadeIn().slideY(begin: -0.05),

          const SizedBox(height: 20),

          if (_loading)
            const Center(child: Padding(
              padding: EdgeInsets.all(40),
              child: CircularProgressIndicator(color: AppTheme.primary, strokeWidth: 2),
            ))
          else if (_error != null)
            _ErrorCard(error: _error!, onRetry: _loadStats)
          else if (_stats != null) ...[
            // Stats grid
            _StatsGrid(stats: _stats!).animate().fadeIn(delay: 100.ms),

            const SizedBox(height: 16),

            // My session summary
            if (sessionState.hasActiveSession)
              _SessionSummaryCard(
                enrollments: sessionState.enrollmentsThisSession,
                session: sessionState.session!,
              ).animate().fadeIn(delay: 200.ms),

            const SizedBox(height: 16),

            // Enrollment trend
            _EnrollmentChart(stats: _stats!).animate().fadeIn(delay: 300.ms),
          ],
        ],
      ),
    );
  }

  String _greeting() {
    final h = DateTime.now().hour;
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  }
}

class _StatsGrid extends StatelessWidget {
  final Map<String, dynamic> stats;
  const _StatsGrid({required this.stats});

  @override
  Widget build(BuildContext context) {
    final agents = stats['agents'] as Map<String, dynamic>?;
    final enrollments = stats['enrollments'] as Map<String, dynamic>?;
    final flags = stats['flags'] as Map<String, dynamic>?;
    final strikes = stats['strikes'] as Map<String, dynamic>?;

    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 2,
      crossAxisSpacing: 10,
      mainAxisSpacing: 10,
      childAspectRatio: 1.6,
      children: [
        _StatCard(
          label: 'Total Enrolled',
          value: '${enrollments?['total'] ?? 0}',
          icon: Icons.people,
          color: AppTheme.primary,
          sub: '+${enrollments?['today'] ?? 0} today',
        ),
        _StatCard(
          label: 'Active Agents',
          value: '${agents?['active'] ?? 0}',
          icon: Icons.badge,
          color: AppTheme.statusInfo,
          sub: '${agents?['total'] ?? 0} total',
        ),
        _StatCard(
          label: 'Open Flags',
          value: '${flags?['open'] ?? 0}',
          icon: Icons.flag,
          color: AppTheme.statusWarning,
          sub: '${flags?['critical'] ?? 0} critical',
        ),
        _StatCard(
          label: 'Active Strikes',
          value: '${strikes?['unresolved'] ?? 0}',
          icon: Icons.gavel,
          color: AppTheme.statusDanger,
          sub: '${strikes?['total'] ?? 0} total',
        ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label, value, sub;
  final IconData icon;
  final Color color;

  const _StatCard({
    required this.label, required this.value, required this.sub,
    required this.icon, required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(icon, size: 14, color: color),
            const SizedBox(width: 6),
            Expanded(child: Text(label,
              style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppTheme.textMuted),
              overflow: TextOverflow.ellipsis)),
          ]),
          const Spacer(),
          Text(value, style: TextStyle(
            fontSize: 24, fontWeight: FontWeight.w800, color: color,
            height: 1,
          )),
          const SizedBox(height: 2),
          Text(sub, style: const TextStyle(fontSize: 10, color: AppTheme.textMuted)),
        ]),
      ),
    );
  }
}

class _SessionSummaryCard extends StatelessWidget {
  final int enrollments;
  final dynamic session;
  const _SessionSummaryCard({required this.enrollments, required this.session});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(children: [
          Container(
            width: 40, height: 40,
            decoration: BoxDecoration(
              color: AppTheme.primary.withOpacity(0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.play_circle, color: AppTheme.primary, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Current Session', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.textPrimary)),
            Text('$enrollments enrolled this session', style: const TextStyle(fontSize: 11, color: AppTheme.textMuted)),
          ])),
          Text('${session.remaining.inHours}h ${session.remaining.inMinutes.remainder(60)}m',
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.statusWarning)),
        ]),
      ),
    );
  }
}

class _EnrollmentChart extends StatelessWidget {
  final Map<String, dynamic> stats;
  const _EnrollmentChart({required this.stats});

  @override
  Widget build(BuildContext context) {
    final daily = (stats['charts']?['dailyEnrollments'] as List?) ?? [];

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Enrollments (7 days)',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.textSecondary)),
          const SizedBox(height: 16),
          SizedBox(
            height: 120,
            child: daily.isEmpty
                ? const Center(child: Text('No data yet', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)))
                : BarChart(
                    BarChartData(
                      gridData: const FlGridData(show: false),
                      borderData: FlBorderData(show: false),
                      titlesData: const FlTitlesData(
                        leftTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        rightTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        topTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        bottomTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
                      ),
                      barGroups: List.generate(daily.length, (i) {
                        final count = (daily[i]['count'] as num?)?.toDouble() ?? 0;
                        return BarChartGroupData(x: i, barRods: [
                          BarChartRodData(
                            toY: count,
                            color: AppTheme.primary,
                            width: 14,
                            borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                          ),
                        ]);
                      }),
                    ),
                  ),
          ),
        ]),
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  final String error;
  final VoidCallback onRetry;
  const _ErrorCard({required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(children: [
          const Icon(Icons.cloud_off, size: 40, color: AppTheme.textMuted),
          const SizedBox(height: 10),
          const Text('Could not load stats', style: TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text('Working offline', style: const TextStyle(color: AppTheme.textMuted, fontSize: 12)),
          const SizedBox(height: 12),
          TextButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh, size: 14), label: const Text('Retry')),
        ]),
      ),
    );
  }
}
