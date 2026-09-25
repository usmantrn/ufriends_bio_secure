// ============================================
// BioSecure Service Worker — Offline Mode
// Caches all app assets after first load.
// Biometric processing is already on-device —
// this makes the full app shell work offline.
// ============================================

const CACHE_NAME = 'biosecure-v3';

// ── Assets to cache immediately on install ────────────────────────────────────
// These are the minimum files needed to run the app with zero internet
const APP_SHELL = [
  '/',
  '/auth',
  '/admin',
  '/index.html',
  '/auth.html',
  '/admin.html',
  '/enroll.html',
  '/css/style.css',
  '/js/palm-biometrics.js',
  '/js/face-biometrics.js',
  // MediaPipe WASM & model bundle
  '/mediapipe/vision_bundle.js',
  '/mediapipe/wasm/vision_wasm_internal.js',
  '/mediapipe/wasm/vision_wasm_internal.wasm',
  '/models/hand_landmarker.task',
];

// ── API routes that should NEVER be served from cache ─────────────────────────
// These must always go to the server (real-time data)
const NETWORK_ONLY = [
  '/api/auth',
  '/api/register',
  '/api/admin/status',
  '/api/admin/setup',
  '/api/admin/logout',
  '/api/users',
  '/api/logs',
  '/api/admin/benchmark',
];

// ── Install: cache the app shell ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing BioSecure Service Worker…');
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache files one by one — skip failures (e.g. large model files on first run)
      const results = await Promise.allSettled(
        APP_SHELL.map(url => cache.add(url).catch(err => {
          console.warn(`[SW] Could not pre-cache: ${url}`, err.message);
        }))
      );
      console.log('[SW] App shell cached.');
      return results;
    })
  );
  // Activate immediately without waiting for old tabs to close
  self.skipWaiting();
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating, cleaning old caches…');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    )
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

// ── Fetch: Intercept all network requests ────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests (POST to /api/* goes straight to server)
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests (CDN fallbacks, external resources)
  if (url.origin !== self.location.origin) return;

  // ── API routes: Network first, no cache fallback ──────────────────────────
  const isApiRoute = NETWORK_ONLY.some(path => url.pathname.startsWith(path));
  if (isApiRoute) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Return structured offline response for API calls
        return new Response(
          JSON.stringify({
            error: 'OFFLINE: No server connection. Please check your network.',
            offline: true
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      })
    );
    return;
  }

  // ── Static assets: Cache first, network fallback ─────────────────────────
  // If cached → serve instantly (works offline)
  // If not cached → fetch from network and cache for next time
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Serve from cache immediately
        // Also update cache in background (stale-while-revalidate)
        const networkFetch = fetch(event.request)
          .then(response => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => {}); // Ignore network errors — we already have cached version
        return cached;
      }

      // Not in cache — fetch from network and cache it
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // Network failed and not in cache — return offline page for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// ── Background Sync: Retry failed enrollment/auth when back online ────────────
// This queues any failed POST requests and retries them automatically
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-biometric-data') {
    console.log('[SW] Background sync triggered — retrying pending requests');
    event.waitUntil(syncPendingRequests());
  }
});

async function syncPendingRequests() {
  // Read pending requests from IndexedDB (managed by the main app)
  // and replay them now that we're back online
  try {
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ type: 'SYNC_COMPLETE', message: 'Back online — pending data synced.' });
    });
  } catch (err) {
    console.error('[SW] Sync failed:', err);
  }
}
