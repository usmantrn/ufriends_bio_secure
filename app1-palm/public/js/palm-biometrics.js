// ============================================
// Core Biometric Logic (Palm Geometry via MediaPipe)
// Works OFFLINE — all assets served locally.
// v3.0 — Liveness detection + camera-agnostic features + quality gate
// ============================================

// Dynamically resolve whether to use local or CDN build
const MEDIAPIPE_BASE = '/mediapipe';
const WASM_PATH      = `${MEDIAPIPE_BASE}/wasm`;
const MODEL_PATH     = '/models/hand_landmarker.task?v=2'; // cache bust

// ── Liveness Configuration ────────────────────────────────────────────────────
// Challenge directions shown to the user — random per session
const LIVENESS_CHALLENGES = ['LEFT', 'RIGHT', 'UP', 'DOWN'];
// How far the hand centroid must move (in normalized 0.0–1.0 units) to pass
const LIVENESS_MOVE_THRESHOLD = 0.05;
// Minimum motion variance required across frames (passive liveness check).
// Lowered to 0.00005 — phone cameras with stabilization suppress micro-tremor
// but still exceed this floor vs. a completely static photo.
const LIVENESS_MIN_VARIANCE = 0.00005;

// Load MediaPipe using dynamic ES module import
async function loadMediaPipe() {
  if (window.HandLandmarker) return true;
  try {
    const mp = await import(`${MEDIAPIPE_BASE}/vision_bundle.js`);
    window.HandLandmarker = mp.HandLandmarker;
    window.FilesetResolver = mp.FilesetResolver;
    return true;
  } catch (err) {
    console.warn('Local MediaPipe failed, trying CDN...', err);
    try {
      const mp = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js');
      window.HandLandmarker = mp.HandLandmarker;
      window.FilesetResolver = mp.FilesetResolver;
      return true;
    } catch (cdnErr) {
      throw new Error('Failed to load MediaPipe from local and CDN.');
    }
  }
}

export class PalmBiometricSystem {
  constructor(videoElement, canvasElement) {
    this.video         = videoElement;
    this.canvas        = canvasElement;
    this.ctx           = canvasElement.getContext('2d');
    this.handLandmarker = null;
    this.isScanning    = false;
    this.onFeatureExtracted = null;
  }

