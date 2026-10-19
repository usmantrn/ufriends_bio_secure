import 'dart:math';
import 'package:image/image.dart' as img;
import 'package:tflite_flutter/tflite_flutter.dart';

// ═══════════════════════════════════════════════════════════════════════════
// Hand Landmark Service — TFLite 0.10.4 (patched for Dart 3.x + JVM-17)
// ─────────────────────────────────────────────────────────────────────────
// Runs Google's MediaPipe hand_landmark_lite.tflite model to detect
// 21 hand keypoints, then extracts 42 lighting-independent geometric
// ratio features for stable cross-session palm authentication.
//
// API changes in tflite_flutter 0.12.x vs 0.10.x:
//   • Interpreter.fromAsset() still works the same
//   • Input tensor is set via interpreter.input/outputTensors[n]
//   • Data is passed as typed List (no more ByteBuffer wrapping needed)
//   • Output is read directly as nested List
//
// Model I/O (hand_landmark_lite.tflite):
//   Input:    [1, 224, 224, 3] float32 — normalised RGB [0, 1]
//   Output 0: [1, 63]          float32 — 21 × (x, y, z) in [0, 1] space
//   Output 1: [1, 1]           float32 — presence score
//
// MediaPipe keypoint indices:
//   0=WRIST  1-4=THUMB  5-8=INDEX  9-12=MIDDLE  13-16=RING  17-20=PINKY
// ═══════════════════════════════════════════════════════════════════════════

class HandLandmarkService {
  static const _modelPath    = 'assets/models/hand_landmark.tflite';
  static const _inputSize    = 224;
  static const _numKeypoints = 21;
  static const _expectedDims = 42;

  static Interpreter? _interpreter;

  // ─── Load model once (call before first scan) ────────────────────────────
  static Future<void> init() async {
    if (_interpreter != null) return;
    try {
      final options = InterpreterOptions()..threads = 2;
      _interpreter = await Interpreter.fromAsset(_modelPath, options: options);
      _interpreter!.allocateTensors();
    } catch (e) {
      // Graceful degradation — PalmVeinExtractor falls back to HOG-only
      _interpreter = null;
    }
  }

  static bool get isAvailable => _interpreter != null;

  static void dispose() {
    _interpreter?.close();
    _interpreter = null;
  }

  // ─── Run hand landmark detection ─────────────────────────────────────────
  /// Returns 42 geometric ratio features, or null if detection fails.
  static Future<List<double>?> extractGeometricFeatures(img.Image palmImage) async {
    if (_interpreter == null) return null;

    try {
      // 1. Preprocess: resize to 224×224, convert to float32 [0,1]
      final resized = img.copyResize(palmImage,
          width: _inputSize, height: _inputSize,
          interpolation: img.Interpolation.linear);

      final input = _imageToInput(resized);

      // 2. Prepare outputs using tflite_flutter 0.12.x API
      //    Output 0: [1, 63] = 21 landmarks × (x, y, z)
      //    Output 1: [1, 1]  = hand presence score
      final outputLandmarks = List.generate(1,
          (_) => List.filled(63, 0.0));
      final outputScore = List.generate(1,
          (_) => List.filled(1, 0.0));

      final outputs = <int, Object>{
        0: outputLandmarks,
        1: outputScore,
      };

      // 3. Run inference
      _interpreter!.runForMultipleInputs([input], outputs);

      // 4. Check hand presence score (>0.5 = hand detected)
      final score = (outputScore[0][0] as double);
      if (score < 0.5) return null;

      // 5. Parse 21 (x, y) keypoints from flat [63] output
      final flat = outputLandmarks[0];
      final kps  = _parseKeypoints(flat);

      // 6. Quality gate
      if (!_qualityGate(kps)) return null;

      // 7. Extract 42 geometric ratio features
      return _extractRatios(kps);
    } catch (_) {
      return null;
    }
  }

  // ─── Preprocess: image → [1, 224, 224, 3] float32 ───────────────────────
  static List<List<List<List<double>>>> _imageToInput(img.Image src) {
    return List.generate(1,
      (_) => List.generate(_inputSize, (y) =>
        List.generate(_inputSize, (x) {
          final px = src.getPixel(x, y);
          return [
            px.r.toDouble() / 255.0,
            px.g.toDouble() / 255.0,
            px.b.toDouble() / 255.0,
          ];
        }),
      ),
    );
  }

  // ─── Parse flat [63] output → 21 (x, y) keypoints ───────────────────────
  static List<_Point> _parseKeypoints(List<double> flat) =>
      List.generate(_numKeypoints, (i) => _Point(flat[i * 3], flat[i * 3 + 1]));

  // ─── Quality gate: wrist + middle MCP must be detected ───────────────────
  static bool _qualityGate(List<_Point> kps) {
    if (kps[0].x < 0.01 && kps[0].y < 0.01) return false;
    if (kps[9].x < 0.01 && kps[9].y < 0.01) return false;
    return kps[0].distanceTo(kps[9]) > 0.05;
  }

