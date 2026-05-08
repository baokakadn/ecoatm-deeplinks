(function () {
  'use strict';

  /* ─── Config ─────────────────────────────────────────────── */
  var CONFIG = {
    scheme:  'ecoatm://',
    timeout: 2500,

    store: {
      ios:     'https://apps.apple.com/us/app/ecoatm/id944835823',
      android: 'https://play.google.com/store/apps/details?id=com.ecoatm.ecoapp.android'
    },

    webFallback: {
      'home':       'https://www.ecoatm.com',
      'sell':       'https://www.ecoatm.com/pages/sell',
      'find-kiosk': 'https://locations.ecoatm.com',
      'offers':     'https://www.ecoatm.com',
      'account':    'https://www.ecoatm.com',
      'price-view': 'https://www.ecoatm.com/pages/sell',
      'default':    'https://www.ecoatm.com'
    },

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

    screenSubPaths: {
      'offers':     'offer_id',
      'find-kiosk': 'kiosk_id',
      'price-view': 'estimate_id'
    },

    forwardParams: [
      'brand', 'model',
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content'
    ],

    ua: {
      ios:          /iPhone|iPad|iPod/i,
      android:      /Android/i,
      inAppBrowser: /FBAN|FBAV|Instagram|Twitter|LinkedInApp|TikTok|BytedanceWebview/i
    }
  };

  /* ─── Platform detection ──────────────────────────────────── */
  var UA = navigator.userAgent || '';

  function getPlatform()    { return CONFIG.ua.ios.test(UA) ? 'ios' : CONFIG.ua.android.test(UA) ? 'android' : 'desktop'; }
  function isInAppBrowser() { return CONFIG.ua.inAppBrowser.test(UA); }

  /* ─── URL helpers ─────────────────────────────────────────── */
  function getParams() { return new URLSearchParams(window.location.search); }

  function getScreen(params) {
    var q = params.get('screen');
    if (q) return q;
    var seg = window.location.pathname.replace(/^\//, '').split('/')[0];
    return CONFIG.pathToScreen[seg] || CONFIG.pathToScreen['default'];
  }

  function buildAppURI(screen, params) {
    var path = 'screen/' + encodeURIComponent(screen);

    var subKey = CONFIG.screenSubPaths[screen];
    if (subKey && params.get(subKey)) {
      path += '/' + encodeURIComponent(params.get(subKey));
    }
    if (screen === 'sell' && params.get('sub-screen') === 'this-device') {
      path += '/this-device';
    }

    var qs = new URLSearchParams();
    CONFIG.forwardParams.forEach(function (k) {
      var v = params.get(k);
      if (v) qs.set(k, v);
    });

    var qsStr = qs.toString();
    return CONFIG.scheme + path + (qsStr ? '?' + qsStr : '');
  }

  /*
   * Build an Android Intent URI using the current HTTPS page URL.
   * scheme=https makes the OS treat this as a normal https:// navigation
   * but routed through the Intent system — which triggers App Links
   * verification and opens the app if verified.
   * S.browser_fallback_url sends to the Play Store if app is not installed.
   */
  function buildAppLinkIntentURI() {
    var currentUrl = window.location.href;
    return 'intent://' + currentUrl.replace(/^https?:\/\//, '')
      + '#Intent'
      + ';scheme=https'
      + ';action=android.intent.action.VIEW'
      + ';category=android.intent.category.BROWSABLE'
      + ';end';
  }

  /* ─── Visibility cancel helper ────────────────────────────── */
  function onAppOpened(cb) {
    function onVis() {
      if (!document.hidden) return;
      cleanup(); cb();
    }
    function onHide() { cleanup(); cb(); }
    function cleanup() {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
    }
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
  }

  /* ─── Open strategies ─────────────────────────────────────── */

  /*
   * Native browser — ecoatm:// custom URI scheme.
   * App installed  → opens immediately.
   * App missing    → timeout fires → store.
   */
  function openAppViaScheme(appUri, storeUrl) {
    var done  = false;

    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      window.location.href = storeUrl;
    }, CONFIG.timeout);

    onAppOpened(function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
    });

    window.location.href = appUri;
  }

  /*
   * Android IAB — parallel approach:
   *
   * Fire the App Link intent URI (no package=, no S.browser_fallback_url).
   * At the same time, start a timer that goes to the store via plain https://.
   *
   * App installed + verified → OS opens app → page goes hidden
   *                          → timer cancelled ✅
   *
   * App NOT installed       → intent fires but nothing opens
   *                          → page stays visible
   *                          → timer fires → window.location.href = storeUrl
   *                          → Play Store app opens directly ✅
   *                          (same mechanism as tapping the badge on index page)
   */
  function openAppViaAppLink(storeUrl) {
    var appOpened = false;

    onAppOpened(function () { appOpened = true; });

    var timer = setTimeout(function () {
      if (!appOpened && !document.hidden) {
        window.location.href = storeUrl;
      }
    }, CONFIG.timeout);

    /* Fire intent — no fallback URL inside the intent itself.
       The JS timer above is the fallback — it's more reliable because
       it uses plain https:// navigation which always works in any WebView. */
    window.location.href = buildAppLinkIntentURI();
  }

  /* ─── Main router ─────────────────────────────────────────── */
  function route() {
    var params  = getParams();
    var screen  = params.get('screen');
    var hasPath = window.location.pathname !== '/'
                  && window.location.pathname !== '/index.html';

    /* No deep link params — plain homepage visit, do nothing */
    if (!screen && !hasPath) return;

    var platform       = getPlatform();
    var resolvedScreen = getScreen(params);
    var appUri         = buildAppURI(resolvedScreen, params);
    var storeUrl       = CONFIG.store[platform] || CONFIG.store.android;

    /* Desktop — show marketing page as-is */
    if (platform === 'desktop') return;

    if (platform === 'android') {
      /*
       * Android IAB — use App Link intent URI (https scheme).
       * Bypasses the WebView custom scheme block while still
       * triggering App Links to open the app directly.
       */
      if (isInAppBrowser()) {
        openAppViaAppLink(storeUrl);
        return;
      }

      /* Android native browser — ecoatm:// scheme + timeout fallback */
      openAppViaScheme(appUri, storeUrl);
      return;
    }

    /* iOS — all browsers use ecoatm:// scheme + timeout fallback */
    openAppViaScheme(appUri, storeUrl);
  }

  /* ─── Boot ────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', route);
  } else {
    route();
  }

}());