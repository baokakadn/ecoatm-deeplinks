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

  // Use a hidden iframe for Android to avoid "app not found" errors
  // on some browsers. On iOS, direct location assignment is more reliable.
  const platform = getPlatform();
  const start = Date.now();

  const timer = setTimeout(() => {
    // If we're still here after the timeout, app is likely not installed
    if (Date.now() - start < CONFIG.appOpenTimeout + 500) {
      updateStatus('App not found. Redirecting to store…');
      window.location.href = storeUrl;
    }
  }, CONFIG.appOpenTimeout);

  // visibilitychange fires when the app takes over — cancel the store redirect
  document.addEventListener('visibilitychange', function onVis() {
    if (document.hidden) {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    }
  });

  if (platform === 'ios') {
    window.location.href = uri;
  } else {
    // Android: iframe trick avoids "page not found" overlay on failure
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = uri;
    document.body.appendChild(iframe);
    setTimeout(() => { try { document.body.removeChild(iframe); } catch(_){} }, 2000);
  }
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
