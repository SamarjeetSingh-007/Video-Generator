# 🎬 Video Generation Studio

A simple, self-contained web app (HTML / CSS / JS) for generating short videos with
**bring-your-own API keys**, then stitching clips into a 15–30s ad — all in the browser.

Providers supported: **NVIDIA Cosmos** (free endpoint) and **Hugging Face**. Because both
block direct browser calls, requests go through a tiny free **Cloudflare Worker** proxy.

## Features

- Provider + model picker that shows each model's capabilities
- Text prompt and/or reference images (upload or paste)
- Aspect ratio (16:9 / 1:1 / 9:16), resolution, and clip length — unsupported options auto-disable
- Async job handling: progress, cancel, retry, timeout
- Multi-segment project: reorder, remove, and **stitch clips into one MP4** client-side (ffmpeg.wasm)
- Preview + download for clips and the final video
- API key stored only in your browser (auto-saved), with reveal/remove
- Per-provider **endpoint override** for when an API URL changes
- Fully responsive; double-click launcher for local use

## Quick start (local)

Double-click **`Start Video Studio.command`** (macOS), or run a static server:

```bash
python3 -m http.server 8765
# then open http://localhost:8765
```

> A local server is needed because the stitching engine (ffmpeg.wasm) loads from a CDN,
> which browsers block on `file://`.

## Hosting on GitHub Pages

1. Push this repo to GitHub.
2. **Settings → Pages → Source: `main` / root.**
3. Open the `https://USERNAME.github.io/REPO` URL on any device.

GitHub Pages serves over HTTPS, so the stitching engine loads fine.

## One-time: deploy the proxy (free)

Both providers need a CORS proxy. See **[`cloudflare-worker/README.md`](cloudflare-worker/README.md)**.
In short: create a Cloudflare Worker, paste `cloudflare-worker/worker.js` into the **Edit code**
editor (don't use file Upload), Deploy, then paste the Worker URL into the app's **Proxy URL** box.

## Getting API keys

- **NVIDIA Cosmos3 Nano** — free key at [build.nvidia.com/nvidia/cosmos3-nano](https://build.nvidia.com/nvidia/cosmos3-nano) (`nvapi-…`). 720p, ~5–10s, text/image→video, commercial use OK.
- **Hugging Face** — Read token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) (`hf_…`). Note: the biggest models may not be on the free serverless tier.

Click **"Where do I get a free key?"** inside the app for the full guide.

## Project layout

```
index.html        # UI
styles.css        # styles (responsive)
config.js         # providers, models, options, in-app guide
storage.js        # API key + state persistence (localStorage)
providers.js      # NVIDIA + Hugging Face adapters (via proxy)
assembler.js      # client-side stitching (ffmpeg.wasm)
app.js            # UI controller + job manager
favicon.svg
Start Video Studio.command   # local double-click launcher (macOS)
cloudflare-worker/           # the CORS proxy (worker.js, wrangler.toml, README)
```

## Privacy & security

- Your API key is stored only in your browser's `localStorage` and is sent only to the
  provider (via your own proxy). It is never committed or sent to any server of this project.
- The Worker proxy stores nothing and only relays to NVIDIA / Hugging Face hosts.

## Notes

- Most free models cap single clips around 5–10s; generate several and stitch for a full ad.
- Cosmos is a physics/world model — great for realistic product motion, less "glossy commercial" than paid models.
