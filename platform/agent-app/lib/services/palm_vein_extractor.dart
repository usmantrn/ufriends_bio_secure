import 'dart:io';
import 'dart:math';
import 'package:camera/camera.dart';
import 'package:image/image.dart' as img;
import 'hand_landmark_service.dart';

// ═══════════════════════════════════════════════════════════════════════════
// Palm Vein Feature Extractor
// ─────────────────────────────────────────────────────────────────────────
// Implements the 3-layer pipeline from palm_vein_system_architecture.pdf:
//
//   Layer 1 — Image Acquisition (Hardware Abstraction)
//     • Simulated NIR: rear camera + 850nm bandpass color matrix
//     • Real NIR:      swap CameraSource.nirCamera → hardware feeds directly
//
//   Layer 2 — OpenCV-style Processing
//     • Grayscale conversion
//     • CLAHE contrast enhancement (local histogram equalisation)
//     • Gabor-like ridge filter (orientation-selective)
//     • ROI extraction (center 60% of frame)
//
//   Layer 3 — Feature Vector (256-dim)
//     • Macro-geometric index [0..63]:  8×8 grid mean intensity (coarse filter)
//     • Ridge density map   [64..127]:  8×8 grid gradient magnitude
//     • Orientation histogram[128..255]: 16 cells × 8 direction bins (HOG-like)
//
// The 298-dim vector is L2-normalised for cosine similarity matching:
//   [0..255]   = HOG texture (lighting-sensitive, vein edges when NIR used)
//   [256..297] = Geometric ratios (lighting-INDEPENDENT, stable across sessions)
// ═══════════════════════════════════════════════════════════════════════════

/// Abstraction layer: swap to CameraSource.nirCamera for real 850nm hardware
enum CameraSource { simulatedNir, nirCamera }

class PalmVeinExtractor {
  static const _framesPerScan = 5;      // average across N captures
  static const _roiScale      = 0.60;   // center 60% of frame = palm ROI
  static const _gridSize      = 8;      // 8×8 spatial grid
  static const _orientBins    = 8;      // 8 gradient orientation bins (0°–360°)
  static const _geomDims       = 42;    // Geometric ratio feature length (MediaPipe)
  static const templateDim     = 298;   // Total: HOG(256) + Geometry(42) = 298

  /// Capture [_framesPerScan] frames and return averaged 298-dim feature vector.
  /// [controller] must already be initialized.
  /// [source] selects simulated NIR vs real 850nm hardware.
  static Future<PalmVeinResult> extract(
    CameraController controller, {
    CameraSource source = CameraSource.simulatedNir,
    void Function(String stage, double progress)? onProgress,
  }) async {
    // Ensure landmark model is loaded before first scan
    await HandLandmarkService.init();

    final hogVectors  = <List<double>>[];  // 256-dim HOG per frame
    final geomVectors = <List<double>>[];  // 42-dim geometry per frame
    final qualityScores = <double>[];

    for (int f = 0; f < _framesPerScan; f++) {
      onProgress?.call('Capturing frame ${f + 1}/$_framesPerScan', f / _framesPerScan);

      // ── Acquisition ────────────────────────────────────────────────────
      final xfile = await controller.takePicture();
      final bytes = await File(xfile.path).readAsBytes();
      try { File(xfile.path).deleteSync(); } catch (_) {}

      var image = img.decodeImage(bytes);
      if (image == null) continue;

      // ── Geometric landmarks on original color image (before NIR simulation) ─
      // Run BEFORE NIR simulation because TFLite model expects RGB color input
      final colorRoi = _extractRoi(image);
      final geomFeats = await HandLandmarkService.extractGeometricFeatures(colorRoi);
      if (geomFeats != null && geomFeats.length == _geomDims) {
        geomVectors.add(geomFeats);
      }

      // ── Layer 2: Simulated 850nm bandpass ───────────────────────────────
      if (source == CameraSource.simulatedNir) {
        image = _applyNirSimulation(image);
      }

      // ── Grayscale ───────────────────────────────────────────────────────────────
      final gray = img.grayscale(image);

      // ── ROI extraction (center 60%) ────────────────────────────────────────────
      final roi = _extractRoi(gray);

      // ── CLAHE contrast enhancement ──────────────────────────────────────────────
      final enhanced = _clahe(roi, clipLimit: 3.0, tileGridSize: 8);

      // ── Gabor-like ridge filter ─────────────────────────────────────────────────
      final ridgeMap = _ridgeFilter(enhanced);

      // ── Quality gate ──────────────────────────────────────────────────────────────
      final quality = _computeQuality(ridgeMap);
      qualityScores.add(quality);
      if (quality < 0.15) continue;

      // ── HOG feature extraction (256-dim) ────────────────────────────────
      final hogVector = _extractFeatureVector(ridgeMap, enhanced);
      hogVectors.add(hogVector);
    }

    if (hogVectors.isEmpty) {
      return PalmVeinResult.failed('No valid frames captured. Check hand position.');
    }

    onProgress?.call('Computing template…', 0.9);

    // Average HOG vectors across frames
    final avgHog = _averageVectors(hogVectors);

    // Average geometric vectors (if any frames had successful landmark detection)
    final hasGeometry = geomVectors.isNotEmpty;
    final avgGeom = hasGeometry
        ? _averageVectors(geomVectors)
        : List<double>.filled(_geomDims, 0.0);

    // Concatenate: [HOG 256] + [Geometry 42] = [298-dim combined template]
    final combined = [...avgHog, ...avgGeom];

    // Zero-center the combined vector so positive/negative crease and vein variances are captured
    final mean = combined.reduce((a, b) => a + b) / combined.length;
    final centered = combined.map((v) => v - mean).toList();

    // L2-normalise for true discriminative cosine similarity
    final normVector = _l2Normalize(centered);

    final avgQuality = qualityScores.reduce((a, b) => a + b) / qualityScores.length;

    onProgress?.call('Template ready ✓', 1.0);

    return PalmVeinResult.success(
      template:     normVector,
      quality:      avgQuality,
      framesUsed:   hogVectors.length,
      geomFrames:   geomVectors.length,
      source:       source,
      hasLandmarks: hasGeometry,
    );
  }

