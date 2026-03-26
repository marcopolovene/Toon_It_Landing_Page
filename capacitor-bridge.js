/**
 * Toon It! — Capacitor Native Bridge v1.0
 * Injected into the web app when running inside the native shell.
 * Provides: Camera capture, Native Share, Push Notifications,
 *           Haptic feedback, App Review prompts, Deep Links,
 *           Status Bar control.
 */
(function() {
  'use strict';

  // Only run inside Capacitor
  if (!window.Capacitor || !window.Capacitor.isNativePlatform()) {
    console.log('[ToonIt Bridge] Not in native — skipping');
    return;
  }

  console.log('[ToonIt Bridge] Initializing native bridge...');

  // Visible debug indicator (remove after confirming bridge loads)
  (function() {
    var d = document.createElement('div');
    d.id = 'bridgeDebug';
    var _plugins = Object.keys(window.Capacitor.Plugins || {}).join(', ') || 'NONE';
    d.textContent = 'Bridge v3 | Plugins: ' + _plugins;
    d.style.cssText = 'position:fixed;bottom:60px;left:10px;right:10px;background:#22c55e;color:#fff;padding:8px 16px;border-radius:12px;font-size:11px;font-weight:600;z-index:99999;opacity:0.95;text-align:center;';
    d.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:#22c55e;color:#fff;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:700;z-index:99999;opacity:0.9;';
    document.body ? document.body.appendChild(d) : document.addEventListener('DOMContentLoaded', function() { document.body.appendChild(d); });
    setTimeout(function() { d.style.transition = 'opacity 0.5s'; d.style.opacity = '0'; setTimeout(function() { d.remove(); }, 500); }, 4000);
  })();

  const platform = window.Capacitor.getPlatform(); // 'ios' | 'android'

  /* ══════════════════════════════════════════
   *  IMPORTS — Capacitor Plugins
   * ══════════════════════════════════════════ */
  const { Camera, CameraResultType, CameraSource } = window.Capacitor.Plugins.Camera || {};
  const { Share } = window.Capacitor.Plugins.Share || {};
  const { PushNotifications } = window.Capacitor.Plugins.PushNotifications || {};
  const { Haptics, ImpactStyle } = window.Capacitor.Plugins.Haptics || {};
  const { StatusBar, Style: StatusBarStyle } = window.Capacitor.Plugins.StatusBar || {};
  const { Browser } = window.Capacitor.Plugins.Browser || {};
  const { App } = window.Capacitor.Plugins.App || {};
  const { SplashScreen } = window.Capacitor.Plugins.SplashScreen || {};
  const { Keyboard } = window.Capacitor.Plugins.Keyboard || {};

  /* ══════════════════════════════════════════
   *  STATUS BAR — Match app theme
   * ══════════════════════════════════════════ */
  try {
    if (StatusBar) {
      StatusBar.setStyle({ style: 'DARK' });
      StatusBar.setBackgroundColor({ color: '#07070f' });
      console.log('[ToonIt Bridge] Status bar configured');
    }
  } catch (e) { console.warn('[ToonIt Bridge] StatusBar error:', e); }

  /* ══════════════════════════════════════════
   *  SPLASH SCREEN — Auto-hide after load
   * ══════════════════════════════════════════ */
  window.addEventListener('load', function() {
    setTimeout(function() {
      try { if (SplashScreen) SplashScreen.hide(); }
      catch (e) { console.warn('[ToonIt Bridge] SplashScreen hide error:', e); }
    }, 500);
  });

  /* ══════════════════════════════════════════
   *  CAMERA — Native photo capture
   * ══════════════════════════════════════════ */
  window.toonItNativeCamera = async function() {
    try {
      if (!Camera) throw new Error('Camera plugin not available');

      const photo = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType ? CameraResultType.Uri : 'uri',
        source: CameraSource ? CameraSource.Prompt : 'PROMPT',
        width: 1024,
        height: 1024,
        correctOrientation: true,
        presentationStyle: 'fullScreen'
      });

      console.log('[ToonIt Bridge] Photo captured:', photo.webPath);

      // Trigger haptic feedback on capture
      try { if (Haptics) await Haptics.impact({ style: 'MEDIUM' }); }
      catch (e) { /* ignore haptic errors */ }

      return photo;
    } catch (e) {
      if (e.message && e.message.includes('cancelled')) {
        console.log('[ToonIt Bridge] Camera cancelled by user');
        return null;
      }
      console.error('[ToonIt Bridge] Camera error:', e);
      throw e;
    }
  };

  // Hook into existing upload area — add camera button for native
  function injectCameraButton() {
    var uploadArea = document.getElementById('uploadArea');
    if (!uploadArea) {
      // Retry when DOM is ready
      setTimeout(injectCameraButton, 1000);
      return;
    }

    // Don't inject twice
    if (document.getElementById('nativeCameraBtn')) return;

    var cameraBtn = document.createElement('button');
    cameraBtn.id = 'nativeCameraBtn';
    cameraBtn.innerHTML = '📷 Take a Photo';
    cameraBtn.style.cssText = 'display:block;margin:12px auto 0;padding:12px 28px;'
      + 'background:linear-gradient(135deg,#7c6bfa 0%,#9d8bff 100%);color:white;'
      + 'border:none;border-radius:30px;font-size:1em;font-weight:700;cursor:pointer;'
      + 'transition:transform 0.2s;';
    cameraBtn.addEventListener('mousedown', function() { cameraBtn.style.transform = 'scale(0.95)'; });
    cameraBtn.addEventListener('mouseup', function() { cameraBtn.style.transform = 'scale(1)'; });

    // Hidden file input with capture for native camera
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
        // Try Capacitor Camera plugin first
        if (Camera) {
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
          // Fallback: use HTML file input with capture
          camInput.value = '';
          camInput.click();
        }
      } catch (err) {
        console.error('[ToonIt Bridge] Camera flow error:', err);
        // On any error, fall back to HTML capture
        camInput.value = '';
        camInput.click();
        // Visible error for debugging
        var _errDiv = document.createElement('div');
        _errDiv.textContent = 'Camera error: ' + (err && err.message ? err.message : String(err));
        _errDiv.style.cssText = 'position:fixed;bottom:100px;left:10px;right:10px;background:#ef4444;color:#fff;padding:10px;border-radius:10px;font-size:12px;z-index:99999;';
        document.body.appendChild(_errDiv);
        setTimeout(function() { _errDiv.remove(); }, 5000);

      }
    });

    uploadArea.parentNode.insertBefore(cameraBtn, uploadArea.nextSibling);
    console.log('[ToonIt Bridge] Camera button injected');
  }

  // Inject camera button when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCameraButton);
  } else {
    injectCameraButton();
  }

  /* ══════════════════════════════════════════
   *  NATIVE SHARE — Override web share
   * ══════════════════════════════════════════ */
  window.toonItNativeShare = async function(opts) {
    try {
      if (!Share) throw new Error('Share plugin not available');

      await Share.share({
        title: opts.title || 'My ToonIt Video',
        text: opts.text || 'Check out this magical transformation! ✨ Made with Toon It!',
        url: opts.url || 'https://toonit.ai',
        dialogTitle: 'Share your magic ✨'
      });

      // Haptic feedback on share
      try { if (Haptics) await Haptics.impact({ style: 'LIGHT' }); }
      catch (e) { /* ignore */ }

      console.log('[ToonIt Bridge] Shared successfully');
      return true;
    } catch (e) {
      if (e.message && e.message.includes('cancelled')) {
        console.log('[ToonIt Bridge] Share cancelled');
        return false;
      }
      console.error('[ToonIt Bridge] Share error:', e);
      // Fall back to web share
      if (navigator.share) {
        return navigator.share(opts);
      }
      throw e;
    }
  };

  // Override the existing share functions to use native share
  var origDownloadVideo = window.downloadVideo;
  if (typeof origDownloadVideo === 'function') {
    window._webDownloadVideo = origDownloadVideo;
  }

  /* ══════════════════════════════════════════
   *  PUSH NOTIFICATIONS
   * ══════════════════════════════════════════ */
  async function initPushNotifications() {
    if (!PushNotifications) {
      console.log('[ToonIt Bridge] Push plugin not available');
      return;
    }

    try {
      // Request permission
      var permission = await PushNotifications.requestPermissions();
      if (permission.receive !== 'granted') {
        console.log('[ToonIt Bridge] Push permission denied');
        return;
      }

      // Register with APNs/FCM
      await PushNotifications.register();

      // Listen for token
      PushNotifications.addListener('registration', function(token) {
        console.log('[ToonIt Bridge] Push token:', token.value);
        // Store token for backend use
        window._pushToken = token.value;
        // TODO: Send token to Supabase for this user
      });

      PushNotifications.addListener('registrationError', function(err) {
        console.error('[ToonIt Bridge] Push registration error:', err);
      });

      // Handle received notifications (foreground)
      PushNotifications.addListener('pushNotificationReceived', function(notification) {
        console.log('[ToonIt Bridge] Push received:', notification);
        // Show in-app notification banner
        showInAppNotification(notification);
      });

      // Handle notification tap
      PushNotifications.addListener('pushNotificationActionPerformed', function(action) {
        console.log('[ToonIt Bridge] Push action:', action);
        var data = action.notification.data;
        if (data && data.url) {
          window.location.href = data.url;
        }
      });

      console.log('[ToonIt Bridge] Push notifications initialized');
    } catch (e) {
      console.error('[ToonIt Bridge] Push init error:', e);
    }
  }

  function showInAppNotification(notification) {
    var banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:env(safe-area-inset-top,20px);left:16px;right:16px;'
      + 'background:#181830;border:1px solid #f0b429;border-radius:16px;padding:14px 18px;'
      + 'z-index:99999;display:flex;align-items:center;gap:12px;'
      + 'animation:slideDown 0.3s ease-out;box-shadow:0 8px 32px rgba(0,0,0,0.5);';
    banner.innerHTML = '<div style="font-size:1.5em;">✨</div>'
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

  // Init push after a brief delay (let app settle)
  setTimeout(initPushNotifications, 3000);

  /* ══════════════════════════════════════════
   *  APP REVIEW PROMPT
   * ══════════════════════════════════════════ */
  window.toonItRequestReview = async function() {
    try {
      // Check if user has done 2+ transforms (positive experience)
      var transforms = parseInt(localStorage.getItem('toonit_transform_count') || '0');
      var reviewShown = localStorage.getItem('toonit_review_prompted');

      if (transforms >= 2 && !reviewShown) {
        // Use the app review plugin
        var AppReview = window.Capacitor.Plugins.AppReview;
        if (AppReview) {
          await AppReview.requestReview();
          localStorage.setItem('toonit_review_prompted', Date.now().toString());
          console.log('[ToonIt Bridge] Review prompt shown');
        }
      }
    } catch (e) {
      console.warn('[ToonIt Bridge] Review prompt error:', e);
    }
  };

  // Track transform count and prompt review after positive experience
  var origTransformCount = parseInt(localStorage.getItem('toonit_transform_count') || '0');
  // Observe result display to track completed transforms
  var resultObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.target.id === 'result' && m.target.style.display === 'block') {
        var count = parseInt(localStorage.getItem('toonit_transform_count') || '0') + 1;
        localStorage.setItem('toonit_transform_count', count.toString());
        console.log('[ToonIt Bridge] Transform completed, count:', count);

        // Inject native share button after transform
        setTimeout(injectNativeShareButton, 500);

        // Haptic celebration!
        try { if (Haptics) Haptics.impact({ style: 'HEAVY' }); }
        catch (e) { /* ignore */ }

        // Prompt review after 2nd transform
        if (count === 2) {
          setTimeout(function() { window.toonItRequestReview(); }, 5000);
        }
      }
    });
  });

  function observeResults() {
    var resultArea = document.getElementById('result');
    if (resultArea) {
      resultObserver.observe(resultArea, { attributes: true, attributeFilter: ['style'] });
      console.log('[ToonIt Bridge] Observing result area');
    } else {
      setTimeout(observeResults, 1000);
    }
  }
  observeResults();

  /* ══════════════════════════════════════════
   *  DEEP LINKS — Web checkout return
   * ══════════════════════════════════════════ */
  if (App) {
    App.addListener('appUrlOpen', function(event) {
      console.log('[ToonIt Bridge] Deep link:', event.url);
      // Handle toonit:// deep links
      // toonit://checkout-complete → refresh credits
      // toonit://checkout-cancelled → show message
      var url = new URL(event.url);
      var path = url.hostname + url.pathname;

      if (path.includes('checkout-complete') || path.includes('checkout-success')) {
        // Refresh user credits from Supabase
        console.log('[ToonIt Bridge] Checkout complete — refreshing credits');
        if (typeof window.refreshCredits === 'function') {
          window.refreshCredits();
        }
        // Show success message
        try { if (Haptics) Haptics.impact({ style: 'HEAVY' }); }
        catch (e) { /* ignore */ }
        showInAppNotification({
          title: 'Credits Added! ✨',
          body: 'Your credits are ready to use. Start transforming!'
        });
      }
    });
  }

  /* ══════════════════════════════════════════
   *  PAYMENT — Route to web checkout
   * ══════════════════════════════════════════ */
  window.toonItOpenCheckout = async function(priceId) {
    try {
      if (Browser) {
        await Browser.open({
          url: 'https://toonit.ai/pricing.html' + (priceId ? '?price=' + priceId : ''),
          presentationStyle: 'popover'
        });
      } else {
        window.open('https://toonit.ai/pricing.html' + (priceId ? '?price=' + priceId : ''), '_blank');
      }
      console.log('[ToonIt Bridge] Checkout opened');
    } catch (e) {
      console.error('[ToonIt Bridge] Checkout error:', e);
      window.open('https://toonit.ai/pricing.html', '_blank');
    }
  };

  /* ══════════════════════════════════════════
   *  KEYBOARD — iOS safe area handling
   * ══════════════════════════════════════════ */
  if (Keyboard && platform === 'ios') {
    Keyboard.addListener('keyboardWillShow', function(info) {
      document.body.style.paddingBottom = info.keyboardHeight + 'px';
    });
    Keyboard.addListener('keyboardWillHide', function() {
      document.body.style.paddingBottom = '0';
    });
  }

  /* ══════════════════════════════════════════
   *  BACK BUTTON — Android
   * ══════════════════════════════════════════ */
  if (App && platform === 'android') {
    App.addListener('backButton', function(event) {
      // If a modal is open, close it
      var modal = document.querySelector('.modal[style*="display: flex"], .modal[style*="display:flex"]');
      if (modal) {
        modal.style.display = 'none';
        return;
      }
      // If on home page, minimize app
      if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
        App.minimizeApp();
      } else {
        window.history.back();
      }
    });
  }

  /* ══════════════════════════════════════════
   *  HIDE PWA INSTALL BANNER in native app
   * ══════════════════════════════════════════ */
  var pwaInstallBanner = document.getElementById('pwaInstallBanner');
  if (pwaInstallBanner) {
    pwaInstallBanner.style.display = 'none';
  }
  // Also prevent it from showing later
  var origAddEventListener = window.addEventListener;
  window.addEventListener = function(type, listener, options) {
    if (type === 'beforeinstallprompt') return; // suppress in native
    return origAddEventListener.call(window, type, listener, options);
  };

  /* ══════════════════════════════════════════
   *  NATIVE APP INDICATOR
   * ══════════════════════════════════════════ */
  document.documentElement.classList.add('capacitor-app');
  document.documentElement.classList.add('platform-' + platform);
  window.toonItIsNative = true;
  window.toonItPlatform = platform;


  /* ══════════════════════════════════════════
   *  DOWNLOAD — Capacitor native save
   *  <a download> doesn't work in WebView;
   *  use navigator.share({files}) instead
   * ══════════════════════════════════════════ */


  // Override global download functions

  // Override dashboard download + share (myvideos.html modal)
  function overrideDashButtons() {
    var dashDl = document.getElementById('dashDownloadBtn');
    if (dashDl) {
      dashDl.onclick = function(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        var mv = document.getElementById('modalVideo');
        var url = mv ? (mv.currentSrc || mv.src) : '';
        if (url) window.burnWatermarkAndDownload(url, true, 'toonit-video.mp4', function() {
          dashDl.textContent = 'Download'; dashDl.disabled = false;
        });
        return false;
      };
    }
    var shareBtn = document.getElementById('shareVideoBtn');
    if (shareBtn) {
      shareBtn.onclick = async function(e) {
        if (e) e.preventDefault();
        var mv = document.getElementById('modalVideo');
        var url = mv ? (mv.currentSrc || mv.src) : '';
        if (!url) return;
        shareBtn.textContent = 'Sharing...';
        try {
          var shared = false;
          try {
            var resp = await fetch(url);
            var blob = await resp.blob();
            var file = new File([blob], 'toonit-video.mp4', { type: 'video/mp4' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: 'My ToonIt Video', text: 'Check out my magical transformation! Made with ToonIt.ai' });
              shared = true;
            }
          } catch(fe) {
            console.log('[ToonIt Bridge] File share failed:', fe.message);
          }
          if (!shared && navigator.share) {
            await navigator.share({ title: 'My ToonIt Video', text: 'Check out my magical transformation! Made with ToonIt.ai', url: 'https://toonit.ai' });
          }
        } catch (e) {
          if (e.name !== 'AbortError') console.error('[ToonIt Bridge] Modal share error:', e);
        } finally { shareBtn.textContent = 'Share Video'; }
      };
    }
  }
  setTimeout(overrideDashButtons, 2000);
  var _dashObs = new MutationObserver(function() { setTimeout(overrideDashButtons, 300); });
  setTimeout(function() {
    var modal = document.getElementById('videoModal');
    if (modal) _dashObs.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }, 2000);

  /* ══════════════════════════════════════════
   *  SHARE BUTTON — Inject in result area
   * ══════════════════════════════════════════ */
  function injectNativeShareButton() {
    var resultBtns = document.querySelector('#result .result-buttons');
    if (!resultBtns || document.getElementById('nativeShareBtn')) return;
    var btn = document.createElement('button');
    btn.id = 'nativeShareBtn';
    btn.type = 'button';
    btn.textContent = 'Share';
    btn.style.cssText = 'background:transparent;color:#f0b429;border:1.5px solid #f0b429;padding:10px 20px;border-radius:25px;cursor:pointer;font-weight:600;font-size:0.95em;';
    btn.addEventListener('click', async function(e) {
      e.preventDefault();
      var video = document.getElementById('resultVideo');
      var url = video ? (video.currentSrc || video.src) : '';
      if (!url) return;
      btn.textContent = 'Sharing...';
      btn.disabled = true;
      try {
        // Try sharing the video file
        var shared = false;
        try {
          var resp = await fetch(url);
          var blob = await resp.blob();
          var file = new File([blob], 'toonit-video.mp4', { type: 'video/mp4' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'My ToonIt Video', text: 'Check out my magical transformation! Made with ToonIt.ai' });
            shared = true;
          }
        } catch(fe) {
          console.log('[ToonIt Bridge] File share failed, trying URL share:', fe.message);
        }
        // Fallback: share URL only
        if (!shared) {
          if (navigator.share) {
            await navigator.share({ title: 'My ToonIt Video', text: 'Check out my magical transformation! Made with ToonIt.ai', url: 'https://toonit.ai' });
          } else {
            // Copy link fallback
            await navigator.clipboard.writeText('https://toonit.ai');
            btn.textContent = 'Link Copied!';
            setTimeout(function() { btn.textContent = 'Share'; }, 2000);
            return;
          }
        }
        try { if (Haptics) Haptics.impact({ style: 'LIGHT' }); } catch(e) {}
      } catch (e) {
        if (e.name !== 'AbortError') console.error('[ToonIt Bridge] Share error:', e);
      } finally {
        btn.textContent = 'Share';
        btn.disabled = false;
      }
    });
    var newBtn = document.getElementById('newBtn');
    if (newBtn) resultBtns.insertBefore(btn, newBtn);
    else resultBtns.appendChild(btn);
    console.log('[ToonIt Bridge] Native share button injected');
  }

  /* ══════════════════════════════════════════
   *  THUMBNAILS — Fix video poster in WebView
   *  Android WebView doesn't auto-show frames
   * ══════════════════════════════════════════ */
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


  /* ══════════════════════════════════════════
   *  DOWNLOAD — Override burnWatermarkAndDownload only
   *  This preserves the existing watermark pipeline
   *  (downloadVideo → _resolveLandingDownloadUrl → here)
   *  We only replace the final save-to-device step
   * ══════════════════════════════════════════ */
  window.burnWatermarkAndDownload = function(videoUrl, isRemoved, filename, onDone) {
    filename = filename || 'toonit-video.mp4';
    console.log('[ToonIt Bridge] Download intercepted, fetching video...');
    fetch(videoUrl)
      .then(function(r) {
        if (!r.ok) throw new Error('fetch ' + r.status);
        return r.blob();
      })
      .then(function(blob) {
        var file = new File([blob], filename, { type: 'video/mp4' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: 'My ToonIt Video' })
            .catch(function(e) {
              if (e.name !== 'AbortError') throw e;
            });
        } else {
          var blobUrl = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = blobUrl; a.download = filename;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(function() { URL.revokeObjectURL(blobUrl); }, 5000);
        }
      })
      .catch(function(err) {
        console.error('[ToonIt Bridge] Download error:', err);
        window.open(videoUrl, '_blank');
      })
      .finally(function() { if (onDone) onDone(); });
  };

  window.downloadVideoFallbackLocal = function() {
    var v = document.getElementById('resultVideo');
    var url = v ? (v.currentSrc || v.src) : '';
    if (url) window.burnWatermarkAndDownload(url, true, 'toonit-video.mp4', function() {});
  };


  console.log('[ToonIt Bridge] ✅ Native bridge initialized for ' + platform);
})();
