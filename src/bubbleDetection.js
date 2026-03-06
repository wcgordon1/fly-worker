// Implements the Bubble-likelihood checks requested by the user.
// This runs on a small window snapshot returned by Playwright evaluate.
function buildBubbleDetection(snapshot) {
  const result = {
    bubble_version:
      typeof snapshot?.bubble_version !== "undefined" ? snapshot.bubble_version : null,
    bubble_page_name:
      typeof snapshot?.bubble_page_name !== "undefined" ? snapshot.bubble_page_name : null,
    has_app: Boolean(snapshot?.has_app),
    app_id: typeof snapshot?.app_id !== "undefined" ? snapshot.app_id : null,
    has_app_styles: Boolean(snapshot?.has_app_styles),
    has_client_safe: Boolean(snapshot?.has_client_safe)
  };

  result.isLikelyBubble =
    result.bubble_version !== null ||
    result.bubble_page_name !== null ||
    (result.app_id && result.has_app_styles && result.has_client_safe);

  return result;
}

module.exports = { buildBubbleDetection };