  // ─── Layer 2: Simulated 850nm NIR bandpass ────────────────────────────────
  static img.Image _applyNirSimulation(img.Image src) {
    // PDF §1: "850nm wavelength optimal for deoxygenated haemoglobin"
    // Red channel ≈ 700–750nm response; scale it up and suppress blue.
    final out = img.Image(width: src.width, height: src.height);
    for (int y = 0; y < src.height; y++) {
      for (int x = 0; x < src.width; x++) {
        final px = src.getPixel(x, y);
        final r = (px.r.toDouble() * 1.4).clamp(0, 255).toInt();
        final g = (px.g.toDouble() * 0.9).clamp(0, 255).toInt();
        final b = (px.b.toDouble() * 0.4).clamp(0, 255).toInt();
        out.setPixelRgb(x, y, r, g, b);
      }
    }
    return out;
  }

  // ─── ROI: center 60% crop ────────────────────────────────────────────────
  static img.Image _extractRoi(img.Image src) {
    const margin = (1.0 - _roiScale) / 2;
    final x = (src.width  * margin).toInt();
    final y = (src.height * margin).toInt();
    final w = (src.width  * _roiScale).toInt();
    final h = (src.height * _roiScale).toInt();
    return img.copyCrop(src, x: x, y: y, width: w, height: h);
  }

  // ─── CLAHE: Contrast Limited Adaptive Histogram Equalisation ─────────────
  // PDF §2: "mitigation of surface glare" — CLAHE suppresses over-bright spots
  static img.Image _clahe(img.Image gray, {double clipLimit = 3.0, int tileGridSize = 8}) {
    final W = gray.width;
    final H = gray.height;
    final out = img.Image(width: W, height: H);
    final tW = (W / tileGridSize).ceil();
    final tH = (H / tileGridSize).ceil();

    for (int ty = 0; ty < tileGridSize; ty++) {
      for (int tx = 0; tx < tileGridSize; tx++) {
        final x0 = tx * tW;
        final y0 = ty * tH;
        final x1 = min(x0 + tW, W);
        final y1 = min(y0 + tH, H);

        // Build local histogram
        final hist = List<int>.filled(256, 0);
        for (int y = y0; y < y1; y++) {
          for (int x = x0; x < x1; x++) {
            hist[gray.getPixel(x, y).r.toInt()]++;
          }
        }

        // Clip and redistribute
        final pixCount = (x1 - x0) * (y1 - y0);
        final clip = (clipLimit * pixCount / 256).toInt().clamp(1, pixCount);
        int excess = 0;
        for (int i = 0; i < 256; i++) {
          if (hist[i] > clip) { excess += hist[i] - clip; hist[i] = clip; }
        }
        final bonus = excess ~/ 256;
        for (int i = 0; i < 256; i++) { hist[i] += bonus; }

        // Build CDF → LUT
        final cdf = List<int>.filled(256, 0);
        cdf[0] = hist[0];
        for (int i = 1; i < 256; i++) { cdf[i] = cdf[i - 1] + hist[i]; }
        final cdfMin = cdf.firstWhere((v) => v > 0);
        final lut = List<int>.generate(256, (i) =>
            ((cdf[i] - cdfMin) * 255 / (pixCount - cdfMin)).round().clamp(0, 255));

        // Apply LUT to tile
        for (int y = y0; y < y1; y++) {
          for (int x = x0; x < x1; x++) {
            final v = lut[gray.getPixel(x, y).r.toInt()];
            out.setPixelRgb(x, y, v, v, v);
          }
        }
      }
    }
    return out;
  }

