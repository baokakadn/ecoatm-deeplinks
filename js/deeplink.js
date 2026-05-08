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
      facebook:     /FBAN|FBAV/i,
      instagram:    /Instagram/i,
      inAppBrowser: /FBAN|FBAV|Instagram|Twitter|LinkedInApp|TikTok|BytedanceWebview/i
    }
  };

  /* ─── Platform detection ──────────────────────────────────── */
  var UA = navigator.userAgent || '';

  function getPlatform()    { return CONFIG.ua.ios.test(UA) ? 'ios' : CONFIG.ua.android.test(UA) ? 'android' : 'desktop'; }
  function isFacebook()     { return CONFIG.ua.facebook.test(UA); }
  function isInstagram()    { return CONFIG.ua.instagram.test(UA); }
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
   * Android:
   * First attempt the ecoatm:// custom URI scheme directly.
   * If the app is installed it opens immediately via the manifest
   * intent filter — regardless of whether App Links are verified.
   * If the app is NOT installed, nothing happens and the timeout
   * fires, sending the user to the Play Store.
   *
   * We deliberately avoid Intent URI here because Intent URI with
   * S.browser_fallback_url skips the app and goes straight to the
   * store when App Links are not verified — even if the app is installed.
   *
   * iOS:
   * Direct ecoatm:// scheme with visibilitychange + timeout fallback.
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

  /* ─── Main router ─────────────────────────────────────────── */
  function route() {
    /* Only run when a deep link param is present.
       Plain visits to the homepage should show the marketing page as-is. */
    var params  = getParams();
    var screen  = params.get('screen');
    var hasPath = window.location.pathname !== '/'
                  && window.location.pathname !== '/index.html';

    if (!screen && !hasPath) return;

    var platform = getPlatform();
    var resolvedScreen = getScreen(params);
    var appUri   = buildAppURI(resolvedScreen, params);
    var storeUrl = CONFIG.store[platform] || CONFIG.store.android;

    /* Desktop — do nothing, let the marketing page render */
    if (platform === 'desktop') return;

    /*
     * Facebook IAB (Android):
     * Blocks ecoatm:// and intent:// but allows normal https:// navigation.
     * Skip the app attempt — go directly to the Play Store.
     */
    if (isFacebook() && platform === 'android') {
      window.location.href = storeUrl;
      return;
    }

    /*
     * Other blocking Android IABs (TikTok, Twitter, LinkedIn, etc.):
     * Same behaviour as Facebook — go directly to the store.
     */
    if (isInAppBrowser() && !isInstagram() && platform === 'android') {
      window.location.href = storeUrl;
      return;
    }

    /* Instagram IAB (Android) — Chrome Custom Tab, intent:// works */
    /* Native Safari, Chrome, and all iOS browsers */
    openApp(appUri, storeUrl);
  }

  /* ─── Boot ────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', route);
  } else {
    route();
  }

}());