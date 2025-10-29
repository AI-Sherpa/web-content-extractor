# Docker Deployment

This folder contains everything needed to run the Web Content Extractor UI and the Playwright extraction helper inside containers.

## Structure

- `Dockerfile` – builds the Playwright extraction helper (`extract-server.js`).
- `Dockerfile.web` – builds a lightweight Nginx image that serves the static UI (`web_content_extractor.html` and companion pages).
- `docker-compose.yml` – convenience launcher that brings up both services together.
- `docker/` – Nginx configuration used by the UI container.

## Usage

All commands below assume you're running them from the `web-content-extractor/` directory:

```bash
cd web-content-extractor
```

### Build and run Playwright helper only

```bash
docker build -t playwright-extractor -f docker/Dockerfile .
docker run -d --rm -p 3050:3050 playwright-extractor
```

### Build and run UI only

```bash
docker build -t extractor-ui -f docker/Dockerfile.web .
docker run -d --rm -p 8080:80 extractor-ui
```

> Note: The UI image serves only `web_content_extractor.html`. If you need extra static pages, copy them into the `web-content-extractor/` directory and extend `docker/Dockerfile.web` accordingly.

### Run both services together

```bash
docker compose -f docker/docker-compose.yml up --build -d
docker compose -f docker/docker-compose.yml logs -f   # optional: stream logs
```

This exposes:

- UI at `http://localhost:8080` (also `https://localhost:8443` with the bundled self-signed cert)
- Embedded helper proxy at `https://localhost:8443/api/playwright/extract` (nginx forwards to the helper container)
- Playwright helper direct endpoint at `http://localhost:3050`

By default you are expected to run Ollama separately on the host (for example, `ollama serve` listening on `http://localhost:11434`). Adjust the UI’s “Ollama Server” field accordingly.

If you prefer to run Ollama in Docker, uncomment the `ollama` service near the bottom of `docker-compose.yml`, then run `docker compose up -d` again so the stack restarts in the background. The commented block already includes persistent storage, CORS settings, and optional GPU hints.

### (Optional) Pull Ollama models

When running the Ollama container, you still need to download models. After enabling the service and bringing the stack up:

```bash
ollama pull llama3.1
```

The command targets the container because port `11434` is published to the host. Pull any other models you want (`mistral`, `phi3`, etc.).

### Shut down compose services

```bash
docker compose -f docker/docker-compose.yml down
```

## Updating the UI instructions

If you move this folder or change ports, update both `docker/nginx.conf` and the guidance text embedded in `web_content_extractor.html` so the on-screen setup instructions stay accurate.

## Troubleshooting Ollama & CORS

The UI calls Ollama directly from the browser, so the Ollama server must allow the UI origin. When using the container, set `OLLAMA_ORIGINS=file://,http://localhost:8080,http://127.0.0.1:8080` (already present in the commented service). If you serve the UI from a different hostname or port, adjust that environment variable accordingly.

- Browser error “Failed to fetch”: CORS is likely blocking the request. Update `OLLAMA_ORIGINS` to include the UI origin and restart the Ollama container.
- Running Ollama on the host: ensure you export `OLLAMA_ORIGINS` before launching `ollama serve`, e.g. `export OLLAMA_ORIGINS="file://,http://localhost:8080"`.
