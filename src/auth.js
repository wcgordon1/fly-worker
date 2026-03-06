const { config } = require("./config");

// Shared-secret middleware is the MVP protection to prevent anonymous abuse.
function requireWorkerSecret(req, res, next) {
  const provided = req.get("x-worker-secret") || "";

  if (!config.workerSecret) {
    return res.status(500).json({
      ok: false,
      error: "Server misconfigured: WORKER_SECRET is not set"
    });
  }

  if (!provided || provided !== config.workerSecret) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized: invalid or missing x-worker-secret header"
    });
  }

  return next();
}

module.exports = { requireWorkerSecret };
