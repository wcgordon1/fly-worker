const express = require("express");
const { config } = require("./config");
const { requireWorkerSecret } = require("./auth");
const { validateSubmittedUrl } = require("./validateUrl");
const { inspectUrl } = require("./inspector");
const { writeDebugFiles } = require("./writeDebugFiles");
const {
  rateLimitInspectRequests,
  tryAcquireInspectionSlot,
  getInspectionLoad
} = require("./rateLimit");

const app = express();
// Trust the Fly proxy hop so req.ip reflects the real client IP for per-IP limiting.
app.set("trust proxy", config.trustProxyHops);
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "bubble-runtime-worker" });
});

// Main endpoint: auth -> validate input -> inspect target URL -> return structured JSON.
app.post("/inspect", requireWorkerSecret, rateLimitInspectRequests, async (req, res) => {
  const submittedUrl = req.body?.url;
  const validation = validateSubmittedUrl(submittedUrl);

  // URL validation exists to reduce obvious SSRF/internal-network abuse.
  if (!validation.ok) {
    return res.status(400).json({
      ok: false,
      error: `Invalid URL: ${validation.reason}`
    });
  }

  // Keep inspection concurrency low so browser workload cannot spike unexpectedly.
  const releaseInspectionSlot = tryAcquireInspectionSlot();
  if (!releaseInspectionSlot) {
    const load = getInspectionLoad();
    return res.status(429).json({
      ok: false,
      error: `Concurrency limit exceeded: max ${load.maxConcurrentInspections} active inspections`,
      retryAfterSeconds: 1
    });
  }

  try {
    const responsePayload = await inspectUrl(validation.normalizedUrl);

    // Local debug output is best-effort only and must never fail the API request.
    await writeDebugFiles(responsePayload);

    return res.status(200).json(responsePayload);
  } catch (error) {
    const isTimeout = error?.code === "INSPECTION_TIMEOUT" || error?.name === "TimeoutError";

    return res.status(isTimeout ? 504 : 500).json({
      ok: false,
      submittedUrl: validation.normalizedUrl,
      error: isTimeout ? "Inspection timed out" : "Inspection failed",
      details: error?.message || "Unknown error"
    });
  } finally {
    releaseInspectionSlot();
  }
});

// Explicitly bind 0.0.0.0 so container platforms (including Fly) can route traffic.
app.listen(config.port, "0.0.0.0", () => {
  console.log(`bubble-runtime-worker listening on 0.0.0.0:${config.port}`);
});
