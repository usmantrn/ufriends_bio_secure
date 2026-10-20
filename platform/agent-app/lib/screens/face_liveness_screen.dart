import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:image/image.dart' as img;
import '../utils/app_theme.dart';

/// Face Liveness Screen — Reliable implementation using XFile capture
/// instead of raw image stream (avoids YUV format issues).
/// Steps: Straight → Left → Right → Blink
class FaceLivenessScreen extends StatefulWidget {
  const FaceLivenessScreen({super.key});

  @override
  State<FaceLivenessScreen> createState() => _FaceLivenessScreenState();
}

enum _LivenessStep { straight, turnLeft, turnRight, blink, done }

extension _LivenessStepExt on _LivenessStep {
  String get instruction {
    switch (this) {
      case _LivenessStep.straight:   return 'Look straight at the camera';
      case _LivenessStep.turnLeft:   return 'Slowly turn your head LEFT ←';
      case _LivenessStep.turnRight:  return 'Slowly turn your head RIGHT →';
      case _LivenessStep.blink:      return 'Look forward and BLINK once 👁️';
      case _LivenessStep.done:       return 'Face Verified ✓';
    }
  }
  IconData get icon {
    switch (this) {
      case _LivenessStep.straight:  return Icons.face;
      case _LivenessStep.turnLeft:  return Icons.arrow_back;
      case _LivenessStep.turnRight: return Icons.arrow_forward;
      case _LivenessStep.blink:     return Icons.visibility_off;
      case _LivenessStep.done:      return Icons.check_circle;
    }
  }
  int get stepIndex => _LivenessStep.values.indexOf(this);
}

class _FaceLivenessScreenState extends State<FaceLivenessScreen> {
  CameraController? _cam;
  FaceDetector? _detector;

  _LivenessStep _step = _LivenessStep.straight;
  String _feedback = 'Initializing camera…';
  String? _errorMsg;
  bool _isCapturing = false;
  bool _initialized = false;
  List<double>? _capturedFaceDescriptor;

  // Retry timer — re-captures every 800ms
  Timer? _captureTimer;

  @override
  void initState() {
    super.initState();
    _initCamera();
  }

