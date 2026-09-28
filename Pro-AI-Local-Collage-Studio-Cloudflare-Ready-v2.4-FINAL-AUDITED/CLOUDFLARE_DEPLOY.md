# Cloudflare Pages production deployment

## Recommended deployment path

This project includes a `/functions` directory for optional edge AI plus dynamic `robots.txt` and `sitemap.xml`. Deploy it with **Cloudflare Pages Git integration** or **Wrangler**. Do not use the Cloudflare dashboard's drag-and-drop Direct Upload for this build, because that flow does not compile a `functions` directory.

### Option A — Git integration

1. Put the project root in a GitHub or GitLab repository.
2. In Cloudflare: **Workers & Pages → Create application → Pages → Connect to Git**.
3. Select the repository.
4. Use the repository root as the build/output directory.
5. Use a no-op build command such as `exit 0` because the project is already prebuilt.
6. Deploy.
7. In the Pages project settings, verify the optional Workers AI binding named `AI` if you want the free edge-AI fallback.

### Option B — Wrangler

From this directory:

```bash
npx wrangler pages project create pro-ai-local-collage
npx wrangler pages deploy . --project-name=pro-ai-local-collage
```

Wrangler will publish the static files and the `/functions` directory.

## First-launch verification

Check these exact URLs on the deployed HTTPS origin:

- `/`
- `/help/`
- `/privacy/`
- `/photo-collage-maker/`
- `/mood-board-maker/`
- `/collage-maker-no-upload/`
- `/etsy-collage-maker/`
- `/product-collage-maker/`
- `/404-test-that-does-not-exist`
- `/robots.txt`
- `/sitemap.xml`
- `/manifest.webmanifest`

Then test:

- upload 1, 2, 4, 9 and large images
- Smart Shuffle / Compare
- subject/focal intelligence
- Precision Studio movement and snapping
- Smart Command / Creative Copilot
- save/open `.localcollage`
- PNG/JPEG/WEBP export
- transparent PNG export
- clipboard export
- header Share
- Copy Link
- WhatsApp / LinkedIn / Facebook / Telegram links
- native device share when supported
- download support popup
- **DOWNLOAD NOW**
- **SUPPORT ME + DOWNLOAD**
- Ko-fi footer link
- PWA installation and offline reload
- recovery after closing/reopening a project

## AI quota model

The core editor does not require AI. Local commands and deterministic intelligence are free of provider quota.

The optional `/api/assistant` route is separately protected and receives only compact structured context. It does not accept source image bytes. Keep the Workers AI binding optional so a temporary edge-AI capacity issue never blocks the editor.

## SEO domain note

The package's default absolute social/canonical origin is:

`https://pro-ai-local-collage.pages.dev`

That matches the project name in `wrangler.jsonc`. If you later attach a custom domain, replace that origin in the static canonical/Open Graph/Twitter tags before making the custom domain the primary SEO URL. The dynamic `robots.txt` and `sitemap.xml` functions already use the request origin automatically.


### OPTIONAL EDGE AI SAFETY
The public Cloudflare Workers AI assistant is disabled by default (`EDGE_AI_ENABLED=0`) so a fresh deployment cannot unexpectedly consume the account's free Workers AI allocation. Enable it explicitly only when you want to expose that shared free AI quota. Local intelligence remains available, and BYOK Gemini/Mistral can still be used without this edge route.
