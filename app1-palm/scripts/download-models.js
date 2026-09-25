// ============================================
// scripts/download-models.js
// Run once: node scripts/download-models.js
// Downloads all AI models locally so the app
// works completely OFFLINE after first setup.
// ============================================

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const PUBLIC   = path.join(__dirname, '..', 'public');
const MODELS   = path.join(PUBLIC, 'models');
const FACE_DIR = path.join(MODELS, 'face');
const LIBS     = path.join(PUBLIC, 'libs');

// ── Create directories ─────────────────────────────────────────────────────
[MODELS, FACE_DIR, LIBS].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── Helper: download a URL to a file ──────────────────────────────────────
function download(url, dest) {
  return new Promise((resolve, reject) => {
    // Skip if already downloaded
    if (fs.existsSync(dest)) {
      const size = fs.statSync(dest).size;
      if (size > 100) {
        console.log(`  ✓ Already exists: ${path.basename(dest)} (${(size/1024).toFixed(0)} KB)`);
        return resolve();
      }
    }

    console.log(`  ↓ Downloading: ${path.basename(dest)}  ←  ${url.split('/').slice(0,4).join('/')}...`);
    const file   = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;

    const req = client.get(url, (res) => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        const size = fs.statSync(dest).size;
        console.log(`  ✅ Saved: ${path.basename(dest)} (${(size/1024).toFixed(0)} KB)`);
        resolve();
      });
    });
    req.on('error', (err) => { file.close(); fs.unlinkSync(dest); reject(err); });
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout: ' + url)); });
  });
}

async function main() {
  console.log('\n🌐 BioSecure — Offline Model Downloader');
  console.log('=========================================\n');

  // ── 1. face-api.js library ──────────────────────────────────────────────
  console.log('📦 [1/3] Downloading face-api.js library...');
  await download(
    'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js',
    path.join(LIBS, 'face-api.min.js')
  );

  // ── 2. Face recognition models ──────────────────────────────────────────
  console.log('\n🧠 [2/3] Downloading face recognition models...');
  const BASE = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';
  const faceFiles = [
    'tiny_face_detector_model-weights_manifest.json',
    'tiny_face_detector_model-shard1',
    'face_landmark_68_model-weights_manifest.json',
    'face_landmark_68_model-shard1',
    'face_recognition_model-weights_manifest.json',
    'face_recognition_model-shard1',
    'face_recognition_model-shard2',
  ];
  for (const f of faceFiles) {
    await download(`${BASE}/${f}`, path.join(FACE_DIR, f));
  }

  // ── 3. MediaPipe hand_landmarker model ──────────────────────────────────
  console.log('\n✋ [3/3] Downloading MediaPipe hand_landmarker model (~8 MB)...');
  await download(
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    path.join(MODELS, 'hand_landmarker.task')
  );

  console.log('\n✅ All models downloaded! The app is now fully offline-capable.\n');
  console.log('   ▸ face-api.js library  →  public/libs/face-api.min.js');
  console.log('   ▸ Face models          →  public/models/face/');
  console.log('   ▸ Hand model           →  public/models/hand_landmarker.task');
  console.log('\n   Run "npm start" to launch the server.\n');
}

main().catch(err => {
  console.error('\n❌ Download failed:', err.message);
  console.error('   Check your internet connection and try again.\n');
  process.exit(1);
});
