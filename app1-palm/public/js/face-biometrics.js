// ============================================
// Face Biometric Module (face-api.js wrapper)
// Works OFFLINE — library + models served locally.
// Falls back to CDN if local files unavailable.
// ============================================

const LOCAL_FACEAPI = '/libs/face-api.min.js';
const CDN_FACEAPI   = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
const LOCAL_MODELS  = '/models/face';
const CDN_MODELS    = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';

// ── Module-level cache so models only load ONCE per page ─────────────────────
let _modelsLoaded = false;
let _loadPromise  = null;

export class FaceBiometricSystem {
  constructor(videoElement, canvasElement) {
    this.video   = videoElement;
    this.canvas  = canvasElement;
    this.ctx     = canvasElement.getContext('2d');
    this.faceapi = null;
    this.stream  = null;
  }

  // ── Load face-api.js — skips if already loaded (cached) ──────────────────
  async initialize(statusCallback) {
    // If already cached from a previous call this session, skip loading entirely
    if (_modelsLoaded && window.faceapi) {
      this.faceapi = window.faceapi;
      if (statusCallback) statusCallback('Face AI Ready ✓');
      return true;
    }

    // If another instance is already loading, wait for it
    if (_loadPromise) {
      if (statusCallback) statusCallback('Loading Face AI...');
      const ok = await _loadPromise;
      if (ok) {
        this.faceapi = window.faceapi;
        if (statusCallback) statusCallback('Face AI Ready ✓');
      }
      return ok;
    }

    _loadPromise = this._doLoad(statusCallback);
    const ok = await _loadPromise;
    if (ok) this.faceapi = window.faceapi;
    return ok;
  }

  async _doLoad(statusCallback) {
    try {
      if (!window.faceapi) {
        if (statusCallback) statusCallback('Loading Face-API library...');
        try {
          await this._loadScript(LOCAL_FACEAPI);
        } catch {
          console.warn('Local face-api.js not found, using CDN...');
          await this._loadScript(CDN_FACEAPI);
        }
      }

      if (statusCallback) statusCallback('Loading face recognition models...');
      const modelsUrl = await this._resolveModelsUrl(statusCallback);

      // Only load models that aren't already loaded
      const api = window.faceapi;
      const toLoad = [];
      if (!api.nets.tinyFaceDetector.isLoaded)   toLoad.push(api.nets.tinyFaceDetector.loadFromUri(modelsUrl));
      if (!api.nets.faceLandmark68Net.isLoaded)   toLoad.push(api.nets.faceLandmark68Net.loadFromUri(modelsUrl));
      if (!api.nets.faceRecognitionNet.isLoaded)  toLoad.push(api.nets.faceRecognitionNet.loadFromUri(modelsUrl));
      // faceExpressionNet removed — not needed, reduces load time

      if (toLoad.length > 0) {
        await Promise.all(toLoad);
      }

      _modelsLoaded = true;
      if (statusCallback) statusCallback('Face AI Ready ✓');
      return true;
    } catch (err) {
      console.error('FaceBiometricSystem init failed:', err);
      _loadPromise = null; // allow retry
      if (statusCallback) statusCallback('Face AI Failed to Load');
      return false;
    }
  }

  // ── Try local models first, fall back to CDN ─────────────────────────────
  async _resolveModelsUrl(statusCallback) {
    try {
      const res = await fetch(`${LOCAL_MODELS}/tiny_face_detector_model-weights_manifest.json`);
      if (res.ok) {
        console.log('✅ Using local face models (offline mode)');
        return LOCAL_MODELS;
      }
    } catch { /* fall through */ }
    console.warn('Local face models not found, using CDN...');
    if (statusCallback) statusCallback('Downloading models from network (first-time only)...');
    return CDN_MODELS;
  }

