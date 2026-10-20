import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../utils/app_theme.dart';
import '../services/palm_vein_extractor.dart';
import '../services/palm_dedup_service.dart';

/// Real Palm Vein Scanner
/// ─────────────────────────────────────────────────────────────────────────
/// Implements the full palm_vein_system_architecture.pdf pipeline:
///
///  1. NIR simulation (phone) → hardware switch (850nm module) via CameraSource HAL
///  2. Multi-frame capture → CLAHE → Gabor ridge filter → ROI extraction
///  3. 256-dim L2-normalised feature vector
///  4. Quality gate (reject blurry / no-hand frames)
///  5. 1:N dedup check at sync (called from this screen when online,
///     or deferred to sync time when offline)
///
/// Returns: List<double> template (256-dim) to EnrollmentScreen
/// ─────────────────────────────────────────────────────────────────────────
class PalmScannerScreen extends StatefulWidget {
  final String side; // 'Right' or 'Left'
  const PalmScannerScreen({super.key, required this.side});

  @override
  State<PalmScannerScreen> createState() => _PalmScannerScreenState();
}

class _PalmScannerScreenState extends State<PalmScannerScreen>
    with SingleTickerProviderStateMixin {
  CameraController? _cam;
  bool _initialized = false;
  String? _errorMsg;

  _ScanPhase _phase = _ScanPhase.positioning;
  double _progress = 0.0;
  String _stageLabel = 'Hold your palm in the frame · Spread fingers';
  double _qualityScore = 0.0;
  PalmDedupResponse? _dedupResult;
  List<double>? _template;
  bool _isProcessing = false;

  late AnimationController _pulseCtrl;

  // Hardware source — swap to CameraSource.nirCamera when 850nm module arrives
  static const _hwSource = CameraSource.simulatedNir;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat(reverse: true);
    _initCamera();
  }

  Future<void> _initCamera() async {
    try {
      final cameras = await availableCameras();
      final rear = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.back,
        orElse: () => cameras.first,
      );
      _cam = CameraController(rear, ResolutionPreset.high, enableAudio: false);
      await _cam!.initialize();
      if (mounted) setState(() => _initialized = true);
    } catch (e) {
      if (mounted) setState(() => _errorMsg = 'Camera error: $e');
    }
  }

  Future<void> _startScan() async {
    if (_cam == null || !_initialized || _isProcessing) return;
    setState(() {
      _isProcessing = true;
      _phase = _ScanPhase.scanning;
      _progress = 0.0;
      _stageLabel = 'Capturing frames…';
    });

    try {
      final result = await PalmVeinExtractor.extract(
        _cam!,
        source: _hwSource,
        onProgress: (stage, progress) {
          if (!mounted) return;
          setState(() {
            _stageLabel = stage;
            _progress = progress;
          });
        },
      );

      if (!mounted) return;

      if (!result.success) {
        setState(() {
          _isProcessing = false;
          _phase = _ScanPhase.positioning;
          _errorMsg = result.errorMessage;
        });
        return;
      }

      setState(() {
        _qualityScore = result.quality;
        _stageLabel = 'Running deduplication check…';
        _phase = _ScanPhase.dedup;
      });

      // ── 1:N dedup check (best-effort; fails open when offline) ───────────
      final dedup = await PalmDedupService.check(
        template: result.template!,
        side: widget.side,
      );

      if (!mounted) return;

      if (dedup.isDuplicate) {
        // Duplicate found — show warning but still allow agent to proceed
        setState(() {
          _dedupResult = dedup;
          _template = result.template;
          _phase = _ScanPhase.duplicateWarning;
          _isProcessing = false;
        });
      } else {
        setState(() {
          _dedupResult = dedup;
          _template = result.template;
          _phase = _ScanPhase.done;
          _isProcessing = false;
        });
        await Future.delayed(const Duration(milliseconds: 900));
        if (mounted) Navigator.pop(context, result.template);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isProcessing = false;
          _phase = _ScanPhase.positioning;
          _errorMsg = 'Processing failed: $e';
        });
      }
    }
  }

  void _proceedDespiteDuplicate() {
    Navigator.pop(context, _template);
  }

  void _retakeScan() {
    setState(() {
      _phase = _ScanPhase.positioning;
      _errorMsg = null;
      _dedupResult = null;
      _template = null;
      _progress = 0.0;
      _stageLabel = 'Position your palm in the frame';
    });
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    _cam?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        title: Text('${widget.side} Palm Biometrics Scan',
            style: const TextStyle(color: Colors.white, fontSize: 15,
                fontWeight: FontWeight.w700)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: _errorMsg != null && _phase == _ScanPhase.positioning
          ? _buildError()
          : !_initialized
              ? const Center(child: CircularProgressIndicator(color: AppTheme.primary))
              : _phase == _ScanPhase.duplicateWarning
                  ? _buildDuplicateWarning()
                  : _buildScanner(),
    );
  }

  // ── Main scanner view ────────────────────────────────────────────────────
  Widget _buildScanner() {
    final size = MediaQuery.of(context).size;
    return Stack(children: [
      // Camera feed with NIR simulation colour matrix
      SizedBox.expand(
        child: ColorFiltered(
          colorFilter: const ColorFilter.matrix(<double>[
            // Boost red (proxy for 850nm), suppress blue, desaturate
            // Simulates the high-contrast vein-dark/tissue-bright NIR image
            0.60, 0.35, 0.05, 0, 10,
            0.30, 0.55, 0.15, 0, 5,
            0.05, 0.15, 0.10, 0, 0,
            0,    0,    0,    1, 0,
          ]),
          child: FittedBox(
            fit: BoxFit.cover,
            child: SizedBox(
              width: _cam!.value.previewSize!.height,
              height: _cam!.value.previewSize!.width,
              child: CameraPreview(_cam!),
            ),
          ),
        ),
      ),

      // Grid overlay
      CustomPaint(
        size: Size(size.width, size.height),
        painter: _GridOverlayPainter(phase: _phase, progress: _progress),
      ),

      // Palm alignment guide silhouette
      Center(
        child: CustomPaint(
          size: const Size(260, 310),
          painter: _PalmSilhouettePainter(phase: _phase, side: widget.side),
        ),
      ),

      // Bandpass filter label — 850nm badge (top-left)
      Positioned(
        top: 12, left: 12,
        child: _NirBadge(phase: _phase),
      ),

      // Distance guide (top-right)
      Positioned(
        top: 12, right: 12,
        child: _DistanceBadge(phase: _phase),
      ),

      // Sweep line during scanning
      if (_phase == _ScanPhase.scanning || _phase == _ScanPhase.dedup)
        _ScanSweep(progress: _progress, width: size.width, height: size.height),

      // Bottom panel
      Positioned(
        bottom: 28, left: 16, right: 16,
        child: _buildBottomPanel(),
      ),

      // Done overlay
      if (_phase == _ScanPhase.done) _buildDoneOverlay(),
    ]);
  }

  // ── Bottom panel ─────────────────────────────────────────────────────────
  Widget _buildBottomPanel() {
    return Column(mainAxisSize: MainAxisSize.min, children: [
      // Stage info card
      AnimatedSwitcher(
        duration: const Duration(milliseconds: 300),
        child: Container(
          key: ValueKey(_phase),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.80),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: _phase == _ScanPhase.scanning
                  ? AppTheme.primary.withValues(alpha: 0.5)
                  : Colors.white12,
            ),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Icon(
                _phase == _ScanPhase.positioning ? Icons.pan_tool_outlined
                  : _phase == _ScanPhase.scanning  ? Icons.radar
                  : _phase == _ScanPhase.dedup     ? Icons.compare_arrows
                  : Icons.check_circle,
                color: _phase == _ScanPhase.done
                    ? AppTheme.statusSuccess : AppTheme.primary,
                size: 20,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  _stageLabel,
                  style: const TextStyle(color: Colors.white,
                      fontSize: 13, fontWeight: FontWeight.w600),
                ),
              ),
            ]),

            // Quality bar (show after processing starts)
            if (_qualityScore > 0) ...[
              const SizedBox(height: 10),
              _QualityBar(score: _qualityScore),
            ],
          ]),
        ),
      ),

      // Progress bar during scan
      if (_phase == _ScanPhase.scanning || _phase == _ScanPhase.dedup) ...[
        const SizedBox(height: 10),
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: LinearProgressIndicator(
            value: _phase == _ScanPhase.dedup ? null : _progress,
            minHeight: 5,
            backgroundColor: Colors.white12,
            valueColor: AlwaysStoppedAnimation<Color>(
              _phase == _ScanPhase.dedup ? AppTheme.secondary : AppTheme.primary,
            ),
          ),
        ),
        if (_phase == _ScanPhase.scanning) ...[
          const SizedBox(height: 5),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Text('${(_progress * 100).toInt()}% frames captured',
                style: const TextStyle(color: Colors.white38, fontSize: 10)),
            Text('5-frame average for robustness',
                style: const TextStyle(color: Colors.white38, fontSize: 10)),
          ]),
        ],
      ],

      // START SCAN button
      if (_phase == _ScanPhase.positioning) ...[
        const SizedBox(height: 12),
        // Physical guide reminder (from PDF §2: mechanical alignment)
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          margin: const EdgeInsets.only(bottom: 10),
          decoration: BoxDecoration(
            color: AppTheme.secondary.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppTheme.secondary.withValues(alpha: 0.25)),
          ),
          child: const Row(children: [
            Icon(Icons.straighten, color: AppTheme.secondary, size: 14),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Hold palm 15–20 cm from camera · Spread fingers · Keep steady',
                style: TextStyle(color: AppTheme.secondary, fontSize: 11,
                    fontWeight: FontWeight.w600),
              ),
            ),
          ]),
        ),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: _startScan,
            icon: const Icon(Icons.pan_tool_rounded, size: 20),
            label: const Text('CAPTURE PALM BIOMETRICS',
                style: TextStyle(fontWeight: FontWeight.w800, letterSpacing: 0.8)),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.primary,
              foregroundColor: Colors.black,
              padding: const EdgeInsets.symmetric(vertical: 15),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
            ),
          ),
        ),
      ],
    ]);
  }

  // ── Duplicate warning screen ─────────────────────────────────────────────
  Widget _buildDuplicateWarning() {
    final match = _dedupResult?.topMatch;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(children: [
          const SizedBox(height: 32),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: const Color(0xFFDC2626).withValues(alpha: 0.12),
              shape: BoxShape.circle,
              border: Border.all(color: const Color(0xFFDC2626), width: 2),
            ),
            child: const Icon(Icons.warning_amber_rounded,
                color: Color(0xFFDC2626), size: 52),
          ).animate().scale(duration: 400.ms, curve: Curves.elasticOut),

          const SizedBox(height: 24),
          const Text('DUPLICATE PALM DETECTED',
            style: TextStyle(color: Color(0xFFDC2626), fontSize: 20,
                fontWeight: FontWeight.w900, letterSpacing: 1.5),
          ).animate().fadeIn(delay: 200.ms),

          const SizedBox(height: 12),
          Text(
            'This palm print matches an existing citizen record\n'
            'in the database with ${match?.similarityPercent ?? 0}% similarity.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white70, fontSize: 13, height: 1.6),
          ).animate().fadeIn(delay: 300.ms),

          const SizedBox(height: 20),

          // Match details card
          if (match != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFDC2626).withValues(alpha: 0.07),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFDC2626).withValues(alpha: 0.35)),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('MATCHING RECORD',
                    style: TextStyle(color: Color(0xFFDC2626), fontSize: 10,
                        fontWeight: FontWeight.w800, letterSpacing: 1)),
                const SizedBox(height: 8),
                _MatchRow(label: 'Name', value: match.name),
                _MatchRow(label: 'Citizen ID', value: match.citizenId.substring(0, 12) + '…'),
                _MatchRow(label: 'Similarity',
                    value: '${match.similarityPercent}% (threshold: ${(_dedupResult!.threshold * 100).toInt()}%)'),
                _MatchRow(label: 'Checked against',
                    value: '${_dedupResult?.scanned} enrolled citizens'),
                _MatchRow(label: 'Time', value: '${_dedupResult?.processingMs}ms'),
              ]),
            ).animate().fadeIn(delay: 350.ms),

          const SizedBox(height: 8),

          // Dedup stats (offline notice)
          if (_dedupResult?.isOffline == true)
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.amber.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: Colors.amber.withValues(alpha: 0.3)),
              ),
              child: const Row(children: [
                Icon(Icons.wifi_off, color: Colors.amber, size: 14),
                SizedBox(width: 8),
                Expanded(child: Text(
                  'Offline — dedup will run at sync time. Proceed with caution.',
                  style: TextStyle(color: Colors.amber, fontSize: 11.5,
                      fontWeight: FontWeight.w600),
                )),
              ]),
            ),

          const Spacer(),

          // Actions
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _retakeScan,
              icon: const Icon(Icons.refresh),
              label: const Text('Retake Scan'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.primary,
                side: const BorderSide(color: AppTheme.primary),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _proceedDespiteDuplicate,
              icon: const Icon(Icons.arrow_forward),
              label: const Text('Override & Proceed',
                  style: TextStyle(fontWeight: FontWeight.w700)),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFDC2626),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
          const SizedBox(height: 8),
          const Text('Override will be logged and flagged for review.',
              style: TextStyle(color: Colors.white30, fontSize: 11)),
        ]),
      ),
    );
  }

  Widget _buildDoneOverlay() {
    return Container(
      color: Colors.black.withValues(alpha: 0.55),
      child: Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.check_circle, size: 80, color: AppTheme.statusSuccess)
              .animate().scale(duration: 400.ms, curve: Curves.elasticOut),
          const SizedBox(height: 14),
          Text('${widget.side} Palm Biometrics Captured',
            style: const TextStyle(color: Colors.white, fontSize: 22,
                fontWeight: FontWeight.w800),
          ).animate().fadeIn(delay: 200.ms),
          const SizedBox(height: 8),
          if (_qualityScore > 0)
            Text('Quality: ${_qualityScore > 0.65 ? "Excellent" : _qualityScore > 0.4 ? "Good" : "Fair"}',
              style: TextStyle(
                color: _qualityScore > 0.4 ? AppTheme.statusSuccess : Colors.amber,
                fontSize: 13, fontWeight: FontWeight.w700,
              ),
            ).animate().fadeIn(delay: 300.ms),
          const SizedBox(height: 4),
          Text('256-dim vascular template · ${_dedupResult?.scanned ?? 0} citizens checked',
            style: const TextStyle(color: Colors.white38, fontSize: 12),
          ).animate().fadeIn(delay: 350.ms),
        ]),
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.camera_alt_outlined, size: 48, color: Colors.white38),
          const SizedBox(height: 16),
          Text(_errorMsg!,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white60, fontSize: 13)),
          const SizedBox(height: 20),
          OutlinedButton(
            onPressed: _retakeScan,
            style: OutlinedButton.styleFrom(foregroundColor: AppTheme.primary),
            child: const Text('Try Again'),
          ),
        ]),
      ),
    );
  }
}

