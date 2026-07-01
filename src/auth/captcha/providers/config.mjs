import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveBrowser67HomePath } from "../../../runtime/paths/home.mjs";

const DEFAULT_CAPTCHA_PROVIDER_CONFIG_DIR = "~/.browser67/captcha-providers";
const JFBYM_ENV_FILE = "jfbym.env";
const DEFAULT_JFBYM_BASE_URL = "https://api.jfbym.com/api/YmServer/customApi";
const DEFAULT_JFBYM_TIMEOUT_MS = 60_000;
const DEFAULT_JFBYM_MAX_ATTEMPTS = 1;
const DEFAULT_JFBYM_MIN_CONFIDENCE = 0.65;
const DEFAULT_JFBYM_SLIDER_RESULT_MODE = "target_x";
const DEFAULT_JFBYM_ALLOWED_KINDS = Object.freeze([
  "checkbox",
  "slider",
  "image_click",
  "rotate",
  "hcaptcha",
  "recaptcha",
  "turnstile",
]);
const DEFAULT_JFBYM_COORDINATE_TYPE_IDS = Object.freeze({
  checkbox: "30009",
  slider: "20110",
  image_click: "30009",
  rotate: "90007",
  hcaptcha: "30009",
  recaptcha: "30009",
  turnstile: "30009",
});

