(function () {
  'use strict';

  /* ─── Config ────────────────────────────────────────────────────────── */

  var ANDROID_PKG    = 'com.ecoatm.ecoapp.android_qa';
  var IOS_STORE      = 'https://apps.apple.com/us/app/ecoatm/id944835823';
  var ANDROID_STORE  = 'https://play.google.com/store/apps/details?id=com.ecoatm.ecoapp.android';
  var APP_SCHEME     = 'ecoatm://';
  var TIMEOUT_MS     = 2500;

  var WEB_FALLBACK = {
    'home':        'https://www.ecoatm.com',
    'sell':        'https://www.ecoatm.com/price-your-device',
    'find-kiosk':  'https://www.ecoatm.com/locations',
    'offers':      'https://www.ecoatm.com',
    'account':     'https://www.ecoatm.com',
    'price-view':  'https://www.ecoatm.com/price-your-device',
  };

  var PATH_TO_SCREEN = {
    'email':       'home',
    'sms':         'sell',
    'social':      'sell',
    'qr':          'sell',
    'push':        'home',
    'find-kiosk':  'find-kiosk',
    'sell':        'sell',
    'offers':      'offers',
    'account':     'account',
    'price-view':  'price-view',
  };

  /* ─── Platform detection ─────────────────────────────────────────────── */

  function getPlatform() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua))          return 'android';
    return 'desktop';
  }

  function isInAppBrowser() {
    var ua = navigator.userAgent || '';
    return /FBAN|FBAV|Instagram|Twitter|LinkedInApp|TikTok|BytedanceWebview/i.test(ua);
  }

  function isFacebookBrowser() {
    var ua = navigator.userAgent || '';
    return /FBAN|FBAV/i.test(ua);
  }

  function isInstagramBrowser() {
    var ua = navigator.userAgent || '';
    return /Instagram/i.test(ua);
  }

  /* ─── URL helpers ────────────────────────────────────────────────────── */

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

  function buildDeepLinkURI(screen, extra) {
    var path = 'screen/' + encodeURIComponent(screen);
    if (screen === 'offers'     && extra['offer_id'])    path += '/' + encodeURIComponent(extra['offer_id']);
    if (screen === 'find-kiosk' && extra['kiosk_id'])    path += '/' + encodeURIComponent(extra['kiosk_id']);
    if (screen === 'price-view' && extra['estimate_id']) path += '/' + encodeURIComponent(extra['estimate_id']);
    if (screen === 'sell'       && extra['sub-screen'] === 'this-device') path += '/this-device';
    var p = new URLSearchParams();
    ['brand','model','utm_source','utm_medium','utm_campaign','utm_content']
      .forEach(function (k) { if (extra[k]) p.set(k, extra[k]); });
    var qs = p.toString();
    return APP_SCHEME + path + (qs ? '?' + qs : '');
  }

  function buildIntentUri(appUri, storeUrl) {
    var withoutScheme = appUri.replace(APP_SCHEME, '');
    return 'intent://' + withoutScheme
      + '#Intent'
      + ';scheme=ecoatm'
      + ';package=' + ANDROID_PKG
      + ';S.browser_fallback_url=' + encodeURIComponent(storeUrl)
      + ';end';
  }

  /* ─── App open attempts ──────────────────────────────────────────────── */

  function tryOpenApp(uri, storeUrl) {
    updateStatus('Trying to open the ecoATM app\u2026');
    var platform   = getPlatform();
    var redirected = false;

    function goToStore() {
      if (redirected) return;
      redirected = true;
      updateStatus('App not found. Redirecting to store\u2026');
      window.location.href = storeUrl;
    }

    var timer = setTimeout(goToStore, TIMEOUT_MS);

    function onHide() {
      clearTimeout(timer);
      redirected = true;
      document.removeEventListener('visibilitychange', onVisChange);
      window.removeEventListener('pagehide', onHide);
    }
    function onVisChange() { if (document.hidden) onHide(); }
    document.addEventListener('visibilitychange', onVisChange);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', function onShow() {
      clearTimeout(timer);
      redirected = true;
      window.removeEventListener('pageshow', onShow);
    }, { once: true });

    if (platform === 'ios') {
      window.location.href = uri;
    } else {
      window.location.href = buildIntentUri(uri, storeUrl);
    }
  }

  function tryOpenAppDirectScheme(uri, storeUrl) {
    var redirected = false;

    var timer = storeUrl ? setTimeout(function () {
      if (redirected) return;
      redirected = true;
      updateStatus('App not found. Redirecting to store\u2026');
      window.location.href = storeUrl;
    }, TIMEOUT_MS) : null;

    function onHide() {
      if (timer) clearTimeout(timer);
      redirected = true;
      document.removeEventListener('visibilitychange', onVisChange);
    }
    function onVisChange() { if (document.hidden) onHide(); }
    document.addEventListener('visibilitychange', onVisChange);

    window.location.href = uri;
  }

  /* ─── Facebook "Open in browser" banner ──────────────────────────────── */

  function showOpenInBrowserPrompt(immediate) {
    function render() {
      if (document.getElementById('open-in-browser-banner')) return;
      if (document.hidden) return;
      var banner = document.createElement('div');
      banner.id = 'open-in-browser-banner';
      banner.style.cssText = [
        'position:fixed','bottom:0','left:0','right:0',
        'background:#fff','border-top:1px solid #e0e0e0',
        'padding:16px 20px','display:flex','align-items:center',
        'gap:12px','z-index:9999','font-family:sans-serif',
        'box-shadow:0 -2px 12px rgba(0,0,0,0.12)'
      ].join(';');
      banner.innerHTML =
        '<div style="flex:1;font-size:14px;color:#1a1a1a;line-height:1.5">'
        + '<strong style="display:block;margin-bottom:4px">Open in your browser to launch the ecoATM app</strong>'
        + 'Tap <strong>\u22ee</strong> at the top right, then choose '
        + '<em>\u201cOpen in Chrome\u201d</em> or <em>\u201cOpen in system browser\u201d</em>.'
        + '</div>'
        + '<button onclick="this.parentNode.remove()" '
        + 'style="border:none;background:none;font-size:22px;cursor:pointer;color:#888;padding:4px;flex-shrink:0">'
        + '\u2715</button>';
      document.body.appendChild(banner);
    }
    setTimeout(render, immediate ? 400 : 1800);
  }

  /* ─── Status helper ──────────────────────────────────────────────────── */

  function updateStatus(msg) {
    var el = document.getElementById('redirect-status');
    if (el) el.textContent = msg;
  }

  /* ─── Main router ────────────────────────────────────────────────────── */

  function route() {
    var platform = getPlatform();
    var params   = getParams();
    var screen   = getScreen();
    var inIAB    = isInAppBrowser();
    var inFB     = isFacebookBrowser();
    var inIG     = isInstagramBrowser();

    var forwardKeys = [
      'offer_id','kiosk_id','estimate_id','brand','model','sub-screen',
      'utm_source','utm_medium','utm_campaign','utm_content'
    ];
    var extra = {};
    forwardKeys.forEach(function (k) {
      var v = params.get(k);
      if (v) extra[k] = v;
    });

    var appUri   = buildDeepLinkURI(screen, extra);
    var storeUrl = platform === 'ios' ? IOS_STORE : ANDROID_STORE;

    updateStatus('Detecting your device\u2026');

    /* Desktop */
    if (platform === 'desktop') {
      updateStatus('Opening ecoATM website\u2026');
      window.location.replace(getWebFallback(screen));
      return;
    }

    /* Facebook IAB — Android */
    if (inFB && platform === 'android') {
      updateStatus('Opening ecoATM app\u2026');
      showOpenInBrowserPrompt(true);
      tryOpenAppDirectScheme(appUri, null);
      return;
    }

    /* Instagram IAB — Android (uses Chrome Custom Tab, intent:// works) */
    if (inIG && platform === 'android') {
      updateStatus('Opening ecoATM app\u2026');
      tryOpenApp(appUri, storeUrl);
      return;
    }

    /* Any other IAB */
    if (inIAB) {
      updateStatus('Opening ecoATM app\u2026');
      if (platform === 'ios') {
        tryOpenApp(appUri, storeUrl);
      } else {
        tryOpenAppDirectScheme(appUri, storeUrl);
      }
      return;
    }

    /* Native browsers — iOS and Android */
    tryOpenApp(appUri, storeUrl);
  }

  /* ─── Boot ───────────────────────────────────────────────────────────── */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', route);
  } else {
    route();
  }

}());
