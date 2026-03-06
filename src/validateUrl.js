const net = require("net");

// These are explicit SSRF guardrails for obvious unsafe/internal targets.
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "127.0.0.1",
  "::1"
]);

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isBlockedIPv6(ip) {
  const value = ip.toLowerCase();
  if (value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true; // unique local
  if (value.startsWith("fe80")) return true; // link local
  return false;
}

function validateSubmittedUrl(input) {
  if (typeof input !== "string" || !input.trim()) {
    return { ok: false, reason: "url is required and must be a string" };
  }

  let parsed;
  try {
    parsed = new URL(input.trim());
  } catch {
    return { ok: false, reason: "url is malformed" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, reason: "only http/https URLs are allowed" };
  }

  const host = (parsed.hostname || "").toLowerCase();
  if (!host) {
    return { ok: false, reason: "url hostname is missing" };
  }

  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { ok: false, reason: "local/internal hostnames are not allowed" };
  }

  const ipVersion = net.isIP(host);
  if (ipVersion === 4 && isPrivateIPv4(host)) {
    return { ok: false, reason: "private/internal IPv4 addresses are not allowed" };
  }
  if (ipVersion === 6 && isBlockedIPv6(host)) {
    return { ok: false, reason: "private/internal IPv6 addresses are not allowed" };
  }

  return { ok: true, normalizedUrl: parsed.toString() };
}

module.exports = { validateSubmittedUrl };