function expandHome(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function splitList(value) {
  return String(value ?? "")
    .split(/[,\n;]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeOrigin(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}

function normalizeOriginList(value) {
  return [...new Set(splitList(value).map(normalizeOrigin).filter(Boolean))].sort();
}

function normalizeKind(raw) {
  return String(raw ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function normalizeKindList(value, fallback = DEFAULT_JFBYM_ALLOWED_KINDS) {
  const kinds = splitList(value).map(normalizeKind).filter(Boolean);
  return [...new Set(kinds.length > 0 ? kinds : fallback)].sort();
}

function parseBoolean(raw, fallback = false) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function parsePositiveInt(raw, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function parseConfidence(raw, fallback) {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizeCoordinateTypeId(raw, fallback) {
  const value = String(raw ?? "").trim();
  if (/^[0-9]{3,12}$/.test(value)) return value;
  return fallback;
}

function normalizeSliderResultMode(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  return ["target_x", "distance"].includes(value) ? value : DEFAULT_JFBYM_SLIDER_RESULT_MODE;
}

function parseEnvText(text = "") {
  const entries = {};
  for (const rawLine of String(text).split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

async function readEnvFileIfPresent(filePath) {
  try {
    await access(filePath);
  } catch {
    return {
      present: false,
      entries: {},
    };
  }
  const text = await readFile(filePath, "utf8");
  return {
    present: true,
    entries: parseEnvText(text),
  };
}

function providerConfigDir(args = {}) {
  const configured = args.captcha_provider_config_dir
    || process.env.TMWD_CAPTCHA_PROVIDER_CONFIG_DIR;
  if (!configured) {
    return path.resolve(resolveBrowser67HomePath(), "captcha-providers");
  }
  return path.resolve(expandHome(
    configured,
  ));
}

function mergedValue(fileEntries, key) {
  return process.env[key] ?? fileEntries[key];
}

async function loadJfbymProviderConfig(args = {}) {
  const configDir = providerConfigDir(args);
  const configPath = path.join(configDir, JFBYM_ENV_FILE);
  const envFile = await readEnvFileIfPresent(configPath);
  const entries = envFile.entries;
  const token = mergedValue(entries, "TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN");
  const enabled = parseBoolean(mergedValue(entries, "TMWD_CAPTCHA_PROVIDER_JFBYM_ENABLED"), false);
  const coordinateSolverEnabled = parseBoolean(
    mergedValue(entries, "TMWD_CAPTCHA_PROVIDER_JFBYM_COORDINATE_SOLVER"),
    true,
  );
  const protocolSolverEnabled = parseBoolean(
    mergedValue(entries, "TMWD_CAPTCHA_PROVIDER_JFBYM_PROTOCOL_SOLVER"),
    false,
  );
  const baseUrl = String(
    mergedValue(entries, "TMWD_CAPTCHA_PROVIDER_JFBYM_BASE_URL")
      || DEFAULT_JFBYM_BASE_URL,
  ).trim();
  const allowedOrigins = normalizeOriginList(
    mergedValue(entries, "TMWD_CAPTCHA_PROVIDER_JFBYM_ALLOWED_ORIGINS"),
  );
  const allowedKinds = normalizeKindList(
    mergedValue(entries, "TMWD_CAPTCHA_PROVIDER_JFBYM_ALLOWED_KINDS"),
  );
  const timeoutMs = parsePositiveInt(
    mergedValue(entries, "TMWD_CAPTCHA_PROVIDER_JFBYM_TIMEOUT_MS"),
    DEFAULT_JFBYM_TIMEOUT_MS,
    { min: 1_000, max: 180_000 },
  );
  const maxAttempts = parsePositiveInt(
    mergedValue(entries, "TMWD_CAPTCHA_PROVIDER_JFBYM_MAX_ATTEMPTS"),
    DEFAULT_JFBYM_MAX_ATTEMPTS,
    { min: 1, max: 3 },
  );
  const minConfidence = parseConfidence(
    mergedValue(entries, "TMWD_CAPTCHA_PROVIDER_JFBYM_MIN_CONFIDENCE"),
    DEFAULT_JFBYM_MIN_CONFIDENCE,
  );
  const sliderResultMode = normalizeSliderResultMode(
    mergedValue(entries, "TMWD_CAPTCHA_PROVIDER_JFBYM_SLIDER_RESULT_MODE"),
  );
  const coordinateTypeIds = Object.fromEntries(Object.entries(DEFAULT_JFBYM_COORDINATE_TYPE_IDS).map((
    [kind, fallback],
  ) => [
    kind,
    normalizeCoordinateTypeId(
      mergedValue(entries, `TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_${kind.toUpperCase()}`),
      fallback,
    ),
  ]));
  const coordinateExtraConfigured = Object.fromEntries(Object.keys(DEFAULT_JFBYM_COORDINATE_TYPE_IDS).map((kind) => [
    kind,
    Boolean(String(
      mergedValue(entries, `TMWD_CAPTCHA_PROVIDER_JFBYM_EXTRA_${kind.toUpperCase()}`) ?? "",
    ).trim()),
  ]));
  return {
    provider_id: "jfbym",
    config_dir: configDir,
    config_path: configPath,
    config_file_present: envFile.present,
    enabled,
    configured: enabled && Boolean(String(token ?? "").trim()),
    token_configured: Boolean(String(token ?? "").trim()),
    base_url: baseUrl,
    timeout_ms: timeoutMs,
    max_attempts: maxAttempts,
    min_confidence: minConfidence,
    coordinate_solver_enabled: coordinateSolverEnabled,
    protocol_solver_enabled: protocolSolverEnabled,
    allowed_origins: allowedOrigins,
    allowed_kinds: allowedKinds,
    coordinate_type_ids: coordinateTypeIds,
    coordinate_extra_configured: coordinateExtraConfigured,
    slider_result_mode: sliderResultMode,
    secrets_redacted: true,
  };
}

async function loadJfbymProviderRuntimeConfig(args = {}) {
  const configDir = providerConfigDir(args);
  const configPath = path.join(configDir, JFBYM_ENV_FILE);
  const envFile = await readEnvFileIfPresent(configPath);
  const entries = envFile.entries;
  const publicConfig = await loadJfbymProviderConfig(args);
  const coordinate_extra = Object.fromEntries(Object.keys(DEFAULT_JFBYM_COORDINATE_TYPE_IDS).map((kind) => [
    kind,
    String(mergedValue(entries, `TMWD_CAPTCHA_PROVIDER_JFBYM_EXTRA_${kind.toUpperCase()}`) ?? "").trim(),
  ]));
  return {
    ...publicConfig,
    token: String(mergedValue(entries, "TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN") ?? "").trim(),
    coordinate_extra,
    secrets_redacted: false,
    secret_source: process.env.TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN !== undefined ? "env" : (
      envFile.present ? "file" : "none"
    ),
    config_path: configPath,
    config_dir: configDir,
  };
}

function originAllowed(config = {}, origin = "") {
  const normalized = normalizeOrigin(origin);
  const allowed = Array.isArray(config.allowed_origins) ? config.allowed_origins : [];
  return Boolean(normalized && allowed.includes(normalized));
}

function kindAllowed(config = {}, kind = "") {
  const normalized = normalizeKind(kind);
  const allowed = Array.isArray(config.allowed_kinds) ? config.allowed_kinds : [];
  return Boolean(normalized && allowed.includes(normalized));
}

export {
  DEFAULT_CAPTCHA_PROVIDER_CONFIG_DIR,
  DEFAULT_JFBYM_ALLOWED_KINDS,
  DEFAULT_JFBYM_BASE_URL,
  DEFAULT_JFBYM_COORDINATE_TYPE_IDS,
  DEFAULT_JFBYM_MAX_ATTEMPTS,
  DEFAULT_JFBYM_MIN_CONFIDENCE,
  DEFAULT_JFBYM_SLIDER_RESULT_MODE,
  DEFAULT_JFBYM_TIMEOUT_MS,
  JFBYM_ENV_FILE,
  expandHome,
  kindAllowed,
  loadJfbymProviderConfig,
  loadJfbymProviderRuntimeConfig,
  normalizeKindList,
  normalizeOrigin,
  normalizeOriginList,
  originAllowed,
  parseEnvText,
  providerConfigDir,
};
