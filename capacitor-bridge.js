/**
 * Toon It! — Capacitor Native Bridge v2.1
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

  console.log('[ToonIt Bridge] Initializing native bridge v2.5 (Watermark-Preserving Download)...');

  var platform = window.Capacitor.getPlatform(); // 'ios' | 'android'
  // [v2.5] Watermark-preserving: Let web code handle watermark burn, then Layer 1 intercepts blob <a download> for MediaSaver/share

  // ══════════════════════════════════════════════════════════════
  //  LOGGING — Console only (no visible overlay in production)
  // ══════════════════════════════════════════════════════════════
  function dbg(msg) {
    console.log('[Bridge] ' + msg);
  }
  dbg('Bridge v2.5-wp init | platform=' + platform);

  // ══════════════════════════════════════════════════════════════
  //  PLUGIN REFERENCES
  // ══════════════════════════════════════════════════════════════
  var Plugins = window.Capacitor.Plugins || {};
  var CapShare     = Plugins.Share;
  var CapCamera    = Plugins.Camera;
  var CapHaptics   = Plugins.Haptics;
  var CapStatusBar = Plugins.StatusBar;
  var CapBrowser   = Plugins.Browser;
  var CapFilesystem = Plugins.Filesystem;
  var CapApp       = Plugins.App;
  var CapSplash    = Plugins.SplashScreen;
  var CapKeyboard  = Plugins.Keyboard;
  var CapPush      = Plugins.PushNotifications;

  var CapMediaSaver = Plugins.MediaSaver;  // Custom plugin for silent Android downloads

  dbg('Plugins: Share=' + !!CapShare + ' Camera=' + !!CapCamera + ' Filesystem=' + !!CapFilesystem + ' MediaSaver=' + !!CapMediaSaver);

  // ══════════════════════════════════════════════════════════════
  //  CORE HELPER: Save/share a video from URL
  //  This is THE function that replaces broken <a download>
  // ══════════════════════════════════════════════════════════════
  // Native toast helper
  function _showNativeToast(msg) {
    try {
      var toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);'
        + 'background:#181830;border:1px solid #7c6bfa;border-radius:12px;padding:12px 24px;'
        + 'z-index:99999;color:#fff;font-size:0.9em;box-shadow:0 4px 20px rgba(0,0,0,0.5);'
        + 'max-width:90vw;text-align:center;';
      toast.textContent = msg;
      document.body.appendChild(toast);
      setTimeout(function() {
        toast.style.transition = 'opacity 0.3s';
        toast.style.opacity = '0';
        setTimeout(function() { toast.remove(); }, 300);
      }, 3000);
    } catch(e) {}
  }

  async function saveOrShareVideo(videoUrl, filename, btnEl) {
    filename = filename || 'toonit-video.mp4';
    var origText = btnEl ? btnEl.textContent : '';
    if (btnEl) { btnEl.textContent = '⬇️ Saving...'; btnEl.disabled = true; }
    dbg('saveOrShare: platform=' + platform + ' url=' + videoUrl.substring(0, 80));

    try {
      // Step 1: Fetch the video blob
      var resp = await fetch(videoUrl);
      if (!resp.ok) throw new Error('fetch failed: ' + resp.status);
      var blob = await resp.blob();
      dbg('blob: ' + blob.size + ' bytes, type=' + blob.type);
      if (blob.size < 1000) throw new Error('Video blob too small: ' + blob.size);

      // Step 2: Convert to base64
      var base64Data = await new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onloadend = function() { resolve(reader.result.split(',')[1]); };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      dbg('base64 ready: ' + base64Data.length + ' chars');

      // ─── ANDROID: Use MediaSaver plugin for silent save to Downloads ───
      if (platform === 'android' && CapMediaSaver) {
        dbg('Android: Using MediaSaver plugin for silent download...');
        if (btnEl) { btnEl.textContent = '⬇️ Saving to Downloads...'; }
        var saveResult = await CapMediaSaver.saveVideo({
          data: base64Data,
          filename: filename,
          mimeType: 'video/mp4'
        });
        dbg('MediaSaver result: ' + JSON.stringify(saveResult));
        if (btnEl) { btnEl.textContent = '✅ Saved to Downloads!'; }
        setTimeout(function() {
          if (btnEl) { btnEl.textContent = origText || '⬇️ Download'; btnEl.disabled = false; }
        }, 2000);
        try { if (CapHaptics) CapHaptics.impact({ style: 'MEDIUM' }); } catch(e) {}
        _showNativeToast('✅ Video saved to Downloads!');
        return true;
      }

      // ─── ANDROID FALLBACK: CACHE + Share sheet if MediaSaver not available ───
      if (platform === 'android' && CapFilesystem && CapShare) {
        dbg('Android fallback: CACHE + Share sheet...');
        var tmpName = 'toonit-download-' + Date.now() + '.mp4';
        var writeResult = await CapFilesystem.writeFile({
          path: tmpName,
          data: base64Data,
          directory: 'CACHE'
        });
        var fileUri = writeResult.uri;
        if (btnEl) { btnEl.textContent = '💾 Choose save location...'; }
        await CapShare.share({
          title: filename,
          url: fileUri,
          dialogTitle: 'Save your ToonIt video'
        });
        if (btnEl) { btnEl.textContent = '✅ Done!'; }
        setTimeout(function() {
          if (btnEl) { btnEl.textContent = origText || '⬇️ Download'; btnEl.disabled = false; }
        }, 2000);
        try { if (CapHaptics) CapHaptics.impact({ style: 'MEDIUM' }); } catch(e) {}
        setTimeout(function() {
          try { CapFilesystem.deleteFile({ path: tmpName, directory: 'CACHE' }); } catch(e) {}
        }, 60000);
        return true;
      }

      // ─── iOS: Use navigator.share with file (saves directly) ───
      // Or fallback to blob + <a download> which works in WKWebView
      var file = new File([blob], filename, { type: blob.type || 'video/mp4' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        dbg('iOS/fallback: navigator.share({files})');
        await navigator.share({ files: [file], title: 'My ToonIt Video' });
        return true;
      }

      // Last resort: open URL
      dbg('Last resort: window.open');
      window._origOpen.call(window, videoUrl, '_blank');
      return false;

    } catch (err) {
      if (err && err.name === 'AbortError') { dbg('User cancelled'); return false; }
      dbg('ERROR: ' + (err && err.message || err));
      console.error('[Bridge] saveOrShare error:', err);
      _showNativeToast('❌ Download failed: ' + (err && err.message || 'Unknown error'));
      try { window._origOpen.call(window, videoUrl, '_blank'); } catch(e) {}
      return false;
    } finally {
      setTimeout(function() {
        if (btnEl) { btnEl.textContent = origText || '⬇️ Download'; btnEl.disabled = false; }
      }, 2500);
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
          dbg('L1 blob: ' + blob.size + ' bytes, platform=' + platform);

          // ─── Android: Use MediaSaver for silent save to Downloads ───
          if (platform === 'android' && CapMediaSaver) {
            dbg('L1 → Android MediaSaver silent download');
            return new Promise(function(resolve, reject) {
              var reader = new FileReader();
              reader.onloadend = function() { resolve(reader.result.split(',')[1]); };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            }).then(function(base64Data) {
              return CapMediaSaver.saveVideo({
                data: base64Data,
                filename: dl,
                mimeType: blob.type || 'video/mp4'
              });
            }).then(function(result) {
              dbg('L1 MediaSaver saved: ' + JSON.stringify(result));
              try { if (CapHaptics) CapHaptics.impact({ style: 'MEDIUM' }); } catch(e) {}
              _showNativeToast('✅ Video saved to Downloads!');
            });
          }

          // ─── Android fallback: CACHE + Share sheet ───
          if (platform === 'android' && CapFilesystem && CapShare) {
            dbg('L1 → Android CACHE+Share fallback');
            return new Promise(function(resolve, reject) {
              var reader = new FileReader();
              reader.onloadend = function() { resolve(reader.result.split(',')[1]); };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            }).then(function(base64Data) {
              var tmpName = 'toonit-dl-' + Date.now() + '.mp4';
              return CapFilesystem.writeFile({ path: tmpName, data: base64Data, directory: 'CACHE' })
                .then(function(wr) {
                  return CapShare.share({ title: dl, url: wr.uri, dialogTitle: 'Save your ToonIt video' });
                });
            });
          }

          // ─── Non-Android (iOS): use navigator.share with file ───
          var file = new File([blob], dl, { type: blob.type || 'video/mp4' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            dbg('L1 → navigator.share({files})');
            return navigator.share({ files: [file], title: dl });
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
    // [v2.5] Resolve URL respecting watermark on/off state
    try {
      var wm = window._wmState;
      if (wm) {
        var isRemoved = wm.globalRemoved || wm.currentVideoRemoved;
        if (isRemoved) {
          if (wm.currentCleanUrl) return wm.currentCleanUrl;
        } else {
          if (wm.wmReady && wm.currentWmUrl) return wm.currentWmUrl;
          if (wm.currentCleanUrl) return wm.currentCleanUrl;
        }
      }
    } catch(e) { dbg('getVideoUrl wmState error: ' + e); }

    var vid = document.getElementById('resultVideo');
    if (vid && (vid.currentSrc || vid.src)) {
      var src = vid.currentSrc || vid.src;
      if (src && src !== '' && !src.endsWith('/')) return src;
    }
    var mv = document.getElementById('modalVideo');
    if (mv && (mv.currentSrc || mv.src)) return mv.currentSrc || mv.src;
    return '';
  }

  function overrideIndexButtons() {
    // === DOWNLOAD BUTTON (index.html) ===
    // NOT overridden — web code's downloadVideo() → burnWatermarkAndDownload() handles
    // watermark logic, then creates blob → <a download> → Layer 1 intercepts for MediaSaver
    // This preserves watermark on downloads across all platforms

    // === SHARE BUTTON (index.html — inject if not found) ===
    var shareBtn = document.getElementById('nativeShareBtn');
    if (!shareBtn) {
      var resultBtns = document.querySelector('.result-buttons');
      var newBtnRef = document.getElementById('newBtn');
      if (resultBtns) {
        shareBtn = document.createElement('button');
        shareBtn.type = 'button';
        shareBtn.id = 'nativeShareBtn';
        shareBtn.textContent = '📤 Share';
        if (newBtnRef && newBtnRef.parentNode === resultBtns) {
          resultBtns.insertBefore(shareBtn, newBtnRef);
        } else {
          resultBtns.appendChild(shareBtn);
        }
        dbg('LAYER3: injected nativeShareBtn');
      }
    }
    if (shareBtn && !shareBtn._bridgeCapture) {
      shareBtn._bridgeCapture = true;
      shareBtn.style.display = '';
      dbg('LAYER3: overriding nativeShareBtn (capture)');

      shareBtn.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        var url = getVideoUrl();
        if (!url) return;
        dbg('L3 share: ' + url.substring(0, 60));
        shareVideoNative(url, shareBtn);
      }, true);
    }
  }

  function overrideDashboardButtons() {
    // === DOWNLOAD BUTTON (myvideos.html modal) ===
    // NOT overridden — web code handles watermark logic, Layer 1 intercepts blob download

    // === SHARE BUTTON (myvideos.html modal) ===
    var shareBtn = document.getElementById('shareVideoBtn');
    if (shareBtn && !shareBtn._bridgeCapture) {
      shareBtn._bridgeCapture = true;
      dbg('LAYER3: overriding shareVideoBtn (capture-phase)');

      shareBtn.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        var mv = document.getElementById('modalVideo');
        var url = mv ? (mv.currentSrc || mv.src) : '';
        if (!url) return;
        dbg('L3 dash share: ' + url.substring(0, 60));
        shareVideoNative(url, shareBtn);
      }, true);
    }
  }

  async function shareVideoNative(videoUrl, btnEl) {
    var origText = btnEl ? btnEl.textContent : 'Share';
    if (btnEl) { btnEl.textContent = 'Preparing...'; btnEl.disabled = true; }
    dbg('shareVideoNative: ' + videoUrl.substring(0, 80));

    try {
      var resp = await fetch(videoUrl);
      if (!resp.ok) throw new Error('fetch ' + resp.status);
      var blob = await resp.blob();
      dbg('share blob: ' + blob.size + ' bytes');

      // Write to cache, then share file URI
      if (CapFilesystem && CapShare) {
        var base64Data = await new Promise(function(resolve, reject) {
          var reader = new FileReader();
          reader.onloadend = function() { resolve(reader.result.split(',')[1]); };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        var tmpName = 'toonit-share-' + Date.now() + '.mp4';
        var writeResult = await CapFilesystem.writeFile({
          path: tmpName,
          data: base64Data,
          directory: 'CACHE'
        });
        dbg('Share temp file: ' + JSON.stringify(writeResult));
        var fileUri = writeResult.uri;
        dbg('Sharing file URI: ' + fileUri);
        await CapShare.share({
          title: 'My ToonIt Video',
          text: '✨ Made with ToonIt.ai',
          url: fileUri,
          dialogTitle: 'Share your ToonIt video'
        });
        dbg('Share completed');
        try { if (CapHaptics) CapHaptics.impact({ style: 'LIGHT' }); } catch(e) {}
        // Cleanup temp file after delay
        setTimeout(function() {
          try { CapFilesystem.deleteFile({ path: tmpName, directory: 'CACHE' }); } catch(e) {}
        }, 30000);
        return;
      }

      // Fallback: navigator.share with File
      var file = new File([blob], 'toonit-video.mp4', { type: 'video/mp4' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        dbg('share fallback: navigator.share({files})');
        await navigator.share({
          files: [file],
          title: 'My ToonIt Video',
          text: '✨ Made with ToonIt.ai'
        });
        return;
      }

      // Last resort: share URL
      if (navigator.share) {
        await navigator.share({ title: 'My ToonIt Video', url: 'https://toonit.ai' });
      }
    } catch (err) {
      if (err && err.name !== 'AbortError') {
        dbg('share error: ' + (err.message || err));
        _showNativeToast('❌ Share failed. Please try again.');
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
        if (m.target.id === 'result') {
          var camBtn = document.getElementById('nativeCameraBtn');
          if (m.target.style.display === 'block') {
            // Hide camera button when result is shown
            if (camBtn) camBtn.style.display = 'none';

            var count = parseInt(localStorage.getItem('toonit_transform_count') || '0') + 1;
            localStorage.setItem('toonit_transform_count', count.toString());
            dbg('Transform #' + count + ' completed (camera hidden)');

            // Re-run button overrides (result area just appeared)
            setTimeout(runAllOverrides, 500);
            setTimeout(runAllOverrides, 1500);

            // Haptic celebration
            try { if (CapHaptics) CapHaptics.impact({ style: 'HEAVY' }); } catch(e) {}

            // Review after 2nd transform
            if (count === 2) {
              setTimeout(function() { window.toonItRequestReview(); }, 5000);
            }
          } else {
            // Result hidden (Create Another) — restore camera button
            if (camBtn) camBtn.style.display = 'block';
            dbg('Result hidden — camera button restored');
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
  //  APPLE SIGN IN — iOS Requirement (HIG Compliant)
  // ══════════════════════════════════════════════════════════════
  // Apple requires Sign In with Apple if any third-party sign-in is offered.
  // HIG requirements:
  //   - Must be displayed with equal or greater prominence than other sign-in options
  //   - Must appear in BOTH login and signup contexts
  //   - Button must use Apple's visual design (black background, white text, Apple logo)
  //   - Account deletion must be available within the app (we have delete-account.html)
  if (platform === 'ios') {
    dbg('iOS detected — enabling Sign In with Apple requirement');
    document.documentElement.classList.add('ios-apple-signin-required');
    window.toonItIOSSignInRequired = true;

    // Inject Apple Sign In button into a container (login or signup)
    // Placed BEFORE Google button per HIG (equal or greater prominence)
    function injectAppleSignIn(containerId, suffix) {
      var container = document.getElementById(containerId);
      if (!container) return false;
      if (document.getElementById('apple-signin-btn-' + suffix)) return true; // Already injected

      var googleBtn = container.querySelector('button');
      if (!googleBtn) return false;

      var appleBtn = document.createElement('button');
      appleBtn.id = 'apple-signin-btn-' + suffix;
      appleBtn.type = 'button';
      // Style matches Apple HIG: black background, white text, left-aligned Apple logo
      appleBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;max-width:320px;padding:10px 24px;background:#000;color:#fff;border:1px solid #000;border-radius:4px;font-size:14px;font-weight:500;cursor:pointer;margin:0 auto;transition:background 0.2s;';
      appleBtn.onmouseenter = function() { appleBtn.style.background = '#333'; };
      appleBtn.onmouseleave = function() { appleBtn.style.background = '#000'; };
      appleBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.58 9.05 7.28c1.36-.07 2.31.75 3.1.75.78 0 2.01-.82 3.39-.7 1.44.11 2.52.7 3.24 1.78-2.97 1.78-2.49 5.19.45 6.12-.53 1.61-1.24 3.18-2.18 4.56zM12.03 7.25c-.15-1.94 1.44-3.53 3.27-3.69.22 2.16-1.95 3.69-3.27 3.69z"/></svg> Sign in with Apple';
      appleBtn.setAttribute('data-provider', 'apple');

      // Use Supabase Auth's Apple provider for OAuth
      appleBtn.addEventListener('click', function() {
        dbg('Apple Sign In button clicked (' + suffix + ')');
        try {
          if (typeof window.supabase !== 'undefined' && window.supabase.auth) {
            window.supabase.auth.signInWithOAuth({
              provider: 'apple',
              options: {
                redirectTo: 'https://toonit.ai/'
              }
            });
          } else if (typeof window.signInWithApple === 'function') {
            window.signInWithApple();
          } else {
            dbg('ERROR: No Apple Sign In handler available');
          }
        } catch (e) {
          dbg('Apple Sign In error: ' + e.message);
        }
      });

      // Insert Apple button BEFORE Google button (HIG: equal or greater prominence)
      container.insertBefore(appleBtn, googleBtn);
      // Add spacing between Apple and Google buttons
      var spacer = document.createElement('div');
      spacer.style.cssText = 'height:8px;';
      container.insertBefore(spacer, googleBtn);
      dbg('Apple Sign In button injected in ' + containerId + ' (before Google)');
      return true;
    }

    // Watch for login/signup modals and inject Apple Sign In buttons
    function tryInjectAppleButtons() {
      injectAppleSignIn('googleLoginContainer', 'login');
      injectAppleSignIn('googleSignupContainer', 'signup');
    }

    var signinObs = new MutationObserver(function() {
      setTimeout(tryInjectAppleButtons, 300);
    });
    setTimeout(function() {
      if (document.body) signinObs.observe(document.body, { childList: true, subtree: true });
      tryInjectAppleButtons();
    }, 1000);
  }

  // ══════════════════════════════════════════════════════════════
  //  DONE
  // ══════════════════════════════════════════════════════════════
  dbg('\u2705 Bridge v2.5-wp+apple ready | ' + platform);
  console.log('[ToonIt Bridge] \u2705 v2.5-wp+apple initialized for ' + platform);
})();
