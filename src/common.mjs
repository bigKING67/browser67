import { createHash } from "node:crypto";

const CDP_DEFAULT_ENDPOINT = "http://127.0.0.1:9222";
const TMWD_LINK_DEFAULT_ENDPOINT = "http://127.0.0.1:18766/link";
const TMWD_WS_DEFAULT_ENDPOINT = "ws://127.0.0.1:18765";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_SCAN_MAX_CHARS = 35_000;

function nowIso() {
  return new Date().toISOString();
}

function hashText(value) {
  return createHash("sha1").update(String(value ?? "")).digest("hex");
}

function randomId(prefix) {
  return `${String(prefix)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function compactText(value, maxLength) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}

function clipContent(value, maxChars) {
  const text = String(value ?? "");
  if (text.length <= maxChars) {
    return {
      value: text,
      truncated: false,
      original_length: text.length,
    };
  }
  return {
    value: `${text.slice(0, maxChars)}\n\n[TRUNCATED ${String(text.length - maxChars)} chars]`,
    truncated: true,
    original_length: text.length,
  };
}

function normalizeTimeoutMs(raw) {
  const parsed = Number(raw ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(100, Math.min(120_000, Math.floor(parsed)));
}

function normalizeMaxChars(raw) {
  const parsed = Number(raw ?? DEFAULT_SCAN_MAX_CHARS);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SCAN_MAX_CHARS;
  }
  return Math.max(1_000, Math.min(300_000, Math.floor(parsed)));
}

function normalizeMainOnlyMinChars(raw) {
  const parsed = Number(raw ?? 600);
  if (!Number.isFinite(parsed)) {
    return 600;
  }
  return Math.max(100, Math.min(10_000, Math.floor(parsed)));
}

function normalizeMainOnlyMinCoverage(raw) {
  const parsed = Number(raw ?? 0.35);
  if (!Number.isFinite(parsed)) {
    return 0.35;
  }
  return Math.max(0.05, Math.min(0.95, parsed));
}

function applyMainOnlyGuardrail(mainText, fullText, args) {
  const main = String(mainText ?? "");
  const full = String(fullText ?? "");
  const fallbackToFull = args?.main_only_fallback_to_full !== false;
  const minChars = normalizeMainOnlyMinChars(args?.main_only_min_chars);
  const minCoverage = normalizeMainOnlyMinCoverage(args?.main_only_min_coverage);
  const mainLength = main.length;
  const fullLength = full.length;
  const coverage = fullLength > 0 ? (mainLength / fullLength) : 1;

  const reasons = [];
  if (mainLength === 0) {
    reasons.push("empty_main");
  }
  if (mainLength > 0 && mainLength < minChars) {
    reasons.push("below_min_chars");
  }
  if (fullLength > 0 && coverage < minCoverage) {
    reasons.push("below_min_coverage");
  }
  if (fullLength === 0 && reasons.length > 0) {
    reasons.push("full_empty");
  }

  let fallbackApplied = false;
  let content = main;
  if (fallbackToFull && reasons.length > 0 && fullLength > 0) {
    fallbackApplied = true;
    content = full;
  }

  return {
    content,
    metadata: {
      enabled: true,
      fallback_to_full: fallbackToFull,
      fallback_applied: fallbackApplied,
      fallback_reason: reasons.length > 0 ? reasons.join("+") : "none",
      min_chars: minChars,
      min_coverage: minCoverage,
      main_length: mainLength,
      full_length: fullLength,
      main_coverage: Number(coverage.toFixed(4)),
      main_only_effective: !fallbackApplied,
    },
  };
}

function normalizeEndpoint(raw) {
  const endpoint = String(raw ?? CDP_DEFAULT_ENDPOINT).trim();
  if (!endpoint) {
    return CDP_DEFAULT_ENDPOINT;
  }
  return endpoint.replace(/\/$/, "");
}

function normalizeTmwdLinkEndpoint(raw) {
  const endpoint = String(raw ?? TMWD_LINK_DEFAULT_ENDPOINT).trim();
  if (!endpoint) {
    return TMWD_LINK_DEFAULT_ENDPOINT;
  }
  return endpoint.replace(/\/$/, "");
}

function normalizeTmwdWsEndpoint(raw) {
  const endpoint = String(raw ?? TMWD_WS_DEFAULT_ENDPOINT).trim();
  if (!endpoint) {
    return TMWD_WS_DEFAULT_ENDPOINT;
  }
  return endpoint;
}

function resolveTmwdMode(raw) {
  const normalized = String(raw ?? process.env.BROWSER_STRUCTURED_TMWD_MODE ?? "auto").trim().toLowerCase();
  if (normalized === "tmwd") {
    return "tmwd";
  }
  if (normalized === "cdp" || normalized === "remote_cdp") {
    return "cdp";
  }
  return "auto";
}

function resolveTmwdTransport(raw) {
  const normalized = String(raw ?? process.env.BROWSER_STRUCTURED_TMWD_TRANSPORT ?? "auto").trim().toLowerCase();
  if (normalized === "ws") {
    return "ws";
  }
  if (normalized === "link") {
    return "link";
  }
  return "auto";
}

function parseObjectLiteral(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed;
    }
  } catch {
    // no-op
  }
  try {
    const value = Function(`"use strict"; return (${raw});`)();
    if (typeof value === "object" && value !== null) {
      return value;
    }
  } catch {
    // no-op
  }
  return undefined;
}

function parseBridgeCommand(script) {
  if (typeof script === "object" && script !== null && !Array.isArray(script)) {
    if (typeof script.cmd === "string" && script.cmd.trim().length > 0) {
      return script;
    }
    return undefined;
  }
  if (typeof script !== "string") {
    return undefined;
  }
  const trimmed = script.trim();
  if (!trimmed || !trimmed.startsWith("{")) {
    return undefined;
  }
  const parsed = parseObjectLiteral(trimmed);
  if (!parsed || typeof parsed.cmd !== "string" || parsed.cmd.trim().length === 0) {
    return undefined;
  }
  return parsed;
}

function resolveExecuteJsScriptInput(args) {
  const hasScript = Object.prototype.hasOwnProperty.call(args ?? {}, "script");
  const hasCode = Object.prototype.hasOwnProperty.call(args ?? {}, "code");
  if (hasScript) {
    return {
      source: "script",
      value: args?.script,
    };
  }
  if (hasCode) {
    return {
      source: "code",
      value: args?.code,
    };
  }
  return {
    missing: true,
    source: "missing",
    value: "",
  };
}

function normalizeTmwdTransportLabel(transport) {
  return transport === "ws" ? "tmwd_ws" : "tmwd_link";
}

function appendTransportAttempt(attempts, transport, phase, status, options = {}) {
  attempts.push({
    transport: normalizeTmwdTransportLabel(transport),
    phase,
    status,
    reason: options.reason,
    message: options.message,
    error_code: options.error_code,
  });
}

function mergeTransportAttempts(primary, secondary) {
  const first = Array.isArray(primary) ? primary : [];
  const second = Array.isArray(secondary) ? secondary : [];
  return [...first, ...second];
}

export {
  CDP_DEFAULT_ENDPOINT,
  TMWD_LINK_DEFAULT_ENDPOINT,
  TMWD_WS_DEFAULT_ENDPOINT,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_SCAN_MAX_CHARS,
  nowIso,
  hashText,
  randomId,
  compactText,
  clipContent,
  normalizeTimeoutMs,
  normalizeMaxChars,
  normalizeMainOnlyMinChars,
  normalizeMainOnlyMinCoverage,
  applyMainOnlyGuardrail,
  normalizeEndpoint,
  normalizeTmwdLinkEndpoint,
  normalizeTmwdWsEndpoint,
  resolveTmwdMode,
  resolveTmwdTransport,
  parseObjectLiteral,
  parseBridgeCommand,
  resolveExecuteJsScriptInput,
  normalizeTmwdTransportLabel,
  appendTransportAttempt,
  mergeTransportAttempts,
};
