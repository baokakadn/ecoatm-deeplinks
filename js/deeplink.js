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

  /* ─── Visibility cancel helper ────────────────────────────── */
  function onAppOpened(cb) {
    function onVis() {
      if (!document.hidden) return;
      cleanup(); cb();
    }
    function onHide()  { cleanup(); cb(); }
    function onBlur()  { cleanup(); cb(); } // fires when OS dialog steals focus
    function cleanup() {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('blur', onBlur);
    }
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('blur', onBlur);
  }

  /* ─── Single open strategy for all browsers and IABs ─────── */
  /*
   * Step 1: Fire ecoatm:// URI scheme.
   *   - App installed → OS opens app immediately → page goes hidden → done ✅
   *   - App not installed OR scheme blocked → nothing happens, page stays visible
   *
   * Step 2: setTimeout fires after 2.5s if page is still visible.
   *   - window.location.href = storeUrl  (plain https://)
   *   - This is identical to tapping the App Store / Google Play badge
   *     on the index page — opens the Store app directly, works in
   *     every browser including Facebook IAB ✅
   *
   * Note: In IABs where ecoatm:// is blocked, Step 1 silently fails
   * and Step 2 fires after the timeout. The Store opens directly — no
   * external browser, no intent URI, no "Page can't be loaded".
   */
  function openApp(appUri, storeUrl) {
    var platform = getPlatform();

    /*
     * Android IAB (Facebook, TikTok, Twitter, etc.):
     *
     * App installed:
     *   ecoatm:// fires → Facebook shows "You're leaving" dialog
     *   User taps Continue → app opens ✅
     *   No timer — avoids racing against the dialog.
     *
     * App NOT installed:
     *   ecoatm:// silently fails, page stays visible.
     *   After a short window (300ms), if page is still visible,
     *   redirect straight to the store via plain https://
     *   (same as tapping the badge — always works in any WebView).
     */
    if (isInAppBrowser() && platform === 'android') {
      var appOpened = false;

      function onLeave() {
        appOpened = true;
        document.removeEventListener('visibilitychange', onLeave);
        window.removeEventListener('pagehide', onLeave);
      }
      document.addEventListener('visibilitychange', onLeave);
      window.addEventListener('pagehide', onLeave);

      window.location.href = appUri;

      setTimeout(function () {
        if (!appOpened) {
          window.location.href = storeUrl;
        }
      }, 300);

      return;
    }

    /*
     * All other browsers (native Chrome, Safari, other IABs):
     * Fire scheme + timeout fallback to store.
     */
    var done = false;

    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      window.location.href = storeUrl;
    }, CONFIG.timeout);

    function onAppOpened() {
      if (done) return;
      done = true;
      clearTimeout(timer);
    }

    document.addEventListener('visibilitychange', function onVis() {
      if (!document.hidden) return;
      document.removeEventListener('visibilitychange', onVis);
      onAppOpened();
    });

    window.addEventListener('pagehide', function onHide() {
      window.removeEventListener('pagehide', onHide);
      onAppOpened();
    });

    window.location.href = appUri;
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

    /* iOS and Android — same strategy for all browsers and IABs */
    openApp(appUri, storeUrl);
  }

  /* ─── Boot ────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', route);
  } else {
    route();
  }

}());