// ============================================
// BioSecure Offline Manager
// Registers the Service Worker and shows/hides
// the offline indicator banner automatically.
// Include this script in every HTML page.
// ============================================

(function () {
  'use strict';

  // ── Register Service Worker ─────────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        console.log('[Offline] Service Worker registered:', reg.scope);

        // Listen for messages from the SW (e.g. sync complete)
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data.type === 'SYNC_COMPLETE') {
            showBanner('✅ ' + event.data.message, 'success', 4000);
          }
        });
      } catch (err) {
        console.warn('[Offline] Service Worker registration failed:', err);
      }
    });
  }

  // ── Inject the offline banner CSS + HTML ────────────────────────────────────
  function injectBannerStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #biosecure-offline-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 99999;
        padding: 10px 20px;
        font-size: 13px;
        font-weight: 600;
        font-family: 'Inter', sans-serif;
        text-align: center;
        display: none;
        align-items: center;
        justify-content: center;
        gap: 8px;
        animation: slideDown 0.3s ease;
        transition: background 0.3s ease;
      }
      #biosecure-offline-banner.offline {
        display: flex;
        background: linear-gradient(90deg, #1a0a00, #3d1500);
        color: #ffb84d;
        border-bottom: 1px solid rgba(255,184,77,0.3);
      }
      #biosecure-offline-banner.success {
        display: flex;
        background: linear-gradient(90deg, #001a0a, #003d15);
        color: #00ff88;
        border-bottom: 1px solid rgba(0,255,136,0.3);
      }
      @keyframes slideDown {
        from { transform: translateY(-100%); }
        to   { transform: translateY(0); }
      }
      /* Push page content down when banner is visible */
      body.has-offline-banner { padding-top: 40px; }
    `;
    document.head.appendChild(style);
  }

  function injectBannerElement() {
    const banner = document.createElement('div');
    banner.id = 'biosecure-offline-banner';
    document.body.insertBefore(banner, document.body.firstChild);
    return banner;
  }

  // ── Show/hide the banner ─────────────────────────────────────────────────────
  function showBanner(message, type = 'offline', autoDismissMs = null) {
    let banner = document.getElementById('biosecure-offline-banner');
    if (!banner) banner = injectBannerElement();

    banner.className = type;
    banner.textContent = message;
    document.body.classList.add('has-offline-banner');

    if (autoDismissMs) {
      setTimeout(hideBanner, autoDismissMs);
    }
  }

  function hideBanner() {
    const banner = document.getElementById('biosecure-offline-banner');
    if (banner) {
      banner.className = '';
      banner.style.display = 'none';
    }
    document.body.classList.remove('has-offline-banner');
  }

  // ── Monitor online/offline status ───────────────────────────────────────────
  function handleOffline() {
    showBanner('📡 You are offline — Biometric processing still works. Data will sync when connected.');
  }

  function handleOnline() {
    showBanner('✅ Connection restored — Syncing any pending data…', 'success', 3000);
    // Trigger background sync if SW supports it
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then(reg => {
        reg.sync.register('sync-biometric-data').catch(err => {
          console.warn('[Offline] Background sync registration failed:', err);
        });
      });
    }
  }

  // ── Expose a helper for API calls to show offline error ─────────────────────
  // Usage: window.BioOffline.handleApiError(response)
  window.BioOffline = {
    handleApiError: function (response) {
      if (response && response.offline) {
        showBanner('⚠️ Cannot reach server — you are offline.', 'offline');
        return true;
      }
      return false;
    },
    showBanner,
    hideBanner,
  };

  // ── Initialize ────────────────────────────────────────────────────────────
  injectBannerStyles();

  // Check current status immediately
  if (!navigator.onLine) handleOffline();

  // Listen for changes
  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);

})();