  // ─── Extract 42 lighting-independent geometric ratio features ────────────
  //
  // All features are RATIOS — independent of camera distance and lighting.
  //
  // Layout (identical to original design):
  //   [0..4]   Finger lengths / palm diagonal        (5)
  //   [5..8]   Finger lengths / middle finger         (4)
  //   [9]      Palm width / height ratio              (1)
  //   [10..13] Knuckle MCP x-positions / palm width  (4)
  //   [14..17] Fingertip x-positions / palm width    (4)
  //   [18..21] Finger PIP heights / palm height      (4)
  //   [22..26] Proximal phalanx ratio (MCP→PIP/full) (5)
  //   [27..31] Middle phalanx ratio  (PIP→DIP/full)  (5)
  //   [32..36] Distal phalanx ratio  (DIP→TIP/full)  (5)
  //   [37..40] Inter-knuckle gaps / palm width       (4)
  //   [41]     Thumb CMC-wrist / palm height         (1)
  //   Total: 5+4+1+4+4+4+5+5+5+4+1 = 42
  static List<double> _extractRatios(List<_Point> kp) {
    final wrist = kp[0];
    final tMcp=kp[1]; final tPip=kp[2]; final tDip=kp[3]; final tTip=kp[4];
    final iMcp=kp[5]; final iPip=kp[6]; final iDip=kp[7]; final iTip=kp[8];
    final mMcp=kp[9]; final mPip=kp[10]; final mDip=kp[11]; final mTip=kp[12];
    final rMcp=kp[13]; final rPip=kp[14]; final rDip=kp[15]; final rTip=kp[16];
    final pMcp=kp[17]; final pPip=kp[18]; final pDip=kp[19]; final pTip=kp[20];

    final palmH = wrist.distanceTo(mMcp).clamp(0.001, 2.0);
    final palmW = iMcp.distanceTo(pMcp).clamp(0.001, 2.0);
    final palmD = sqrt(palmH*palmH + palmW*palmW).clamp(0.001, 3.0);

    // Finger full lengths (MCP→TIP)
    final tLen = tMcp.distanceTo(tTip);
    final iLen = iMcp.distanceTo(iTip);
    final mLen = mMcp.distanceTo(mTip).clamp(0.001, 2.0);
    final rLen = rMcp.distanceTo(rTip);
    final pLen = pMcp.distanceTo(pTip);

    final f = <double>[];

    // [0..4] Finger lengths / palm diagonal
    f.addAll([tLen/palmD, iLen/palmD, mLen/palmD, rLen/palmD, pLen/palmD]);

    // [5..8] Finger / middle finger
    f.addAll([tLen/mLen, iLen/mLen, rLen/mLen, pLen/mLen]);

    // [9] Palm aspect ratio
    f.add(palmW / palmH);

    // [10..13] Knuckle MCP x / palm width
    f.addAll([
      (iMcp.x - pMcp.x) / palmW,
      (mMcp.x - pMcp.x) / palmW,
      (rMcp.x - pMcp.x) / palmW,
      (pMcp.x - iMcp.x).abs() / palmW,
    ]);

    // [14..17] Fingertip x / palm width
    f.addAll([
      (iTip.x - pTip.x) / palmW,
      (mTip.x - pTip.x) / palmW,
      (rTip.x - pTip.x) / palmW,
      (pTip.x - iTip.x).abs() / palmW,
    ]);

    // [18..21] PIP heights / palm height
    f.addAll([
      (wrist.y - tPip.y).abs() / palmH,
      (wrist.y - iPip.y).abs() / palmH,
      (wrist.y - mPip.y).abs() / palmH,
      (wrist.y - rPip.y).abs() / palmH,
    ]);

    // [22..26] Proximal phalanx ratio (MCP→PIP / MCP→TIP)
    f.addAll([
      tMcp.distanceTo(tPip) / tLen.clamp(0.001, 2.0),
      iMcp.distanceTo(iPip) / iLen.clamp(0.001, 2.0),
      mMcp.distanceTo(mPip) / mLen,
      rMcp.distanceTo(rPip) / rLen.clamp(0.001, 2.0),
      pMcp.distanceTo(pPip) / pLen.clamp(0.001, 2.0),
    ]);

    // [27..31] Middle phalanx ratio (PIP→DIP / MCP→TIP)
    f.addAll([
      tPip.distanceTo(tDip) / tLen.clamp(0.001, 2.0),
      iPip.distanceTo(iDip) / iLen.clamp(0.001, 2.0),
      mPip.distanceTo(mDip) / mLen,
      rPip.distanceTo(rDip) / rLen.clamp(0.001, 2.0),
      pPip.distanceTo(pDip) / pLen.clamp(0.001, 2.0),
    ]);

    // [32..36] Distal phalanx ratio (DIP→TIP / MCP→TIP)
    f.addAll([
      tDip.distanceTo(tTip) / tLen.clamp(0.001, 2.0),
      iDip.distanceTo(iTip) / iLen.clamp(0.001, 2.0),
      mDip.distanceTo(mTip) / mLen,
      rDip.distanceTo(rTip) / rLen.clamp(0.001, 2.0),
      pDip.distanceTo(pTip) / pLen.clamp(0.001, 2.0),
    ]);

    // [37..40] Inter-knuckle gaps / palm width
    f.addAll([
      iMcp.distanceTo(mMcp) / palmW,
      mMcp.distanceTo(rMcp) / palmW,
      rMcp.distanceTo(pMcp) / palmW,
      iMcp.distanceTo(pMcp) / palmW,
    ]);

    // [41] Thumb CMC-wrist / palm height
    f.add(wrist.distanceTo(tMcp) / palmH);

    assert(f.length == _expectedDims,
        'Expected $_expectedDims features, got ${f.length}');

    return f;
  }
}

// ─── 2D point helper ─────────────────────────────────────────────────────────

class _Point {
  final double x, y;
  const _Point(this.x, this.y);
  double distanceTo(_Point o) {
    final dx = x - o.x, dy = y - o.y;
    return sqrt(dx*dx + dy*dy);
  }
}
