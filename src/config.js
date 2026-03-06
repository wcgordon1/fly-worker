const path = require("path");

function positiveIntEnv(name, fallback) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return Math.floor(raw);
}

// Centralized config keeps env handling in one place so route/inspector code stays focused.
const config = {
  port: positiveIntEnv("PORT", 8080),
  workerSecret: process.env.WORKER_SECRET || "",
  trustProxyHops: positiveIntEnv("TRUST_PROXY_HOPS", 1),

  // Keep local debug output opt-in/controlled; never treat Fly filesystem as durable storage.
  debugOutputEnabled:
    process.env.DEBUG_OUTPUT_ENABLED === "true" || process.env.NODE_ENV !== "production",
  outputDir: process.env.OUTPUT_DIR || path.join(process.cwd(), "output"),

  // Browser and wait timings are configurable for real-world slow Bubble pages.
  // These are hard timeout controls for navigation, runtime signal wait, and total inspection duration.
  navigationTimeoutMs: positiveIntEnv("NAVIGATION_TIMEOUT_MS", 15000),
  bubbleSignalWaitMs: positiveIntEnv("BUBBLE_SIGNAL_WAIT_MS", 5000),
  appWaitMs: positiveIntEnv("APP_WAIT_MS", 10000),
  postAppDelayMs: positiveIntEnv("POST_APP_DELAY_MS", 1200),
  totalInspectionTimeoutMs: positiveIntEnv("TOTAL_INSPECTION_TIMEOUT_MS", 30000),

  // Layered in-memory limits for MVP cost control.
  // Global limits cap overall worker traffic.
  globalRateLimitPerMinute: positiveIntEnv("GLOBAL_RATE_LIMIT_PER_MINUTE", 60),
  globalRateLimitPerHour: positiveIntEnv("GLOBAL_RATE_LIMIT_PER_HOUR", 500),

  // Per-caller limits cap one caller's usage. Caller ID comes from x-caller-id.
  perCallerRateLimitPerMinute: positiveIntEnv("PER_CALLER_RATE_LIMIT_PER_MINUTE", 5),
  perCallerRateLimitPerHour: positiveIntEnv("PER_CALLER_RATE_LIMIT_PER_HOUR", 20),

  // Concurrency cap protects against parallel browser cost spikes.
  maxConcurrentInspections: positiveIntEnv("MAX_CONCURRENT_INSPECTIONS", 2),

  // Keep response metadata bounded so payloads remain predictable.
  maxAppKeys: positiveIntEnv("MAX_APP_KEYS", 50),
  maxConsoleMessages: positiveIntEnv("MAX_CONSOLE_MESSAGES", 20),
  maxConsoleTextLength: positiveIntEnv("MAX_CONSOLE_TEXT_LENGTH", 250)
};

module.exports = { config };