  // ─── Gabor-like ridge filter ─────────────────────────────────────────────
  // Enhances the vein-ridge pattern by emphasising oriented edges.
  // Simplified 3×3 Sobel in 4 directions → max response = ridge map.
  static img.Image _ridgeFilter(img.Image gray) {
    final W = gray.width;
    final H = gray.height;
    final out = img.Image(width: W, height: H);

    // Sobel kernels: horizontal, vertical, diagonal×2
    const kernels = [
      [[-1,0,1],[-2,0,2],[-1,0,1]],   // Gx
      [[-1,-2,-1],[0,0,0],[1,2,1]],    // Gy
      [[-2,-1,0],[-1,0,1],[0,1,2]],    // G45
      [[0,1,2],[-1,0,1],[-2,-1,0]],   // G135
    ];

    for (int y = 1; y < H - 1; y++) {
      for (int x = 1; x < W - 1; x++) {
        double maxResp = 0;
        for (final k in kernels) {
          double resp = 0;
          for (int ky = 0; ky < 3; ky++) {
            for (int kx = 0; kx < 3; kx++) {
              final px = gray.getPixel(x + kx - 1, y + ky - 1);
              resp += px.r.toDouble() * k[ky][kx];
            }
          }
          maxResp = max(maxResp, resp.abs());
        }
        final v = maxResp.clamp(0, 255).toInt();
        out.setPixelRgb(x, y, v, v, v);
      }
    }
    return out;
  }

  // ─── Quality score: variance of ridge map (0=blank, 1=rich veins) ────────
  static double _computeQuality(img.Image ridgeMap) {
    double sum = 0, sum2 = 0;
    int count = 0;
    for (int y = 0; y < ridgeMap.height; y++) {
      for (int x = 0; x < ridgeMap.width; x++) {
        final v = ridgeMap.getPixel(x, y).r.toDouble();
        sum += v; sum2 += v * v; count++;
      }
    }
    final mean = sum / count;
    final variance = (sum2 / count) - mean * mean;
    // Normalise: max expected variance ~3000
    return (variance / 3000.0).clamp(0.0, 1.0);
  }

