(function () {
  'use strict';

  /* ─── Config ─────────────────────────────────────────────── */
  var CONFIG = {
    scheme: 'ecoatm://',
    androidPkg: 'com.ecoatm.ecoapp.android_qa',
    timeout: 2500,

    store: {
      ios:     'https://apps.apple.com/us/app/ecoatm/id944835823',
      android: 'https://play.google.com/store/apps/details?id=com.ecoatm.ecoapp.android'
    },

    /* Maps ?screen= value → desktop web fallback URL */
    webFallback: {
      'home':       'https://www.ecoatm.com',
      'sell':       'https://www.ecoatm.com/pages/sell',
      'find-kiosk': 'https://locations.ecoatm.com',
      'offers':     'https://www.ecoatm.com',
      'account':    'https://www.ecoatm.com',
      'price-view': 'https://www.ecoatm.com/pages/sell',
      'default':    'https://www.ecoatm.com'
    },

    /* Maps URL path segment → screen name when ?screen= is absent */
    pathToScreen: {
      'email':      'home',
      'sms':        'sell',
      'social':     'sell',
      'qr':         'sell',
      'push':       'home',
      'find-kiosk': 'find-kiosk',
      'sell':       'sell',
      'offers':     'offers',
      'account':    'account',
      'price-view': 'price-view',
      'default':    'home'
    },

    /* Params that carry a sub-path segment (appended after the screen) */
    screenSubPaths: {
      'offers':     'offer_id',
      'find-kiosk': 'kiosk_id',
      'price-view': 'estimate_id'
    },

    /* Query params forwarded from the web link into the app URI */
    forwardParams: [
      'brand', 'model',
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content'
    ],

    /* User-Agent patterns */
    ua: {
      ios:       /iPhone|iPad|iPod/i,
      android:   /Android/i,
      facebook:  /FBAN|FBAV/i,
      instagram: /Instagram/i,
      inAppBrowser: /FBAN|FBAV|Instagram|Twitter|LinkedInApp|TikTok|BytedanceWebview/i
    },

    /* IAB "open in browser" banner copy */
    banner: {
      title: 'Open in your browser to launch the ecoATM app',
      body:  'Tap \u22ee at the top right, then choose \u201cOpen in Chrome\u201d or \u201cOpen in system browser\u201d.'
    }
  };

  /* ─── Platform detection ──────────────────────────────────── */
  var UA = navigator.userAgent || '';

  function getPlatform() {
    if (CONFIG.ua.ios.test(UA))     return 'ios';
    if (CONFIG.ua.android.test(UA)) return 'android';
    return 'desktop';
  }

  function isFacebook()  { return CONFIG.ua.facebook.test(UA); }
  function isInstagram() { return CONFIG.ua.instagram.test(UA); }
  function isInAppBrowser() { return CONFIG.ua.inAppBrowser.test(UA); }

  /* ─── URL helpers ─────────────────────────────────────────── */
  function getParams() {
    return new URLSearchParams(window.location.search);
  }

  function getScreen(params) {
    var fromQuery = params.get('screen');
    if (fromQuery) return fromQuery;
    var segment = window.location.pathname.replace(/^\//, '').split('/')[0];
    return CONFIG.pathToScreen[segment] || CONFIG.pathToScreen['default'];
  }

  function getWebFallback(screen) {
    return CONFIG.webFallback[screen] || CONFIG.webFallback['default'];
  }

  function buildAppURI(screen, params) {
    var path = 'screen/' + encodeURIComponent(screen);

    /* Append sub-path segment for screens that need it (e.g. /offers/{id}) */
    var subPathKey = CONFIG.screenSubPaths[screen];
    if (subPathKey && params.get(subPathKey)) {
      path += '/' + encodeURIComponent(params.get(subPathKey));
    }

    /* Special case: sell/this-device */
    if (screen === 'sell' && params.get('sub-screen') === 'this-device') {
      path += '/this-device';
    }

    /* Forward whitelisted query params */
    var qs = new URLSearchParams();
    CONFIG.forwardParams.forEach(function (k) {
      var v = params.get(k);
      if (v) qs.set(k, v);
    });

    var qsStr = qs.toString();
    return CONFIG.scheme + path + (qsStr ? '?' + qsStr : '');
  }

  function buildIntentURI(appUri, storeUrl) {
    return 'intent://' + appUri.replace(CONFIG.scheme, '')
      + '#Intent'
      + ';scheme=ecoatm'
      + ';package=' + CONFIG.androidPkg
      + ';S.browser_fallback_url=' + encodeURIComponent(storeUrl)
      + ';end';
  }

  /* ─── Loading modal ──────────────────────────────────────── */
  function hideModal() {
    var modal = document.getElementById('loading-modal');
    if (modal) modal.style.display = 'none';
  }

  /* ─── Visibility cancel helper ────────────────────────────── */
  function onAppOpened(callback) {
    function onVis() {
      if (document.hidden) {
        cleanup();
        callback();
      }
    }
    function onHide()  { cleanup(); callback(); }
    function onShow()  { cleanup(); callback(); }

    function cleanup() {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
    }

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow, { once: true });
  }

  /* ─── App open strategies ─────────────────────────────────── */

  /**
   * Standard open — intent:// on Android Chrome, direct scheme on iOS.
   * Falls back to the store after TIMEOUT_MS if the app never opens.
   */
  function openApp(appUri, storeUrl) {
    var done = false;

    var timer = setTimeout(function () {
      if (!done) { done = true; hideModal(); window.location.href = storeUrl; }
    }, CONFIG.timeout);

    onAppOpened(function () {
      if (!done) { done = true; clearTimeout(timer); hideModal(); }
    });

    var platform = getPlatform();
    window.location.href = platform === 'ios'
      ? appUri
      : buildIntentURI(appUri, storeUrl);
  }

  /**
   * Direct scheme open via hidden iframe — used for Android IABs where
   * intent:// is not supported (Facebook, TikTok, Twitter, etc.).
   * Using an iframe instead of window.location.href prevents the WebView
   * from freezing the JS event loop on a blocked scheme, so the store
   * timeout fires reliably.
   */
  function openAppDirectScheme(appUri, storeUrl) {
    var done = false;

    var timer = storeUrl
      ? setTimeout(function () {
          if (done) return;
          done = true;
          hideModal();
          window.location.href = storeUrl;
        }, CONFIG.timeout)
      : null;

    onAppOpened(function () {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      hideModal();
    });

    /* Attempt scheme via hidden iframe — failure is silently swallowed,
       JS execution continues and the timeout fires normally. */
    var iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = appUri;
    document.body.appendChild(iframe);
    setTimeout(function () {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    }, 2000);
  }

  /* ─── Main router ─────────────────────────────────────────── */
  function route() {
    var platform = getPlatform();
    var params   = getParams();
    var screen   = getScreen(params);
    var appUri   = buildAppURI(screen, params);
    var storeUrl = CONFIG.store[platform] || CONFIG.store.android;

    /* Desktop → redirect to corresponding web page */
    if (platform === 'desktop') {
      hideModal();
      window.location.replace(getWebFallback(screen));
      return;
    }

    /* Facebook IAB (Android) — blocks intent://, try direct scheme.
       Show "open in browser" banner early so user can act,
       but still auto-redirect to store after timeout if app never opens. */
    if (isFacebook() && platform === 'android') {
      showOpenInBrowserBanner(true);
      openAppDirectScheme(appUri, storeUrl);
      return;
    }

    /* Instagram IAB (Android) — uses Chrome Custom Tab; intent:// works */
    if (isInstagram() && platform === 'android') {
      openApp(appUri, storeUrl);
      return;
    }

    /* Other IABs (TikTok, Twitter, etc.) */
    if (isInAppBrowser()) {
      if (platform === 'ios') {
        openApp(appUri, storeUrl);
      } else {
        openAppDirectScheme(appUri, storeUrl);
      }
      return;
    }

    /* Native Safari / Chrome */
    openApp(appUri, storeUrl);
  }

  /* ─── Boot ────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', route);
  } else {
    route();
  }

}());