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

- UI at `http://localhost:8080`
- Playwright helper at `http://localhost:3050`

Inside the compose network, the UI reaches the helper at `http://playwright-extractor:3050`.

### Shut down compose services

```bash
docker compose -f docker/docker-compose.yml down
```

## Updating the UI instructions

If you move this folder or change ports, update the guidance text embedded in `web_content_extractor.html` so the on-screen setup instructions stay accurate.
