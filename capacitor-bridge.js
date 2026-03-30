/**
 * Toon It! — Capacitor Native Bridge v2.0
 * Rewritten with clean download/share handling.
 *
 * THE CORE PROBLEM:
 *   <a download> SILENTLY FAILS in Android WebView.
 *   blob: URLs don't trigger native downloads.
 *
 * THE FIX (3 layers):
 *   Layer 1: HTMLAnchorElement.prototype.click override — catches blob: anchor clicks
 *   Layer 2: window.open override — catches fallback window.open(blob:) calls
 *   Layer 3: Direct button onclick override — bypasses closures entirely
 *
 * DOWNLOAD METHOD: fetch → blob → File → navigator.share({files})
 *   Falls back to: Capacitor Share plugin with data URI
 */
(function() {
  'use strict';

  // Only run inside Capacitor native app
  if (!window.Capacitor || !window.Capacitor.isNativePlatform()) {
    console.log('[ToonIt Bridge] Not in native — skipping');
    return;
  }

  console.log('[ToonIt Bridge] Initializing native bridge v2.0...');

  var platform = window.Capacitor.getPlatform(); // 'ios' | 'android'

  // ══════════════════════════════════════════════════════════════
  //  LOGGING — Console only (no visible overlay in production)
  // ══════════════════════════════════════════════════════════════
  function dbg(msg) {
    console.log('[Bridge] ' + msg);
  }
  dbg('Bridge v2.0 init | platform=' + platform);

  // ══════════════════════════════════════════════════════════════
  //  PLUGIN REFERENCES
  // ══════════════════════════════════════════════════════════════
  var Plugins = window.Capacitor.Plugins || {};
  var CapShare     = Plugins.Share;
  var CapCamera    = Plugins.Camera;
  var CapHaptics   = Plugins.Haptics;
  var CapStatusBar = Plugins.StatusBar;
  var CapBrowser   = Plugins.Browser;
  var CapApp       = Plugins.App;
  var CapSplash    = Plugins.SplashScreen;
  var CapKeyboard  = Plugins.Keyboard;
  var CapPush      = Plugins.PushNotifications;

  dbg('Plugins: Share=' + !!CapShare + ' Camera=' + !!CapCamera);

  // ══════════════════════════════════════════════════════════════
  //  CORE HELPER: Save/share a video from URL
  //  This is THE function that replaces broken <a download>
  // ══════════════════════════════════════════════════════════════
  async function saveOrShareVideo(videoUrl, filename, btnEl) {
    filename = filename || 'toonit-video.mp4';
    var origText = btnEl ? btnEl.textContent : '';
    if (btnEl) { btnEl.textContent = '\u2B07\uFE0F Saving...'; btnEl.disabled = true; }
    dbg('saveOrShare: ' + videoUrl.substring(0, 60));

    try {
      // Step 1: Fetch the video blob
      var resp = await fetch(videoUrl);
      if (!resp.ok) throw new Error('fetch failed: ' + resp.status);
      var blob = await resp.blob();
      dbg('blob: ' + blob.size + ' bytes, type=' + blob.type);

      if (blob.size < 1000) {
        dbg('WARNING: blob too small, likely error');
        throw new Error('Video blob too small: ' + blob.size);
      }

      // Step 2: Create a File object
      var file = new File([blob], filename, { type: blob.type || 'video/mp4' });

      // Step 3: Try navigator.share with actual file (PREFERRED)
      // This opens the Android share sheet where user can "Save to device", send via WhatsApp, etc.
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        dbg('Using navigator.share({files}) — PREFERRED');
        await navigator.share({
          files: [file],
          title: 'My ToonIt Video',
          text: '\u2728 Made with ToonIt.ai'
        });
        dbg('navigator.share completed OK');
        // Haptic feedback
        try { if (CapHaptics) CapHaptics.impact({ style: 'MEDIUM' }); } catch(e) {}
        return true;
      }

      // Step 4: Fallback — Capacitor Share plugin with data URI
      if (CapShare) {
        dbg('Fallback: CapShare with data URI...');
        var dataUrl = await new Promise(function(resolve) {
          var reader = new FileReader();
          reader.onloadend = function() { resolve(reader.result); };
          reader.readAsDataURL(blob);
        });
        dbg('dataURI ready: ' + dataUrl.substring(0, 40) + '...');
        await CapShare.share({
          title: filename,
          url: dataUrl,
          dialogTitle: 'Save Video'
        });
        dbg('CapShare completed OK');
        try { if (CapHaptics) CapHaptics.impact({ style: 'MEDIUM' }); } catch(e) {}
        return true;
      }

      // Step 5: Last resort — try opening URL directly
      dbg('Last resort: window.open');
      window._origOpen.call(window, videoUrl, '_blank');
      return false;

    } catch (err) {
      if (err && err.name === 'AbortError') {
        dbg('User cancelled share');
        return false;
      }
      dbg('ERROR: ' + (err && err.message || err));
      console.error('[Bridge] saveOrShare error:', err);
      // Try opening URL as absolute last resort
      try { window._origOpen.call(window, videoUrl, '_blank'); } catch(e) {}
      return false;
    } finally {
      if (btnEl) { btnEl.textContent = origText || '\u2B07\uFE0F Download'; btnEl.disabled = false; }
    }
  }

  // Expose globally so page code can call it too
  window.toonItSaveOrShare = saveOrShareVideo;

  // ══════════════════════════════════════════════════════════════
  //  LAYER 1: HTMLAnchorElement.prototype.click Override
  //  Catches: fetch→blob→createObjectURL→<a download>→click()
  // ══════════════════════════════════════════════════════════════
  var _origAnchorClick = HTMLAnchorElement.prototype.click;

  HTMLAnchorElement.prototype.click = function() {
    var href = this.href || '';
    var dl = this.download || this.getAttribute('download') || '';

    // Only intercept blob: URLs with a download attribute
    if (href.indexOf('blob:') === 0 && dl) {
      dbg('LAYER1: anchor intercept: ' + dl);
      var self = this;

      fetch(href)
        .then(function(r) { return r.blob(); })
        .then(function(blob) {
          dbg('L1 blob: ' + blob.size + ' bytes');
          var file = new File([blob], dl, { type: blob.type || 'video/mp4' });

          // Preferred: share with actual file
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            dbg('L1 → navigator.share({files})');
            return navigator.share({ files: [file], title: dl });
          }

          // Fallback: Capacitor Share with data URI
          if (CapShare) {
            dbg('L1 → CapShare data URI fallback');
            return new Promise(function(resolve) {
              var reader = new FileReader();
              reader.onloadend = function() { resolve(reader.result); };
              reader.readAsDataURL(blob);
            }).then(function(dataUrl) {
              return CapShare.share({ title: dl, url: dataUrl, dialogTitle: 'Save Video' });
            });
          }

          // Last resort: original click
          dbg('L1 → original click (no share available)');
          return _origAnchorClick.call(self);
        })
        .catch(function(err) {
          if (err && err.name !== 'AbortError') {
            dbg('L1 error: ' + (err.message || err));
            _origAnchorClick.call(self);
          }
        });
      return; // Don't call original
    }

    // Non-blob or non-download: pass through
    return _origAnchorClick.call(this);
  };
  dbg('Layer 1 (anchor intercept) active');

  // ══════════════════════════════════════════════════════════════
  //  LAYER 2: window.open Override
  //  Catches: window.open(blobUrl) and window.open(supabaseUrl)
  // ══════════════════════════════════════════════════════════════
  var _origOpen = window.open;
  window._origOpen = _origOpen; // Save for use in saveOrShareVideo

  window.open = function(url, target, features) {
    var u = (url || '') + '';

    // Intercept blob: URLs and Supabase storage URLs
    if (u.indexOf('blob:') === 0 || (u.indexOf('supabase') > -1 && u.indexOf('.mp4') > -1)) {
      dbg('LAYER2: window.open intercept: ' + u.substring(0, 60));

      fetch(u)
        .then(function(r) {
          if (!r.ok) throw new Error('fetch ' + r.status);
          return r.blob();
        })
        .then(function(blob) {
          dbg('L2 blob: ' + blob.size + ' bytes');
          var file = new File([blob], 'toonit-video.mp4', { type: 'video/mp4' });

          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            dbg('L2 → navigator.share({files})');
            return navigator.share({ files: [file], title: 'ToonIt Video' });
          }

          if (CapShare) {
            dbg('L2 → CapShare fallback');
            return new Promise(function(res) {
              var rd = new FileReader();
              rd.onloadend = function() { res(rd.result); };
              rd.readAsDataURL(blob);
            }).then(function(dataUrl) {
              return CapShare.share({ title: 'ToonIt Video', url: dataUrl });
            });
          }

          return _origOpen.call(window, u, target, features);
        })
        .catch(function(e) {
          dbg('L2 error: ' + (e && e.message || e));
          _origOpen.call(window, u, target, features);
        });
      return null;
    }

    return _origOpen.call(window, u, target, features);
  };
  dbg('Layer 2 (window.open intercept) active');

  // ══════════════════════════════════════════════════════════════
  //  LAYER 3: Direct Button onclick Overrides
  //  WHY: JS closures in index.html mean downloadVideo() is a
  //  local variable. Global overrides don't reach it. We MUST
  //  replace the button's onclick directly.
  // ══════════════════════════════════════════════════════════════

  function getVideoUrl() {
    // Try multiple sources for the current video URL
    try {
      // 1. Watermark state (most reliable)
      if (window._wmState) {
        if (window._wmState.currentCleanUrl) return window._wmState.currentCleanUrl;
        if (window._wmState.currentWmUrl) return window._wmState.currentWmUrl;
      }
    } catch(e) {}

    // 2. Result video element
    var vid = document.getElementById('resultVideo');
    if (vid && (vid.currentSrc || vid.src)) {
      var src = vid.currentSrc || vid.src;
      if (src && src !== '' && !src.endsWith('/')) return src;
    }

    // 3. Modal video (myvideos.html)
    var mv = document.getElementById('modalVideo');
    if (mv && (mv.currentSrc || mv.src)) {
      return mv.currentSrc || mv.src;
    }

    return '';
  }

  function overrideIndexButtons() {
    // === DOWNLOAD BUTTON (index.html) ===
    var dlBtn = document.getElementById('downloadBtn');
    if (dlBtn && dlBtn.dataset.bridgeV2 !== '1') {
      dlBtn.dataset.bridgeV2 = '1';
      dbg('LAYER3: overriding downloadBtn');

      dlBtn.onclick = function(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        var url = getVideoUrl();
        if (!url) {
          dbg('L3 download: no video URL found');
          return false;
        }
        dbg('L3 download: ' + url.substring(0, 60));
        saveOrShareVideo(url, 'toon-it-video.mp4', dlBtn);
        return false;
      };
    }

    // === SHARE BUTTON (index.html — #nativeShareBtn) ===
    var shareBtn = document.getElementById('nativeShareBtn');
    if (shareBtn && shareBtn.dataset.bridgeV2 !== '1') {
      shareBtn.dataset.bridgeV2 = '1';
      shareBtn.style.display = ''; // Make sure it's visible
      dbg('LAYER3: overriding nativeShareBtn');

      shareBtn.onclick = function(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        var url = getVideoUrl();
        if (!url) return false;
        dbg('L3 share: ' + url.substring(0, 60));
        shareVideoNative(url, shareBtn);
        return false;
      };
    }
  }

  function overrideDashboardButtons() {
    // === DOWNLOAD BUTTON (myvideos.html modal) ===
    var dashDl = document.getElementById('dashDownloadBtn');
    if (dashDl && dashDl.dataset.bridgeV2 !== '1') {
      dashDl.dataset.bridgeV2 = '1';
      dbg('LAYER3: overriding dashDownloadBtn');

      dashDl.onclick = function(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        var mv = document.getElementById('modalVideo');
        var url = mv ? (mv.currentSrc || mv.src) : '';
        if (!url) return false;
        dbg('L3 dash download: ' + url.substring(0, 60));
        saveOrShareVideo(url, 'toonit-video.mp4', dashDl);
        return false;
      };
    }

    // === SHARE BUTTON (myvideos.html modal) ===
    var shareBtn = document.getElementById('shareVideoBtn');
    if (shareBtn && shareBtn.dataset.bridgeV2 !== '1') {
      shareBtn.dataset.bridgeV2 = '1';
      dbg('LAYER3: overriding shareVideoBtn');

      shareBtn.onclick = function(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        var mv = document.getElementById('modalVideo');
        var url = mv ? (mv.currentSrc || mv.src) : '';
        if (!url) return false;
        dbg('L3 dash share: ' + url.substring(0, 60));
        shareVideoNative(url, shareBtn);
        return false;
      };
    }
  }

  // Share helper — shares actual video file
  async function shareVideoNative(videoUrl, btnEl) {
    var origText = btnEl ? btnEl.textContent : 'Share';
    if (btnEl) { btnEl.textContent = 'Sharing...'; btnEl.disabled = true; }
    dbg('shareVideoNative: ' + videoUrl.substring(0, 60));

    try {
      var resp = await fetch(videoUrl);
      if (!resp.ok) throw new Error('fetch ' + resp.status);
      var blob = await resp.blob();
      var file = new File([blob], 'toonit-video.mp4', { type: 'video/mp4' });

      // Preferred: share actual file
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        dbg('share → navigator.share({files})');
        await navigator.share({
          files: [file],
          title: 'My ToonIt Video',
          text: "\u2728 Just toon'd myself \uD83D\uDE0D Try it free \u2192 toonit.ai"
        });
        try { if (CapHaptics) CapHaptics.impact({ style: 'LIGHT' }); } catch(e) {}
        return;
      }

      // Fallback: Capacitor Share with data URI
      if (CapShare) {
        dbg('share → CapShare data URI');
        var dataUrl = await new Promise(function(res) {
          var rd = new FileReader();
          rd.onloadend = function() { res(rd.result); };
          rd.readAsDataURL(blob);
        });
        await CapShare.share({
          title: 'My ToonIt Video',
          text: "\u2728 Made with ToonIt.ai",
          url: dataUrl,
          dialogTitle: 'Share your magic'
        });
        try { if (CapHaptics) CapHaptics.impact({ style: 'LIGHT' }); } catch(e) {}
        return;
      }

      // Last resort: share URL only
      if (navigator.share) {
        await navigator.share({
          title: 'My ToonIt Video',
          text: '\u2728 Check out my magical transformation!',
          url: 'https://toonit.ai'
        });
      }
    } catch (err) {
      if (err && err.name !== 'AbortError') {
        dbg('share error: ' + (err.message || err));
        console.error('[Bridge] Share error:', err);
      }
    } finally {
      if (btnEl) { btnEl.textContent = origText; btnEl.disabled = false; }
    }
  }

  window.toonItShareVideo = shareVideoNative;

  // Run button overrides now and on DOM changes
  function runAllOverrides() {
    overrideIndexButtons();
    overrideDashboardButtons();
  }

  // Initial run with delays (page loads remote content)
  setTimeout(runAllOverrides, 1500);
  setTimeout(runAllOverrides, 3000);
  setTimeout(runAllOverrides, 5000);

  // Re-run on DOM mutations (catches dynamically shown buttons)
  var _btnObserver = new MutationObserver(function() {
    setTimeout(runAllOverrides, 300);
  });
  setTimeout(function() {
    if (document.body) {
      _btnObserver.observe(document.body, { childList: true, subtree: true, attributes: true });
    }
  }, 2000);

  dbg('Layer 3 (button overrides) scheduled');

  // ══════════════════════════════════════════════════════════════
  //  STATUS BAR — Match app theme
  // ══════════════════════════════════════════════════════════════
  try {
    if (CapStatusBar) {
      CapStatusBar.setStyle({ style: 'DARK' });
      CapStatusBar.setBackgroundColor({ color: '#07070f' });
    }
  } catch (e) { console.warn('[Bridge] StatusBar error:', e); }

  // ══════════════════════════════════════════════════════════════
  //  SPLASH SCREEN — Auto-hide after load
  // ══════════════════════════════════════════════════════════════
  window.addEventListener('load', function() {
    setTimeout(function() {
      try { if (CapSplash) CapSplash.hide(); }
      catch (e) { console.warn('[Bridge] SplashScreen error:', e); }
    }, 500);
  });

  // ══════════════════════════════════════════════════════════════
  //  CAMERA — Native photo capture
  // ══════════════════════════════════════════════════════════════
  window.toonItNativeCamera = async function() {
    try {
      if (!CapCamera) throw new Error('Camera plugin not available');

      var photo = await CapCamera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: 'uri',
        source: 'PROMPT',
        width: 1024,
        height: 1024,
        correctOrientation: true,
        presentationStyle: 'fullScreen'
      });

      dbg('Photo captured: ' + (photo.webPath || '').substring(0, 40));
      try { if (CapHaptics) await CapHaptics.impact({ style: 'MEDIUM' }); } catch(e) {}
      return photo;
    } catch (e) {
      if (e.message && e.message.includes('cancelled')) {
        dbg('Camera cancelled');
        return null;
      }
      dbg('Camera error: ' + e.message);
      throw e;
    }
  };

  // Camera button injection
  function injectCameraButton() {
    var uploadArea = document.getElementById('uploadArea');
    if (!uploadArea) { setTimeout(injectCameraButton, 1000); return; }
    if (document.getElementById('nativeCameraBtn')) return;

    var cameraBtn = document.createElement('button');
    cameraBtn.id = 'nativeCameraBtn';
    cameraBtn.innerHTML = '\uD83D\uDCF7 Take a Photo';
    cameraBtn.style.cssText = 'display:block;margin:12px auto 0;padding:12px 28px;'
      + 'background:linear-gradient(135deg,#7c6bfa 0%,#9d8bff 100%);color:white;'
      + 'border:none;border-radius:30px;font-size:1em;font-weight:700;cursor:pointer;'
      + 'transition:transform 0.2s;';

    var camInput = document.createElement('input');
    camInput.type = 'file';
    camInput.accept = 'image/*';
    camInput.capture = 'environment';
    camInput.style.display = 'none';
    camInput.id = 'nativeCamInput';
    document.body.appendChild(camInput);

    camInput.addEventListener('change', function(e) {
      if (e.target.files && e.target.files[0]) {
        var file = e.target.files[0];
        if (typeof window.handleFileFallback === 'function') {
          window.handleFileFallback(file);
        } else {
          var input = document.querySelector('#uploadArea input[type="file"]');
          if (input) {
            var dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }
    });

    cameraBtn.addEventListener('click', async function(e) {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (CapCamera) {
          var photo = await window.toonItNativeCamera();
          if (photo && photo.webPath) {
            var response = await fetch(photo.webPath);
            var blob = await response.blob();
            var file = new File([blob], 'camera_photo.jpg', { type: 'image/jpeg' });
            if (typeof window.handleFileFallback === 'function') {
              window.handleFileFallback(file);
            }
          }
        } else {
          camInput.value = '';
          camInput.click();
        }
      } catch (err) {
        dbg('Camera flow error: ' + (err.message || err));
        camInput.value = '';
        camInput.click();
      }
    });

    uploadArea.parentNode.insertBefore(cameraBtn, uploadArea.nextSibling);
    dbg('Camera button injected');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCameraButton);
  } else {
    injectCameraButton();
  }

  // ══════════════════════════════════════════════════════════════
  //  PUSH NOTIFICATIONS
  // ══════════════════════════════════════════════════════════════
  async function initPushNotifications() {
    if (!CapPush) { dbg('Push: plugin not available, skipping'); return; }
    try {
      // Check if Firebase/FCM is available before attempting registration
      // Without google-services.json, register() will crash the app
      var permission = await CapPush.requestPermissions();
      if (permission.receive !== 'granted') { dbg('Push: permission denied'); return; }
      try {
        await CapPush.register();
      } catch (regErr) {
        dbg('Push register failed (Firebase not configured?): ' + (regErr.message || regErr));
        console.warn('[Bridge] Push registration failed — Firebase may not be configured:', regErr);
        return;
      }

      CapPush.addListener('registration', function(token) {
        dbg('Push token: ' + token.value.substring(0, 20) + '...');
        window._pushToken = token.value;
      });
      CapPush.addListener('registrationError', function(err) {
        dbg('Push reg error: ' + (err.error || err));
      });
      CapPush.addListener('pushNotificationReceived', function(notification) {
        showInAppNotification(notification);
      });
      CapPush.addListener('pushNotificationActionPerformed', function(action) {
        var data = action.notification.data;
        if (data && data.url) window.location.href = data.url;
      });
      dbg('Push initialized');
    } catch (e) {
      dbg('Push init error: ' + (e && e.message || e));
      console.warn('[Bridge] Push initialization error (non-fatal):', e);
    }
  }

  function showInAppNotification(notification) {
    var banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:env(safe-area-inset-top,20px);left:16px;right:16px;'
      + 'background:#181830;border:1px solid #f0b429;border-radius:16px;padding:14px 18px;'
      + 'z-index:99999;display:flex;align-items:center;gap:12px;'
      + 'animation:slideDown 0.3s ease-out;box-shadow:0 8px 32px rgba(0,0,0,0.5);';
    banner.innerHTML = '<div style="font-size:1.5em;">\u2728</div>'
      + '<div><strong style="color:#f0b429;font-size:0.9em;">' + (notification.title || 'Toon It!') + '</strong>'
      + '<div style="color:#9090b0;font-size:0.8em;margin-top:2px;">' + (notification.body || '') + '</div></div>';
    document.body.appendChild(banner);
    setTimeout(function() {
      banner.style.transition = 'opacity 0.3s, transform 0.3s';
      banner.style.opacity = '0';
      banner.style.transform = 'translateY(-20px)';
      setTimeout(function() { banner.remove(); }, 300);
    }, 4000);
  }

  setTimeout(initPushNotifications, 3000);

  // ══════════════════════════════════════════════════════════════
  //  APP REVIEW PROMPT
  // ══════════════════════════════════════════════════════════════
  window.toonItRequestReview = async function() {
    try {
      var transforms = parseInt(localStorage.getItem('toonit_transform_count') || '0');
      var reviewShown = localStorage.getItem('toonit_review_prompted');
      if (transforms >= 2 && !reviewShown) {
        var AppReview = Plugins.AppReview;
        if (AppReview) {
          await AppReview.requestReview();
          localStorage.setItem('toonit_review_prompted', Date.now().toString());
          dbg('Review prompt shown');
        }
      }
    } catch (e) { dbg('Review error: ' + e.message); }
  };

  // Track transforms and trigger review
  function observeResults() {
    var resultArea = document.getElementById('result');
    if (!resultArea) { setTimeout(observeResults, 1000); return; }

    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        if (m.target.id === 'result' && m.target.style.display === 'block') {
          var count = parseInt(localStorage.getItem('toonit_transform_count') || '0') + 1;
          localStorage.setItem('toonit_transform_count', count.toString());
          dbg('Transform #' + count + ' completed');

          // Re-run button overrides (result area just appeared)
          setTimeout(runAllOverrides, 500);
          setTimeout(runAllOverrides, 1500);

          // Haptic celebration
          try { if (CapHaptics) CapHaptics.impact({ style: 'HEAVY' }); } catch(e) {}

          // Review after 2nd transform
          if (count === 2) {
            setTimeout(function() { window.toonItRequestReview(); }, 5000);
          }
        }
      });
    });
    observer.observe(resultArea, { attributes: true, attributeFilter: ['style'] });
    dbg('Result observer active');
  }
  observeResults();

  // ══════════════════════════════════════════════════════════════
  //  DEEP LINKS — Checkout return
  // ══════════════════════════════════════════════════════════════
  if (CapApp) {
    CapApp.addListener('appUrlOpen', function(event) {
      dbg('Deep link: ' + event.url);
      try {
        var url = new URL(event.url);
        var path = url.hostname + url.pathname;
        if (path.includes('checkout-complete') || path.includes('checkout-success')) {
          if (typeof window.refreshCredits === 'function') window.refreshCredits();
          try { if (CapHaptics) CapHaptics.impact({ style: 'HEAVY' }); } catch(e) {}
          showInAppNotification({ title: 'Credits Added! \u2728', body: 'Your credits are ready to use.' });
        }
      } catch(e) { dbg('Deep link error: ' + e.message); }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  PAYMENT — Route to web checkout
  // ══════════════════════════════════════════════════════════════
  window.toonItOpenCheckout = async function(priceId) {
    var url = 'https://toonit.ai/pricing.html' + (priceId ? '?price=' + priceId : '');
    try {
      if (CapBrowser) {
        await CapBrowser.open({ url: url, presentationStyle: 'popover' });
      } else {
        _origOpen.call(window, url, '_blank');
      }
    } catch (e) {
      _origOpen.call(window, url, '_blank');
    }
  };

  // ══════════════════════════════════════════════════════════════
  //  KEYBOARD — iOS safe area
  // ══════════════════════════════════════════════════════════════
  if (CapKeyboard && platform === 'ios') {
    CapKeyboard.addListener('keyboardWillShow', function(info) {
      document.body.style.paddingBottom = info.keyboardHeight + 'px';
    });
    CapKeyboard.addListener('keyboardWillHide', function() {
      document.body.style.paddingBottom = '0';
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  BACK BUTTON — Android
  // ══════════════════════════════════════════════════════════════
  if (CapApp && platform === 'android') {
    CapApp.addListener('backButton', function() {
      var modal = document.querySelector('.modal[style*="display: flex"], .modal[style*="display:flex"]');
      if (modal) { modal.style.display = 'none'; return; }
      if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
        CapApp.minimizeApp();
      } else {
        window.history.back();
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  HIDE PWA INSTALL BANNER in native
  // ══════════════════════════════════════════════════════════════
  var pwaInstallBanner = document.getElementById('pwaInstallBanner');
  if (pwaInstallBanner) pwaInstallBanner.style.display = 'none';
  var origAddEventListener = window.addEventListener;
  window.addEventListener = function(type, listener, options) {
    if (type === 'beforeinstallprompt') return;
    return origAddEventListener.call(window, type, listener, options);
  };

  // ══════════════════════════════════════════════════════════════
  //  NATIVE APP INDICATOR
  // ══════════════════════════════════════════════════════════════
  document.documentElement.classList.add('capacitor-app');
  document.documentElement.classList.add('platform-' + platform);
  window.toonItIsNative = true;
  window.toonItPlatform = platform;

  // ══════════════════════════════════════════════════════════════
  //  VIDEO THUMBNAILS — Fix for Android WebView
  // ══════════════════════════════════════════════════════════════
  function fixVideoThumbnails() {
    var thumbs = document.querySelectorAll('.video-card-thumb video, .video-thumbnail video');
    for (var i = 0; i < thumbs.length; i++) {
      var v = thumbs[i];
      if (v.dataset.thumbFixed) continue;
      v.dataset.thumbFixed = '1';
      v.preload = 'auto';
      v.addEventListener('loadeddata', function() {
        try { this.currentTime = 0.5; } catch(e) {}
      }, { once: true });
      if (v.src && v.src.indexOf('#t=') === -1) {
        v.src = v.src + '#t=0.5';
      }
    }
  }
  var _thumbObs = new MutationObserver(function() { setTimeout(fixVideoThumbnails, 200); });
  setTimeout(function() {
    if (document.body) _thumbObs.observe(document.body, { childList: true, subtree: true });
    fixVideoThumbnails();
  }, 1500);

  // ══════════════════════════════════════════════════════════════
  //  DONE
  // ══════════════════════════════════════════════════════════════
  dbg('\u2705 Bridge v2.0 ready | ' + platform);
  console.log('[ToonIt Bridge] \u2705 v2.0 initialized for ' + platform);
})();
