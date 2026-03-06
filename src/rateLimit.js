const { config } = require("./config");

const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const STALE_COUNTER_TTL_MS = 2 * ONE_HOUR_MS;

// Swappable storage boundary:
// This in-memory store is simple for MVP. If you move to Redis later,
// implement the same getOrCreateCounter(key, now) + cleanup strategy there.
class InMemoryRateLimitStore {
  constructor() {
    this.counters = new Map();
    this.lookupsSinceCleanup = 0;
  }

  getOrCreateCounter(key, now) {
    const existing = this.counters.get(key);
    if (existing) {
      existing.lastSeenAt = now;
      this.maybeCleanup(now);
      return existing;
    }

    const created = {
      minute: { windowStart: now, count: 0 },
      hour: { windowStart: now, count: 0 },
      lastSeenAt: now
    };

    this.counters.set(key, created);
    this.maybeCleanup(now);
    return created;
  }

  maybeCleanup(now) {
    this.lookupsSinceCleanup += 1;
    if (this.lookupsSinceCleanup % 100 !== 0) return;

    for (const [key, value] of this.counters.entries()) {
      if (now - value.lastSeenAt > STALE_COUNTER_TTL_MS) {
        this.counters.delete(key);
      }
    }
  }
}

const rateLimitStore = new InMemoryRateLimitStore();
let activeInspections = 0;

function resetWindowIfNeeded(windowState, durationMs, now) {
  if (now - windowState.windowStart >= durationMs) {
    windowState.windowStart = now;
    windowState.count = 0;
  }
}

function remainingLimit(limitValue, currentCount) {
  return Math.max(0, limitValue - currentCount);
}

function retryAfterSeconds(windowState, durationMs, now) {
  return Math.max(1, Math.ceil((windowState.windowStart + durationMs - now) / 1000));
}

function normalizeCallerId(rawValue) {
  return String(rawValue).trim().slice(0, 200);
}

function deriveCallerId(req) {
  const fromHeader = req.get("x-caller-id");
  if (typeof fromHeader === "string" && fromHeader.trim()) {
    return normalizeCallerId(fromHeader);
  }

  // Caller ID strategy note:
  // Prefer a server-generated stable visitor/user/workspace ID from your main app.
  // We only use IP fallback when x-caller-id is missing.
  const ipFallback = req.ip || req.socket?.remoteAddress || "unknown";
  return `fallback-ip:${ipFallback}`;
}

function applyRateLimitHeaders(res, globalCounter, callerCounter) {
  res.set("X-RateLimit-Global-Limit-Minute", String(config.globalRateLimitPerMinute));
  res.set("X-RateLimit-Global-Limit-Hour", String(config.globalRateLimitPerHour));
  res.set(
    "X-RateLimit-Global-Remaining-Minute",
    String(remainingLimit(config.globalRateLimitPerMinute, globalCounter.minute.count))
  );
  res.set(
    "X-RateLimit-Global-Remaining-Hour",
    String(remainingLimit(config.globalRateLimitPerHour, globalCounter.hour.count))
  );

  res.set("X-RateLimit-Caller-Limit-Minute", String(config.perCallerRateLimitPerMinute));
  res.set("X-RateLimit-Caller-Limit-Hour", String(config.perCallerRateLimitPerHour));
  res.set(
    "X-RateLimit-Caller-Remaining-Minute",
    String(remainingLimit(config.perCallerRateLimitPerMinute, callerCounter.minute.count))
  );
  res.set(
    "X-RateLimit-Caller-Remaining-Hour",
    String(remainingLimit(config.perCallerRateLimitPerHour, callerCounter.hour.count))
  );
}

function rateLimitResponse({ res, scope, windowName, limitValue, retryAfter }) {
  res.set("Retry-After", String(retryAfter));
  return res.status(429).json({
    ok: false,
    error: `Rate limit exceeded for ${scope}: max ${limitValue} requests per ${windowName}`,
    limitScope: scope,
    limitWindow: windowName,
    limit: limitValue,
    retryAfterSeconds: retryAfter
  });
}

function rateLimitInspectRequests(req, res, next) {
  const now = Date.now();
  const callerId = deriveCallerId(req);

  // Expose caller key to downstream handlers for logging/debug if needed.
  req.callerId = callerId;

  const globalCounter = rateLimitStore.getOrCreateCounter("global", now);
  const callerCounter = rateLimitStore.getOrCreateCounter(`caller:${callerId}`, now);

  resetWindowIfNeeded(globalCounter.minute, ONE_MINUTE_MS, now);
  resetWindowIfNeeded(globalCounter.hour, ONE_HOUR_MS, now);
  resetWindowIfNeeded(callerCounter.minute, ONE_MINUTE_MS, now);
  resetWindowIfNeeded(callerCounter.hour, ONE_HOUR_MS, now);

  if (globalCounter.minute.count >= config.globalRateLimitPerMinute) {
    const retryAfter = retryAfterSeconds(globalCounter.minute, ONE_MINUTE_MS, now);
    applyRateLimitHeaders(res, globalCounter, callerCounter);
    return rateLimitResponse({
      res,
      scope: "global",
      windowName: "minute",
      limitValue: config.globalRateLimitPerMinute,
      retryAfter
    });
  }

  if (globalCounter.hour.count >= config.globalRateLimitPerHour) {
    const retryAfter = retryAfterSeconds(globalCounter.hour, ONE_HOUR_MS, now);
    applyRateLimitHeaders(res, globalCounter, callerCounter);
    return rateLimitResponse({
      res,
      scope: "global",
      windowName: "hour",
      limitValue: config.globalRateLimitPerHour,
      retryAfter
    });
  }

  if (callerCounter.minute.count >= config.perCallerRateLimitPerMinute) {
    const retryAfter = retryAfterSeconds(callerCounter.minute, ONE_MINUTE_MS, now);
    applyRateLimitHeaders(res, globalCounter, callerCounter);
    return rateLimitResponse({
      res,
      scope: "caller",
      windowName: "minute",
      limitValue: config.perCallerRateLimitPerMinute,
      retryAfter
    });
  }

  if (callerCounter.hour.count >= config.perCallerRateLimitPerHour) {
    const retryAfter = retryAfterSeconds(callerCounter.hour, ONE_HOUR_MS, now);
    applyRateLimitHeaders(res, globalCounter, callerCounter);
    return rateLimitResponse({
      res,
      scope: "caller",
      windowName: "hour",
      limitValue: config.perCallerRateLimitPerHour,
      retryAfter
    });
  }

  globalCounter.minute.count += 1;
  globalCounter.hour.count += 1;
  callerCounter.minute.count += 1;
  callerCounter.hour.count += 1;
  applyRateLimitHeaders(res, globalCounter, callerCounter);

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
