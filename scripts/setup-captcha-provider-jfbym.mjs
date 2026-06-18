#!/usr/bin/env node

import { mkdir, stat, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_JFBYM_ALLOWED_KINDS,
  DEFAULT_JFBYM_BASE_URL,
  DEFAULT_JFBYM_COORDINATE_TYPE_IDS,
  DEFAULT_JFBYM_MAX_ATTEMPTS,
  DEFAULT_JFBYM_MIN_CONFIDENCE,
  DEFAULT_JFBYM_SLIDER_RESULT_MODE,
  DEFAULT_JFBYM_TIMEOUT_MS,
  JFBYM_ENV_FILE,
  normalizeKindList,
  normalizeOriginList,
  providerConfigDir,
} from "../src/auth/captcha/providers/config.mjs";

const DEFAULT_TOKEN_ENV = "TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN";
const DEFAULT_ALLOWED_KINDS = DEFAULT_JFBYM_ALLOWED_KINDS.join(",");

function splitList(value = "") {
  return String(value)
    .split(/[,\n;]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function usage() {
  return [
    "usage: npm run setup:captcha-provider:jfbym -- --allowed-origin <origin> --write",
    "",
    "Reads the provider token from TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN by default.",
    "The token is written only to repo-external jfbym.env and is never printed.",
    "",
    "options:",
    "  --allowed-origin, --origin <origin>   Allow one http(s) origin; repeatable.",
    "  --allowed-origins <list>             Comma/newline/semicolon-separated origins.",
    "  --allowed-kinds <list>               Allowed CAPTCHA kinds. Defaults to all coordinate kinds.",
    "  --config-dir <path>                  Repo-external provider config dir.",
    "  --token-env <name>                   Env var holding the provider token.",
    "  --base-url <url>                     JFBYM customApi endpoint.",
    "  --timeout-ms <n>                     Provider timeout.",
    "  --max-attempts <n>                   Provider attempts, clamped by runtime loader.",
    "  --min-confidence <0..1>              Minimum provider confidence.",
    "  --slider-result-mode <target_x|distance>",
    "  --enable-protocol-solver             Write protocol solver enabled. Default off.",
    "  --disable-coordinate-solver          Write coordinate solver disabled. Default on.",
    "  --write                              Create/update jfbym.env.",
    "  --overwrite                          Allow replacing an existing jfbym.env.",
    "  --help                               Print this help.",
  ].join("\n");
}

function parseArgs(argv = []) {
  const args = {
    write: false,
    overwrite: false,
    config_dir: undefined,
    token_env: DEFAULT_TOKEN_ENV,
    allowed_origins: [],
    allowed_kinds: DEFAULT_ALLOWED_KINDS,
    base_url: DEFAULT_JFBYM_BASE_URL,
    timeout_ms: DEFAULT_JFBYM_TIMEOUT_MS,
    max_attempts: DEFAULT_JFBYM_MAX_ATTEMPTS,
    min_confidence: DEFAULT_JFBYM_MIN_CONFIDENCE,
    slider_result_mode: DEFAULT_JFBYM_SLIDER_RESULT_MODE,
    coordinate_solver: true,
    protocol_solver: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || String(value).startsWith("--")) {
        throw new Error(`missing value for ${token}`);
      }
      index += 1;
      return value;
    };
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--overwrite") {
      args.overwrite = true;
      continue;
    }
    if (token === "--config-dir") {
      args.config_dir = next();
      continue;
    }
    if (token === "--token-env") {
      args.token_env = next();
      continue;
    }
    if (token === "--allowed-origin" || token === "--origin") {
      args.allowed_origins.push(next());
      continue;
    }
    if (token === "--allowed-origins") {
      args.allowed_origins.push(...splitList(next()));
      continue;
    }
    if (token === "--allowed-kinds") {
      args.allowed_kinds = next();
      continue;
    }
    if (token === "--base-url") {
      args.base_url = next();
      continue;
    }
    if (token === "--timeout-ms") {
      args.timeout_ms = Number(next());
      continue;
    }
    if (token === "--max-attempts") {
      args.max_attempts = Number(next());
      continue;
    }
    if (token === "--min-confidence") {
      args.min_confidence = Number(next());
      continue;
    }
    if (token === "--slider-result-mode") {
      args.slider_result_mode = next();
      continue;
    }
    if (token === "--enable-protocol-solver") {
      args.protocol_solver = true;
      continue;
    }
    if (token === "--disable-coordinate-solver") {
      args.coordinate_solver = false;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function normalizeConfidence(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeSliderMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  return ["target_x", "distance"].includes(mode) ? mode : DEFAULT_JFBYM_SLIDER_RESULT_MODE;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildEnvText({ token, config }) {
  const typeLines = Object.entries(DEFAULT_JFBYM_COORDINATE_TYPE_IDS).map(([kind, value]) => (
    `TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_${kind.toUpperCase()}=${value}`
  ));
  return [
    "TMWD_CAPTCHA_PROVIDER_JFBYM_ENABLED=1",
    `TMWD_CAPTCHA_PROVIDER_JFBYM_BASE_URL=${config.base_url}`,
    `TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN=${token}`,
    `TMWD_CAPTCHA_PROVIDER_JFBYM_TIMEOUT_MS=${config.timeout_ms}`,
    `TMWD_CAPTCHA_PROVIDER_JFBYM_MAX_ATTEMPTS=${config.max_attempts}`,
    `TMWD_CAPTCHA_PROVIDER_JFBYM_MIN_CONFIDENCE=${config.min_confidence}`,
    `TMWD_CAPTCHA_PROVIDER_JFBYM_ALLOWED_ORIGINS=${config.allowed_origins.join(",")}`,
    `TMWD_CAPTCHA_PROVIDER_JFBYM_ALLOWED_KINDS=${config.allowed_kinds.join(",")}`,
    `TMWD_CAPTCHA_PROVIDER_JFBYM_COORDINATE_SOLVER=${config.coordinate_solver ? "1" : "0"}`,
    `TMWD_CAPTCHA_PROVIDER_JFBYM_PROTOCOL_SOLVER=${config.protocol_solver ? "1" : "0"}`,
    ...typeLines,
    `TMWD_CAPTCHA_PROVIDER_JFBYM_SLIDER_RESULT_MODE=${config.slider_result_mode}`,
    "",
  ].join("\n");
}

function buildRedactedPreview(config) {
  return buildEnvText({ token: "<redacted>", config });
}

async function buildJfbymSetupPlan(rawArgs = {}, env = process.env) {
  const configDir = providerConfigDir({ captcha_provider_config_dir: rawArgs.config_dir });
  const configPath = path.join(configDir, JFBYM_ENV_FILE);
  const rawAllowedOrigins = Array.isArray(rawArgs.allowed_origins)
    ? rawArgs.allowed_origins
    : splitList(rawArgs.allowed_origins ?? "");
  const allowedOrigins = normalizeOriginList(rawAllowedOrigins.join(","));
  const allowedKinds = normalizeKindList(rawArgs.allowed_kinds ?? DEFAULT_ALLOWED_KINDS, DEFAULT_JFBYM_ALLOWED_KINDS);
  const tokenEnv = String(rawArgs.token_env || DEFAULT_TOKEN_ENV).trim() || DEFAULT_TOKEN_ENV;
  const tokenConfigured = Boolean(String(env[tokenEnv] ?? "").trim());
  const existing = await fileExists(configPath);
  const config = {
    base_url: String(rawArgs.base_url || DEFAULT_JFBYM_BASE_URL).trim() || DEFAULT_JFBYM_BASE_URL,
    timeout_ms: normalizePositiveInteger(rawArgs.timeout_ms, DEFAULT_JFBYM_TIMEOUT_MS),
    max_attempts: normalizePositiveInteger(rawArgs.max_attempts, DEFAULT_JFBYM_MAX_ATTEMPTS),
    min_confidence: normalizeConfidence(rawArgs.min_confidence, DEFAULT_JFBYM_MIN_CONFIDENCE),
    allowed_origins: allowedOrigins,
    allowed_kinds: allowedKinds,
    coordinate_solver: rawArgs.coordinate_solver !== false,
    protocol_solver: rawArgs.protocol_solver === true,
    slider_result_mode: normalizeSliderMode(rawArgs.slider_result_mode),
  };
  const blockers = [];
  if (allowedOrigins.length === 0) {
    blockers.push({
      reason: "allowed_origin_required",
      required: "--allowed-origin https://example.test",
    });
  }
  if (!tokenConfigured) {
    blockers.push({
      reason: "provider_token_env_required",
      required_env: tokenEnv,
    });
  }
  if (rawArgs.write === true && existing && rawArgs.overwrite !== true) {
    blockers.push({
      reason: "config_exists_overwrite_required",
      config_path: configPath,
      required: "--overwrite",
    });
  }
  return {
    ok: blockers.length === 0,
    status: blockers.length === 0 ? (rawArgs.write ? "ready_to_write" : "planned") : "blocked",
    action: "setup_captcha_provider_jfbym",
    write_requested: rawArgs.write === true,
    overwrite_requested: rawArgs.overwrite === true,
    config_dir: configDir,
    config_path: configPath,
    config_file_present: existing,
    token_env: tokenEnv,
    token_configured: tokenConfigured,
    provider_id: "jfbym",
    allowed_origins: allowedOrigins,
    allowed_kinds: allowedKinds,
    coordinate_solver_enabled: config.coordinate_solver,
    protocol_solver_enabled: config.protocol_solver,
    min_confidence: config.min_confidence,
    timeout_ms: config.timeout_ms,
    max_attempts: config.max_attempts,
    slider_result_mode: config.slider_result_mode,
    redacted_env_preview: buildRedactedPreview(config),
    blockers,
    secrets_redacted: true,
    _internal_config: config,
  };
}

function publicPlan(plan) {
  const { _internal_config: _ignored, ...safePlan } = plan;
  return safePlan;
}

async function writeJfbymSetup(rawArgs = {}, env = process.env) {
  const plan = await buildJfbymSetupPlan(rawArgs, env);
  if (plan.ok !== true) {
    return publicPlan(plan);
  }
  if (rawArgs.write !== true) {
    return publicPlan(plan);
  }
  const token = String(env[plan.token_env] ?? "").trim();
  await mkdir(plan.config_dir, { recursive: true, mode: 0o700 });
  await chmod(plan.config_dir, 0o700);
  await writeFile(
    plan.config_path,
    buildEnvText({ token, config: plan._internal_config }),
    { mode: 0o600 },
  );
  await chmod(plan.config_path, 0o600);
  return {
    ...publicPlan(plan),
    ok: true,
    status: "written",
    token_configured: true,
    next_checks: [
      "npm run check:captcha-provider-jfbym",
      "npm run check:captcha-provider-jfbym-coordinate",
      "npm run check:readiness -- --json",
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const result = await writeJfbymSetup(args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`setup-captcha-provider-jfbym failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export {
  buildJfbymSetupPlan,
  parseArgs,
  writeJfbymSetup,
};
