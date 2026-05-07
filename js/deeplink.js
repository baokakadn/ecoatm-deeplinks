(function () {
  'use strict';

  /* ─── Config ─────────────────────────────────────────────── */
  var ANDROID_PKG     = 'com.ecoatm.ecoapp.android_qa';
  var IOS_STORE       = 'https://apps.apple.com/us/app/ecoatm/id944835823';
  var ANDROID_STORE   = 'https://play.google.com/store/apps/details?id=com.ecoatm.ecoapp.android';
  var APP_SCHEME      = 'ecoatm://';
  var TIMEOUT_MS      = 2500;

  var WEB_FALLBACK = {
    'home':       'https://www.ecoatm.com',
    'sell':       'https://www.ecoatm.com/pages/sell',
    'find-kiosk': 'https://locations.ecoatm.com',
    'offers':     'https://www.ecoatm.com',
    'account':    'https://www.ecoatm.com',
    'price-view': 'https://www.ecoatm.com/pages/sell'
  };

  var PATH_TO_SCREEN = {
    'email':      'home',
    'sms':        'sell',
    'social':     'sell',
    'qr':         'sell',
    'push':       'home',
    'find-kiosk': 'find-kiosk',
    'sell':       'sell',
    'offers':     'offers',
    'account':    'account',
    'price-view': 'price-view'
  };

  /* ─── Platform detection ──────────────────────────────────── */
  function getPlatform() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua))          return 'android';
    return 'desktop';
  }

  function isFacebookBrowser() {
    return /FBAN|FBAV/i.test(navigator.userAgent || '');
  }

  function isInstagramBrowser() {
    return /Instagram/i.test(navigator.userAgent || '');
  }

  function isInAppBrowser() {
    return /FBAN|FBAV|Instagram|Twitter|LinkedInApp|TikTok|BytedanceWebview/i.test(navigator.userAgent || '');
  }

  /* ─── URL helpers ─────────────────────────────────────────── */
  function getParams() {
    return new URLSearchParams(window.location.search);
  }

  function getScreen() {
    var fromQuery = getParams().get('screen');
    if (fromQuery) return fromQuery;
    var path = window.location.pathname.replace(/^\//, '').split('/')[0];
    return PATH_TO_SCREEN[path] || 'home';
  }

  function getWebFallback(screen) {
    return WEB_FALLBACK[screen] || 'https://www.ecoatm.com';
  }

  function buildAppURI(screen, extra) {
    var path = 'screen/' + encodeURIComponent(screen);

    if (screen === 'offers'     && extra['offer_id'])    path += '/' + encodeURIComponent(extra['offer_id']);
    if (screen === 'find-kiosk' && extra['kiosk_id'])    path += '/' + encodeURIComponent(extra['kiosk_id']);
    if (screen === 'price-view' && extra['estimate_id']) path += '/' + encodeURIComponent(extra['estimate_id']);
    if (screen === 'sell'       && extra['sub-screen'] === 'this-device') path += '/this-device';

    var p = new URLSearchParams();
    ['brand', 'model', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content']
      .forEach(function (k) { if (extra[k]) p.set(k, extra[k]); });

    var qs = p.toString();
    return APP_SCHEME + path + (qs ? '?' + qs : '');
  }

  function buildIntentURI(appUri, storeUrl) {
    var path = appUri.replace(APP_SCHEME, '');
    return 'intent://' + path
      + '#Intent'
      + ';scheme=ecoatm'
      + ';package=' + ANDROID_PKG
      + ';S.browser_fallback_url=' + encodeURIComponent(storeUrl)
      + ';end';
  }

  /* ─── Status helper ───────────────────────────────────────── */
  function updateStatus(msg) {
    var el = document.getElementById('redirect-status');
    if (el) el.textContent = msg;
  }

  /* ─── App open — native browsers (iOS & Android Chrome) ───── */
  function tryOpenApp(appUri, storeUrl) {
    updateStatus('Opening ecoATM app\u2026');

    var platform   = getPlatform();
    var redirected = false;

    var timer = setTimeout(function () {
      if (redirected) return;
      redirected = true;
      updateStatus('App not found. Redirecting to store\u2026');
      window.location.href = storeUrl;
    }, TIMEOUT_MS);

    function cancel() {
      if (redirected) return;
      redirected = true;
      clearTimeout(timer);
    }

    document.addEventListener('visibilitychange', function onVis() {
      if (document.hidden) {
        cancel();
        document.removeEventListener('visibilitychange', onVis);
      }
    });

    window.addEventListener('pagehide', function onHide() {
      cancel();
      window.removeEventListener('pagehide', onHide);
    });

    window.addEventListener('pageshow', function onShow() {
      cancel();
      window.removeEventListener('pageshow', onShow);
    }, { once: true });

    if (platform === 'ios') {
      window.location.href = appUri;
    } else {
      window.location.href = buildIntentURI(appUri, storeUrl);
    }
  }

  /* ─── App open — Facebook/Instagram IAB (no intent:// support) */
  function tryOpenAppDirectScheme(appUri, storeUrl) {
    var redirected = false;

    var timer = storeUrl
      ? setTimeout(function () {
          if (redirected) return;
          redirected = true;
          updateStatus('App not found. Redirecting to store\u2026');
          window.location.href = storeUrl;
        }, TIMEOUT_MS)
      : null;

    document.addEventListener('visibilitychange', function onVis() {
      if (document.hidden) {
        if (timer) clearTimeout(timer);
        redirected = true;
        document.removeEventListener('visibilitychange', onVis);
      }
    });

    window.location.href = appUri;
  }

  /* ─── Facebook "open in browser" banner ──────────────────── */
  function showOpenInBrowserBanner(immediate) {
    function render() {
      if (document.getElementById('eco-iab-banner')) return;
      if (document.hidden) return;

      var banner = document.createElement('div');
      banner.id = 'eco-iab-banner';
      banner.style.cssText = [
        'position:fixed', 'bottom:0', 'left:0', 'right:0',
        'background:#fff', 'border-top:1px solid #e0e0e0',
        'padding:16px 20px', 'display:flex', 'align-items:center',
        'gap:12px', 'z-index:9999', 'font-family:sans-serif',
        'box-shadow:0 -2px 12px rgba(0,0,0,0.12)'
      ].join(';');

      banner.innerHTML =
        '<div style="flex:1;font-size:14px;color:#1a1a1a;line-height:1.5">'
        + '<strong style="display:block;margin-bottom:4px">Open in your browser to launch the ecoATM app</strong>'
        + 'Tap <strong>\u22ee</strong> at the top right, then choose '
        + '<em>\u201cOpen in Chrome\u201d</em> or <em>\u201cOpen in system browser\u201d</em>.'
        + '</div>'
        + '<button onclick="this.parentNode.remove()" style="'
        + 'border:none;background:none;font-size:22px;cursor:pointer;'
        + 'color:#888;padding:4px;flex-shrink:0">\u00d7</button>';

      document.body.appendChild(banner);
    }

    setTimeout(render, immediate ? 400 : 1800);
  }

  /* ─── Main router ─────────────────────────────────────────── */
  function route() {
    var platform = getPlatform();
    var params   = getParams();
    var screen   = getScreen();
    var inFB     = isFacebookBrowser();
    var inIG     = isInstagramBrowser();
    var inIAB    = isInAppBrowser();

    var FORWARD_KEYS = [
      'offer_id', 'kiosk_id', 'estimate_id',
      'brand', 'model', 'sub-screen',
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content'
    ];
    var extra = {};
    FORWARD_KEYS.forEach(function (k) {
      var v = params.get(k);
      if (v) extra[k] = v;
    });

    var appUri   = buildAppURI(screen, extra);
    var storeUrl = platform === 'ios' ? IOS_STORE : ANDROID_STORE;

    updateStatus('Detecting your device\u2026');

    /* Desktop → web fallback */
    if (platform === 'desktop') {
      updateStatus('Opening ecoATM website\u2026');
      window.location.replace(getWebFallback(screen));
      return;
    }

    /* Facebook IAB — Android blocks intent:// and custom schemes */
    if (inFB && platform === 'android') {
      updateStatus('Opening ecoATM app\u2026');
      showOpenInBrowserBanner(true);
      tryOpenAppDirectScheme(appUri, null);
      return;
    }

    /* Instagram IAB — Android uses Chrome Custom Tab, intent:// works */
    if (inIG && platform === 'android') {
      updateStatus('Opening ecoATM app\u2026');
      tryOpenApp(appUri, storeUrl);
      return;
    }

    /* Other IAB (TikTok, Twitter, etc.) */
    if (inIAB) {
      updateStatus('Opening ecoATM app\u2026');
      if (platform === 'ios') {
        tryOpenApp(appUri, storeUrl);
      } else {
        tryOpenAppDirectScheme(appUri, storeUrl);
      }
      return;
    }

    /* Native Safari / Chrome */
    tryOpenApp(appUri, storeUrl);
  }

  /* ─── Boot ────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', route);
  } else {
    route();
  }

}());