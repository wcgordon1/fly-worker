const express = require("express");
const { config } = require("./config");
const { requireWorkerSecret } = require("./auth");
const { validateSubmittedUrl } = require("./validateUrl");
const { inspectUrl } = require("./inspector");
const { writeDebugFiles } = require("./writeDebugFiles");

const app = express();
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "bubble-runtime-worker" });
});

// Main endpoint: auth -> validate input -> inspect target URL -> return structured JSON.
app.post("/inspect", requireWorkerSecret, async (req, res) => {
  const submittedUrl = req.body?.url;
  const validation = validateSubmittedUrl(submittedUrl);

  // URL validation exists to reduce obvious SSRF/internal-network abuse.
  if (!validation.ok) {
    return res.status(400).json({
      ok: false,
      error: `Invalid URL: ${validation.reason}`
    });
  }

  try {
    const responsePayload = await inspectUrl(validation.normalizedUrl);

    // Local debug output is best-effort only and must never fail the API request.
    await writeDebugFiles(responsePayload);

    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      submittedUrl: validation.normalizedUrl,
      error: "Inspection failed",
      details: error?.message || "Unknown error"
    });
  }
});

app.listen(config.port, () => {
  console.log(`bubble-runtime-worker listening on port ${config.port}`);
});
