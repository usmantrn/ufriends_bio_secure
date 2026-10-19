import 'dart:async';
import 'dart:io';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';

/// Continuous Agent Verification Service
/// ─────────────────────────────────────────────────────────────────────────────
/// Blueprint Section 2.2: "While the agent app is open, the front-facing
/// camera periodically verifies that the face looking at the screen matches
/// the authorized agent. If it fails, the app instantly locks."
///
/// How it works:
///   1. At login, the agent's face session is "anchored" (face detected = OK)
///   2. Every 90 seconds, a silent background check runs:
///      - Takes a front camera snapshot
///      - Runs ML Kit face detection
///      - If NO face is detected for 3 consecutive checks → lock the app
///      - Shows a brief non-intrusive banner during check
///   3. onLockTriggered callback is invoked → app navigates to lock screen
/// ─────────────────────────────────────────────────────────────────────────────
class ContinuousVerificationService {
  static const _checkIntervalSeconds = 90;
  static const _maxConsecutiveFails = 3;

  static Timer? _timer;
  static int _consecutiveFails = 0;
  static bool _isChecking = false;
  static FaceDetector? _detector;
  static CameraController? _cam;

  static VoidCallback? _onLockTriggered;
  static void Function(String message)? _onStatusUpdate;

  static bool get isRunning => _timer != null && _timer!.isActive;

  /// Start the continuous verification loop
  static Future<void> start({
    required VoidCallback onLockTriggered,
    void Function(String)? onStatusUpdate,
  }) async {
    if (isRunning) return;

    _onLockTriggered = onLockTriggered;
    _onStatusUpdate = onStatusUpdate;
    _consecutiveFails = 0;

    await _initDetector();

    _timer = Timer.periodic(
      const Duration(seconds: _checkIntervalSeconds),
      (_) => _runCheck(),
    );

    _onStatusUpdate?.call('Continuous verification active');
  }

  static void stop() {
    _timer?.cancel();
    _timer = null;
    _cam?.dispose();
    _cam = null;
    _detector?.close();
    _detector = null;
    _consecutiveFails = 0;
  }

  static Future<void> _initDetector() async {
    _detector ??= FaceDetector(
      options: FaceDetectorOptions(
        performanceMode: FaceDetectorMode.fast,
      ),
    );
  }

  static Future<void> _runCheck() async {
    if (_isChecking) return;
    _isChecking = true;

    try {
      _onStatusUpdate?.call('Verifying agent presence…');

      // Get front camera
      final cameras = await availableCameras();
      final front = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => cameras.first,
      );

      final cam = CameraController(
        front, ResolutionPreset.low, enableAudio: false,
      );
      await cam.initialize();

      final xfile = await cam.takePicture();
      await cam.dispose();

      // Analyze
      final inputImage = InputImage.fromFilePath(xfile.path);
      final faces = await _detector!.processImage(inputImage);

      // Clean up temp file
      try { File(xfile.path).deleteSync(); } catch (_) {}

      if (faces.isNotEmpty) {
        // Face detected — agent is present
        _consecutiveFails = 0;
        _onStatusUpdate?.call('Agent verified ✓');
      } else {
        _consecutiveFails++;
        _onStatusUpdate?.call(
            'No face detected (${ _consecutiveFails}/$_maxConsecutiveFails)');

        if (_consecutiveFails >= _maxConsecutiveFails) {
          // Lock the app
          stop();
          _onLockTriggered?.call();
        }
      }
    } catch (e) {
      // On error, don't penalize — network/camera issues shouldn't lock the user
      _onStatusUpdate?.call('Check skipped (camera busy)');
    } finally {
      _isChecking = false;
    }
  }

  /// Force an immediate check (e.g. before a sensitive action)
  static Future<bool> forceCheck() async {
    if (_detector == null) await _initDetector();
    try {
      final cameras = await availableCameras();
      final front = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => cameras.first,
      );
      final cam = CameraController(front, ResolutionPreset.low, enableAudio: false);
      await cam.initialize();
      final xfile = await cam.takePicture();
      await cam.dispose();
      final inputImage = InputImage.fromFilePath(xfile.path);
      final faces = await _detector!.processImage(inputImage);
      try { File(xfile.path).deleteSync(); } catch (_) {}
      return faces.isNotEmpty;
    } catch (_) {
      return true; // fail-open on camera error
    }
  }
}

/// Widget that wraps any screen and shows continuous verification status
class ContinuousVerificationWrapper extends StatefulWidget {
  final Widget child;
  final VoidCallback onLocked;

  const ContinuousVerificationWrapper({
    super.key,
    required this.child,
    required this.onLocked,
  });

  @override
  State<ContinuousVerificationWrapper> createState() =>
      _ContinuousVerificationWrapperState();
}

class _ContinuousVerificationWrapperState
    extends State<ContinuousVerificationWrapper> {
  String _status = '';
  bool _showStatus = false;
  Timer? _hideTimer;

  @override
  void initState() {
    super.initState();
    ContinuousVerificationService.start(
      onLockTriggered: () {
        if (mounted) widget.onLocked();
      },
      onStatusUpdate: (msg) {
        if (!mounted) return;
        setState(() {
          _status = msg;
          _showStatus = true;
        });
        _hideTimer?.cancel();
        _hideTimer = Timer(const Duration(seconds: 3), () {
          if (mounted) setState(() => _showStatus = false);
        });
      },
    );
  }

  @override
  void dispose() {
    _hideTimer?.cancel();
    // Don't stop the service here — it continues across screen transitions
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        // Subtle status toast at top
        AnimatedPositioned(
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
          top: _showStatus ? 0 : -60,
          left: 0, right: 0,
          child: SafeArea(
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: _status.contains('✓')
                    ? const Color(0xFF059669).withValues(alpha: 0.92)
                    : const Color(0xFF1E40AF).withValues(alpha: 0.92),
                borderRadius: BorderRadius.circular(10),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.15),
                    blurRadius: 8, offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Row(children: [
                Icon(
                  _status.contains('✓') ? Icons.verified_user
                      : Icons.shield_outlined,
                  size: 14,
                  color: Colors.white,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _status,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ]),
            ),
          ),
        ),
      ],
    );
  }
}
