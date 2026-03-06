# bubble-runtime-worker

Standalone Node.js + Playwright worker service for inspecting one submitted public URL and extracting targeted public Bubble runtime data.

This worker is meant to be called by your main app. Your main app sends a URL, and this worker returns structured JSON that indicates Bubble likelihood plus extracted subsets (`user_types`, `option_sets`, pages, colors).

## What problem this solves

- Your main app should not run browser automation directly.
- This service isolates browser execution and Bubble runtime extraction.
- The worker returns normalized JSON so your main app can consume one stable response shape.

## Key behavior

- `POST /inspect` accepts one URL.
- Requires `x-worker-secret` header auth.
- Applies in-memory per-IP rate limits and an in-process concurrency cap.
- Validates URL and rejects obvious unsafe/internal targets.
- Loads only the submitted URL in Playwright.
- Uses runtime object inspection (not console text parsing) as source of truth.
- Extracts targeted subsets only (does **not** serialize full `window.app`).
- Returns partial data + warnings when some sections are missing.
- Optionally writes local debug files in `output/`.

## Folder structure

```text
bubble-runtime-worker/
  src/
    server.js
    inspector.js
    extractors.js
    bubbleDetection.js
    validateUrl.js
    auth.js
    writeDebugFiles.js
    config.js
  output/
    .gitkeep
  package.json
  Dockerfile
  fly.toml
  .dockerignore
  .gitignore
  README.md
```

## Environment variables

Required:

- `WORKER_SECRET` - shared secret required in `x-worker-secret` header.

Common optional:

- `PORT` (default `8080`)
- `DEBUG_OUTPUT_ENABLED` (`true`/`false`, default true outside production)
- `OUTPUT_DIR` (default `./output`)
- `NAVIGATION_TIMEOUT_MS` (default `30000`)
- `BUBBLE_SIGNAL_WAIT_MS` (default `5000`)
- `APP_WAIT_MS` (default `10000`)
- `POST_APP_DELAY_MS` (default `1200`)
- `TOTAL_INSPECTION_TIMEOUT_MS` (default `30000`)
- `RATE_LIMIT_PER_MINUTE` (default `5`)
- `RATE_LIMIT_PER_HOUR` (default `20`)
- `MAX_CONCURRENT_INSPECTIONS` (default `2`)
- `TRUST_PROXY_HOPS` (default `1` for Fly proxy chain)
- `MAX_APP_KEYS` (default `50`)
- `MAX_CONSOLE_MESSAGES` (default `20`)
- `MAX_CONSOLE_TEXT_LENGTH` (default `250`)

## Auth model

`POST /inspect` is protected by a shared secret header:

- Header: `x-worker-secret`
- Value must match `WORKER_SECRET`
- Unauthorized calls get `401`

This is the MVP protection to prevent random public traffic from abusing browser execution.

## Rate limiting and concurrency (MVP)

`POST /inspect` has two additional guards:

- Per-IP in-memory rate limits:
  - `5` requests/minute/IP (default)
  - `20` requests/hour/IP (default)
- Global in-process concurrency cap:
  - `2` active inspections at once (default)

When limits are exceeded the worker returns `429` and includes `retryAfterSeconds`.

Timeout behavior:

- If total inspection duration exceeds `TOTAL_INSPECTION_TIMEOUT_MS`, worker returns `504`.

Important MVP caveat:

- These limits are in-memory and local to one running process.
- If you scale to multiple Fly machines, counters are **not** shared globally.
- For globally shared limits later, use Redis/Upstash (or another shared store).

## Calling from your main app (recommended pattern)

Call the worker from your main app **server-side** (API route/backend), not from browser client code.

Why:

- The worker secret must stay private.
- Browser-side calls would expose `x-worker-secret`.
- This repo intentionally does not enable broad CORS for public browser-origin calls.

Server-side example (Node.js):

```js
const workerBaseUrl = process.env.WORKER_BASE_URL;
const workerSecret = process.env.WORKER_SECRET;

const response = await fetch(`${workerBaseUrl}/inspect`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-worker-secret": workerSecret
  },
  body: JSON.stringify({ url: "https://app.vows.you/" })
});

const data = await response.json();
```

## Local run

1. Install dependencies:

```bash
npm install
```

2. Set env vars:

