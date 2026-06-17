import { createHash } from "node:crypto";

const COMMON_KEYWORDS = [
  "sign",
  "_signature",
  "token",
  "nonce",
  "encrypt",
  "hmac",
  "sha",
  "md5",
  "cookie",
  "h5st",
  "x-bogus",
  "msToken",
];

function clip(value, max = 4000) {
  const text = String(value ?? "");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n...[truncated ${String(text.length - max)} chars]`;
}

function hashText(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return value.split("|").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeTransport(transport) {
  if (transport === "tmwd_ws" || transport === "ws") {
    return "tmwd_ws";
  }
  if (transport === "tmwd_link" || transport === "link") {
    return "tmwd_link";
  }
  return String(transport ?? "tmwd");
}

export {
  COMMON_KEYWORDS,
  asArray,
  clip,
  hashText,
  normalizeTransport,
};
