# Web Content Extractor

A lightweight toolkit for turning any web page into LLM-ready text. The project ships a polished browser UI for driving extractions plus an optional Playwright-powered helper service that renders dynamic, JavaScript-heavy pages.

## Features

- Toggleable extraction options: include structured metadata, link and image alt text, and optional content cleaning.
- Playwright integration for server-side rendering of SPA or client-heavy pages with configurable wait times.
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

Then load `web_content_extractor.html` in your browser (open it via `file://` or serve it with any static file server). In the UI, ensure **Use Real Browser (Playwright)** is toggled on and the server URL field matches where the helper is running—`http://localhost:3050` by default. Toggle options as needed, submit a URL, and copy the output format you prefer.

> Tip: Press the **Use Real Browser (Playwright)** toggle off if you only need a simple fetch without headless rendering.

## Docker Quick Start

Build and run the helper service on its own:

```bash
docker build -t web-content-extractor-helper -f docker/Dockerfile .
docker run --rm -p 3050:3050 web-content-extractor-helper
```

Serve the UI from nginx:

```bash
docker build -t web-content-extractor-ui -f docker/Dockerfile.web .
docker run --rm -p 8080:80 web-content-extractor-ui
```

Spin up the full stack via Compose:

```bash
docker compose -f docker/docker-compose.yml up --build -d
```

This exposes the UI at `http://localhost:8080`, with the helper available at `http://localhost:3050`. Inside the Compose network, the UI talks to the helper at `http://playwright-extractor:3050`. See `docker/README.md` for detailed container workflows, logs, and teardown commands.

## Configuration Notes

- The helper honours `PORT` (default `3050`); adjust when running multiple instances.
- Update the Playwright server URL field in the UI if you deploy the helper elsewhere (remote host, Docker container, etc.).
- The `wait time` option instructs Playwright how long to pause for client-side rendering before content capture.

## Development Tips

- The UI is a single static file—customize the styling or behaviour directly in `web_content_extractor.html`.
- Use the stats grid within the UI results pane to sanity-check extraction length and metadata at a glance.
- Playwright downloads sizeable browser binaries. Keep them cached locally and rely on `.gitignore` to avoid checking them into source control.

## License

This project is released under the MIT License (`LICENSE`). Update the copyright notice with
your name or organization if needed before sharing the repository publicly.
