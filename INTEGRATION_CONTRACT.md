# Bubble Runtime Worker Integration Contract

This contract is for backend-to-backend integration from your main app to the worker.

## Endpoint

- Method: `POST`
- URL: `${WORKER_BASE_URL}/inspect`
- Content-Type: `application/json`

## Required Headers

- `x-worker-secret`: must match worker `WORKER_SECRET`
- `x-caller-id`: stable caller identity from your backend (for per-caller limiting)

## Caller Identity (`x-caller-id`)

Use a stable server-generated identifier. Recommended priority:

1. `workspace:<workspaceId>`
2. `user:<userId>`
3. `visitor:<server-generated-visitor-id-cookie>`

If you have no stable ID, fallback to a hashed fingerprint in your backend (for example `hash(ip + userAgent + salt)`).

## Request Body

```json
{
  "url": "https://app.vows.you/"
}
```

Rules:

- `url` is required
- only public `http`/`https` targets are allowed
- localhost/private/internal targets are rejected

## Success Response (`200`)

Top-level contract:

```json
{
  "ok": true,
  "submittedUrl": "https://app.vows.you/",
  "finalUrl": "https://app.vows.you/",
  "bubbleDetection": {},
  "summary": {},
  "database": {},
  "optionSets": {},
  "pages": {},
  "colors": {},
  "debugMeta": {},
  "consoleMessages": []
}
```

Notes:

- JSON is source of truth.
- Worker returns partial sections with warnings when some runtime trees are missing.
- Do not depend on strict key ordering.

## Error Contract

### `400 Bad Request`

Request URL is malformed, unsupported, or blocked by safety checks.

Example:

```json
{
  "ok": false,
  "error": "Invalid URL: only http/https URLs are allowed"
}
```

### `401 Unauthorized`

Missing or incorrect `x-worker-secret`.

Example:

```json
{
  "ok": false,
  "error": "Unauthorized: invalid or missing x-worker-secret header"
}
```

### `429 Too Many Requests`

Global or per-caller rate limit exceeded.

Example:

```json
{
  "ok": false,
  "error": "Rate limit exceeded for caller: max 5 requests per minute",
  "limitScope": "caller",
  "limitWindow": "minute",
  "limit": 5,
  "retryAfterSeconds": 60
}
```

### `503 Service Unavailable`

Concurrency cap reached (worker busy).

Example:

```json
{
  "ok": false,
  "error": "Worker is busy: max 2 active inspections",
  "retryAfterSeconds": 1
}
```

### `504 Gateway Timeout`

Inspection exceeded total timeout ceiling.

Example:

```json
{
  "ok": false,
  "submittedUrl": "https://app.vows.you/",
  "error": "Inspection timed out",
  "details": "Inspection exceeded total timeout of 30000ms"
}
```

### `500 Internal Server Error`

Unexpected worker failure.

Example:

```json
{
  "ok": false,
  "submittedUrl": "https://app.vows.you/",
  "error": "Inspection failed",
  "details": "..."
}
```

## Retry Rules (Main App Backend)

- `200`: success, no retry.
- `400`: do not retry; fix user input.
- `401`: do not retry; fix secret/env mismatch.
- `429`: retry after `Retry-After` header (or `retryAfterSeconds` body).
- `503`: retry after `Retry-After` header (or `retryAfterSeconds` body).
- `504`: optional retry once with backoff; then surface timeout to user.
- `500`: retry with capped exponential backoff.

Recommended retry policy:

1. Max attempts: `3`
2. Backoff: `500ms`, `1500ms`, `3000ms` (+ jitter)
3. Always respect `Retry-After` when present
4. Keep retries server-side only

## Rate-Limit Headers

Worker sets these headers on `POST /inspect`:

- `X-RateLimit-Global-Limit-Minute`
- `X-RateLimit-Global-Limit-Hour`
- `X-RateLimit-Global-Remaining-Minute`
- `X-RateLimit-Global-Remaining-Hour`
- `X-RateLimit-Caller-Limit-Minute`
- `X-RateLimit-Caller-Limit-Hour`
- `X-RateLimit-Caller-Remaining-Minute`
- `X-RateLimit-Caller-Remaining-Hour`
- `Retry-After` (when throttled/busy)

## Server-to-Server Example

```js
const response = await fetch(`${process.env.WORKER_BASE_URL}/inspect`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-worker-secret": process.env.WORKER_SECRET,
    "x-caller-id": callerId
  },
  body: JSON.stringify({ url })
});

const data = await response.json();
```
