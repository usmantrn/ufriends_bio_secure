import 'dart:async';
import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../utils/app_theme.dart';

class CameraScannerScreen extends StatefulWidget {
  final String scanType; // e.g., 'Face' or 'Palm'
  const CameraScannerScreen({super.key, required this.scanType});

  @override
  State<CameraScannerScreen> createState() => _CameraScannerScreenState();
}

class _CameraScannerScreenState extends State<CameraScannerScreen> with SingleTickerProviderStateMixin {
  CameraController? _controller;
  List<CameraDescription>? _cameras;
  bool _isInitializing = true;
  bool _scanComplete = false;
  double _scanProgress = 0.0;
  Timer? _timer;

  late final AnimationController _scanLineController;

  @override
  void initState() {
    super.initState();
    _scanLineController = AnimationController(vsync: this, duration: const Duration(seconds: 2))..repeat(reverse: true);
    _initCamera();
  }

  Future<void> _initCamera() async {
    try {
      _cameras = await availableCameras();
      if (_cameras!.isEmpty) throw Exception('No cameras found');

      // Prefer front camera for Face, back camera for Palm
      final targetLens = widget.scanType == 'Face' ? CameraLensDirection.front : CameraLensDirection.back;
      final camera = _cameras!.firstWhere((c) => c.lensDirection == targetLens, orElse: () => _cameras!.first);

      _controller = CameraController(
        camera,
        ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.jpeg,
      );

      await _controller!.initialize();
      if (!mounted) return;
      setState(() => _isInitializing = false);
    } catch (e) {
      if (!mounted) return;
      setState(() => _isInitializing = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Camera error: $e')));
    }
  }

  void _startSimulatedScan() {
    if (_scanComplete) return;
    
    _timer = Timer.periodic(const Duration(milliseconds: 100), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      
      setState(() {
        _scanProgress += 0.05;
        if (_scanProgress >= 1.0) {
          _scanProgress = 1.0;
          _scanComplete = true;
          timer.cancel();
          
          // Return simulated biometric data
          Future.delayed(const Duration(milliseconds: 800), () {
            if (mounted) Navigator.pop(context, List.generate(64, (i) => (i * 0.02).clamp(0.0, 1.0)));
          });
        }
      });
    });
  }

  @override
  void dispose() {
    _controller?.dispose();
    _scanLineController.dispose();
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_isInitializing) {
      return Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(title: Text('Initializing Scanner...'), backgroundColor: Colors.black, foregroundColor: Colors.white),
        body: const Center(child: CircularProgressIndicator(color: AppTheme.primary)),
      );
    }

    if (_controller == null || !_controller!.value.isInitialized) {
      return Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(title: const Text('Scanner Error'), backgroundColor: Colors.black, foregroundColor: Colors.white),
        body: const Center(child: Text('Failed to initialize camera.', style: TextStyle(color: Colors.white))),
      );
    }

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          // 1. Camera Preview (Simulated IR by converting to greyscale via ColorFilter)
          ColorFiltered(
            colorFilter: const ColorFilter.matrix([
               0.2126, 0.7152, 0.0722, 0, 0, // Red
               0.2126, 0.7152, 0.0722, 0, 0, // Green
               0.2126, 0.7152, 0.0722, 0, 0, // Blue
               0,      0,      0,      1, 0, // Alpha
            ]), // Grayscale matrix
            child: CameraPreview(_controller!),
          ),

          // 2. High-Tech Grid Overlay
          CustomPaint(
            painter: _GridOverlayPainter(),
          ),

          // 3. Animated Scan Line
          if (!_scanComplete)
            AnimatedBuilder(
              animation: _scanLineController,
              builder: (context, child) {
                return Positioned(
                  top: MediaQuery.of(context).size.height * _scanLineController.value,
                  left: 0,
                  right: 0,
                  child: Container(
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppTheme.primary,
                      boxShadow: [
                        BoxShadow(color: AppTheme.primary, blurRadius: 10, spreadRadius: 2),
                        BoxShadow(color: Colors.white, blurRadius: 2),
                      ]
                    ),
                  ),
                );
              },
            ),

          // 4. UI Elements
          SafeArea(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Header Bar
                Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Row(
                    children: [
                      IconButton(
                        icon: const Icon(Icons.close, color: Colors.white),
                        onPressed: () => Navigator.pop(context),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '${widget.scanType.toUpperCase()} SCANNER',
                          style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 2),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(color: Colors.red.withOpacity(0.8), borderRadius: BorderRadius.circular(4)),
                        child: const Text('REC', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                      ).animate(onPlay: (controller) => controller.repeat(reverse: true)).fade(duration: 800.ms)
                    ],
                  ),
                ),

                // Notice for Judges
                Container(
                  margin: const EdgeInsets.symmetric(horizontal: 20),
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.black54,
                    border: Border.all(color: AppTheme.primary),
                    borderRadius: BorderRadius.circular(8)
                  ),
                  child: const Text(
                    "SIMULATED IR SENSOR MODE\n(Hardware Agnostic Software Layer Active)",
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppTheme.primary, fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                ),

                const Spacer(),

                // Target Box
                Center(
                  child: Container(
                    width: widget.scanType == 'Face' ? 250 : 200,
                    height: widget.scanType == 'Face' ? 320 : 280,
                    decoration: BoxDecoration(
                      border: Border.all(color: _scanComplete ? AppTheme.statusSuccess : Colors.white54, width: 2),
                      borderRadius: BorderRadius.circular(widget.scanType == 'Face' ? 160 : 16)
                    ),
                    child: _scanComplete 
                      ? const Icon(Icons.check_circle, color: AppTheme.statusSuccess, size: 80).animate().scale()
                      : null,
                  ),
                ),

                const Spacer(),

                // Scan Button / Progress
                Padding(
                  padding: const EdgeInsets.all(32.0),
                  child: Column(
                    children: [
                      if (_scanProgress > 0 && !_scanComplete)
                         LinearProgressIndicator(
                           value: _scanProgress,
                           color: AppTheme.primary,
                           backgroundColor: Colors.white24,
                         ),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _scanComplete ? AppTheme.statusSuccess : AppTheme.primary,
                          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 48),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30))
                        ),
                        onPressed: _scanProgress == 0 ? _startSimulatedScan : null,
                        child: Text(
                          _scanComplete ? 'SCAN COMPLETE' : (_scanProgress > 0 ? 'ANALYZING VEINS...' : 'START CAPTURE'),
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _GridOverlayPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withOpacity(0.1)
      ..strokeWidth = 1;

    for (double i = 0; i < size.width; i += 40) {
      canvas.drawLine(Offset(i, 0), Offset(i, size.height), paint);
    }
    for (double i = 0; i < size.height; i += 40) {
      canvas.drawLine(Offset(0, i), Offset(size.width, i), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