```bash
export WORKER_SECRET="replace-with-long-random-secret"
export DEBUG_OUTPUT_ENABLED="true"
```

3. Start dev server:

```bash
npm run dev
```

Or production-style local run:

```bash
npm start
```

## Local test request

```bash
curl -X POST http://localhost:8080/inspect \
  -H 'Content-Type: application/json' \
  -H 'x-worker-secret: replace-with-long-random-secret' \
  -d '{"url":"https://example.com"}'
```

## Response shape

Response is structured JSON with these main sections:

- `ok`, `submittedUrl`, `finalUrl`
- `bubbleDetection`
- `summary`
- `database` (`types`, `refs`, optional `dbml`, `warnings`)
- `optionSets` (`items`, optional `dbml`, `warnings`)
- `pages` (`items`, `count`, `warnings`)
- `colors` (`%del:false`, `%del:true`, `warnings`)
- `debugMeta`
- `consoleMessages` (optional capped messages)

## Debug output

When `DEBUG_OUTPUT_ENABLED=true`, worker writes local files in `output/`:

- `latest-response.json`
- `latest-database.json`
- `latest-database.dbml.txt`
- `latest-option-sets.json`
- `latest-pages.json`
- `latest-colors.json`
- `latest-summary.json`

Important:

- This is local troubleshooting output only.
- Write failures are ignored (request still succeeds/fails normally).
- Do not treat Fly filesystem as durable storage.

## Why Dockerfile

This worker uses Playwright + Chromium. Docker is used for predictable browser dependencies and simpler Fly deployment. Fly builds directly from the Dockerfile.

## Fly.io deploy steps (beginner)

1. Install Fly CLI: <https://fly.io/docs/hands-on/install-flyctl/>
2. Log in:

```bash
fly auth login
```

3. (First time) launch app in this folder:

```bash
fly launch --no-deploy
```

If prompted, keep this app as a standalone service. You can keep the checked-in `Dockerfile` and `fly.toml`.

4. Set secret:

```bash
fly secrets set WORKER_SECRET="replace-with-long-random-secret"
```

5. Deploy:

```bash
fly deploy
```

6. Test deployed endpoint:

```bash
curl -X POST https://<your-fly-app>.fly.dev/inspect \
  -H 'Content-Type: application/json' \
  -H 'x-worker-secret: replace-with-long-random-secret' \
  -d '{"url":"https://example.com"}'
```

7. Optional quick health check:

```bash
curl https://<your-fly-app>.fly.dev/health
```

8. Wire your main app backend env vars:

- `WORKER_BASE_URL=https://<your-fly-app>.fly.dev`
- `WORKER_SECRET=<same secret set in Fly>`

## Common pitfalls (and how this worker addresses them)

1. Do not rely on `load` only: worker uses staged waits (`domcontentloaded`, signal wait, app wait, short delay).
2. Do not depend on console logs: extraction uses direct runtime object reads via `page.evaluate`.
3. Do not serialize full `window.app`: worker extracts only targeted subsets.
4. Do not crash on missing fields: extractors use defensive access and warnings.
5. Do not mix routing and extraction logic: route, inspector, validation, extractors are separate modules.
6. Do not assume all Bubble apps match one shape: missing sections produce partial results + warnings.
7. Do not keep permanent debug files in production: debug writing is toggleable and local-only.
8. Do not skip URL validation: worker blocks obvious unsafe protocols/hosts/IP ranges.
9. Do not leave endpoint unauthenticated: shared secret middleware required.
10. Do not fail whole request when one section missing: each extractor returns independently.
11. Return partial results with warnings: each section contains its own warnings array.
12. Keep payloads bounded: app keys + console capture are capped.
13. In-memory rate limits are per-instance only: use a shared backend if you later need global limits across many machines.

## Implementation notes

- `src/server.js`: HTTP server + endpoint orchestration.
- `src/auth.js`: shared secret header guard.
- `src/validateUrl.js`: malformed URL + obvious SSRF/internal-target checks.
- `src/inspector.js`: Playwright lifecycle, staged waits, runtime snapshot.
- `src/rateLimit.js`: in-memory per-IP rate limiting + concurrency slot control.
- `src/bubbleDetection.js`: Bubble-likelihood logic.
- `src/extractors.js`: targeted JSON extraction + optional DBML derivation.
- `src/writeDebugFiles.js`: best-effort local output writes.