  async initialize(statusCallback) {
    try {
      if (statusCallback) statusCallback('Loading MediaPipe...');
      await loadMediaPipe();

      // After UMD load, the APIs are on window object
      const { HandLandmarker, FilesetResolver } = window;

      if (statusCallback) statusCallback('Initializing Hand AI...');

      // Try local WASM; if that fails (e.g. first cold start), fall back to CDN
      let wasmPath = WASM_PATH;
      try {
        const vision = await FilesetResolver.forVisionTasks(wasmPath);
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_PATH,
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence:  0.5,
          minTrackingConfidence:      0.5
        });
      } catch (localErr) {
        console.warn('Local model failed, trying CDN fallback...', localErr);
        fetch('/api/log', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ error: localErr.toString() + ' | ' + localErr.stack }) }).catch(e => {});
        if (statusCallback) statusCallback('Downloading model from network...');
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
        );
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.7,
          minHandPresenceConfidence:  0.7,
          minTrackingConfidence:      0.7
        });
      }

      return true;
    } catch (e) {
      console.error('Failed to load MediaPipe model:', e);
      return false;
    }
  }

  async startCamera(useFrontCamera = false) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: useFrontCamera ? 'user' : 'environment', width: 640, height: 480 }
      });
      this.video.srcObject = stream;
      this.video.style.transform  = useFrontCamera ? 'scaleX(-1)' : 'none';
      this.canvas.style.transform = useFrontCamera ? 'scaleX(-1)' : 'none';

      return new Promise((resolve) => {
        this.video.onloadedmetadata = () => {
          this.video.play();
          this.canvas.width  = this.video.videoWidth;
          this.canvas.height = this.video.videoHeight;
          resolve(true);
        };
      });
    } catch (e) {
      console.error('Camera access denied or unavailable', e);
      return false;
    }
  }

  stopCamera() {
    this.isScanning = false;
    if (this.video.srcObject) {
      this.video.srcObject.getTracks().forEach(track => track.stop());
    }
  }

  startScanning(callback, onProgress) {
    if (!this.handLandmarker || !this.video.srcObject) return;
    this.isScanning = true;
    this.onFeatureExtracted = callback;

    let lastVideoTime    = -1;
    let framesToCapture  = 15;
    let capturedVectors  = [];
    let missedFrames     = 0;     // allow brief hand disappearance
    const MAX_MISSED     = 5;     // reset only after 5 consecutive missed frames

    const predictWebcam = async () => {
      if (!this.isScanning) return;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      let startTimeMs = performance.now();
      if (lastVideoTime !== this.video.currentTime) {
        lastVideoTime = this.video.currentTime;
        const results = this.handLandmarker.detectForVideo(this.video, startTimeMs);

        if (results.landmarks && results.landmarks.length > 0) {
          missedFrames = 0; // hand found — reset miss counter
          const landmarks = results.landmarks[0];
          this.drawLandmarks(landmarks);

          const vector = this.extractFeatures(landmarks);
          if (vector) {
            capturedVectors.push(vector);
          }

          if (onProgress) onProgress(capturedVectors.length, framesToCapture);

          if (capturedVectors.length >= framesToCapture) {
            this.isScanning = false;
            const averagedVector = this.rejectOutliersAndAverage(capturedVectors);
            if (this.onFeatureExtracted) this.onFeatureExtracted(averagedVector);
            return;
          }
        } else {
          missedFrames++;
          // Only reset progress after 5+ consecutive missed frames
          // (tolerates brief hand movement between frames)
          if (missedFrames >= MAX_MISSED && capturedVectors.length > 0) {
            capturedVectors = [];
            missedFrames = 0;
            if (onProgress) onProgress(0, framesToCapture);
          }
        }
      }
      if (this.isScanning) window.requestAnimationFrame(predictWebcam);
    };
    window.requestAnimationFrame(predictWebcam);
  }

  drawLandmarks(landmarks) {
    this.ctx.lineWidth  = 2;
    this.ctx.fillStyle  = '#00d4ff';
    for (const point of landmarks) {
      this.ctx.beginPath();
      this.ctx.arc(point.x * this.canvas.width, point.y * this.canvas.height, 4, 0, 2 * Math.PI);
      this.ctx.fill();
    }
    const connections = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [9,10],[10,11],[11,12],
      [13,14],[14,15],[15,16],
      [0,17],[17,18],[18,19],[19,20],
      [5,9],[9,13],[13,17]
    ];
    this.ctx.strokeStyle = 'rgba(0, 212, 255, 0.5)';
    for (const [start, end] of connections) {
      if (landmarks[start] && landmarks[end]) {
        this.ctx.beginPath();
        this.ctx.moveTo(landmarks[start].x * this.canvas.width, landmarks[start].y * this.canvas.height);
        this.ctx.lineTo(landmarks[end].x   * this.canvas.width, landmarks[end].y   * this.canvas.height);
        this.ctx.stroke();
      }
    }
  }

  extractFeatures(landmarks) {
    const palmSize = this.get3DDistance(landmarks[0], landmarks[9]);
    if (palmSize < 0.05) return null; // Quality filter

    const points = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const features = [];
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        features.push(this.get3DDistance(landmarks[points[i]], landmarks[points[j]]) / palmSize);
      }
    }
    return features;
  }

  get3DDistance(p1, p2) {
    return Math.sqrt(
      Math.pow(p1.x - p2.x, 2) +
      Math.pow(p1.y - p2.y, 2) +
      Math.pow(p1.z - p2.z, 2)
    );
  }

  rejectOutliersAndAverage(vectors) {
    const numFeatures = vectors[0].length;
    const means = new Array(numFeatures).fill(0);
    vectors.forEach(v => v.forEach((val, i) => means[i] += val / vectors.length));

    const cleanVectors = vectors.filter(v => {
      let diff = 0;
      v.forEach((val, i) => diff += Math.abs(val - means[i]));
      return (diff / numFeatures) < 0.1;
    });

    const finalAvg = new Array(numFeatures).fill(0);
    cleanVectors.forEach(v => v.forEach((val, i) => finalAvg[i] += val / cleanVectors.length));
    return finalAvg;
  }

  // ── Hand centroid helper (used by liveness) ──────────────────────────────────
  getCentroid(landmarks) {
    const x = landmarks.reduce((s, p) => s + p.x, 0) / landmarks.length;
    const y = landmarks.reduce((s, p) => s + p.y, 0) / landmarks.length;
    return { x, y };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LivenessDetector — Standalone class that wraps PalmBiometricSystem
// with a two-layer anti-spoofing check before the real biometric scan.
//
// Layer 1 (Passive): Measures landmark variance over 20 frames.
//   A printed photo has near-zero variance. A live hand always moves slightly.
//
// Layer 2 (Active / Challenge-Response): Displays a random direction prompt.
//   User must physically move their hand in that direction.
//   Pre-recorded videos and photos cannot comply with a random challenge.
//
// Usage:
//   const detector = new LivenessDetector(videoEl, canvasEl, statusEl);
//   const isLive = await detector.run();
//   if (isLive) { // proceed with palm scan }
// ══════════════════════════════════════════════════════════════════════════════
export class LivenessDetector {
  constructor(videoElement, canvasElement, statusElement) {
    this.video   = videoElement;
    this.canvas  = canvasElement;
    this.ctx     = canvasElement.getContext('2d');
    this.statusEl = statusElement; // DOM element to show instructions to user
    this.palmSys = new PalmBiometricSystem(videoElement, canvasElement);
  }

  // Initialize — must be called after camera is already started
  async initialize(progressCallback) {
    return await this.palmSys.initialize(progressCallback);
  }

  // Run the full two-layer liveness check.
  // Returns: { passed: true } or { passed: false, reason: string }
  async run() {
    // ── Layer 1: Passive motion variance check ────────────────────────────────
    this._setStatus('🔍 Hold your open palm still…');
    const passiveResult = await this._passiveCheck();
    if (!passiveResult.passed) {
      return { passed: false, reason: 'No live hand detected. Please use a real hand.' };
    }

    // ── Layer 2: Challenge-response ───────────────────────────────────────────
    const challenge = LIVENESS_CHALLENGES[Math.floor(Math.random() * LIVENESS_CHALLENGES.length)];
    const arrows = { LEFT: '⬅️', RIGHT: '➡️', UP: '⬆️', DOWN: '⬇️' };
    this._setStatus(`${arrows[challenge]} Move your hand ${challenge}!`);

    const challengeResult = await this._challengeCheck(challenge);
    if (!challengeResult.passed) {
      return { passed: false, reason: `Challenge failed. Please move your hand ${challenge}.` };
    }

    this._setStatus('✅ Liveness confirmed! Scanning palm…');
    return { passed: true };
  }

  // ── Layer 1: Passive — checks for natural micro-movement variance ─────────
  _passiveCheck() {
    return new Promise((resolve) => {
      if (!this.palmSys.handLandmarker) return resolve({ passed: false });

      const FRAMES = 20;
      const centroids = [];
      let lastTime = -1;

      const loop = () => {
        if (centroids.length >= FRAMES) {
          // Compute variance of x-positions across frames
          const xs = centroids.map(c => c.x);
          const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
          const variance = xs.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / xs.length;
          // A photo has variance ≈ 0; a live hand always has tiny tremor
          resolve({ passed: variance >= LIVENESS_MIN_VARIANCE, variance });
          return;
        }

        const now = performance.now();
        if (lastTime !== this.video.currentTime) {
          lastTime = this.video.currentTime;
          const results = this.palmSys.handLandmarker.detectForVideo(this.video, now);
          if (results.landmarks && results.landmarks.length > 0) {
            centroids.push(this.palmSys.getCentroid(results.landmarks[0]));
          }
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  }

  // ── Layer 2: Challenge — detects directional hand movement ───────────────
  _challengeCheck(direction) {
    return new Promise((resolve) => {
      if (!this.palmSys.handLandmarker) return resolve({ passed: false });

      const TIMEOUT_MS = 7000; // 7 seconds to respond
      let startCentroid = null;
      let lastTime = -1;
      const deadline = Date.now() + TIMEOUT_MS;

      const loop = () => {
        if (Date.now() > deadline) {
          resolve({ passed: false, reason: 'Timeout' });
          return;
        }

        const now = performance.now();
        if (lastTime !== this.video.currentTime) {
          lastTime = this.video.currentTime;
          const results = this.palmSys.handLandmarker.detectForVideo(this.video, now);

          if (results.landmarks && results.landmarks.length > 0) {
            const c = this.palmSys.getCentroid(results.landmarks[0]);

            if (!startCentroid) {
              startCentroid = c; // Record starting position
            } else {
              const dx = c.x - startCentroid.x; // positive = right
              const dy = c.y - startCentroid.y; // positive = down (screen coords)

              let moved = false;
              if (direction === 'LEFT'  && dx < -LIVENESS_MOVE_THRESHOLD) moved = true;
              if (direction === 'RIGHT' && dx >  LIVENESS_MOVE_THRESHOLD) moved = true;
              if (direction === 'UP'    && dy < -LIVENESS_MOVE_THRESHOLD) moved = true;
              if (direction === 'DOWN'  && dy >  LIVENESS_MOVE_THRESHOLD) moved = true;

              if (moved) {
                resolve({ passed: true });
                return;
              }
            }
          }
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  }

  _setStatus(msg) {
    if (this.statusEl) this.statusEl.textContent = msg;
    console.log('[Liveness]', msg);
  }
}