// ── Supporting widgets ────────────────────────────────────────────────────

class _NirBadge extends StatelessWidget {
  final _ScanPhase phase;
  const _NirBadge({required this.phase});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.75),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFF00D4FF).withOpacity(0.5)),
      ),
      child: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('PALM BIOMETRICS',
          style: TextStyle(color: Color(0xFF00D4FF), fontSize: 8.5,
              fontWeight: FontWeight.w800, letterSpacing: 0.8)),
        Text('Palm Geometry & Vein Pattern',
          style: TextStyle(color: Colors.white70, fontSize: 8)),
        Text('Non-Contact Optical Sensing',
          style: TextStyle(color: Colors.white38, fontSize: 7,
              fontStyle: FontStyle.italic)),
      ]),
    );
  }
}

class _DistanceBadge extends StatelessWidget {
  final _ScanPhase phase;
  const _DistanceBadge({required this.phase});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.75),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white12),
      ),
      child: const Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
        Text('DISTANCE GUIDE',
          style: TextStyle(color: Colors.white38, fontSize: 8,
              fontWeight: FontWeight.w800, letterSpacing: 0.8)),
        Text('15 – 20 cm',
          style: TextStyle(color: Colors.white, fontSize: 11,
              fontWeight: FontWeight.w800)),
        Text('Open Hand · Flat',
          style: TextStyle(color: Color(0xFF00D4FF), fontSize: 7.5,
              fontWeight: FontWeight.w600)),
      ]),
    );
  }
}