  Future<void> _initCamera() async {
    try {
      final cameras = await availableCameras();
      final front = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => cameras.first,
      );
      _detector = FaceDetector(
        options: FaceDetectorOptions(
          enableClassification: true,
          enableLandmarks: true,
          enableContours: true,
          performanceMode: FaceDetectorMode.accurate, // More reliable
        ),
      );
      _cam = CameraController(front, ResolutionPreset.medium, enableAudio: false);
      await _cam!.initialize();
      if (mounted) {
        setState(() {
          _initialized = true;
          _feedback = 'Position your face in the oval';
        });
        // Start periodic capture
        _startCaptureLoop();
      }
    } catch (e) {
      setState(() => _errorMsg = 'Camera error: $e');
    }
  }

  void _startCaptureLoop() {
    _captureTimer = Timer.periodic(const Duration(milliseconds: 900), (_) {
      if (_step != _LivenessStep.done && !_isCapturing) {
        _captureAndAnalyze();
      }
    });
  }

  Future<void> _captureAndAnalyze() async {
    if (_isCapturing || _cam == null || !_cam!.value.isInitialized) return;
    _isCapturing = true;
    try {
      // Take a still picture — avoids YUV format issues entirely
      final xfile = await _cam!.takePicture();
      final inputImage = InputImage.fromFilePath(xfile.path);
      final faces = await _detector!.processImage(inputImage);

      // Read image bytes for biometric descriptor extraction before deleting
      Uint8List? rawBytes;
      if (faces.isNotEmpty) {
        try {
          rawBytes = await File(xfile.path).readAsBytes();
        } catch (_) {}
      }

      // Clean up temp file
      try { File(xfile.path).deleteSync(); } catch (_) {}

      if (!mounted) return;

      if (faces.isEmpty) {
        setState(() => _feedback = 'No face detected — center your face in the oval');
        return;
      }

      final face = faces.first;
      final yaw = face.headEulerAngleY ?? 0;
      final leftEye = face.leftEyeOpenProbability ?? 1.0;
      final rightEye = face.rightEyeOpenProbability ?? 1.0;

      // Dynamic feedback based on current state
      bool stepPassed = false;
      String hint = '';

      switch (_step) {
        case _LivenessStep.straight:
          stepPassed = yaw.abs() < 12;
          hint = stepPassed ? 'Hold still…' : 'Face the camera directly';
          // Extract real deterministic facial biometric descriptor
          if (stepPassed && rawBytes != null) {
            try {
              _capturedFaceDescriptor = _extractFaceDescriptor(face, rawBytes);
            } catch (e) {
              debugPrint('Error extracting face descriptor: $e');
            }
          }
          break;
        case _LivenessStep.turnLeft:
          // Front camera on Android: turning head to the user's LEFT produces a POSITIVE Euler Y (yaw > 0)
          stepPassed = yaw > 14;
          if (stepPassed) {
            hint = 'Left turn detected! ✓';
          } else if (yaw > 6) {
            hint = 'Turning left… keep turning (yaw: +${yaw.toStringAsFixed(0)}°)';
          } else {
            hint = 'Turn your head LEFT ←';
          }
          break;
        case _LivenessStep.turnRight:
          // Front camera on Android: turning head to the user's RIGHT produces a NEGATIVE Euler Y (yaw < 0)
          stepPassed = yaw < -14;
          if (stepPassed) {
            hint = 'Right turn detected! ✓';
          } else if (yaw < -6) {
            hint = 'Turning right… keep turning (yaw: ${yaw.toStringAsFixed(0)}°)';
          } else {
            hint = 'Turn your head RIGHT →';
          }
          break;
        case _LivenessStep.blink:
          stepPassed = leftEye < 0.35 && rightEye < 0.35;
          hint = stepPassed ? 'Blink detected! ✓' : 'Close both eyes fully';
          break;
        case _LivenessStep.done:
          return;
      }

      setState(() => _feedback = hint);

      if (stepPassed) {
        _advanceStep();
      }
    } catch (e) {
      if (mounted) setState(() => _feedback = 'Retrying…');
    } finally {
      _isCapturing = false;
    }
  }

  void _advanceStep() {
    _captureTimer?.cancel();
    final steps = _LivenessStep.values;
    final next = steps[_step.stepIndex + 1];
    setState(() => _step = next);

    if (next == _LivenessStep.done) {
      Future.delayed(const Duration(milliseconds: 900), _returnResult);
    } else {
      // Small delay before next step so user sees the transition
      Future.delayed(const Duration(milliseconds: 600), () {
        if (mounted) _startCaptureLoop();
      });
    }
  }

  void _returnResult() {
    final descriptor = _capturedFaceDescriptor ?? List<double>.filled(128, 0.0);
    Navigator.pop(context, descriptor);
  }

  List<double> _extractFaceDescriptor(Face face, Uint8List imageBytes) {
    // ── 1. Geometric proportions from landmarks & contours (64 dims) ──────
    final geom = <double>[];

    final le = face.landmarks[FaceLandmarkType.leftEye]?.position;
    final re = face.landmarks[FaceLandmarkType.rightEye]?.position;
    final nb = face.landmarks[FaceLandmarkType.noseBase]?.position;
    final lm = face.landmarks[FaceLandmarkType.leftMouth]?.position;
    final rm = face.landmarks[FaceLandmarkType.rightMouth]?.position;
    final bm = face.landmarks[FaceLandmarkType.bottomMouth]?.position;
    final lc = face.landmarks[FaceLandmarkType.leftCheek]?.position;
    final rc = face.landmarks[FaceLandmarkType.rightCheek]?.position;

    // Normalization baseline: Inter-pupillary distance (IPD)
    double ipd = 100.0;
    if (le != null && re != null) {
      final dx = (le.x - re.x).toDouble();
      final dy = (le.y - re.y).toDouble();
      ipd = sqrt(dx * dx + dy * dy);
      if (ipd < 10) ipd = 100.0;
    } else {
      ipd = face.boundingBox.width * 0.45;
    }

    double dist(Point<int>? p1, Point<int>? p2) {
      if (p1 == null || p2 == null) return 0.0;
      final dx = (p1.x - p2.x).toDouble();
      final dy = (p1.y - p2.y).toDouble();
      return sqrt(dx * dx + dy * dy) / ipd;
    }

    // Pairwise normalized distances between key landmarks (28 features)
    final keyPoints = [le, re, nb, lm, rm, bm, lc, rc];
    for (int i = 0; i < keyPoints.length; i++) {
      for (int j = i + 1; j < keyPoints.length; j++) {
        geom.add(dist(keyPoints[i], keyPoints[j]));
      }
    }

    // Bounding box proportions (3 features)
    final bbH = face.boundingBox.height > 0 ? face.boundingBox.height : 1.0;
    geom.add(face.boundingBox.width / bbH);
    geom.add(face.boundingBox.width / ipd);
    geom.add(face.boundingBox.height / ipd);

    // Jawline / chin contour sample points relative to noseBase (16 features)
    final faceContour = face.contours[FaceContourType.face]?.points;
    if (faceContour != null && faceContour.isNotEmpty && nb != null) {
      final step = (faceContour.length / 16).floor().clamp(1, faceContour.length);
      for (int i = 0; i < 16; i++) {
        final idx = (i * step).clamp(0, faceContour.length - 1);
        final pt = faceContour[idx];
        final dx = (pt.x - nb.x).toDouble();
        final dy = (pt.y - nb.y).toDouble();
        geom.add(sqrt(dx * dx + dy * dy) / ipd);
      }
    }

    // Pad or trim to exactly 64 geometric features
    while (geom.length < 64) {
      geom.add(geom.isNotEmpty ? geom[geom.length % geom.length] * 0.5 : 0.0);
    }
    final geom64 = geom.sublist(0, 64);

    // ── 2. Facial texture & spatial gradient descriptor (64 dims) ────────
    final texture = <double>[];
    try {
      final decoded = img.decodeImage(imageBytes);
      if (decoded != null) {
        final bb = face.boundingBox;
        final cropX = bb.left.toInt().clamp(0, decoded.width - 1);
        final cropY = bb.top.toInt().clamp(0, decoded.height - 1);
        final cropW = bb.width.toInt().clamp(1, decoded.width - cropX);
        final cropH = bb.height.toInt().clamp(1, decoded.height - cropY);

        final cropped = img.copyCrop(decoded, x: cropX, y: cropY, width: cropW, height: cropH);
        final resized = img.copyResize(cropped, width: 32, height: 32);
        final gray = img.grayscale(resized);

        // 4x4 spatial grid (16 cells, each 8x8 pixels)
        // 4 features per cell: mean intensity, dx gradient, dy gradient, gradient magnitude
        for (int gy = 0; gy < 4; gy++) {
          for (int gx = 0; gx < 4; gx++) {
            double sum = 0, sumDx = 0, sumDy = 0;
            for (int y = gy * 8; y < (gy + 1) * 8; y++) {
              for (int x = gx * 8; x < (gx + 1) * 8; x++) {
                final v = gray.getPixel(x, y).r.toDouble();
                sum += v;
                if (x > 0 && x < 31) {
                  sumDx += (gray.getPixel(x + 1, y).r.toDouble() - gray.getPixel(x - 1, y).r.toDouble()).abs();
                }
                if (y > 0 && y < 31) {
                  sumDy += (gray.getPixel(x, y + 1).r.toDouble() - gray.getPixel(x, y - 1).r.toDouble()).abs();
                }
              }
            }
            texture.add(sum / (64.0 * 255.0));
            texture.add(sumDx / (64.0 * 255.0));
            texture.add(sumDy / (64.0 * 255.0));
            texture.add(sqrt(sumDx * sumDx + sumDy * sumDy) / (64.0 * 255.0));
          }
        }
      }
    } catch (_) {}

    while (texture.length < 64) {
      texture.add(0.0);
    }
    final text64 = texture.sublist(0, 64);

    // Combine: 64 geom + 64 texture = 128-dim biometric face descriptor
    final raw128 = [...geom64, ...text64];

    // Zero-center for true discriminative cosine similarity
    final mean = raw128.reduce((a, b) => a + b) / raw128.length;
    final centered = raw128.map((v) => v - mean).toList();

    // L2-normalize
    final norm = sqrt(centered.fold(0.0, (s, v) => s + v * v));
    return norm > 0 ? centered.map((v) => v / norm).toList() : centered;
  }

  @override
  void dispose() {
    _captureTimer?.cancel();
    _cam?.dispose();
    _detector?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        title: const Text('Face Liveness Check',
            style: TextStyle(color: Colors.white, fontSize: 16)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: _errorMsg != null
          ? _ErrorView(message: _errorMsg!)
          : !_initialized
              ? const Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      CircularProgressIndicator(color: AppTheme.primary),
                      SizedBox(height: 16),
                      Text('Starting camera…',
                          style: TextStyle(color: Colors.white60, fontSize: 13)),
                    ],
                  ))
              : _buildUI(),
    );
  }

  Widget _buildUI() {
    final size = MediaQuery.of(context).size;
    final ovalW = size.width * 0.72;
    final ovalH = ovalW * 1.35;
    final isDone = _step == _LivenessStep.done;

    return Stack(children: [
      // Camera preview
      SizedBox.expand(
        child: FittedBox(
          fit: BoxFit.cover,
          child: SizedBox(
            width: _cam!.value.previewSize!.height,
            height: _cam!.value.previewSize!.width,
            child: CameraPreview(_cam!),
          ),
        ),
      ),

      // Dark overlay with oval cutout
      CustomPaint(
        size: size,
        painter: _OvalCutoutPainter(
          ovalW: ovalW, ovalH: ovalH,
          color: isDone ? AppTheme.statusSuccess : AppTheme.primary,
        ),
      ),

      // Scan sweep inside oval
      if (!isDone && _isCapturing)
        Positioned(
          left: (size.width - ovalW) / 2,
          top: (size.height - ovalH) / 2,
          child: _ScanLine(width: ovalW, height: ovalH),
        ),

      // Step progress (top)
      Positioned(
        top: 12, left: 16, right: 16,
        child: _StepProgressBar(step: _step),
      ),

      // Live feedback hint (middle above oval)
      Positioned(
        top: size.height / 2 - ovalH / 2 - 52,
        left: 20, right: 20,
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 300),
          child: Container(
            key: ValueKey(_feedback),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.black.withOpacity(0.7),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              _feedback,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: _feedback.contains('Good') || _feedback.contains('detected!')
                    ? AppTheme.statusSuccess
                    : Colors.white,
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
      ),

      // Bottom instruction card
      Positioned(
        bottom: 40, left: 20, right: 20,
        child: _InstructionCard(step: _step),
      ),

      // Capture indicator
      if (_isCapturing && !isDone)
        Positioned(
          bottom: 160, right: 28,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: AppTheme.primary.withOpacity(0.2),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: AppTheme.primary.withOpacity(0.5)),
            ),
            child: const Row(mainAxisSize: MainAxisSize.min, children: [
              SizedBox(width: 8, height: 8,
                  child: CircularProgressIndicator(strokeWidth: 1.5, color: AppTheme.primary)),
              SizedBox(width: 6),
              Text('SCANNING', style: TextStyle(color: AppTheme.primary, fontSize: 9,
                  fontWeight: FontWeight.w700, letterSpacing: 0.8)),
            ]),
          ),
        ),

      // Done overlay
      if (isDone)
        Container(
          color: Colors.black.withOpacity(0.6),
          child: Center(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.check_circle, size: 90, color: AppTheme.statusSuccess)
                  .animate().scale(duration: 400.ms, curve: Curves.elasticOut),
              const SizedBox(height: 16),
              const Text('Liveness Confirmed',
                style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800))
                  .animate().fadeIn(delay: 250.ms),
            ]),
          ),
        ),
    ]);
  }
}

