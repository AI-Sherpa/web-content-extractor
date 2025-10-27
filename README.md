# Web Content Extractor

Interactive tooling that turns any web page into LLM-ready context. The project ships a polished single-page UI for running extractions plus an optional Playwright helper service that renders JavaScript-heavy targets before capture.

## What’s Included

- `web_content_extractor.html` — standalone browser UI with a chat-inspired workflow, extraction history, formatting helpers, and Ollama integration.
- `extract-server.js` — Express server that keeps a warm Playwright browser ready for `/extract-with-playwright` requests.
- `static/` — favicon assets referenced by the UI.
- `docker/` — container builds for the UI and helper (with nginx front end and helper-only variants).
- `package.json` / `package-lock.json` — Node metadata for the helper.

## Key Features

- Handles modern pages: Playwright renders targets headlessly, waits for SPA hydration, and falls back to multiple text-only services if the helper is offline.
- Guided workflow: status bubbles, progress meters, and extraction history show exactly where each request is in the pipeline.
- Rich content capture: configurable toggles for metadata, links, image alt text, dynamic content expansion, and post-processing cleanup.
- LLM handoff: send extracted data to Ollama in Markdown or JSON format, track generation progress, and display responses inline with copy/export controls.
- Export anywhere: copy the main content, structured outline, Markdown, JSON, or a ready-to-host HTML capsule with one click.
- Smart defaults: remembers Playwright/Ollama endpoints and preferred models in `localStorage`, dark/light theme toggle, and opinionated response-format hints for HTML-ready LLM output.

## How the Flow Works

1. You enter an instruction that contains a URL and click **Run Task**.
2. The UI calls the Playwright helper (`/extract-with-playwright`) with the target URL and wait time.
3. The helper launches (or reuses) a headless Chromium instance, waits for DOMContentLoaded plus your configured delay, and returns the page HTML.
4. The UI parses and enriches the HTML (clean text, metadata, structure, links, images).
5. If Playwright fails or is unreachable, the UI cascades through text-only fallbacks (AllOrigins proxy, r.jina.ai mirrors, Google Webcache) before surfacing an error.
6. The extraction summary, raw data, and export controls are shown. If an Ollama model is selected, the UI automatically formats a prompt and sends it to your local LLM.

## Prerequisites

- Node.js ≥ 18 (helper server) and npm.
- Playwright browser binaries (`npm run playwright:install` once per machine).
- Optional: Docker + Docker Compose if you prefer containerized deployment.
- Optional: Ollama for on-device LLM generation.

## Local Quick Start

```bash
git clone <repo-url>
cd web-content-extractor
npm install
npm run playwright:install   # installs Playwright browsers
npm start                    # helper listens on http://localhost:3050
```

Open `web_content_extractor.html` directly in your browser (`file://` is fine) or serve it from any static host. Confirm the **Playwright Server URL** field matches where the helper is running (`http://localhost:3050` by default), enter a task such as:

```
Visit https://example.com and summarise the main offerings. Include notable links.
```

Click **Run Task** to launch the extraction. Watch the progress meter and conversation view for status updates, then review the formatted outline, structured JSON, and markdown exports.

## Using the UI

- **Extraction Options** — Expand the footer panel to toggle metadata/link/image inclusion, dynamic content expansion, content cleanup, wait time, and server endpoints.
- **Conversation Thread** — Each run adds a user/assistant pair. System cards surface progress, warnings, and success/failure states.
- **Extraction Details Drawer** — Per result you can switch between formatted text, structured JSON, Markdown, and raw JSON tabs, with copy icons for each.
- **Send to Ollama** — Choose Markdown or JSON payload format, select a model, and click **Send to Ollama** (automatically triggered after extraction when a model is already selected). The UI streams progress, handles errors, and keeps the status bubble pinned to the conversation tail.
- **Copy Menu** — Quick actions exist for copying main content, Markdown, JSON, HTML, or entire LLM responses. Success/warning toasts confirm the results.
- **Theme Toggle & Persistence** — Theme, server URLs, preferred model, and last-known model are stored under dedicated keys so the UI comes back exactly as you left it.