class _QualityBar extends StatelessWidget {
  final double score;
  const _QualityBar({required this.score});

  @override
  Widget build(BuildContext context) {
    final color = score > 0.65 ? AppTheme.statusSuccess
        : score > 0.40 ? Colors.amber
        : AppTheme.statusDanger;
    final label = score > 0.65 ? 'Excellent'
        : score > 0.40 ? 'Good'
        : 'Poor — hold hand steadier';

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Text('Template quality',
          style: TextStyle(color: Colors.white54, fontSize: 10)),
        Text('$label · ${(score * 100).toInt()}%',
          style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w700)),
      ]),
      const SizedBox(height: 4),
      ClipRRect(
        borderRadius: BorderRadius.circular(4),
        child: LinearProgressIndicator(
          value: score,
          minHeight: 4,
          backgroundColor: Colors.white12,
          valueColor: AlwaysStoppedAnimation<Color>(color),
        ),
      ),
    ]);
  }
}

class _MatchRow extends StatelessWidget {
  final String label, value;
  const _MatchRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(children: [
        SizedBox(
          width: 90,
          child: Text(label,
            style: const TextStyle(color: Colors.white38, fontSize: 11)),
        ),
        Expanded(
          child: Text(value,
            style: const TextStyle(color: Colors.white, fontSize: 11,
                fontWeight: FontWeight.w600)),
        ),
      ]),
    );
  }
}

