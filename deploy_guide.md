# Deployment Guide — ecoATM Deep Link Site on Netlify

## Prerequisites
- A free [Netlify account](https://app.netlify.com/signup)
- A free [GitHub account](https://github.com) (recommended for CI/CD)
- Your Apple Team ID (from [developer.apple.com](https://developer.apple.com) → Membership)
- Your Android SHA-256 signing certificate fingerprint

---

## Step 1 — Prepare the files

Ensure your project folder looks exactly like this:

```
ecoatm-deeplink/
├── index.html
├── redirect.html
├── _redirects
├── _headers
├── .well-known/
│   ├── apple-app-site-association
│   └── assetlinks.json
├── css/
│   └── style.css
└── js/
    └── deeplink.js
```

---

## Step 2 — Fill in your real values

**In `.well-known/apple-app-site-association`:**
- Replace `TEAMID` with your real Apple Team ID (10-character string, e.g. `ABC123DEF4`).
- Example: `"ABC123DEF4.com.outerwall.ecoATM2"`

**In `.well-known/assetlinks.json`:**
- Replace `TODO:REPLACE_WITH_YOUR_SHA256_SIGNING_CERT_FINGERPRINT` with your real SHA-256 fingerprint.
- To get your fingerprint, run:
  ```bash
  # From your Android project keystore:
  keytool -list -v -keystore your-release-key.jks -alias your-key-alias
  # Copy the SHA256 value — format: AB:CD:EF:01:…
  ```

---

## Step 3 — Push to GitHub

```bash
cd ecoatm-deeplink
git init
git add .
git commit -m "Initial ecoATM deep link site"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/ecoatm-deeplinks.git
git push -u origin main
```

---

## Step 4 — Deploy to Netlify

**Option A — Drag & drop (quickest, no GitHub needed):**
1. Go to [app.netlify.com](https://app.netlify.com)
2. Drag your `ecoatm-deeplink/` folder onto the deploy zone
3. Done — you get a `*.netlify.app` URL immediately

**Option B — Connect GitHub (recommended for ongoing updates):**
1. In Netlify dashboard → **Add new site → Import an existing project**
2. Choose **GitHub** → authorize → select your repo
3. Build settings:
   - Build command: *(leave blank — this is a static site)*
   - Publish directory: `.` (the root)
4. Click **Deploy site**

---

## Step 5 — Add a custom domain (free)

1. In Netlify → **Domain management → Add a domain**
2. Enter your domain (e.g. `links.ecoatm.com`)
3. Update your DNS: add a **CNAME** record pointing `links` → `your-site-name.netlify.app`
4. Netlify auto-provisions a free TLS certificate (Let's Encrypt) within minutes

> **Why `links.ecoatm.com` matters:** The AASA and assetlinks files must be served from the *same domain* as your deep links. If your links use `links.ecoatm.com`, the well-known files must be at `https://links.ecoatm.com/.well-known/…`.

---

## Step 6 — Verify the well-known files

After deploy, confirm the files are reachable and return `Content-Type: application/json`:

```bash
# iOS AASA
curl -I https://links.ecoatm.com/.well-known/apple-app-site-association
# Expect: content-type: application/json

# Android Asset Links
curl -I https://links.ecoatm.com/.well-known/assetlinks.json
# Expect: content-type: application/json
```

For iOS, also validate through Apple's official tool:
```
https://app-site-association.cdn-apple.com/a/v1/links.ecoatm.com
```

For Android, use the App Links Assistant in Android Studio or:
```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://links.ecoatm.com&relation=delegate_permission/common.handle_all_urls
```

---

## Step 7 — Test each channel

| Channel | Test URL |
|---|---|
| Email | `https://links.ecoatm.com/email?screen=trade-in&utm_source=email` |
| SMS | `https://links.ecoatm.com/sms?screen=sell&utm_source=sms` |
| Social | `https://links.ecoatm.com/social?screen=sell&utm_source=instagram` |
| QR | `https://links.ecoatm.com/qr?screen=sell&utm_source=qr` |
| Short link | `https://links.ecoatm.com/s/test123` |
| Homepage | `https://links.ecoatm.com/` |

Test on a real device (not simulator) for both iOS and Android with the app installed and uninstalled.

---

## Optional enhancements

### Short links for SMS
Netlify doesn't generate short codes dynamically, but you can:
- Maintain a static map in `_redirects` (simple, no backend needed):
  ```
  /s/abc123  /redirect?screen=sell&utm_source=sms  302
  /s/xyz789  /redirect?screen=trade-in&utm_source=sms  302
  ```
- Or use a free [Bitly](https://bitly.com) / branded shortener pointed at your Netlify domain.

### Per-channel OG metadata
The current `redirect.html` uses static OG tags. For dynamic per-channel tags (different title/image per `?screen=` value), add a Netlify Edge Function:

```
netlify/
└── edge-functions/
    └── og-inject.js   ← intercepts /redirect requests, rewrites OG meta tags
```

This is a Netlify-only feature and works on the free tier.

### Analytics
Add UTM tracking in every link and connect Netlify Analytics (paid) or drop in a free GA4 snippet for full funnel tracking.

---

## Why Netlify over GitHub Pages for this use case

| Feature | GitHub Pages | Netlify (free) |
|---|---|---|
| Custom `_redirects` rules | ❌ Not supported | ✅ Native |
| Custom response headers | ❌ No `_headers` file | ✅ Native |
| AASA `Content-Type: application/json` (no extension) | ❌ Difficult | ✅ Works out of the box |
| Edge Functions (dynamic OG tags) | ❌ | ✅ Free tier |
| Deploy from drag & drop | ❌ | ✅ |
| Branch previews | ❌ | ✅ |
| Build minutes (free tier) | 2,000/month | 300/month (unlimited for static) |

**Verdict:** Netlify is the right choice here. The `_redirects` and `_headers` files are essential for serving the AASA/assetlinks files with the correct `Content-Type`, and for routing `/email`, `/sms`, etc. to `redirect.html` without changing the URL. GitHub Pages cannot do this without a workaround.
