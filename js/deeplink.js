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

  /* ─── Navigate via anchor click (avoids JS thread freeze) ─── */
  /*
   * Using a hidden <a> element and calling .click() fires the navigation
   * through the DOM event system. Unlike window.location.href = 'ecoatm://',
   * this does NOT freeze the JS thread on blocked schemes in Android WebViews,
   * so setTimeout / setInterval continues to tick normally.
   */
  function navigateViaAnchor(uri) {
    var a = document.createElement('a');
    a.href = uri;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (document.body.contains(a)) document.body.removeChild(a);
    }, 1000);
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
   * Standard open — all native browsers + iOS IABs.
   * Fires ecoatm:// via anchor click to avoid thread freeze.
   * App installed  → page goes hidden → timer cancelled ✅
   * App missing    → timeout fires → store ✅
   */
  function openApp(appUri, storeUrl) {
    var done = false;

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

    navigateViaAnchor(appUri);
  }

  /*
   * Android IAB open (Facebook, TikTok, Twitter, etc.).
   *
   * Uses anchor click to fire ecoatm:// without freezing JS thread.
   * Then polls document.hasFocus() every 50ms:
   *
   *   App installed:
   *     Facebook dialog appears → steals focus → hasFocus() = false
   *     → poll stops → user taps Continue → app opens ✅
   *
   *   App not installed:
   *     ecoatm:// silently blocked → no dialog → hasFocus() stays true
   *     → poll reaches timeout → store opens ✅
   */
  function openAppInIAB(appUri, storeUrl) {
    var elapsed  = 0;
    var interval = setInterval(function () {
      if (!document.hasFocus()) {
        /* Dialog appeared — stop polling, user is in control */
        clearInterval(interval);
        return;
      }
      elapsed += 50;
      if (elapsed >= CONFIG.timeout) {
        clearInterval(interval);
        window.location.href = storeUrl;
      }
    }, 50);

    /* Fire scheme via anchor — does not freeze the JS thread */
    navigateViaAnchor(appUri);
  }

  /* ─── Main router ─────────────────────────────────────────── */
  function route() {
    var params  = getParams();
    var screen  = params.get('screen');
    var hasPath = window.location.pathname !== '/'
                  && window.location.pathname !== '/index.html';

    if (!screen && !hasPath) return;

    var platform       = getPlatform();
    var resolvedScreen = getScreen(params);
    var appUri         = buildAppURI(resolvedScreen, params);
    var storeUrl       = CONFIG.store[platform] || CONFIG.store.android;

    if (platform === 'desktop') return;

    if (isInAppBrowser() && platform === 'android') {
      openAppInIAB(appUri, storeUrl);
      return;
    }

    openApp(appUri, storeUrl);
  }

  /* ─── Boot ────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', route);
  } else {
    route();
  }

}());