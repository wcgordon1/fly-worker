const { chromium } = require("playwright");
const { config } = require("./config");
const { buildBubbleDetection } = require("./bubbleDetection");
const {
  extractDatabase,
  extractOptionSets,
  extractPages,
  extractColors
} = require("./extractors");

async function inspectUrl(submittedUrl) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleMessages = [];

  // Console capture is optional and capped; extraction never depends on this text.
  page.on("console", (msg) => {
    if (consoleMessages.length >= config.maxConsoleMessages) return;
    consoleMessages.push({
      type: msg.type(),
      text: String(msg.text() || "").slice(0, config.maxConsoleTextLength)
    });
  });

  try {
    // We intentionally use domcontentloaded first, then custom waits for Bubble runtime signals.
    await page.goto(submittedUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.navigationTimeoutMs
    });

    // Initial signal wait to handle apps where runtime globals appear slightly after DOM ready.
    await page
      .waitForFunction(
        () =>
          typeof window.bubble_version !== "undefined" ||
          typeof window.bubble_page_name !== "undefined" ||
          (typeof window.app !== "undefined" && !!window.app),
        { timeout: config.bubbleSignalWaitMs }
      )
      .catch(() => null);

    // Wait for window.app when possible; Bubble pages can take several seconds.
    const hasApp = await page
      .waitForFunction(() => typeof window.app !== "undefined" && !!window.app, {
        timeout: config.appWaitMs
      })
      .then(() => true)
      .catch(() => false);

    // Short buffer after app appears to reduce race conditions on nested runtime trees.
    if (hasApp && config.postAppDelayMs > 0) {
      await page.waitForTimeout(config.postAppDelayMs);
    }

    const runtimeSnapshot = await page.evaluate(({ maxAppKeys }) => {
      // Only collect targeted subsets; do NOT serialize full window.app.
      const safeApp = typeof window.app !== "undefined" && window.app ? window.app : null;

      const detectionSignals = {
        bubble_version: typeof window.bubble_version !== "undefined" ? window.bubble_version : null,
        bubble_page_name:
          typeof window.bubble_page_name !== "undefined" ? window.bubble_page_name : null,
        has_app: !!safeApp,
        app_id: safeApp?._id ?? null,
        has_app_styles: !!safeApp?.styles,
        has_client_safe: !!safeApp?.settings?.client_safe
      };

      return {
        detectionSignals,
        summary: {
          hasApp: !!safeApp,
          appKeys: safeApp && typeof safeApp === "object" ? Object.keys(safeApp).slice(0, maxAppKeys) : [],
          warnings: []
        },
        appId: safeApp?._id ?? null,
        userTypes: safeApp?.user_types ?? null,
        optionSets: safeApp?.option_sets ?? null,
        pagesObj: safeApp?.["%p3"] ?? null,
        colorTokens: safeApp?.settings?.client_safe?.color_tokens_user?.["%d1"] ?? null
      };
    }, { maxAppKeys: config.maxAppKeys });

    const bubbleDetection = buildBubbleDetection(runtimeSnapshot.detectionSignals);
    const database = extractDatabase(runtimeSnapshot.userTypes, runtimeSnapshot.appId);
    const optionSets = extractOptionSets(runtimeSnapshot.optionSets);
    const pages = extractPages(runtimeSnapshot.pagesObj);
    const colors = extractColors(runtimeSnapshot.colorTokens);

    const summary = {
      hasApp: runtimeSnapshot.summary.hasApp,
      appKeys: runtimeSnapshot.summary.appKeys,
      warnings: [...runtimeSnapshot.summary.warnings]
    };

    if (!summary.hasApp) {
      summary.warnings.push("window.app was not available at extraction time");
    }

    const payload = {
      ok: true,
      submittedUrl,
      finalUrl: page.url(),
      bubbleDetection,
      summary,
      database,
      optionSets,
      pages,
      colors,
      debugMeta: {
        hasUserTypes: Boolean(runtimeSnapshot.userTypes && typeof runtimeSnapshot.userTypes === "object"),
        hasOptionSets: Boolean(runtimeSnapshot.optionSets && typeof runtimeSnapshot.optionSets === "object"),
        hasPagesObject: Boolean(runtimeSnapshot.pagesObj && typeof runtimeSnapshot.pagesObj === "object"),
        hasColorsObject: Boolean(runtimeSnapshot.colorTokens && typeof runtimeSnapshot.colorTokens === "object")
      },
      consoleMessages
    };

    return payload;
  } finally {
    // Always close browser resources to avoid leaks under repeated requests.
    await context.close();
    await browser.close();
  }
}

module.exports = { inspectUrl };
