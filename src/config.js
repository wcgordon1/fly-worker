const path = require("path");

// Centralized config keeps env handling in one place so route/inspector code stays focused.
const config = {
  port: Number(process.env.PORT || 8080),
  workerSecret: process.env.WORKER_SECRET || "",

  // Keep local debug output opt-in/controlled; never treat Fly filesystem as durable storage.
  debugOutputEnabled:
    process.env.DEBUG_OUTPUT_ENABLED === "true" || process.env.NODE_ENV !== "production",
  outputDir: process.env.OUTPUT_DIR || path.join(process.cwd(), "output"),

  // Browser and wait timings are configurable for real-world slow Bubble pages.
  navigationTimeoutMs: Number(process.env.NAVIGATION_TIMEOUT_MS || 30000),
  bubbleSignalWaitMs: Number(process.env.BUBBLE_SIGNAL_WAIT_MS || 5000),
  appWaitMs: Number(process.env.APP_WAIT_MS || 10000),
  postAppDelayMs: Number(process.env.POST_APP_DELAY_MS || 1200),

  // Keep response metadata bounded so payloads remain predictable.
  maxAppKeys: Number(process.env.MAX_APP_KEYS || 50),
  maxConsoleMessages: Number(process.env.MAX_CONSOLE_MESSAGES || 20),
  maxConsoleTextLength: Number(process.env.MAX_CONSOLE_TEXT_LENGTH || 250)
};

module.exports = { config };
