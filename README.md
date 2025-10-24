# Web Content Extractor

A lightweight toolkit for turning any web page into LLM-ready text. The project ships a polished browser UI for driving extractions plus an optional Playwright-powered helper service that renders dynamic, JavaScript-heavy pages.

## Features

- Toggleable extraction options: include structured metadata, link and image alt text, and optional content cleaning.
- Playwright integration for server-side rendering of SPA or client-heavy pages with configurable wait times.
- Built-in handoff to local Ollama models: send the extracted content (Markdown or JSON) with a custom prompt and view responses inline.
- Multiple export formats (clean text, structured data, Markdown, JSON, and raw HTML) with one-click copy actions.
- Zero-build workflow for the UI—open the HTML file directly—or deploy both UI and helper in Docker containers.

## Repository Layout

```
web-content-extractor/
├── extract-server.js          # Express + Playwright helper API
├── web_content_extractor.html # Stand-alone browser UI
├── docker/                    # Dockerfiles, compose stack, and nginx config
├── package.json               # Helper service metadata and scripts
├── package-lock.json
└── .gitignore
```

## Ignored Files

Generated artifacts and machine-specific files are kept out of version control:

- Node/Playwright dependencies and caches (`node_modules/`, Playwright reports, coverage output, etc.).
- Local TLS materials under `docker/ssl/`; regenerate them with `docker/generate-ssl.sh` whenever you need fresh certs.
- Developer-specific workspace files such as `*.code-workspace` or macOS `.DS_Store` entries.

## Prerequisites

- Node.js ≥ 18 and npm (for the Playwright helper).
- Docker / Docker Compose (optional) if you prefer containerized deployment.
- Playwright browser binaries. Install them once with `npm run playwright:install` or `npx playwright install --with-deps`.

## Local Quick Start

```bash
git clone <repo-url>
cd web-content-extractor
npm install
npm run playwright:install   # optional but recommended on a fresh machine
npm start                    # starts the helper on http://localhost:3050
```

Then load `web_content_extractor.html` in your browser (open it via `file://` or serve it with any static file server). The UI always routes page fetches through the Playwright helper, so make sure the server URL field matches where it is running—`http://localhost:3050` by default. Enter an instruction that includes the target URL (for example, `From the URL "https://...", tell me ...`) and click **Run Task**. The app runs Playwright extraction with the default options, forwards the result to your local LLM, and shows both the raw capture and the model response. Expand the options panel if you need to tweak extraction settings.

> Ollama users: start `ollama serve` with `OLLAMA_ORIGINS` set to your UI origin (for example, `export OLLAMA_ORIGINS="file://,http://localhost:8080"`), so the browser is allowed to call the API.

## Docker Quick Start

Build and run the helper service on its own:

```bash
docker build -t web-content-extractor-helper -f docker/Dockerfile .
docker run --rm -p 3050:3050 web-content-extractor-helper
```

Serve the UI from nginx:

```bash
# optional: create or refresh the self-signed TLS cert/key for HTTPS
docker/generate-ssl.sh

docker build -t web-content-extractor-ui -f docker/Dockerfile.web .
docker run --rm -p 8080:80 web-content-extractor-ui
```

Spin up the full stack via Compose:

```bash
docker compose -f docker/docker-compose.yml up --build -d
```

The `-d` flag keeps the stack running in the background; tail logs anytime with `docker compose -f docker/docker-compose.yml logs -f`.

This exposes the UI at `http://localhost:8080` and the helper at `http://localhost:3050`. By default the compose file expects you to run Ollama on your host machine; point the UI to `http://localhost:11434` (or another host) after launching the stack. To run Ollama in a container instead, uncomment the `ollama` service in `docker/docker-compose.yml` and see `docker/README.md` for details and CORS guidance.

## Configuration Notes

- The helper honours `PORT` (default `3050`); adjust when running multiple instances.
- Update the Playwright server URL field in the UI if you deploy the helper elsewhere (remote host, Docker container, etc.).
- The `wait time` option instructs Playwright how long to pause for client-side rendering before content capture.

## Development Tips

- The UI is a single static file—customize the styling or behaviour directly in `web_content_extractor.html`.
- Playwright downloads sizeable browser binaries. Keep them cached locally and rely on `.gitignore` to avoid checking them into source control.

## License

This project is released under the MIT License (`LICENSE`) © 2025 Jansen Tang.