  // ─── Layer 3: 256-dim feature vector ─────────────────────────────────────
  // [0..63]:   Macro-geometric index — 8×8 grid mean intensity (coarse filter)
  // [64..127]: Ridge density map     — 8×8 grid gradient magnitude
  // [128..255]: HOG-like orientation  — 16 cells × 8 bins
  static List<double> _extractFeatureVector(img.Image ridgeMap, img.Image gray) {
    final W = ridgeMap.width;
    final H = ridgeMap.height;
    final vector = List<double>.filled(256, 0.0);

    // ── Part A: 8×8 Macro-geometric index [0..63] ─────────────────────────
    final cellW = W / _gridSize;
    final cellH = H / _gridSize;
    for (int gy = 0; gy < _gridSize; gy++) {
      for (int gx = 0; gx < _gridSize; gx++) {
        double sum = 0;
        final x0 = (gx * cellW).toInt();
        final y0 = (gy * cellH).toInt();
        final x1 = ((gx + 1) * cellW).toInt().clamp(0, W);
        final y1 = ((gy + 1) * cellH).toInt().clamp(0, H);
        for (int y = y0; y < y1; y++) {
          for (int x = x0; x < x1; x++) {
            sum += gray.getPixel(x, y).r.toDouble();
          }
        }
        final pixCount = (x1 - x0) * (y1 - y0);
        vector[gy * _gridSize + gx] = pixCount > 0 ? sum / (pixCount * 255.0) : 0.0;
      }
    }

    // ── Part B: Ridge density [64..127] ───────────────────────────────────
    for (int gy = 0; gy < _gridSize; gy++) {
      for (int gx = 0; gx < _gridSize; gx++) {
        double sum = 0;
        final x0 = (gx * cellW).toInt();
        final y0 = (gy * cellH).toInt();
        final x1 = ((gx + 1) * cellW).toInt().clamp(0, W);
        final y1 = ((gy + 1) * cellH).toInt().clamp(0, H);
        for (int y = y0; y < y1; y++) {
          for (int x = x0; x < x1; x++) {
            sum += ridgeMap.getPixel(x, y).r.toDouble();
          }
        }
        final pixCount = (x1 - x0) * (y1 - y0);
        vector[64 + gy * _gridSize + gx] = pixCount > 0 ? sum / (pixCount * 255.0) : 0.0;
      }
    }

    // ── Part C: HOG orientation histogram [128..255] ──────────────────────
    // Divide into 4×4 macro-cells (16 total), each with 8 orientation bins
    const hogCells = 4;
    final hogCellW = W / hogCells;
    final hogCellH = H / hogCells;

    for (int cy = 0; cy < hogCells; cy++) {
      for (int cx = 0; cx < hogCells; cx++) {
        final bins = List<double>.filled(_orientBins, 0.0);

        for (int y = (cy * hogCellH).toInt() + 1;
             y < ((cy + 1) * hogCellH).toInt() - 1 && y < H - 1; y++) {
          for (int x = (cx * hogCellW).toInt() + 1;
               x < ((cx + 1) * hogCellW).toInt() - 1 && x < W - 1; x++) {
            final gx2 = gray.getPixel(x + 1, y).r.toDouble() -
                        gray.getPixel(x - 1, y).r.toDouble();
            final gy2 = gray.getPixel(x, y + 1).r.toDouble() -
                        gray.getPixel(x, y - 1).r.toDouble();
            final mag = sqrt(gx2 * gx2 + gy2 * gy2);
            if (mag < 5) continue;
            final angle = (atan2(gy2, gx2) + pi) / (2 * pi);
            final bin = (angle * _orientBins).toInt().clamp(0, _orientBins - 1);
            bins[bin] += mag;
          }
        }

        // L1-normalise this cell's histogram
        final total = bins.reduce((a, b) => a + b);
        final cellIdx = 128 + (cy * hogCells + cx) * _orientBins;
        for (int b = 0; b < _orientBins; b++) {
          vector[cellIdx + b] = total > 0 ? bins[b] / total : 0.0;
        }
      }
    }

    return vector;
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  static List<double> _averageVectors(List<List<double>> vecs) {
    final len = vecs.first.length;
    final avg = List<double>.filled(len, 0.0);
    for (final v in vecs) {
      for (int i = 0; i < len; i++) { avg[i] += v[i] / vecs.length; }
    }
    return avg;
  }

  static List<double> _l2Normalize(List<double> v) {
    final norm = sqrt(v.map((x) => x * x).reduce((a, b) => a + b));
    if (norm < 1e-9) return v;
    return v.map((x) => x / norm).toList();
  }

  /// Cosine similarity between two L2-normalised vectors (dot product)
  static double cosineSimilarity(List<double> a, List<double> b) {
    assert(a.length == b.length);
    double dot = 0;
    for (int i = 0; i < a.length; i++) { dot += a[i] * b[i]; }
    return dot.clamp(-1.0, 1.0);
  }
}

// ─── Result model ──────────────────────────────────────────────────────────

class PalmVeinResult {
  final bool success;
  final List<double>? template;  // 298-dim L2-normalised: [HOG 256] + [Geometry 42]
  final double quality;           // 0.0–1.0 (based on ridge map variance)
  final int framesUsed;           // HOG frames captured
  final int geomFrames;           // Frames with successful landmark detection
  final bool hasLandmarks;        // Whether geometric ratios are in template
  final CameraSource? source;
  final String? errorMessage;

  const PalmVeinResult._({
    required this.success,
    this.template,
    this.quality       = 0,
    this.framesUsed    = 0,
    this.geomFrames    = 0,
    this.hasLandmarks  = false,
    this.source,
    this.errorMessage,
  });

  factory PalmVeinResult.success({
    required List<double> template,
    required double quality,
    required int framesUsed,
    required int geomFrames,
    required bool hasLandmarks,
    required CameraSource source,
  }) => PalmVeinResult._(
    success:      true,
    template:     template,
    quality:      quality,
    framesUsed:   framesUsed,
    geomFrames:   geomFrames,
    hasLandmarks: hasLandmarks,
    source:       source,
  );

  factory PalmVeinResult.failed(String msg) =>
      PalmVeinResult._(success: false, errorMessage: msg);

  String get qualityLabel {
    if (quality > 0.65) return 'Excellent';
    if (quality > 0.40) return 'Good';
    if (quality > 0.20) return 'Fair';
    return 'Poor';
  }

  /// Describe what the template contains for debug/UI display
  String get templateDescription {
    if (!success) return 'Failed';
    final geomStr = hasLandmarks
        ? '+ $geomFrames-frame geometry'
        : '(HOG only — no hand detected)';
    return '$framesUsed-frame HOG $geomStr → 298-dim';
  }
}