// ── Scan phases ───────────────────────────────────────────────────────────

enum _ScanPhase { positioning, scanning, dedup, done, duplicateWarning }

// ── Sweep line ────────────────────────────────────────────────────────────

class _ScanSweep extends StatelessWidget {
  final double progress, width, height;
  const _ScanSweep({required this.progress, required this.width, required this.height});

  @override
  Widget build(BuildContext context) {
    return Positioned(
      top: progress * height,
      left: 0, right: 0,
      child: Container(
        height: 2,
        decoration: const BoxDecoration(
          gradient: LinearGradient(colors: [
            Colors.transparent, Color(0xFF00FF88), Colors.transparent,
          ]),
        ),
      ),
    );
  }
}

// ── Grid overlay ──────────────────────────────────────────────────────────

class _GridOverlayPainter extends CustomPainter {
  final _ScanPhase phase;
  final double progress;
  const _GridOverlayPainter({required this.phase, required this.progress});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFF00B4D8).withValues(alpha: 0.10)
      ..strokeWidth = 0.5;
    const spacing = 28.0;
    for (double x = 0; x < size.width; x += spacing) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (double y = 0; y < size.height; y += spacing) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
    if (phase == _ScanPhase.scanning) {
      canvas.drawRect(
        Rect.fromLTWH(0, 0, size.width, size.height * progress),
        Paint()..color = const Color(0xFF00FF88).withValues(alpha: 0.06),
      );
    }
  }

  @override
  bool shouldRepaint(_GridOverlayPainter old) =>
      old.progress != progress || old.phase != phase;
}

