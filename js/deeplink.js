/**
 * ecoATM Deep Link Router
 * Custom device detection + app-install check + store fallback
 * No third-party SDK required.
 */

const CONFIG = {
  appScheme:     'ecoatm://',
  iosStoreUrl:   'https://apps.apple.com/us/app/ecoatm/id944835823',
  androidStoreUrl:'https://play.google.com/store/apps/details?id=com.ecoatm.ecoapp.android',
  webFallbackUrl: 'https://www.ecoatm.com',
  // How long (ms) to wait for app to open before redirecting to store
  appOpenTimeout: 1800,
};

/* ─── Platform detection ──────────────────────────────────────────── */

function getPlatform() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua))           return 'android';
  return 'desktop';
}

function isInAppBrowser() {
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|Instagram|Twitter|LinkedInApp|Snapchat|TikTok|BytedanceWebview/i.test(ua);
}

/* ─── URL param helpers ───────────────────────────────────────────── */

function getParams() {
  return new URLSearchParams(window.location.search);
}

function getScreen() {
  return getParams().get('screen') || 'home';
}

function buildDeepLinkURI(screen, extraParams) {
  // e.g. ecoatm://screen/sell?offerId=123
  let uri = CONFIG.appScheme + 'screen/' + encodeURIComponent(screen);
  const p = new URLSearchParams(extraParams || {});
  const str = p.toString();
  if (str) uri += '?' + str;
  return uri;
}

/* ─── App open attempt ────────────────────────────────────────────── */

/**
 * Tries to open the app via custom URI scheme.
 * If the app is installed the OS hijacks the navigation and
 * the page stays open (or goes to background). If not, nothing
 * happens — we fall through to the store redirect after the timeout.
 */
function tryOpenApp(uri, storeUrl) {
  updateStatus('Trying to open the ecoATM app…');

  const platform = getPlatform();
  const start    = Date.now();
  let   redirected = false;

  function goToStore() {
    if (redirected) return;
    redirected = true;
    updateStatus('App not found. Redirecting to store…');
    window.location.href = storeUrl;
  }

  const timer = setTimeout(goToStore, CONFIG.appOpenTimeout);

  // visibilitychange: page goes hidden when app opens — cancel store redirect.
  // Use 'pagehide' as a second signal (more reliable on some Android browsers).
  function onHide() {
    clearTimeout(timer);
    redirected = true; // app opened — do not redirect
    document.removeEventListener('visibilitychange', onVisChange);
    window.removeEventListener('pagehide', onHide);
  }
  function onVisChange() {
    if (document.hidden) onHide();
  }
  document.addEventListener('visibilitychange', onVisChange);
  window.addEventListener('pagehide', onHide);

  // Also cancel if user comes back to page (app was opened, then user returned)
  window.addEventListener('pageshow', function onShow() {
    clearTimeout(timer);
    redirected = true;
    window.removeEventListener('pageshow', onShow);
  }, { once: true });

  if (platform === 'ios') {
    // iOS: direct assignment is most reliable for Universal Link fallback
    window.location.href = uri;
  } else {
    // Android: intent:// scheme is more reliable than custom URI in Chrome
    // Format: intent://<host>/<path>#Intent;scheme=ecoatm;package=com.ecoatm.ecoapp.android_qa;end
    const intentUri = buildIntentUri(uri, storeUrl);
    window.location.href = intentUri;
  }
}

/**
 * Builds an Android Intent URI.
 * Chrome on Android handles this natively — if the app is installed it opens,
 * if not it follows the S.browser_fallback_url to the store.
 * This is MORE reliable than the iframe trick and doesn't need a JS timeout
 * to detect install status on Chrome Android.
 */
function buildIntentUri(appUri, storeUrl) {
  // Extract path from ecoatm://screen/sell?foo=bar
  const withoutScheme = appUri.replace(CONFIG.appScheme, '');
  const encodedFallback = encodeURIComponent(storeUrl);
  return (
    'intent://' + withoutScheme +
    '#Intent' +
    ';scheme=ecoatm' +
    ';package=com.ecoatm.ecoapp.android_qa' +
    ';S.browser_fallback_url=' + encodedFallback +
    ';end'
  );
}

/* ─── Main router ─────────────────────────────────────────────────── */

function route() {
  const platform = getPlatform();
  const params   = getParams();
  const screen   = getScreen();
  const inIAB    = isInAppBrowser();

  // Collect any extra params to forward (e.g. offerId, promo)
  const forwardKeys = ['offerId', 'promo', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
  const extra = {};
  forwardKeys.forEach(k => { if (params.get(k)) extra[k] = params.get(k); });

  const appUri   = buildDeepLinkURI(screen, extra);
  const storeUrl = platform === 'ios' ? CONFIG.iosStoreUrl : CONFIG.androidStoreUrl;

  if (platform === 'desktop') {
    updateStatus('Opening ecoATM website…');
    setTimeout(() => { window.location.href = CONFIG.webFallbackUrl; }, 800);
    return;
  }

  // In-app browsers (Instagram, Facebook, TikTok) block Universal Links.
  // We fall back directly to the URI scheme + store timeout.
  if (inIAB) {
    updateStatus('Opening ecoATM app…');
    tryOpenApp(appUri, storeUrl);
    return;
  }

  // Native browser on iOS: Universal Links are handled by the OS
  // before this JS even runs — if we reach here, the AASA check failed
  // or the app isn't installed. Attempt URI scheme as last resort.
  if (platform === 'ios') {
    tryOpenApp(appUri, storeUrl);
    return;
  }

  // Native browser on Android: App Links handled by OS. Same fallback.
  tryOpenApp(appUri, storeUrl);
}

/* ─── UI helpers ──────────────────────────────────────────────────── */

function updateStatus(msg) {
  const el = document.getElementById('redirect-status');
  if (el) el.textContent = msg;
}

/* ─── Auto-run on redirect.html ───────────────────────────────────── */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', route);
} else {
  route();
}