// ── Progress bar ───────────────────────────────────────────────────────────────

class _StepProgressBar extends StatelessWidget {
  final _LivenessStep step;
  const _StepProgressBar({required this.step});

  static const _steps = [
    _LivenessStep.straight, _LivenessStep.turnLeft,
    _LivenessStep.turnRight, _LivenessStep.blink,
  ];
  static const _labels = ['STRAIGHT', 'LEFT', 'RIGHT', 'BLINK'];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.7),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: List.generate(_steps.length, (i) {
          final s = _steps[i];
          final done = step.stepIndex > s.stepIndex;
          final active = step == s;
          return Column(mainAxisSize: MainAxisSize.min, children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 300),
              width: 36, height: 36,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: done ? AppTheme.statusSuccess
                    : active ? AppTheme.primary
                    : Colors.white12,
                border: Border.all(
                  color: active ? AppTheme.primary : Colors.transparent,
                  width: 2,
                ),
              ),
              child: Icon(done ? Icons.check : s.icon,
                size: 17,
                color: (done || active) ? Colors.black : Colors.white30),
            ),
            const SizedBox(height: 4),
            Text(_labels[i],
              style: TextStyle(
                fontSize: 9, letterSpacing: 0.3,
                fontWeight: active ? FontWeight.w800 : FontWeight.w400,
                color: done ? AppTheme.statusSuccess
                    : active ? AppTheme.primary
                    : Colors.white30,
              )),
          ]);
        }),
      ),
    );
  }
}

