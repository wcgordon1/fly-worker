const fs = require("fs/promises");
const path = require("path");
const { config } = require("./config");

async function writeFileSafely(filePath, content) {
  await fs.writeFile(filePath, content, "utf8");
}

// Debug files are only for local troubleshooting; Fly filesystem is ephemeral.
async function writeDebugFiles(payload) {
  if (!config.debugOutputEnabled) return;

  try {
    await fs.mkdir(config.outputDir, { recursive: true });

    await Promise.all([
      writeFileSafely(
        path.join(config.outputDir, "latest-response.json"),
        JSON.stringify(payload, null, 2)
      ),
      writeFileSafely(
        path.join(config.outputDir, "latest-database.json"),
        JSON.stringify(payload.database || {}, null, 2)
      ),
      writeFileSafely(
        path.join(config.outputDir, "latest-database.dbml.txt"),
        (payload.database && payload.database.dbml) || ""
      ),
      writeFileSafely(
        path.join(config.outputDir, "latest-option-sets.json"),
        JSON.stringify(payload.optionSets || {}, null, 2)
      ),
      writeFileSafely(
        path.join(config.outputDir, "latest-pages.json"),
        JSON.stringify(payload.pages || {}, null, 2)
      ),
      writeFileSafely(
        path.join(config.outputDir, "latest-colors.json"),
        JSON.stringify(payload.colors || {}, null, 2)
      ),
      writeFileSafely(
        path.join(config.outputDir, "latest-summary.json"),
        JSON.stringify(payload.summary || {}, null, 2)
      )
    ]);
  } catch (error) {
    // Debug output should never break a request path.
    console.warn("Failed to write debug output:", error.message);
  }
}

module.exports = { writeDebugFiles };
