import { createHash } from "node:crypto";

const SENSITIVE_KEY = /(?:^|[_-])(?:password|passwd|pwd|secret|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|oauth[_-]?token|session[_-]?token|bearer[_-]?token|api[_-]?key|authorization|cookie|session[_-]?secret|otp|one[_-]?time|mfa|oauth[_-]?code|private[_-]?key)(?:$|[_-])/i;
const SAFE_SENSITIVE_DESCRIPTOR_KEY = /_(?:selector|selectors|source|warning|reason|status|method|kind|type)$/i;
const SENSITIVE_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function redactedValue(value, reason = "sensitive_field") {
  const text = value === undefined || value === null ? "" : String(value);
  return {
    present: text.length > 0,
    length: text.length,
    redacted: true,
    reason,
  };
}

function redactUrl(value) {
  const text = String(value ?? "");
  try {
    const url = new URL(text);
    for (const key of [...url.searchParams.keys()]) {
      url.searchParams.set(key, "[REDACTED]");
    }
    if (
      url.hash
      && (SENSITIVE_KEY.test(url.hash) || /(?:^|[?&])[^=&#]+=[^&#]+/.test(url.hash.slice(1)))
    ) {
      url.hash = "#[REDACTED]";
    }
    return url.href;
  } catch {
    return text;
  }
}

function redactString(value) {
  let redacted = String(value ?? "");
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

function redactBrowserValue(value, options = {}, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return options.url === true ? redactUrl(value) : redactString(value);
  }
  if (typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => redactBrowserValue(item, options, seen));
    seen.delete(value);
    return result;
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if ((key === "redacted" || key.endsWith("_redacted")) && typeof item === "boolean") {
      result[key] = item;
      continue;
    }
    const safeSensitiveMetadata = (
      /(?:^has_|_(?:length|count|present|redacted)$)/i.test(key)
      && (typeof item === "boolean" || typeof item === "number")
    ) || (
      SAFE_SENSITIVE_DESCRIPTOR_KEY.test(key)
      && (
        typeof item === "string"
        || typeof item === "boolean"
        || typeof item === "number"
        || (Array.isArray(item) && item.every((entry) => typeof entry === "string"))
      )
    );
    if (SENSITIVE_KEY.test(key) && typeof item !== "boolean" && !safeSensitiveMetadata) {
      result[key] = redactedValue(item, `sensitive_key:${key.toLowerCase()}`);
      continue;
    }
    const lowerKey = key.toLowerCase();
    const isUrl = lowerKey === "url"
      || lowerKey === "href"
      || lowerKey.endsWith("_url")
      || lowerKey.endsWith("_href");
    result[key] = redactBrowserValue(item, { ...options, url: isUrl }, seen);
  }
  seen.delete(value);
  return result;
}

function summarizeSensitiveInput(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return {
    present: text.length > 0,
    length: text.length,
    sha256: sha256(text),
  };
}

export {
  redactBrowserValue,
  redactString,
  redactUrl,
  redactedValue,
  sha256,
  summarizeSensitiveInput,
};
