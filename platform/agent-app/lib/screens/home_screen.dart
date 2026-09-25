import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../providers/providers.dart';
import '../utils/app_theme.dart';
import 'dashboard_tab.dart';
import 'session_tab.dart';
import 'enrollment_screen.dart';
import 'history_tab.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  int _selectedTab = 0;

  final List<Widget> _tabs = const [
    DashboardTab(),
    SessionTab(),
    HistoryTab(),
  ];

  @override
  Widget build(BuildContext context) {
    final agent = ref.watch(authProvider).agent!;
    final sessionState = ref.watch(sessionProvider);
    final pendingCount = ref.watch(pendingCountProvider);

    return Scaffold(
      backgroundColor: AppTheme.bgBase,
      appBar: AppBar(
        backgroundColor: AppTheme.bgSurface,
        title: Row(children: [
          Container(
            width: 32, height: 32,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [AppTheme.primary, AppTheme.secondary],
              ),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(Icons.fingerprint, color: Colors.black, size: 18),
          ),
          const SizedBox(width: 10),
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('BioSecure Agent', style: Theme.of(context).textTheme.titleMedium),
            Text(agent.fullName.split(' ').take(2).join(' '),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: AppTheme.textMuted, fontSize: 10,
              )),
          ]),
        ]),
        actions: [
          // Sync queue indicator
          pendingCount.when(
            data: (count) => count > 0
                ? Container(
                    margin: const EdgeInsets.only(right: 8),
                    child: Chip(
                      label: Text('$count pending',
                        style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700)),
                      backgroundColor: AppTheme.statusWarning.withOpacity(0.15),
                      side: const BorderSide(color: AppTheme.statusWarning, width: 0.5),
                      padding: EdgeInsets.zero,
                      labelPadding: const EdgeInsets.symmetric(horizontal: 6),
                    ),
                  )
                : const SizedBox.shrink(),
            loading: () => const SizedBox.shrink(),
            error: (_, __) => const SizedBox.shrink(),
          ),

          // Strike indicator
          if (agent.strikeCount > 0)
            Container(
              margin: const EdgeInsets.only(right: 8),
              child: Chip(
                avatar: const Icon(Icons.warning_amber, size: 12, color: AppTheme.statusDanger),
                label: Text('${agent.strikeCount} strike${agent.strikeCount > 1 ? 's' : ''}',
                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700)),
                backgroundColor: AppTheme.statusDanger.withOpacity(0.1),
                side: const BorderSide(color: AppTheme.statusDanger, width: 0.5),
                padding: EdgeInsets.zero,
                labelPadding: const EdgeInsets.symmetric(horizontal: 4),
              ),
            ),

          IconButton(
            icon: const Icon(Icons.logout, size: 18),
            onPressed: () => _confirmLogout(context, ref),
          ),
        ],
      ),

      body: _tabs[_selectedTab],

      // FAB — only show when session is active
      floatingActionButton: sessionState.hasActiveSession
          ? FloatingActionButton.extended(
              onPressed: () => Navigator.push(context,
                MaterialPageRoute(builder: (_) => const EnrollmentScreen())),
              backgroundColor: AppTheme.primary,
              foregroundColor: Colors.black,
              icon: const Icon(Icons.person_add),
              label: const Text('Enroll Citizen',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            ).animate().scale(duration: 300.ms).fadeIn()
          : null,

      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _selectedTab,
        onTap: (i) => setState(() => _selectedTab = i),
        items: [
          const BottomNavigationBarItem(
            icon: Icon(Icons.dashboard_outlined),
            activeIcon: Icon(Icons.dashboard),
            label: 'Dashboard',
          ),
          BottomNavigationBarItem(
            icon: Stack(children: [
              const Icon(Icons.play_circle_outline),
              if (sessionState.hasActiveSession)
                Positioned(
                  right: 0, top: 0,
                  child: Container(
                    width: 8, height: 8,
                    decoration: const BoxDecoration(
                      color: AppTheme.statusSuccess,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
            ]),
            activeIcon: const Icon(Icons.play_circle),
            label: 'Session',
          ),
          const BottomNavigationBarItem(
            icon: Icon(Icons.history_outlined),
            activeIcon: Icon(Icons.history),
            label: 'History',
          ),
        ],
      ),
    );
  }

  void _confirmLogout(BuildContext context, WidgetRef ref) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.bgSurface,
        title: const Text('Sign Out'),
        content: const Text('End your current session and sign out?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              await ref.read(sessionProvider.notifier).endSession();
              await ref.read(authProvider.notifier).logout();
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.statusDanger,
              foregroundColor: Colors.white,
            ),
            child: const Text('Sign Out'),
          ),
        ],
      ),
    );
  }
}
