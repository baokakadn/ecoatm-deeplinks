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

function getWebFallback(screen) {
  return CONFIG.webFallbackMap[screen] || CONFIG.webFallbackDefault;
}

function buildDeepLinkURI(screen, extraParams) {
  let path = 'screen/' + encodeURIComponent(screen);
  // Append sub-path for known parameterised screens
  const offerId    = extraParams.offer_id;
  const kioskId    = extraParams.kiosk_id;
  const estimateId = extraParams.estimate_id;
  if (screen === 'offers'      && offerId)    path += '/' + encodeURIComponent(offerId);
  if (screen === 'find-kiosk'  && kioskId)    path += '/' + encodeURIComponent(kioskId);
  if (screen === 'price-view'  && estimateId) path += '/' + encodeURIComponent(estimateId);
  if (screen === 'sell' && extraParams['sub-screen'] === 'this-device') path += '/this-device';
  const p = new URLSearchParams();
  ['brand','model','utm_source','utm_medium','utm_campaign','utm_content']
    .forEach(k => { if (extraParams[k]) p.set(k, extraParams[k]); });
  const qs = p.toString();
  return CONFIG.appScheme + path + (qs ? '?' + qs : '');
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
  let   redirected = false;

  function goToStore() {
    if (redirected) return;
    redirected = true;
    updateStatus('App not found. Redirecting to store…');
    window.location.href = storeUrl;
  }

  const timer = setTimeout(goToStore, CONFIG.appOpenTimeout);

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
    // Native Chrome on Android — Intent URI is most reliable
    window.location.href = buildIntentUri(uri, storeUrl);
  }
}

/**
 * Direct custom scheme attempt — used inside Facebook/Instagram IAB on Android
 * where intent:// is not supported.
 * Falls back to store after CONFIG.appOpenTimeout if app does not respond.
 */
function tryOpenAppDirectScheme(uri, storeUrl) {
  let redirected = false;

  const timer = setTimeout(() => {
    if (redirected) return;
    redirected = true;
    updateStatus('App not found. Redirecting to store…');
    window.location.href = storeUrl;
  }, CONFIG.appOpenTimeout);

  function onHide() {
    clearTimeout(timer);
    redirected = true;
    document.removeEventListener('visibilitychange', onVisChange);
  }
  function onVisChange() { if (document.hidden) onHide(); }
  document.addEventListener('visibilitychange', onVisChange);

  // Direct scheme — no intent:// wrapper
  window.location.href = uri; // e.g. ecoatm://screen/sell
}

/**
 * Shows a manual fallback prompt inside Facebook's IAB.
 * Facebook sometimes blocks even direct URI scheme attempts.
 * The prompt gives the user a way to open the link in their real browser
 * where Universal Links / App Links will fire correctly.
 */
function showOpenInBrowserPrompt() {
  setTimeout(() => {
    const existing = document.getElementById('open-in-browser-banner');
    if (existing) return;
    const banner = document.createElement('div');
    banner.id = 'open-in-browser-banner';
    banner.style.cssText = [
      'position:fixed', 'bottom:0', 'left:0', 'right:0',
      'background:#fff', 'border-top:1px solid #e0e0e0',
      'padding:16px 20px', 'display:flex', 'align-items:center',
      'gap:12px', 'z-index:9999', 'font-family:sans-serif',
      'box-shadow:0 -2px 12px rgba(0,0,0,0.12)'
    ].join(';');
    banner.innerHTML = `
      <div style="flex:1;font-size:14px;color:#1a1a1a;line-height:1.4">
        <strong>Open in your browser</strong> for the best experience —
        tap <strong>⋮</strong> or <strong>···</strong> then
        <em>"Open in Chrome"</em> or <em>"Open in Safari"</em>.
      </div>
      <button onclick="this.parentNode.remove()"
        style="border:none;background:none;font-size:20px;cursor:pointer;color:#888;padding:4px">
        ✕
      </button>`;
    document.body.appendChild(banner);
  }, 1800); // only show if app hasn't opened after 1.8s
}

/**
 * Builds an Android Intent URI.
 * Chrome on Android handles this natively — if the app is installed it opens,
 * if not it follows the S.browser_fallback_url to the store.
 */
function buildIntentUri(appUri, storeUrl) {
  const withoutScheme = appUri.replace(CONFIG.appScheme, '');
  const encodedFallback = encodeURIComponent(storeUrl);
  return (
    'intent://' + withoutScheme +
    '#Intent' +
    ';scheme=ecoatm' +
    ';package=' + CONFIG.androidPkg +
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

  // Collect params to forward
  const forwardKeys = [
    'offer_id','kiosk_id','estimate_id','brand','model','sub-screen',
    'utm_source','utm_medium','utm_campaign','utm_content'
  ];
  const extra = {};
  forwardKeys.forEach(k => { if (params.get(k)) extra[k] = params.get(k); });

  const appUri   = buildDeepLinkURI(screen, extra);
  const storeUrl = platform === 'ios' ? CONFIG.iosStoreUrl : CONFIG.androidStoreUrl;

  if (platform === 'desktop') {
    updateStatus('Opening ecoATM website…');
    setTimeout(() => { window.location.href = getWebFallback(screen); }, 800);
    return;
  }

  if (inIAB) {
    updateStatus('Opening ecoATM app…');
    tryOpenApp(appUri, storeUrl);
    return;
  }

  if (platform === 'ios') {
    tryOpenApp(appUri, storeUrl);
    return;
  }

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
