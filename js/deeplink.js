/**
 * ecoATM Deep Link Router
 * Handles routing from web links to the native app, with Play Store / App Store fallback.
 *
 * Web URL format:
 *   https://ecoatm.com/app/{channel}?screen={screen}&{params}&utm_source=...
 *
 * Custom URI scheme format:
 *   ecoatm://{channel}/{screen}?{params}
 *
 * Examples:
 *   https://ecoatm.com/app/email?screen=offers&offer_id=abc123&utm_source=email&utm_campaign=offer_lock_q2
 *   → ecoatm://email/offers?offer_id=abc123&utm_source=email&utm_campaign=offer_lock_q2
 *
 *   https://ecoatm.com/app/social?screen=find-kiosk&kiosk_id=4521&utm_source=social&utm_medium=cpc
 *   → ecoatm://social/find-kiosk?kiosk_id=4521&utm_source=social&utm_medium=cpc
 *
 *   https://ecoatm.com/app/push?screen=sell&utm_source=push&utm_medium=notification
 *   → ecoatm://push/sell?utm_source=push&utm_medium=notification
 *
 * Platform routing:
 *   - Android native browser → intent:// with Play Store fallback
 *   - Android IAB (Facebook, Instagram, etc.) → escape to system browser
 *   - iOS Safari/Chrome → ecoatm:// with App Store timeout fallback
 *   - iOS IAB → Universal Links handle it; show App Store banner if not
 *   - Desktop → no-op, marketing page shown
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
  // App: ecoatm://{channel}/{screen}?{params}
  function buildAppUri() {
  const params = new URLSearchParams(window.location.search);
  const screen = params.get('screen') || 'home';

  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const channel = pathParts[1] || '';

  const path = channel ? channel + '/' + screen : screen;

  const forwarded = new URLSearchParams();
  params.forEach((value, key) => {
    if (key !== 'screen') {
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

  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const channel = pathParts[1] || '';

  const path = channel ? channel + '/' + screen : screen;

  const forwarded = new URLSearchParams();
  params.forEach((value, key) => {
    if (key !== 'screen') {
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

  // Intent to open URL in the default browser
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