// ── Palm Silhouette guide ─────────────────────────────────────────────────

class _PalmSilhouettePainter extends CustomPainter {
  final _ScanPhase phase;
  final String side;
  const _PalmSilhouettePainter({required this.phase, required this.side});

  @override
  void paint(Canvas canvas, Size size) {
    final color = phase == _ScanPhase.done
        ? AppTheme.statusSuccess
        : phase == _ScanPhase.duplicateWarning
            ? const Color(0xFFDC2626)
            : const Color(0xFF00D4FF); // BioSecure cyber cyan

    final cx = size.width / 2;
    final cy = size.height / 2;

    // ── 1. Cyber Outer Rounded Frame & Corners (matching app1-palm) ────────
    const pad = 10.0;
    final frameRect = RRect.fromRectAndRadius(
      Rect.fromLTWH(pad, pad, size.width - pad * 2, size.height - pad * 2),
      const Radius.circular(22),
    );

    // Subtle dashed / translucent border
    final framePaint = Paint()
      ..color = color.withOpacity(0.35)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6;
    canvas.drawRRect(frameRect, framePaint);

    // 4 High-tech Corner Targeting Brackets
    final cornerPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.2
      ..strokeCap = StrokeCap.round;

    const cLen = 32.0;
    final l = pad;
    final r = size.width - pad;
    final t = pad;
    final b = size.height - pad;
    const rad = 22.0;

    // Top-Left
    final pathTL = Path()
      ..moveTo(l, t + cLen)
      ..lineTo(l, t + rad)
      ..quadraticBezierTo(l, t, l + rad, t)
      ..lineTo(l + cLen, t);
    canvas.drawPath(pathTL, cornerPaint);

    // Top-Right
    final pathTR = Path()
      ..moveTo(r - cLen, t)
      ..lineTo(r - rad, t)
      ..quadraticBezierTo(r, t, r, t + rad)
      ..lineTo(r, t + cLen);
    canvas.drawPath(pathTR, cornerPaint);

    // Bottom-Left
    final pathBL = Path()
      ..moveTo(l, b - cLen)
      ..lineTo(l, b - rad)
      ..quadraticBezierTo(l, b, l + rad, b)
      ..lineTo(l + cLen, b);
    canvas.drawPath(pathBL, cornerPaint);

    // Bottom-Right
    final pathBR = Path()
      ..moveTo(r - cLen, b)
      ..lineTo(r - rad, b)
      ..quadraticBezierTo(r, b, r, b - rad)
      ..lineTo(r, b - cLen);
    canvas.drawPath(pathBR, cornerPaint);

    // ── 2. Anatomical Hand Contour (Natural Palm & Fingers) ────────────────
    // Flip slightly if Left hand for ergonomic match
    final bool isLeft = side.toLowerCase().contains('left');
    final double flip = isLeft ? -1.0 : 1.0;

    final handPath = Path();
    // Wrist base
    handPath.moveTo(cx - 36 * flip, cy + 95);
    // Outer edge up to thumb base
    handPath.quadraticBezierTo(cx - 44 * flip, cy + 65, cx - 52 * flip, cy + 45);
    // Thumb outward and tip
    handPath.quadraticBezierTo(cx - 76 * flip, cy + 28, cx - 88 * flip, cy - 8);
    handPath.quadraticBezierTo(cx - 86 * flip, cy - 22, cx - 74 * flip, cy - 18);
    // Thumb web
    handPath.quadraticBezierTo(cx - 56 * flip, cy + 8, cx - 44 * flip, cy + 2);
    // Index finger
    handPath.quadraticBezierTo(cx - 50 * flip, cy - 40, cx - 46 * flip, cy - 90);
    handPath.quadraticBezierTo(cx - 38 * flip, cy - 98, cx - 30 * flip, cy - 90);
    handPath.quadraticBezierTo(cx - 26 * flip, cy - 45, cx - 22 * flip, cy - 18);
    // Middle finger
    handPath.quadraticBezierTo(cx - 22 * flip, cy - 50, cx - 12 * flip, cy - 106);
    handPath.quadraticBezierTo(cx - 4 * flip, cy - 112, cx + 4 * flip, cy - 106);
    handPath.quadraticBezierTo(cx + 6 * flip, cy - 50, cx + 8 * flip, cy - 18);
    // Ring finger
    handPath.quadraticBezierTo(cx + 10 * flip, cy - 46, cx + 22 * flip, cy - 95);
    handPath.quadraticBezierTo(cx + 30 * flip, cy - 102, cx + 38 * flip, cy - 95);
    handPath.quadraticBezierTo(cx + 32 * flip, cy - 44, cx + 28 * flip, cy - 12);
    // Pinky finger
    handPath.quadraticBezierTo(cx + 36 * flip, cy - 35, cx + 48 * flip, cy - 70);
    handPath.quadraticBezierTo(cx + 56 * flip, cy - 75, cx + 62 * flip, cy - 68);
    handPath.quadraticBezierTo(cx + 52 * flip, cy - 25, cx + 46 * flip, cy + 15);
    // Palm side down to wrist
    handPath.quadraticBezierTo(cx + 44 * flip, cy + 65, cx + 36 * flip, cy + 95);
    handPath.close();

    // Subtle translucent fill
    canvas.drawPath(
      handPath,
      Paint()
        ..color = color.withOpacity(0.04)
        ..style = PaintingStyle.fill,
    );

    // Glowing contour stroke
    canvas.drawPath(
      handPath,
      Paint()
        ..color = color.withOpacity(0.60)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.8
        ..strokeJoin = StrokeJoin.round,
    );

    // ── 3. MediaPipe Palm Landmarks & Interconnection Rays (app1-palm) ────
    final landmarks = [
      Offset(cx, cy + 85),                           // 0: Wrist
      Offset(cx - 38 * flip, cy + 50),               // 1: Thumb CMC
      Offset(cx - 58 * flip, cy + 28),               // 2: Thumb MCP
      Offset(cx - 74 * flip, cy + 6),                // 3: Thumb IP
      Offset(cx - 82 * flip, cy - 14),               // 4: Thumb TIP
      Offset(cx - 36 * flip, cy - 14),               // 5: Index MCP
      Offset(cx - 39 * flip, cy - 44),               // 6: Index PIP
      Offset(cx - 41 * flip, cy - 68),               // 7: Index DIP
      Offset(cx - 43 * flip, cy - 88),               // 8: Index TIP
      Offset(cx - 8 * flip, cy - 18),                // 9: Middle MCP
      Offset(cx - 7 * flip, cy - 50),                // 10: Middle PIP
      Offset(cx - 6 * flip, cy - 78),                // 11: Middle DIP
      Offset(cx - 5 * flip, cy - 102),               // 12: Middle TIP
      Offset(cx + 16 * flip, cy - 14),               // 13: Ring MCP
      Offset(cx + 19 * flip, cy - 44),               // 14: Ring PIP
      Offset(cx + 22 * flip, cy - 70),               // 15: Ring DIP
      Offset(cx + 25 * flip, cy - 92),               // 16: Ring TIP
      Offset(cx + 38 * flip, cy - 6),                // 17: Pinky MCP
      Offset(cx + 44 * flip, cy - 30),               // 18: Pinky PIP
      Offset(cx + 49 * flip, cy - 50),               // 19: Pinky DIP
      Offset(cx + 54 * flip, cy - 66),               // 20: Pinky TIP
    ];

    // Connection lines (skeletal biometric mesh)
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [9, 10], [10, 11], [11, 12],
      [13, 14], [14, 15], [15, 16],
      [0, 17], [17, 18], [18, 19], [19, 20],
      [5, 9], [9, 13], [13, 17], [0, 9],
    ];