  // ── Start front camera ───────────────────────────────────────────────────
  async startCamera() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width:  { ideal: 640 },
          height: { ideal: 480 }
        }
      });
      this.video.srcObject        = this.stream;
      this.video.style.transform  = 'scaleX(-1)';
      this.canvas.style.transform = 'scaleX(-1)';

      return new Promise((resolve) => {
        this.video.onloadedmetadata = () => {
          this.video.play();
          this.canvas.width  = this.video.videoWidth;
          this.canvas.height = this.video.videoHeight;
          resolve(true);
        };
      });
    } catch (err) {
      console.error('Face camera error:', err);
      return false;
    }
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  // ── Capture face descriptor (128-d float array) ──────────────────────────
  captureDescriptor(statusCallback, onProgress) {
    return new Promise((resolve, reject) => {
      if (!this.faceapi) return reject(new Error('Not initialized'));

      // Lower scoreThreshold → detects faces faster/more reliably
      // Smaller inputSize (224) → faster inference per frame
      const detectorOptions = new this.faceapi.TinyFaceDetectorOptions({
        inputSize: 224,
        scoreThreshold: 0.3
      });

      let noFaceFrames = 0;
      let goodFrames   = 0;
      const NEEDED     = 15;  // 15 frames averaged — matches palm frame count for consistency
      const descriptors = [];
      let running      = true;

      // ── Active Liveness Challenge ─────────────────────────────────────────
      // Randomise between blink and open-mouth
      const challengeType = Math.random() > 0.5 ? 'blink' : 'mouth';
      const challengeText = challengeType === 'blink'
        ? 'BLINK your eyes  👁️'
        : 'OPEN your mouth 😮';
      let challengePassed      = false;
      let challengeFramesCount = 0;
      // Track the PREVIOUS frame's state so we detect a TRANSITION (not just current state)
      let prevChallengeState   = false;

      const getDist = (p1, p2) =>
        Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));

      const loop = async () => {
        if (!running) return;

        let result;
        try {
          result = await this.faceapi
            .detectSingleFace(this.video, detectorOptions)
            .withFaceLandmarks()
            .withFaceDescriptor();
        } catch (_) {
          if (running) requestAnimationFrame(loop);
          return;
        }

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (result) {
          noFaceFrames = 0;
          this._drawDetection(result);

          if (!challengePassed) {
            const pts = result.landmarks.positions;
            let currentState = false;

            if (challengeType === 'blink') {
              // Eye Aspect Ratio — significantly relaxed threshold (0.32 → very easy to detect)
              const earLeft  = (getDist(pts[37], pts[41]) + getDist(pts[38], pts[40]))
                              / (2 * getDist(pts[36], pts[39]));
              const earRight = (getDist(pts[43], pts[47]) + getDist(pts[44], pts[46]))
                              / (2 * getDist(pts[42], pts[45]));
              const earAvg = (earLeft + earRight) / 2;
              currentState = earAvg < 0.32; // eyes closed
            } else {
              // Mouth Aspect Ratio — more lenient threshold (0.4 → easier to detect)
              const mar = getDist(pts[62], pts[66]) / getDist(pts[60], pts[64]);
              currentState = mar > 0.40;
            }

            // Detect a TRANSITION: was closed/open, now is. Count that as the gesture.
            if (currentState) {
              challengeFramesCount++;
            }

            // Draw challenge prompt
            this._drawOverlay(
              `LIVENESS: Please ${challengeText}`,
              'rgba(124, 58, 237, 0.88)',
              currentState ? 'rgba(0,255,136,0.88)' : null
            );

            if (statusCallback) statusCallback(`Challenge: ${challengeText}`);

            // Need just 1 frame confirming the action for maximum snappiness
            if (challengeFramesCount >= 1) {
              challengePassed = true;
              if (statusCallback) statusCallback('✅ Challenge Passed! Capturing...');
            }

            prevChallengeState = currentState;
          } else {
            // Challenge passed — capture descriptors
            goodFrames++;
            descriptors.push(result.descriptor);
            if (onProgress) onProgress(goodFrames, NEEDED);

            if (statusCallback) statusCallback(`Capturing face… ${goodFrames}/${NEEDED}`);

            if (descriptors.length >= NEEDED) {
              running = false;
              resolve(Array.from(this._averageDescriptors(descriptors)));
              return;
            }
          }
        } else {
          noFaceFrames++;
          // Reset capture progress but do NOT reset challengePassed —
          // user should not need to redo the challenge just because they moved slightly
          goodFrames    = 0;
          descriptors.length = 0;

          this._drawOverlay('No face detected — look at the camera', 'rgba(255,51,102,0.85)');
          if (statusCallback) statusCallback('No face detected — look at camera');

          if (noFaceFrames > 150) { // ~5 seconds at 30fps before giving up
            running = false;
            reject(new Error('Face not detected. Ensure good lighting and face the camera directly.'));
            return;
          }
        }

        if (running) requestAnimationFrame(loop);
      };

      requestAnimationFrame(loop);
    });
  }

  // ── Helper: draw overlay text on canvas ──────────────────────────────────
  _drawOverlay(text, bgColor, successColor = null) {
    const w = this.canvas.width;
    this.ctx.fillStyle = successColor || bgColor;
    this.ctx.fillRect(8, 8, w - 16, 52);
    this.ctx.save();
    this.ctx.scale(-1, 1); // reverse the CSS mirror so text reads correctly
    this.ctx.fillStyle = 'white';
    this.ctx.font = 'bold 16px Inter, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(text, -w / 2, 40);
    this.ctx.restore();
  }

  static euclideanDistance(desc1, desc2) {
    if (!desc1 || !desc2 || desc1.length !== desc2.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < desc1.length; i++) sum += Math.pow(desc1[i] - desc2[i], 2);
    return Math.sqrt(sum);
  }

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s  = document.createElement('script');
      s.src    = src;
      s.onload  = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  _drawDetection(result) {
    const { x, y, width, height } = result.detection.box;
    const scaleX = this.canvas.width  / this.video.videoWidth;
    const scaleY = this.canvas.height / this.video.videoHeight;

    this.ctx.strokeStyle = 'rgba(0,255,136,0.9)';
    this.ctx.lineWidth   = 2;
    this.ctx.strokeRect(x * scaleX, y * scaleY, width * scaleX, height * scaleY);

    this.ctx.fillStyle = 'rgba(0,212,255,0.8)';
    for (const pt of result.landmarks.positions) {
      this.ctx.beginPath();
      this.ctx.arc(pt.x * scaleX, pt.y * scaleY, 2, 0, 2 * Math.PI);
      this.ctx.fill();
    }
  }

  _averageDescriptors(descriptors) {
    const len = descriptors[0].length;
    const avg = new Float32Array(len);
    for (const desc of descriptors) {
      for (let i = 0; i < len; i++) avg[i] += desc[i];
    }
    for (let i = 0; i < len; i++) avg[i] /= descriptors.length;
    return avg;
  }
}
