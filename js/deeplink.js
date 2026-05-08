(function () {
  'use strict';

  /* ─── Config ─────────────────────────────────────────────── */
  var CONFIG = {
    scheme:     'ecoatm://',
    androidPkg: 'com.ecoatm.ecoapp.android_qa',
    timeout:    2500,

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
   * Native browser open (Safari, Chrome, non-IAB).
   * Fires ecoatm:// scheme — if app is installed it opens.
   * If not, visibilitychange never fires and the timeout
   * sends the user to the store after 2.5s.
   */
  function openApp(appUri, storeUrl) {
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
   * IAB open (Facebook, TikTok, Twitter, etc. on Android).
   * These WebViews block ecoatm:// AND freeze setTimeout after
   * a blocked navigation — so openApp() hangs forever.
   *
   * Solution: skip the scheme attempt entirely.
   * Go straight to the store via a plain https:// navigation,
   * which always works in any WebView (same as tapping the
   * Google Play badge on the index page).
   */
  function openStore(storeUrl) {
    window.location.href = storeUrl;
  }

  /* ─── Main router ─────────────────────────────────────────── */
  function route() {
    var params  = getParams();
    var screen  = params.get('screen');
    var hasPath = window.location.pathname !== '/'
                  && window.location.pathname !== '/index.html';

    /* No deep link params — plain homepage visit, do nothing */
    if (!screen && !hasPath) return;

    var platform = getPlatform();
    var resolvedScreen = getScreen(params);
    var appUri   = buildAppURI(resolvedScreen, params);
    var storeUrl = CONFIG.store[platform] || CONFIG.store.android;

    /* Desktop — show marketing page as-is */
    if (platform === 'desktop') return;

    /*
     * Android IAB (Facebook, TikTok, Twitter, LinkedIn, etc.):
     * ecoatm:// is blocked AND setTimeout freezes after a blocked
     * navigation. Go straight to the Play Store via https://.
     *
     * Android native browser (Chrome, Samsung Internet, etc.):
     * ecoatm:// works — attempt app open, fallback to store on timeout.
     */
    if (platform === 'android') {
      if (isInAppBrowser()) {
        openStore(storeUrl);
      } else {
        openApp(appUri, storeUrl);
      }
      return;
    }

    /* iOS — all browsers use the same ecoatm:// + timeout approach */
    openApp(appUri, storeUrl);
  }

  /* ─── Boot ────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', route);
  } else {
    route();
  }

}());