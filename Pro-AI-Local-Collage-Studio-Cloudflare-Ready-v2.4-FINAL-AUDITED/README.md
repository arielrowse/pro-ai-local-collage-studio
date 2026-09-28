# Pro AI Local Collage Studio v2.4

Cloudflare Pages-ready, local-first collage and mood-board studio with optional edge AI.

## Deployment

### Recommended: Git / Wrangler deployment

This release is prebuilt. For the current GitHub layout, set **Root directory (advanced) → Path** to `Pro-AI-Local-Collage-Studio-Cloudflare-Ready-v2.4-FINAL-AUDITED`. Set **Build output directory** to `.` and use the no-op build command `exit 0`.

The repository contains the production static app, `functions/` routes, `_headers`, `_redirects`, `_routes.json`, PWA assets, and SEO routes.

> The `/functions` directory must be deployed through a Cloudflare Pages Git integration or Wrangler deployment. A dashboard drag-and-drop upload/direct-upload workflow does not compile Pages Functions.

### Workers AI binding

`wrangler.jsonc` contains the optional `AI` binding used by `/api/assistant` when the edge AI fallback is enabled.

If you deploy through the Cloudflare dashboard, configure the Pages project with the equivalent Workers AI binding. If you do not enable the AI binding, the editor still works and local assistance remains available; only the optional free edge-AI fallback is disabled.

### Core routes

- `/` — application
- `/help/` — help center
- `/privacy/` — privacy / data-processing explanation
- `/photo-collage-maker/` — SEO landing page
- `/mood-board-maker/` — SEO landing page
- `/collage-maker-no-upload/` — SEO landing page
- `/etsy-collage-maker/` — SEO landing page
- `/product-collage-maker/` — SEO landing page
- `/404.html` — custom not-found page
- `/robots.txt` — dynamic robots policy + absolute sitemap URL
- `/sitemap.xml` — dynamic XML sitemap
- `/api/assistant` — optional edge AI assistant only

## Local-first + quota strategy

Core editing, image import, canvas rendering, composition intelligence, focal intelligence, authoring intelligence, adaptive learning, project storage and export run client-side.

The AI route is deliberately optional. The client interprets simple commands locally first, caches repeat AI answers, prevents concurrent requests, and never sends source image bytes to `/api/assistant`.

The edge function has strict body/context limits, same-origin request checks, input sanitization, no automatic provider retries, and fail-fast capacity handling.

## Support + sharing

Downloads open an optional support/share dialog before the file starts downloading. **DOWNLOAD NOW** starts the download immediately. **SUPPORT ME + DOWNLOAD** opens the configured Ko-fi page and also starts the download. Support is optional; the file remains free.

Configured support URL:
`https://ko-fi.com/arielrowse`

The same dialog and the header Share action provide copy-link, WhatsApp, LinkedIn, Facebook, Telegram, and native device sharing when supported.

## PWA / SEO / deployment assets

- `favicon.ico` plus 16/32/48px PNG favicons
- 180px Apple touch icon
- 192px and 512px PWA icons
- Open Graph 1200x630 share image
- WebApplication JSON-LD on the app
- WebPage JSON-LD on SEO/help routes
- canonical tags, robots directives, and social metadata
- dynamic `robots.txt` and `sitemap.xml`
- custom `404.html`
- `_headers` security policy
- `_redirects` legacy help-route redirects
- `_routes.json` keeps ordinary static traffic off Pages Functions

## Important production note

Test the final deployed HTTPS origin before public launch, especially:

1. PWA install / service-worker update
2. native Web Share availability
3. clipboard permissions
4. large-image exports on representative devices
5. `/api/assistant` when an AI binding/provider is enabled
6. social preview cards on the final custom domain

No application can remove browser, device, Cloudflare, or third-party provider limits entirely. This project keeps those limits away from the core editor and avoids turning provider quota into a product paywall or required dependency.

## Production checklist

See `CLOUDFLARE_DEPLOY.md` for the deployment path, first-launch smoke tests, support/share verification, AI binding setup and custom-domain SEO note.


### OPTIONAL EDGE AI SAFETY
The public Cloudflare Workers AI assistant is disabled by default (`EDGE_AI_ENABLED=0`) so a fresh deployment cannot unexpectedly consume the account's free Workers AI allocation. Enable it explicitly only when you want to expose that shared free AI quota. Local intelligence remains available, and BYOK Gemini/Mistral can still be used without this edge route.
