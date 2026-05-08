/**
 * ecoATM Deep Link Router
 * Handles routing from web links to the native app, with Play Store / App Store fallback.
 *
 * Key challenge: Facebook In-App Browser (IAB) blocks ecoatm:// custom scheme AND
 * freezes the JS thread after a blocked navigation, so setTimeout/setInterval stop firing.
 *
 * Solution by platform:
 *   - Android (any browser, including Facebook IAB): use intent:// URLs.
 *     The OS itself handles app-installed detection and falls back to Play Store
 *     via S.browser_fallback_url — no JS timer needed.
 *   - iOS Safari/Chrome: ecoatm:// + 2.5s timer fallback to App Store.
 *   - iOS Facebook IAB: ecoatm:// is blocked and timers freeze.
 *     Universal Links (the https://links.ecoatm.com/... URL itself) should open
 *     the app on the *initial tap* from the Facebook feed. Once we're inside
 *     the IAB the app isn't installed (or UL didn't fire), so we go to the App Store.
 *   - Desktop: do nothing, show marketing page.
 */

(function () {
  'use strict';

  // ---------- Config ----------
  const ANDROID_PACKAGE = 'com.ecoatm.ecoapp.android_qa';
  const ANDROID_STORE_URL = 'https://play.google.com/store/apps/details?id=com.ecoatm.ecoapp.android';
  const IOS_STORE_URL = 'https://apps.apple.com/us/app/ecoatm/id944835823';
  const APP_SCHEME = 'ecoatm';
  const FALLBACK_TIMEOUT_MS = 2500;

  // ---------- UA detection ----------
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua) && !window.MSStream;
  const isMobile = isAndroid || isIOS;

  // In-app browser detection
  const isFacebookIAB = /FBAN|FBAV|FB_IAB|FB4A|FBIOS/i.test(ua);
  const isInstagramIAB = /Instagram/i.test(ua);
  const isTikTokIAB = /BytedanceWebview|musical_ly|TikTok/i.test(ua);
  const isTwitterIAB = /Twitter/i.test(ua);
  const isLinkedInIAB = /LinkedInApp/i.test(ua);
  const isAnyIAB = isFacebookIAB || isInstagramIAB || isTikTokIAB || isTwitterIAB || isLinkedInIAB;

  // ---------- URL parsing: web URL -> app URI ----------
  // Web: https://links.ecoatm.com/{channel}?screen={screen}&{params}
  // App: ecoatm://screen/{screenName}/{subPath}?{params}
  function buildAppUri() {
    const params = new URLSearchParams(window.location.search);
    const screen = params.get('screen') || 'home';
    const subScreen = params.get('sub-screen');

    let path = `screen/${screen}`;
    if (subScreen) path += `/${subScreen}`;

    // Forward all params except 'screen' and 'sub-screen'
    const forwarded = new URLSearchParams();
    params.forEach((value, key) => {
      if (key !== 'screen' && key !== 'sub-screen') {
        forwarded.append(key, value);
      }
    });

    const qs = forwarded.toString();
    return `${APP_SCHEME}://${path}${qs ? '?' + qs : ''}`;
  }

  // For Android intent:// URLs we need just the path + query, no scheme prefix
  function buildAppUriForIntent() {
    const params = new URLSearchParams(window.location.search);
    const screen = params.get('screen') || 'home';
    const subScreen = params.get('sub-screen');

    let path = `screen/${screen}`;
    if (subScreen) path += `/${subScreen}`;

    const forwarded = new URLSearchParams();
    params.forEach((value, key) => {
      if (key !== 'screen' && key !== 'sub-screen') {
        forwarded.append(key, value);
      }
    });

    const qs = forwarded.toString();
    return `${path}${qs ? '?' + qs : ''}`;
  }

  // ---------- Visibility helpers ----------
  // If the app opens, the page becomes hidden — we use this to cancel the
  // store-redirect timer so we don't bounce back to the store after returning.
  function isPageHidden() {
    return document.hidden || document.webkitHidden || document.visibilityState === 'hidden';
  }

  // ---------- Routing strategies ----------

  /**
   * Android strategy.
   *
   * Native Chrome/Samsung browser: intent:// URL is enough — the OS handles
   * both "app installed → open" and "not installed → Play Store" via
   * S.browser_fallback_url. No JS fallback needed.
   *
   * Facebook/Instagram IAB on Android: more complicated. Three scenarios:
   *
   *   1. App installed, no chooser dialog: OS opens app → page goes hidden →
   *      visibilitychange/pagehide/blur fire → we cancel.
   *
   *   2. App installed, OS shows "Open with ecoATM? [Cancel][Continue]" dialog:
   *      WebView loses focus while dialog is up → blur fires → we cancel.
   *      We must NOT redirect to the store here — the user has been offered
   *      a choice, and either outcome (open app or cancel) is intentional.
   *
   *   3. App not installed and IAB silently swallows the intent:
   *      No dialog, no focus change, no visibility change. The page just sits.
   *      After our timeout we redirect to Play Store as the fallback.
   *
   * The discriminator between scenarios 2 and 3 is whether `blur` ever fired.
   * Once blur fires we permanently cancel — even if the user later cancels
   * the dialog, redirecting them to the store would be hostile.
   *
   * We use requestAnimationFrame instead of setTimeout because Facebook IAB
   * freezes JS timers after navigation, but rAF keeps ticking.
   */
 function routeAndroid() {
  if (!isAnyIAB) {
    // Native browser: intent:// with OS fallback — already works.
    const appPath = buildAppUriForIntent();
    const fallback = encodeURIComponent(ANDROID_STORE_URL);
    const intentUrl =
      `intent://${appPath}` +
      `#Intent;` +
      `scheme=${APP_SCHEME};` +
      `package=${ANDROID_PACKAGE};` +
      `S.browser_fallback_url=${fallback};` +
      `end`;
    window.location.href = intentUrl;
    return;
  }

  // Facebook/Instagram/TikTok IAB on Android:
  // Escape the IAB entirely by opening the current URL in the system browser.
  // Once in Chrome/Samsung Browser, the native browser path above handles
  // both cases: app installed → intent opens it, not installed → Play Store.
  var currentUrl = window.location.href;

  // Method 1: intent to open URL in the default browser
  var browserIntent =
    'intent://' + currentUrl.replace(/https?:\/\//, '') +
    '#Intent;scheme=https;action=android.intent.action.VIEW;end';
  window.location.href = browserIntent;
}

  /**
   * iOS strategy for normal browsers (Safari, Chrome, etc).
   *
   * Custom scheme + visibility-based timer. If the app opens, the page hides
   * and we cancel the timer. Otherwise after 2.5s we redirect to the App Store.
   */
  function routeIOSStandard() {
    const appUri = buildAppUri();

    let timer = null;
    const startedAt = Date.now();

    function clearFallback() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function onVisibilityChange() {
      if (isPageHidden()) clearFallback();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', clearFallback);
    window.addEventListener('blur', clearFallback);

    timer = setTimeout(function () {
      // Guard against background timer firing late after returning from app
      if (Date.now() - startedAt < FALLBACK_TIMEOUT_MS - 100) return;
      if (!isPageHidden()) {
        window.location.href = IOS_STORE_URL;
      }
    }, FALLBACK_TIMEOUT_MS);

    // Trigger the app
    window.location.href = appUri;
  }

  /**
   * iOS Facebook/Instagram IAB strategy.
   *
   * Universal Links should have opened the app on the initial tap from the
   * social feed. If we're executing this code, we're inside the IAB, which
   * means either the app isn't installed or Universal Links didn't fire.
   *
   * ecoatm:// is blocked here and JS timers freeze after blocked navigation,
   * so we can't reliably attempt the scheme + fallback. We render an
   * "Open in App Store" UI and let the user tap it. Tapping a plain https
   * link to the App Store works in IAB.
   */
  function routeIOSInAppBrowser() {
    showOpenInStoreUI(IOS_STORE_URL, 'App Store');
  }

  /**
   * Renders a "Get the app" button when we can't auto-redirect safely.
   * Used for iOS in-app browsers.
   */
  function showOpenInStoreUI(storeUrl, storeName) {
    // If the marketing page already has its own UX, we just don't auto-redirect.
    // But to be safe, surface a clear CTA at the top.
    const existing = document.getElementById('ecoatm-iab-banner');
    if (existing) return;

    const banner = document.createElement('div');
    banner.id = 'ecoatm-iab-banner';
    banner.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'right:0',
      'background:#D6FDDB',
      'padding:14px 16px',
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'gap:12px',
      'box-shadow:0 2px 8px rgba(0,0,0,0.08)',
      'z-index:9999',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'font-size:15px',
      'color:#1a1a1a'
    ].join(';');

    const text = document.createElement('span');
    text.textContent = 'Get the ecoATM app';
    text.style.cssText = 'font-weight:500;flex:1;';

    const button = document.createElement('a');
    button.href = storeUrl;
    button.textContent = `Open ${storeName}`;
    button.style.cssText = [
      'background:#1a1a1a',
      'color:#fff',
      'padding:8px 14px',
      'border-radius:20px',
      'text-decoration:none',
      'font-weight:600',
      'font-size:14px',
      'white-space:nowrap'
    ].join(';');

    banner.appendChild(text);
    banner.appendChild(button);

    if (document.body) {
      document.body.appendChild(banner);
      // Push page content down so banner doesn't cover the hero
      document.body.style.paddingTop = (banner.offsetHeight + 8) + 'px';
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.appendChild(banner);
        document.body.style.paddingTop = (banner.offsetHeight + 8) + 'px';
      });
    }
  }

  // ---------- Entry point ----------
  function route() {
    // Desktop — do nothing, marketing page is fine.
    if (!isMobile) return;

    if (isAndroid) {
      // intent:// works everywhere on Android: native browsers AND Facebook/Instagram IAB.
      // OS handles install detection and fallback to Play Store.
      routeAndroid();
      return;
    }

    if (isIOS) {
      if (isAnyIAB) {
        // ecoatm:// blocked + timers freeze. Show CTA, rely on Universal Links
        // having handled the initial tap if the app is installed.
        routeIOSInAppBrowser();
        return;
      }
      // Standard iOS browser: scheme + timer fallback.
      routeIOSStandard();
      return;
    }
  }

  // Run as soon as script loads. deeplink.js is in <head> so this fires
  // before the page paints, minimizing flash of marketing content on mobile.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', route);
  } else {
    route();
  }
})();