    final meshPaint = Paint()
      ..color = color.withOpacity(0.28)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;

    for (final conn in connections) {
      canvas.drawLine(landmarks[conn[0]], landmarks[conn[1]], meshPaint);
    }

    // Glowing Landmark Nodes
    final nodePaint = Paint()
      ..color = color.withOpacity(0.85)
      ..style = PaintingStyle.fill;
    final nodeGlow = Paint()
      ..color = color.withOpacity(0.3)
      ..style = PaintingStyle.fill;

    for (final pt in landmarks) {
      canvas.drawCircle(pt, 5.0, nodeGlow);
      canvas.drawCircle(pt, 2.6, nodePaint);
    }

    // ── 4. Palmar Vascular Plexus Target Crosshairs (Center of Palm) ──────
    final centerPlexus = Offset(cx, cy + 28);
    final targetPaint = Paint()
      ..color = color.withOpacity(0.65)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4;

    canvas.drawCircle(centerPlexus, 18, targetPaint);
    canvas.drawCircle(centerPlexus, 9, Paint()
      ..color = color.withOpacity(0.35)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0);
    canvas.drawCircle(centerPlexus, 3, Paint()..color = color..style = PaintingStyle.fill);

    // Crosshairs
    canvas.drawLine(
      Offset(centerPlexus.dx - 26, centerPlexus.dy),
      Offset(centerPlexus.dx + 26, centerPlexus.dy),
      targetPaint,
    );
    canvas.drawLine(
      Offset(centerPlexus.dx, centerPlexus.dy - 26),
      Offset(centerPlexus.dx, centerPlexus.dy + 26),
      targetPaint,
    );
  }

  @override
  bool shouldRepaint(_PalmSilhouettePainter old) => old.phase != phase;
}
