const { config } = require("./config");

const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const STALE_IP_TTL_MS = 2 * ONE_HOUR_MS;

// In-memory maps are intentionally simple for MVP. They are per-process only,
// not shared across multiple Fly instances.
const perIpCounters = new Map();
let activeInspections = 0;
let requestsSinceCleanup = 0;

function nowMs() {
  return Date.now();
}

function normalizeIp(value) {
  if (!value) return "unknown";
  return String(value).trim();
}

function resetWindowIfNeeded(windowState, durationMs, now) {
  if (now - windowState.windowStart >= durationMs) {
    windowState.windowStart = now;
    windowState.count = 0;
  }
}

function getOrCreateIpCounter(ip, now) {
  const existing = perIpCounters.get(ip);
  if (existing) {
    existing.lastSeenAt = now;
    return existing;
  }

  const created = {
    minute: { windowStart: now, count: 0 },
    hour: { windowStart: now, count: 0 },
    lastSeenAt: now
  };

  perIpCounters.set(ip, created);
  return created;
}

function maybeCleanupOldIpCounters(now) {
  requestsSinceCleanup += 1;
  if (requestsSinceCleanup % 100 !== 0) return;

  for (const [ip, counter] of perIpCounters.entries()) {
    if (now - counter.lastSeenAt > STALE_IP_TTL_MS) {
      perIpCounters.delete(ip);
    }
  }
}

function buildRateLimitExceededResponse(limitType, limitValue, retryAfterSeconds) {
  return {
    ok: false,
    error: `Rate limit exceeded: max ${limitValue} requests per ${limitType} per IP`,
    retryAfterSeconds
  };
}

function setRateLimitHeaders(res, minuteRemaining, hourRemaining) {
  res.set("X-RateLimit-Limit-Minute", String(config.rateLimitPerMinute));
  res.set("X-RateLimit-Limit-Hour", String(config.rateLimitPerHour));
  res.set("X-RateLimit-Remaining-Minute", String(Math.max(0, minuteRemaining)));
  res.set("X-RateLimit-Remaining-Hour", String(Math.max(0, hourRemaining)));
}

function rateLimitInspectRequests(req, res, next) {
  const now = nowMs();
  const ip = normalizeIp(req.ip || req.socket?.remoteAddress);
  const counter = getOrCreateIpCounter(ip, now);

  resetWindowIfNeeded(counter.minute, ONE_MINUTE_MS, now);
  resetWindowIfNeeded(counter.hour, ONE_HOUR_MS, now);
  maybeCleanupOldIpCounters(now);

  if (counter.minute.count >= config.rateLimitPerMinute) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((counter.minute.windowStart + ONE_MINUTE_MS - now) / 1000)
    );
    res.set("Retry-After", String(retryAfterSeconds));
    setRateLimitHeaders(res, 0, config.rateLimitPerHour - counter.hour.count);
    return res
      .status(429)
      .json(buildRateLimitExceededResponse("minute", config.rateLimitPerMinute, retryAfterSeconds));
  }

  if (counter.hour.count >= config.rateLimitPerHour) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((counter.hour.windowStart + ONE_HOUR_MS - now) / 1000)
    );
    res.set("Retry-After", String(retryAfterSeconds));
    setRateLimitHeaders(res, config.rateLimitPerMinute - counter.minute.count, 0);
    return res
      .status(429)
      .json(buildRateLimitExceededResponse("hour", config.rateLimitPerHour, retryAfterSeconds));
  }

  counter.minute.count += 1;
  counter.hour.count += 1;

  setRateLimitHeaders(
    res,
    config.rateLimitPerMinute - counter.minute.count,
    config.rateLimitPerHour - counter.hour.count
  );

  return next();
}

function tryAcquireInspectionSlot() {
  if (activeInspections >= config.maxConcurrentInspections) {
    return null;
  }

  activeInspections += 1;
  let released = false;

  return function releaseInspectionSlot() {
    if (released) return;
    released = true;
    activeInspections = Math.max(0, activeInspections - 1);
  };
}

function getInspectionLoad() {
  return {
    activeInspections,
    maxConcurrentInspections: config.maxConcurrentInspections
  };
}

module.exports = {
  rateLimitInspectRequests,
  tryAcquireInspectionSlot,
  getInspectionLoad
};