// ── Instruction card ───────────────────────────────────────────────────────────

class _InstructionCard extends StatelessWidget {
  final _LivenessStep step;
  const _InstructionCard({required this.step});

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 350),
      child: Container(
        key: ValueKey(step),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.8),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppTheme.primary.withOpacity(0.4)),
        ),
        child: Row(children: [
          Container(
            width: 42, height: 42,
            decoration: BoxDecoration(
              color: AppTheme.primary.withOpacity(0.15),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(step.icon, color: AppTheme.primary, size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(step == _LivenessStep.done ? 'Complete'
                  : 'Step ${step.stepIndex + 1} of 4',
                style: const TextStyle(fontSize: 10, color: AppTheme.textMuted)),
              const SizedBox(height: 3),
              Text(step.instruction,
                style: const TextStyle(color: Colors.white, fontSize: 14,
                    fontWeight: FontWeight.w700)),
            ]),
          ),
        ]),
      ),
    );
  }
}

// ── Scan sweep line ────────────────────────────────────────────────────────────

class _ScanLine extends StatefulWidget {
  final double width, height;
  const _ScanLine({required this.width, required this.height});
  @override
  State<_ScanLine> createState() => _ScanLineState();
}

class _ScanLineState extends State<_ScanLine> with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;
  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))
      ..repeat(reverse: true);
  }
  @override
  void dispose() { _ctrl.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return SizedBox(width: widget.width, height: widget.height,
      child: AnimatedBuilder(
        animation: _ctrl,
        builder: (_, __) => Stack(children: [
          Positioned(
            top: _ctrl.value * (widget.height - 2),
            left: 0, right: 0,
            child: Container(height: 2,
              decoration: BoxDecoration(
                gradient: LinearGradient(colors: [
                  AppTheme.primary.withOpacity(0),
                  AppTheme.primary.withOpacity(0.85),
                  AppTheme.primary.withOpacity(0),
                ]),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

// ── Painters ──────────────────────────────────────────────────────────────────

class _OvalCutoutPainter extends CustomPainter {
  final double ovalW, ovalH;
  final Color color;
  const _OvalCutoutPainter({required this.ovalW, required this.ovalH, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final cx = size.width / 2, cy = size.height / 2;
    final oval = Rect.fromCenter(center: Offset(cx, cy), width: ovalW, height: ovalH);
    canvas.drawPath(
      Path()
        ..addRect(Rect.fromLTWH(0, 0, size.width, size.height))
        ..addOval(oval)
        ..fillType = PathFillType.evenOdd,
      Paint()..color = Colors.black.withOpacity(0.55),
    );
    canvas.drawOval(oval,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = color
        ..strokeWidth = 2.5);
  }

  @override
  bool shouldRepaint(_OvalCutoutPainter old) => old.color != color;
}

// ── Error view ─────────────────────────────────────────────────────────────────

class _ErrorView extends StatelessWidget {
  final String message;
  const _ErrorView({required this.message});
  @override
  Widget build(BuildContext context) {
    return Center(child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.camera_alt_outlined, size: 48, color: Colors.white38),
        const SizedBox(height: 16),
        Text(message, textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white60, fontSize: 13)),
        const SizedBox(height: 20),
        OutlinedButton(
          onPressed: () => Navigator.pop(context),
          style: OutlinedButton.styleFrom(foregroundColor: AppTheme.primary),
          child: const Text('Go Back'),
        ),
      ]),
    ));
  }
}