## Ollama Integration

- Set `OLLAMA_ORIGINS` to allow the UI origin before running `ollama serve`. When using `file://`, a permissive value works:
  ```bash
  export OLLAMA_ORIGINS="*"
  ollama serve
  ```
- The UI calls `/api/tags` to populate the model dropdown and will attempt to auto-pull the preferred `gpt-oss:120b-cloud` model if it is missing.
- Response payloads are generated via `/api/generate` with `stream: false`. Any connectivity or CORS issues are surfaced inline with remedial tips.
- Switching models or formats updates the Send button availability immediately; extraction history entries retain the model used at the time of generation.

## Playwright Helper (`extract-server.js`)

- Launches a persistent Chromium instance on first request (headless, `--no-sandbox` flags for container use) and reuses it for subsequent calls.
- Warms the browser on startup by loading `about:blank` so the first extraction returns quickly.
- Route: `POST /extract-with-playwright` with payload `{ url, waitTime }`. Wait time defaults to 3000 ms and feeds both the navigation timeout and post-load delay.
- Returns `{ success: true, html }` or `{ success: false, error }`. Errors are logged server-side and mirrored in the UI.
- Graceful shutdown on `SIGTERM`/`SIGINT` plus defensive cleanup on uncaught errors to avoid orphaned Chromium processes.

## Fallback Extraction Strategy

If the helper is offline or Playwright cannot reach the page, the UI attempts:

1. AllOrigins proxy (`https://api.allorigins.win/raw?...`).
2. r.jina.ai text mirroring (`https://r.jina.ai/http://…` variants, with and without `www.`).
3. Google Webcache (`https://webcache.googleusercontent.com/search?q=cache:…`).

These sources return simplified HTML; dynamic or authenticated content will likely be missing. The final extraction report records which method succeeded (`playwright`, `playwright-fallback`, `alternative`, or `cached`) so you can gauge fidelity.

## Docker Quick Start

Build and run the helper alone:

```bash
docker build -t web-content-extractor-helper -f docker/Dockerfile .
docker run --rm -p 3050:3050 web-content-extractor-helper
```

Serve the UI (optional TLS) via nginx:

```bash
# optional: refresh the self-signed cert
docker/generate-ssl.sh

docker build -t web-content-extractor-ui -f docker/Dockerfile.web .
docker run --rm -p 8080:80 web-content-extractor-ui
```

Compose the full stack:

```bash
docker compose -f docker/docker-compose.yml up --build -d
```

The compose file exposes the UI at `http://localhost:8080` and the helper at `http://localhost:3050`. It expects Ollama on the host; uncomment the `ollama` service and follow `docker/README.md` to containerize the model server.

## Configuration & Persistence Notes

- Helper honours `PORT` (default `3050`).
- UI uses `localStorage` keys:
  - `playwrightServerUrl`
  - `ollamaServerUrl`
  - `ollamaModel`
  - `uiTheme`
- Wait time input accepts 1000–10000 ms in 500 ms steps; longer waits automatically widen navigation timeouts.

## Repository Layout

```
web-content-extractor/
├── extract-server.js
├── web_content_extractor.html
├── static/
│   ├── favicon.png
│   └── favicon.svg
├── docker/
│   ├── Dockerfile
│   ├── Dockerfile.web
│   ├── docker-compose.yml
│   ├── generate-ssl.sh
│   └── nginx.conf
├── package.json
├── package-lock.json
└── README.md
```

## Development Tips

- The UI is plain HTML/JS/CSS; iterate quickly by editing `web_content_extractor.html` and refreshing the browser.
- Playwright downloads sizable browser binaries. Keep them cached locally; `.gitignore` already excludes `node_modules/` and Playwright artifacts.
- Logs from the helper make troubleshooting straightforward—watch for navigation timeouts or Chromium launch failures if extractions stall.

## License

MIT License (`LICENSE`) © 2025 Jansen Tang.
