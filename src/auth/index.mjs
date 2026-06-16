import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeTimeoutMs } from "../common.mjs";
import { createToolError } from "../errors.mjs";
import { executeTmwdJsWithFallback, resolvePreferredBrowserContext } from "../tmwd-runtime.mjs";

const DEFAULT_PROFILE_DIR = path.join(os.homedir(), ".codex", "secrets", "tmwd-login-profiles");
const LEGACY_DATAHUB_PROFILE_PATH = path.join(os.homedir(), ".codex", "secrets", "datahub-groland-login.env");
const DEFAULT_LOGIN_TIMEOUT_MS = 12_000;
const PROFILE_FILE_EXTENSIONS = [".env", ".profile"];
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function expandUserPath(raw) {
  const value = String(raw ?? "").trim();
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function normalizeAction(args, supported) {
  const action = String(args?.action ?? "").trim().toLowerCase();
  if (!action) {
    throw createToolError("INVALID_ARGUMENT", "action is required", {
      details: { supported_actions: supported },
    });
  }
  if (!supported.includes(action)) {
    throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${action}`, {
      details: { supported_actions: supported },
    });
  }
  return action;
}

function parseEnvContent(content) {
  const values = {};
  for (const rawLine of String(content ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const normalizedLine = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equalsIndex = normalizedLine.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = normalizedLine.slice(0, equalsIndex).trim();
    let value = normalizedLine.slice(equalsIndex + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function splitList(raw) {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => splitList(item));
  }
  return String(raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function fileBaseProfileId(fileName) {
  let base = fileName;
  for (const extension of PROFILE_FILE_EXTENSIONS) {
    if (base.endsWith(extension)) {
      base = base.slice(0, -extension.length);
      break;
    }
  }
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeOrigin(raw) {
  try {
    return new URL(String(raw ?? "").trim()).origin;
  } catch {
    return "";
  }
}

function validateExactHttpOrigin(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return { ok: false, origin: "", reason: "missing_origin" };
  }
  if (value.includes("*")) {
    return { ok: false, origin: "", reason: "wildcard_origin_not_allowed" };
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, origin: "", reason: "invalid_origin" };
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, origin: "", reason: "origin_protocol_not_allowed" };
  }
  return { ok: true, origin: url.origin, reason: "" };
}

function normalizePathPattern(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return "";
  }
  return value.startsWith("/") ? value : `/${value}`;
}

function sanitizeProfileId(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    throw createToolError("INVALID_ARGUMENT", "profile_id is required", {
      retryable: false,
      details: { reason: "missing_profile_id" },
    });
  }
  if (value === "." || value === ".." || !/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw createToolError("INVALID_ARGUMENT", "profile_id must use only letters, numbers, dot, underscore, and dash", {
      retryable: false,
      details: { reason: "invalid_profile_id" },
    });
  }
  return value;
}

function profileIdFromOrigin(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return "login-profile";
  }
  const url = new URL(normalized);
  const port = url.port ? `-${url.port}` : "";
  const raw = `${url.hostname}${port}`.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return raw.replace(/^-+|-+$/g, "").slice(0, 96) || "login-profile";
}

function ensureRepoExternalProfileDir(profileDir) {
  const resolved = path.resolve(profileDir);
  const roots = [...new Set([path.resolve(process.cwd()), PROJECT_ROOT])];
  const unsafeRoot = roots.find((root) => {
    const relative = path.relative(root, resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  if (unsafeRoot) {
    throw createToolError("INVALID_ARGUMENT", "login profile directory must be outside the repository", {
      retryable: false,
      details: { reason: "profile_dir_inside_repo", profiles_dir: resolved, blocked_root: unsafeRoot },
    });
  }
  return resolved;
}

function envValue(value) {
  return JSON.stringify(String(value ?? ""));
}

function serializeProfileEnv(profile) {
  return [
    `PROFILE_ID=${envValue(profile.profile_id)}`,
    `ALLOWED_ORIGINS=${envValue(profile.allowed_origins.join(","))}`,
    `USERNAME=${envValue(profile.username)}`,
    `PASSWORD=${envValue(profile.password)}`,
    `LOGIN_PATH_PATTERNS=${envValue(profile.login_path_patterns.join(","))}`,
    `USERNAME_SELECTOR=${envValue(profile.username_selector)}`,
    `PASSWORD_SELECTOR=${envValue(profile.password_selector)}`,
    `SUBMIT_SELECTOR=${envValue(profile.submit_selector)}`,
    `SUCCESS_PATH_NOT=${envValue(profile.success_path_not.join(","))}`,
    `SUCCESS_TEXT=${envValue(profile.success_text)}`,
    "",
  ].join("\n");
}

function normalizeProfile(rawProfile) {
  const profileId = String(rawProfile.profile_id ?? "").trim();
  if (!profileId) {
    return null;
  }
  const allowedOrigins = splitList(rawProfile.allowed_origins)
    .map((origin) => normalizeOrigin(origin))
    .filter((origin) => origin.length > 0);
  const loginPathPatterns = splitList(rawProfile.login_path_patterns)
    .map((item) => normalizePathPattern(item))
    .filter((item) => item.length > 0);
  const successPathNot = splitList(rawProfile.success_path_not)
    .map((item) => normalizePathPattern(item))
    .filter((item) => item.length > 0);
  const normalizedLoginPathPatterns = loginPathPatterns.length > 0 ? loginPathPatterns : ["/login"];
  return {
    profile_id: profileId,
    source: String(rawProfile.source ?? "profile_env"),
    source_path: String(rawProfile.source_path ?? ""),
    file_mode: rawProfile.file_mode,
    insecure_file_permissions: rawProfile.insecure_file_permissions === true,
    allowed_origins: [...new Set(allowedOrigins)],
    login_path_patterns: normalizedLoginPathPatterns,
    username_selector: String(rawProfile.username_selector ?? "#username").trim() || "#username",
    password_selector: String(rawProfile.password_selector ?? "#password").trim() || "#password",
    submit_selector: String(rawProfile.submit_selector ?? "button[type=\"submit\"]").trim() || "button[type=\"submit\"]",
    success_path_not: successPathNot.length > 0 ? successPathNot : normalizedLoginPathPatterns,
    success_text: String(rawProfile.success_text ?? "").trim(),
    username: String(rawProfile.username ?? ""),
    password: String(rawProfile.password ?? ""),
  };
}

function statModePayload(stat) {
  if (!stat) {
    return { mode: undefined, insecure: false };
  }
  const mode = stat.mode & 0o777;
  return {
    mode: mode.toString(8).padStart(3, "0"),
    insecure: (mode & 0o077) !== 0,
  };
}

function profileFromGenericEnv(filePath, fileName, env, stat) {
  const mode = statModePayload(stat);
  return normalizeProfile({
    profile_id: env.PROFILE_ID || fileBaseProfileId(fileName),
    source: "profile_env",
    source_path: filePath,
    file_mode: mode.mode,
    insecure_file_permissions: mode.insecure,
    allowed_origins: env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN,
    username: env.USERNAME || env.LOGIN_USERNAME,
    password: env.PASSWORD || env.LOGIN_PASSWORD,
    login_path_patterns: env.LOGIN_PATH_PATTERNS || env.LOGIN_PATH_PATTERN || env.LOGIN_URL_PATTERN,
    username_selector: env.USERNAME_SELECTOR,
    password_selector: env.PASSWORD_SELECTOR,
    submit_selector: env.SUBMIT_SELECTOR,
    success_path_not: env.SUCCESS_PATH_NOT || env.SUCCESS_PATH_NOTS,
    success_text: env.SUCCESS_TEXT,
  });
}

function profileFromLegacyDatahub(filePath, env, stat) {
  const mode = statModePayload(stat);
  return normalizeProfile({
    profile_id: "datahub-groland",
    source: "legacy_datahub_env",
    source_path: filePath,
    file_mode: mode.mode,
    insecure_file_permissions: mode.insecure,
    allowed_origins: env.DATAHUB_GROLAND_ALLOWED_ORIGINS,
    username: env.DATAHUB_GROLAND_USERNAME,
    password: env.DATAHUB_GROLAND_PASSWORD,
    login_path_patterns: "/login",
    username_selector: "#username",
    password_selector: "#password",
    submit_selector: "button[type=\"submit\"]",
    success_path_not: "/login",
  });
}

async function maybeReadEnvFile(filePath) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) {
    return null;
  }
  const content = await fs.readFile(filePath, "utf8");
  return {
    env: parseEnvContent(content),
    stat,
  };
}

function resolveProfileDir(args = {}) {
  return path.resolve(expandUserPath(
    args.profiles_dir
    || process.env.BROWSER_STRUCTURED_LOGIN_PROFILE_DIR
    || DEFAULT_PROFILE_DIR,
  ));
}

async function loadLoginProfiles(args = {}) {
  const profiles = new Map();
  const legacy = await maybeReadEnvFile(LEGACY_DATAHUB_PROFILE_PATH);
  if (legacy) {
    const profile = profileFromLegacyDatahub(LEGACY_DATAHUB_PROFILE_PATH, legacy.env, legacy.stat);
    if (profile) {
      profiles.set(profile.profile_id, profile);
    }
  }

  const profilesDir = resolveProfileDir(args);
  try {
    const entries = await fs.readdir(profilesDir, { withFileTypes: true });
    const profileFileEntries = entries.filter((entry) => (
      entry.isFile() && PROFILE_FILE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))
    ));
    const parsedProfiles = await Promise.all(profileFileEntries.map(async (entry) => {
      const filePath = path.join(profilesDir, entry.name);
      const parsed = await maybeReadEnvFile(filePath);
      if (!parsed) {
        return null;
      }
      return profileFromGenericEnv(filePath, entry.name, parsed.env, parsed.stat);
    }));
    for (const profile of parsedProfiles) {
      if (profile) {
        profiles.set(profile.profile_id, profile);
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  return {
    profiles: [...profiles.values()],
    profiles_dir: profilesDir,
    legacy_profile_path: LEGACY_DATAHUB_PROFILE_PATH,
  };
}

function buildProfileFromUpsertArgs(args) {
  const profileId = sanitizeProfileId(args?.profile_id);
  const originInputs = splitList(args?.allowed_origins ?? args?.allowed_origin ?? args?.origin);
  const normalizedOrigins = [];
  for (const rawOrigin of originInputs) {
    const validation = validateExactHttpOrigin(rawOrigin);
    if (!validation.ok) {
      throw createToolError("INVALID_ARGUMENT", `invalid allowed origin: ${validation.reason}`, {
        retryable: false,
        details: { reason: validation.reason, origin: String(rawOrigin ?? "") },
      });
    }
    normalizedOrigins.push(validation.origin);
  }
  const uniqueOrigins = [...new Set(normalizedOrigins)];
  if (uniqueOrigins.length === 0) {
    throw createToolError("INVALID_ARGUMENT", "origin or allowed_origins is required", {
      retryable: false,
      details: { reason: "missing_allowed_origins" },
    });
  }

  const loginPathPatterns = splitList(args?.login_path_patterns ?? args?.login_path_pattern)
    .map((item) => normalizePathPattern(item))
    .filter((item) => item.length > 0);
  const successPathNot = splitList(args?.success_path_not)
    .map((item) => normalizePathPattern(item))
    .filter((item) => item.length > 0);
  const username = String(args?.username ?? "");
  const password = String(args?.password ?? "");
  const profile = normalizeProfile({
    profile_id: profileId,
    source: "profile_env",
    allowed_origins: uniqueOrigins,
    username,
    password,
    login_path_patterns: loginPathPatterns.length > 0 ? loginPathPatterns : ["/login"],
    username_selector: args?.username_selector,
    password_selector: args?.password_selector,
    submit_selector: args?.submit_selector,
    success_path_not: successPathNot,
    success_text: args?.success_text,
  });
  const validation = validateProfileShape(profile);
  if (!validation.valid) {
    throw createToolError("INVALID_ARGUMENT", "profile is missing required login fields", {
      retryable: false,
      details: { reason: "profile_invalid", validation },
    });
  }
  return profile;
}

async function writeProfileAtomic(args, profile) {
  if (args?.confirm_write !== true) {
    throw createToolError("INVALID_ARGUMENT", "confirm_write=true is required to save login credentials", {
      retryable: false,
      details: { reason: "confirm_write_required" },
    });
  }
  const profilesDir = ensureRepoExternalProfileDir(resolveProfileDir(args));
  const filePath = path.join(profilesDir, `${profile.profile_id}.env`);
  const relative = path.relative(profilesDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw createToolError("INVALID_ARGUMENT", "profile path must stay within the profile directory", {
      retryable: false,
      details: { reason: "profile_path_escape" },
    });
  }

  let existingStat = null;
  try {
    existingStat = await fs.stat(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  if (existingStat && args?.overwrite !== true) {
    throw createToolError("INVALID_ARGUMENT", "profile already exists; pass overwrite=true to update it", {
      retryable: false,
      details: { reason: "profile_exists", profile_id: profile.profile_id },
    });
  }

  await fs.mkdir(profilesDir, { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(profilesDir, 0o700);
  } catch {
    // Best effort on filesystems that do not support POSIX mode changes.
  }
  const tmpPath = path.join(
    profilesDir,
    `.${profile.profile_id}.${process.pid}.${Date.now()}.${Math.floor(Math.random() * 1_000_000)}.tmp`,
  );
  try {
    await fs.writeFile(tmpPath, serializeProfileEnv(profile), { mode: 0o600 });
    try {
      await fs.chmod(tmpPath, 0o600);
    } catch {
      // Best effort on non-POSIX filesystems.
    }
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true });
    throw error;
  }
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // Best effort on non-POSIX filesystems.
  }
  const finalStat = await fs.stat(filePath);
  const mode = statModePayload(finalStat);
  return {
    filePath,
    created: !existingStat,
    updated: Boolean(existingStat),
    file_mode: mode.mode,
    insecure_file_permissions: mode.insecure,
  };
}

function redactProfile(profile) {
  return {
    profile_id: profile.profile_id,
    source: profile.source,
    source_path: profile.source_path,
    file_mode: profile.file_mode,
    insecure_file_permissions: profile.insecure_file_permissions,
    allowed_origins: profile.allowed_origins,
    login_path_patterns: profile.login_path_patterns,
    username_selector: profile.username_selector,
    password_selector: profile.password_selector,
    submit_selector: profile.submit_selector,
    success_path_not: profile.success_path_not,
    success_text_configured: profile.success_text.length > 0,
    has_username: profile.username.length > 0,
    has_password: profile.password.length > 0,
  };
}

function validateProfileShape(profile) {
  const errors = [];
  const warnings = [];
  if (!profile.profile_id) {
    errors.push("missing_profile_id");
  }
  if (!Array.isArray(profile.allowed_origins) || profile.allowed_origins.length === 0) {
    errors.push("missing_allowed_origins");
  }
  if (!profile.username) {
    errors.push("missing_username");
  }
  if (!profile.password) {
    errors.push("missing_password");
  }
  if (!profile.username_selector) {
    errors.push("missing_username_selector");
  }
  if (!profile.password_selector) {
    errors.push("missing_password_selector");
  }
  if (!profile.submit_selector) {
    warnings.push("missing_submit_selector");
  }
  if (profile.insecure_file_permissions === true) {
    warnings.push("profile_file_permissions_are_not_private");
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function pathMatchesPattern(pathname, pattern) {
  const normalizedPath = normalizePathPattern(pathname);
  const normalizedPattern = normalizePathPattern(pattern);
  if (!normalizedPattern) {
    return false;
  }
  return normalizedPath === normalizedPattern
    || normalizedPath.startsWith(`${normalizedPattern}/`);
}

function pathMatchesAny(pathname, patterns) {
  return (Array.isArray(patterns) ? patterns : []).some((pattern) => pathMatchesPattern(pathname, pattern));
}

function findProfileById(profiles, profileId) {
  const normalized = String(profileId ?? "").trim();
  if (!normalized || normalized === "auto") {
    return null;
  }
  return profiles.find((profile) => profile.profile_id === normalized) ?? null;
}

function findProfileByOrigin(profiles, origin) {
  const normalizedOrigin = normalizeOrigin(origin);
  return profiles.find((profile) => profile.allowed_origins.includes(normalizedOrigin)) ?? null;
}

function resolveProfileForOrigin(profiles, args, origin) {
  const requestedProfileId = String(args?.profile_id ?? "auto").trim() || "auto";
  const explicit = requestedProfileId !== "auto" ? findProfileById(profiles, requestedProfileId) : null;
  if (requestedProfileId !== "auto" && !explicit) {
    return {
      profile: null,
      blocked_reason: "profile_not_found",
      requested_profile_id: requestedProfileId,
    };
  }
  const profile = explicit ?? findProfileByOrigin(profiles, origin);
  if (!profile) {
    return {
      profile: null,
      blocked_reason: "no_matching_login_profile",
      requested_profile_id: requestedProfileId,
    };
  }
  const normalizedOrigin = normalizeOrigin(origin);
  if (!profile.allowed_origins.includes(normalizedOrigin)) {
    return {
      profile,
      blocked_reason: "origin_not_allowed_for_profile",
      requested_profile_id: requestedProfileId,
    };
  }
  return {
    profile,
    blocked_reason: "",
    requested_profile_id: requestedProfileId,
  };
}

function parseUrlState(rawUrl) {
  try {
    const url = new URL(String(rawUrl ?? ""));
    return {
      url: url.href,
      origin: url.origin,
      pathname: url.pathname,
    };
  } catch {
    return {
      url: String(rawUrl ?? ""),
      origin: "",
      pathname: "",
    };
  }
}

function detectLoginFromUrl(url, profile) {
  const state = parseUrlState(url);
  const pathMatch = profile
    ? pathMatchesAny(state.pathname, profile.login_path_patterns)
    : /(^|\/)(login|signin|sign-in)(\/|$)/i.test(state.pathname);
  return {
    ...state,
    login_detected: pathMatch,
    detection_source: "url",
    path_match: pathMatch,
    selector_match: false,
  };
}

function detectLoginPage(pageState, profile) {
  const pathMatch = profile
    ? pathMatchesAny(pageState.pathname, profile.login_path_patterns)
    : /(^|\/)(login|signin|sign-in)(\/|$)/i.test(pageState.pathname);
  const selectorMatch = profile
    ? pageState.profile_selectors?.username === true && pageState.profile_selectors?.password === true
    : Number(pageState.password_input_count ?? 0) > 0;
  return {
    login_detected: pathMatch || selectorMatch,
    detection_source: pathMatch ? "path" : (selectorMatch ? "selectors" : "none"),
    path_match: pathMatch,
    selector_match: selectorMatch,
  };
}

function wrapPageFunction(body, input) {
  return `return await (async (input) => {\n${body}\n})(${JSON.stringify(input ?? {})});`;
}

async function resolveAuthBrowserContext(args) {
  const explicitTarget = String(args?.tab_id ?? args?.switch_tab_id ?? args?.session_id ?? args?.sessionId ?? "").trim();
  const timeoutMs = explicitTarget
    ? Math.min(10_000, normalizeTimeoutMs(args?.timeout_ms))
    : 0;
  const started = Date.now();
  const attemptResolve = async () => {
    try {
      const preferred = await resolvePreferredBrowserContext(args ?? {});
      const selectionWarning = String(preferred.context?.selection?.warning ?? "").trim();
      if (selectionWarning) {
        throw createToolError("NO_SESSION", `browser_auth_ops target unavailable: ${selectionWarning}`, {
          retryable: true,
        });
      }
      return preferred;
    } catch (error) {
      const message = String(error?.message ?? error);
      const retryableTargetLookup = explicitTarget
        && (message.includes("tab not found") || message.includes("session_id="));
      if (!retryableTargetLookup || Date.now() - started >= timeoutMs) {
        throw error;
      }
      await sleep(250);
      return attemptResolve();
    }
  };
  return attemptResolve();
}

async function executeBrowserScript(args, body, input = {}) {
  const script = wrapPageFunction(body, input);
  const preferred = await resolveAuthBrowserContext(args ?? {});
  if (preferred.transport !== "tmwd_ws" && preferred.transport !== "tmwd_link") {
    throw createToolError(
      "TRANSPORT_UNAVAILABLE",
      `browser_auth_ops requires TMWD transport, got ${preferred.transport}`,
      { retryable: true },
    );
  }
  const result = await executeTmwdJsWithFallback(args ?? {}, preferred.context, script);
  return {
    transport: result.context.tmwd_transport === "ws" ? "tmwd_ws" : "tmwd_link",
    transport_attempts: result.transport_attempts,
    value: result.executed.value,
    raw: result.executed.raw,
    page: {
      id: result.context.target.id,
      url: result.context.target.url,
      title: result.context.target.title,
    },
  };
}

async function inspectCurrentPage(args, profile = null) {
  const result = await executeBrowserScript(args, `
    const profile = input.profile || {};
    const hasSelector = (selector) => {
      if (!selector) return false;
      try {
        return Boolean(document.querySelector(selector));
      } catch {
        return false;
      }
    };
    const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]'));
    const usernameLikeInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="email"], input[name*="user" i], input[name*="email" i]'));
    return {
      url: location.href,
      origin: location.origin,
      pathname: location.pathname,
      title: document.title,
      ready_state: document.readyState,
      password_input_count: passwordInputs.length,
      username_like_input_count: usernameLikeInputs.length,
      profile_selectors: {
        username: hasSelector(profile.username_selector),
        password: hasSelector(profile.password_selector),
        submit: hasSelector(profile.submit_selector)
      }
    };
  `, { profile: profile ? redactProfile(profile) : null });
  return {
    ...result.value,
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    page: result.page,
  };
}

async function suggestProfileFromCurrentPage(args) {
  const result = await executeBrowserScript(args, `
    const cssEscape = (value) => {
      if (globalThis.CSS && typeof CSS.escape === "function") {
        return CSS.escape(String(value));
      }
      return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
    };
    const queryAll = (selector, root = document) => {
      try {
        return Array.from(root.querySelectorAll(selector));
      } catch {
        return [];
      }
    };
    const uniqueInDocument = (selector, el) => {
      const matches = queryAll(selector);
      return matches.length === 1 && matches[0] === el;
    };
    const selectorFor = (el, fallbackSelectors = []) => {
      if (!el) return "";
      if (el.id) {
        const selector = "#" + cssEscape(el.id);
        if (uniqueInDocument(selector, el)) return selector;
      }
      const name = el.getAttribute("name");
      if (name) {
        const tag = String(el.tagName || "").toLowerCase();
        const selector = tag + "[name=\\"" + name.replace(/"/g, "\\\\\\"") + "\\"]";
        if (uniqueInDocument(selector, el)) return selector;
      }
      for (const selector of fallbackSelectors) {
        if (uniqueInDocument(selector, el)) return selector;
      }
      return fallbackSelectors.find((selector) => queryAll(selector).includes(el)) || "";
    };
    const passwordInputs = queryAll('input[type="password"]');
    const passwordInput = passwordInputs.length === 1 ? passwordInputs[0] : passwordInputs[0] || null;
    const form = passwordInput?.closest("form") || document.querySelector("form") || null;
    const formInputs = queryAll('input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"])', form || document);
    const scoreUsername = (el) => {
      const attrs = [
        el.id,
        el.getAttribute("name"),
        el.getAttribute("autocomplete"),
        el.getAttribute("placeholder"),
        el.getAttribute("aria-label"),
        el.type,
      ].filter(Boolean).join(" ").toLowerCase();
      let score = 0;
      if (/user(name)?/.test(attrs)) score += 6;
      if (/email|mail/.test(attrs)) score += 5;
      if (/login|account/.test(attrs)) score += 3;
      if (el.type === "email") score += 4;
      if (el.type === "text" || !el.type) score += 1;
      return score;
    };
    const usernameInput = formInputs
      .map((el) => ({ el, score: scoreUsername(el) }))
      .sort((a, b) => b.score - a.score)[0]?.el || null;
    const submitCandidates = queryAll('button[type="submit"], input[type="submit"], button:not([type]), button', form || document);
    const submitButton = submitCandidates[0] || null;
    const usernameSelector = selectorFor(usernameInput, [
      'input[name="username"]',
      'input[type="email"]',
      'input[name*="user" i]',
      'input[name*="email" i]',
      'input[type="text"]'
    ]);
    const passwordSelector = selectorFor(passwordInput, ['input[type="password"]']);
    const submitSelector = selectorFor(submitButton, ['button[type="submit"]', 'input[type="submit"]', 'button']);
    const captchaDetected = Boolean(document.querySelector('[class*="captcha" i], [id*="captcha" i], iframe[src*="captcha" i], iframe[src*="recaptcha" i]'));
    const ssoDetected = queryAll('a, button').some((el) => /sso|single sign|google|github|microsoft|okta|saml|oauth/i.test(String(el.textContent || "")));
    return {
      url: location.href,
      origin: location.origin,
      pathname: location.pathname,
      title: document.title,
      ready_state: document.readyState,
      username_selector: usernameSelector,
      password_selector: passwordSelector,
      submit_selector: submitSelector,
      password_input_count: passwordInputs.length,
      username_like_input_count: formInputs.length,
      form_detected: Boolean(form),
      captcha_detected: captchaDetected,
      sso_detected: ssoDetected
    };
  `);
  return {
    ...result.value,
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    page: result.page,
  };
}

function makeSuggestedProfile(pageState, args = {}) {
  const origin = normalizeOrigin(args?.origin || pageState.origin);
  const requestedProfileId = String(args?.profile_id ?? "").trim();
  const profileId = requestedProfileId && requestedProfileId !== "auto"
    ? sanitizeProfileId(requestedProfileId)
    : profileIdFromOrigin(origin);
  const loginPath = normalizePathPattern(args?.login_path_pattern || pageState.pathname || "/login") || "/login";
  const profile = normalizeProfile({
    profile_id: profileId,
    source: "suggested_profile",
    source_path: "",
    allowed_origins: [origin],
    username: "",
    password: "",
    login_path_patterns: [loginPath],
    username_selector: args?.username_selector || pageState.username_selector || "#username",
    password_selector: args?.password_selector || pageState.password_selector || "#password",
    submit_selector: args?.submit_selector || pageState.submit_selector || "button[type=\"submit\"]",
    success_path_not: [loginPath],
    success_text: args?.success_text || "",
  });
  const confidence = profile.password_selector && profile.submit_selector
    ? (profile.username_selector ? "high" : "medium")
    : "low";
  return {
    profile,
    confidence,
  };
}

async function submitLoginForm(args, profile) {
  const timeoutMs = normalizeTimeoutMs(args?.timeout_ms ?? DEFAULT_LOGIN_TIMEOUT_MS);
  const result = await executeBrowserScript(args, `
    const profile = input.profile;
    const timeoutMs = input.timeout_ms;
    const missingSelectors = [];
    const query = (selector) => {
      if (!selector) return null;
      try {
        return document.querySelector(selector);
      } catch {
        return null;
      }
    };
    const usernameInput = query(profile.username_selector);
    const passwordInput = query(profile.password_selector);
    const submitButton = query(profile.submit_selector);
    if (!usernameInput) missingSelectors.push(profile.username_selector);
    if (!passwordInput) missingSelectors.push(profile.password_selector);
    if (!submitButton) missingSelectors.push(profile.submit_selector);
    const pathMatches = (pathname, pattern) => {
      if (!pattern) return false;
      const normalizedPattern = pattern.startsWith("/") ? pattern : "/" + pattern;
      return pathname === normalizedPattern || pathname.startsWith(normalizedPattern + "/");
    };
    const successPathNot = Array.isArray(profile.success_path_not) ? profile.success_path_not : [];
    const isStillBlockedPath = () => successPathNot.some((pattern) => pathMatches(location.pathname, pattern));
    let successTextMatched = profile.success_text ? String(document.body?.innerText || "").includes(profile.success_text) : true;
    const refreshSuccessText = () => {
      successTextMatched = profile.success_text ? String(document.body?.innerText || "").includes(profile.success_text) : true;
      return successTextMatched;
    };
    const waitForAuthReady = async (started) => {
      refreshSuccessText();
      if (!isStillBlockedPath() && successTextMatched) {
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      return waitForAuthReady(started);
    };
    if ((!usernameInput || !passwordInput) && !isStillBlockedPath()) {
      const started = Date.now();
      await waitForAuthReady(started);
      const blockedPath = isStillBlockedPath();
      refreshSuccessText();
      return {
        ok: !blockedPath && successTextMatched,
        reason: !blockedPath && successTextMatched ? "already_authenticated" : "authenticated_state_not_confirmed",
        submitted: false,
        waited_ms: Date.now() - started,
        final_url: location.href,
        final_origin: location.origin,
        final_path: location.pathname,
        title: document.title,
        blocked_path: blockedPath,
        success_text_matched: successTextMatched,
        missing_selectors: missingSelectors.filter(Boolean)
      };
    }
    if (!usernameInput || !passwordInput) {
      return {
        ok: false,
        reason: "login_selector_not_found",
        missing_selectors: missingSelectors.filter(Boolean),
        final_url: location.href,
        final_path: location.pathname
      };
    }
    const setValue = (el, value) => {
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor?.set) {
        descriptor.set.call(el, value);
      } else {
        el.value = value;
      }
      for (const type of ["input", "change"]) {
        el.dispatchEvent(new Event(type, { bubbles: true }));
      }
    };
    setValue(usernameInput, profile.username);
    setValue(passwordInput, profile.password);
    const form = usernameInput.closest("form") || passwordInput.closest("form") || submitButton?.closest("form") || document.querySelector("form");
    let submit_method = "none";
    if (form && typeof form.requestSubmit === "function") {
      if (submitButton instanceof HTMLElement && form.contains(submitButton)) {
        form.requestSubmit(submitButton);
      } else {
        form.requestSubmit();
      }
      submit_method = "form.requestSubmit";
    } else if (submitButton instanceof HTMLElement) {
      submitButton.click();
      submit_method = "button.click";
    } else {
      return {
        ok: false,
        reason: "login_submit_not_found",
        missing_selectors: missingSelectors.filter(Boolean),
        final_url: location.href,
        final_path: location.pathname
      };
    }
    const started = Date.now();
    successTextMatched = profile.success_text ? false : true;
    await waitForAuthReady(started);
    const blockedPath = isStillBlockedPath();
    refreshSuccessText();
    return {
      ok: !blockedPath && successTextMatched,
      reason: !blockedPath && successTextMatched ? "logged_in" : "login_not_completed",
      submitted: true,
      submit_method,
      waited_ms: Date.now() - started,
      final_url: location.href,
      final_origin: location.origin,
      final_path: location.pathname,
      title: document.title,
      blocked_path: blockedPath,
      success_text_matched: successTextMatched,
      missing_selectors: missingSelectors.filter(Boolean)
    };
  `, {
    timeout_ms: timeoutMs,
    profile: {
      profile_id: profile.profile_id,
      username_selector: profile.username_selector,
      password_selector: profile.password_selector,
      submit_selector: profile.submit_selector,
      username: profile.username,
      password: profile.password,
      success_path_not: profile.success_path_not,
      success_text: profile.success_text,
    },
  });
  return {
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    page: result.page,
    result: result.value,
  };
}

async function handleListProfiles(args) {
  const loaded = await loadLoginProfiles(args);
  const profiles = loaded.profiles.map((profile) => ({
    ...redactProfile(profile),
    validation: validateProfileShape(profile),
  }));
  return {
    status: "success",
    action: "list_profiles",
    profiles_dir: loaded.profiles_dir,
    legacy_profile_path: loaded.legacy_profile_path,
    profile_count: profiles.length,
    profiles,
    secrets_redacted: true,
  };
}

async function handleValidateProfile(args) {
  const loaded = await loadLoginProfiles(args);
  const urlState = args?.url ? parseUrlState(args.url) : null;
  const profileId = String(args?.profile_id ?? "").trim();
  if (profileId && profileId !== "auto") {
    const profile = findProfileById(loaded.profiles, profileId);
    const originAllowed = !urlState?.origin || (profile?.allowed_origins ?? []).includes(urlState.origin);
    const matchedProfiles = profile ? [profile] : [];
    return {
      status: profile && originAllowed ? "success" : "blocked",
      action: "validate_profile",
      reason: profile
        ? (originAllowed ? "matched" : "origin_not_allowed_for_profile")
        : "profile_not_found",
      url: urlState?.url,
      origin: urlState?.origin,
      profiles: matchedProfiles.map((entry) => ({
        ...redactProfile(entry),
        validation: validateProfileShape(entry),
      })),
      secrets_redacted: true,
    };
  }

  let profiles = loaded.profiles;
  if (urlState?.origin) {
    const matched = findProfileByOrigin(profiles, urlState.origin);
    profiles = matched ? [matched] : [];
  }
  return {
    status: profiles.length > 0 ? "success" : "blocked",
    action: "validate_profile",
    reason: profiles.length > 0 ? "matched" : "no_matching_login_profile",
    url: urlState?.url,
    origin: urlState?.origin,
    profiles: profiles.map((profile) => ({
      ...redactProfile(profile),
      validation: validateProfileShape(profile),
    })),
    secrets_redacted: true,
  };
}

async function handleInspectLoginPage(args) {
  const loaded = await loadLoginProfiles(args);
  if (args?.dry_run === true && args?.url) {
    const urlState = parseUrlState(args.url);
    const resolved = resolveProfileForOrigin(loaded.profiles, args, urlState.origin);
    const detection = detectLoginFromUrl(args.url, resolved.profile);
    return {
      status: "success",
      action: "inspect_login_page",
      dry_run: true,
      url: urlState.url,
      origin: urlState.origin,
      profile: resolved.profile ? redactProfile(resolved.profile) : undefined,
      blocked_reason: resolved.blocked_reason || undefined,
      ...detection,
      secrets_redacted: true,
    };
  }
  const firstState = await inspectCurrentPage(args, null);
  const resolved = resolveProfileForOrigin(loaded.profiles, args, firstState.origin);
  const profile = resolved.profile;
  const pageState = profile ? await inspectCurrentPage(args, profile) : firstState;
  const detection = detectLoginPage(pageState, profile);
  return {
    status: "success",
    action: "inspect_login_page",
    url: pageState.url,
    origin: pageState.origin,
    pathname: pageState.pathname,
    title: pageState.title,
    transport: pageState.transport,
    transport_attempts: pageState.transport_attempts,
    page: pageState.page,
    profile: profile ? redactProfile(profile) : undefined,
    blocked_reason: resolved.blocked_reason || undefined,
    ...detection,
    profile_selectors: pageState.profile_selectors,
    password_input_count: pageState.password_input_count,
    username_like_input_count: pageState.username_like_input_count,
    secrets_redacted: true,
  };
}

async function handleSuggestProfile(args) {
  if (args?.dry_run === true && args?.url) {
    const urlState = parseUrlState(args.url);
    const originValidation = validateExactHttpOrigin(urlState.origin);
    if (!originValidation.ok) {
      return {
        status: "blocked",
        action: "suggest_profile",
        dry_run: true,
        reason: originValidation.reason,
        url: urlState.url,
        origin: urlState.origin,
        secrets_redacted: true,
      };
    }
    const suggestion = makeSuggestedProfile({
      origin: urlState.origin,
      pathname: urlState.pathname || "/login",
      username_selector: args?.username_selector || "#username",
      password_selector: args?.password_selector || "#password",
      submit_selector: args?.submit_selector || "button[type=\"submit\"]",
    }, args);
    return {
      status: "success",
      action: "suggest_profile",
      dry_run: true,
      url: urlState.url,
      origin: urlState.origin,
      profile: redactProfile(suggestion.profile),
      confidence: suggestion.confidence,
      secrets_redacted: true,
    };
  }

  const pageState = await suggestProfileFromCurrentPage(args);
  const originValidation = validateExactHttpOrigin(pageState.origin);
  if (!originValidation.ok) {
    return {
      status: "blocked",
      action: "suggest_profile",
      reason: originValidation.reason,
      url: pageState.url,
      origin: pageState.origin,
      pathname: pageState.pathname,
      title: pageState.title,
      transport: pageState.transport,
      transport_attempts: pageState.transport_attempts,
      page: pageState.page,
      secrets_redacted: true,
    };
  }
  const suggestion = makeSuggestedProfile(pageState, args);
  return {
    status: "success",
    action: "suggest_profile",
    url: pageState.url,
    origin: pageState.origin,
    pathname: pageState.pathname,
    title: pageState.title,
    transport: pageState.transport,
    transport_attempts: pageState.transport_attempts,
    page: pageState.page,
    profile: redactProfile(suggestion.profile),
    confidence: suggestion.confidence,
    captcha_detected: pageState.captcha_detected === true,
    sso_detected: pageState.sso_detected === true,
    form_detected: pageState.form_detected === true,
    password_input_count: pageState.password_input_count,
    username_like_input_count: pageState.username_like_input_count,
    secrets_redacted: true,
  };
}

async function handleUpsertProfile(args) {
  const profile = buildProfileFromUpsertArgs(args);
  const writeResult = await writeProfileAtomic(args, profile);
  const storedProfile = {
    ...profile,
    source: "profile_env",
    source_path: writeResult.filePath,
    file_mode: writeResult.file_mode,
    insecure_file_permissions: writeResult.insecure_file_permissions,
  };
  return {
    status: "success",
    action: "upsert_profile",
    created: writeResult.created,
    updated: writeResult.updated,
    profile: redactProfile(storedProfile),
    secrets_redacted: true,
  };
}

async function handleEnsureLogin(args) {
  const loaded = await loadLoginProfiles(args);
  if (args?.dry_run === true && args?.url) {
    const urlState = parseUrlState(args.url);
    const genericDetection = detectLoginFromUrl(args.url, null);
    if (!genericDetection.login_detected) {
      return {
        status: "success",
        action: "ensure_login",
        dry_run: true,
        already_authenticated: true,
        submitted: false,
        would_submit: false,
        reason: "profile_missing_but_not_needed",
        url: urlState.url,
        origin: urlState.origin,
        ...genericDetection,
        secrets_redacted: true,
      };
    }
    const resolved = resolveProfileForOrigin(loaded.profiles, args, urlState.origin);
    const detection = detectLoginFromUrl(args.url, resolved.profile);
    const canSubmit = Boolean(resolved.profile && !resolved.blocked_reason && detection.login_detected);
    return {
      status: canSubmit ? "success" : "blocked",
      action: "ensure_login",
      dry_run: true,
      would_submit: canSubmit,
      reason: resolved.blocked_reason || (detection.login_detected ? "would_submit" : "login_not_detected"),
      url: urlState.url,
      origin: urlState.origin,
      profile: resolved.profile ? redactProfile(resolved.profile) : undefined,
      ...detection,
      secrets_redacted: true,
    };
  }

  const firstState = await inspectCurrentPage(args, null);
  const genericDetection = detectLoginPage(firstState, null);
  if (!genericDetection.login_detected) {
    return {
      status: "success",
      action: "ensure_login",
      already_authenticated: true,
      submitted: false,
      reason: "profile_missing_but_not_needed",
      url: firstState.url,
      origin: firstState.origin,
      pathname: firstState.pathname,
      title: firstState.title,
      transport: firstState.transport,
      transport_attempts: firstState.transport_attempts,
      page: firstState.page,
      ...genericDetection,
      secrets_redacted: true,
    };
  }
  const resolved = resolveProfileForOrigin(loaded.profiles, args, firstState.origin);
  const profile = resolved.profile;
  if (!profile) {
    return {
      status: "blocked",
      action: "ensure_login",
      reason: resolved.blocked_reason || "no_matching_login_profile",
      url: firstState.url,
      origin: firstState.origin,
      pathname: firstState.pathname,
      title: firstState.title,
      transport: firstState.transport,
      transport_attempts: firstState.transport_attempts,
      page: firstState.page,
      ...genericDetection,
      secrets_redacted: true,
    };
  }
  if (resolved.blocked_reason) {
    const detection = detectLoginPage(firstState, profile);
    return {
      status: "blocked",
      action: "ensure_login",
      reason: resolved.blocked_reason,
      url: firstState.url,
      origin: firstState.origin,
      pathname: firstState.pathname,
      title: firstState.title,
      transport: firstState.transport,
      transport_attempts: firstState.transport_attempts,
      page: firstState.page,
      profile: redactProfile(profile),
      ...detection,
      secrets_redacted: true,
    };
  }

  const pageState = await inspectCurrentPage(args, profile);
  const detection = detectLoginPage(pageState, profile);
  if (!detection.login_detected) {
    return {
      status: "success",
      action: "ensure_login",
      already_authenticated: true,
      submitted: false,
      reason: "login_not_detected",
      url: pageState.url,
      origin: pageState.origin,
      pathname: pageState.pathname,
      title: pageState.title,
      transport: pageState.transport,
      transport_attempts: pageState.transport_attempts,
      page: pageState.page,
      profile: redactProfile(profile),
      ...detection,
      secrets_redacted: true,
    };
  }

  const validation = validateProfileShape(profile);
  if (!validation.valid) {
    return {
      status: "blocked",
      action: "ensure_login",
      reason: "profile_invalid",
      validation,
      url: pageState.url,
      origin: pageState.origin,
      pathname: pageState.pathname,
      profile: redactProfile(profile),
      ...detection,
      secrets_redacted: true,
    };
  }
  if (args?.dry_run === true) {
    return {
      status: "success",
      action: "ensure_login",
      dry_run: true,
      would_submit: true,
      reason: "would_submit",
      url: pageState.url,
      origin: pageState.origin,
      pathname: pageState.pathname,
      title: pageState.title,
      transport: pageState.transport,
      transport_attempts: pageState.transport_attempts,
      page: pageState.page,
      profile: redactProfile(profile),
      ...detection,
      secrets_redacted: true,
    };
  }

  const submitted = await submitLoginForm(args, profile);
  const payload = submitted.result ?? {};
  return {
    status: payload.ok === true ? "success" : "failed",
    action: "ensure_login",
    profile: redactProfile(profile),
    login_detected: true,
    detection_source: detection.detection_source,
    submitted: payload.submitted === true,
    reason: String(payload.reason ?? (payload.ok === true ? "logged_in" : "login_failed")),
    transport: submitted.transport,
    transport_attempts: submitted.transport_attempts,
    page: submitted.page,
    submit_method: payload.submit_method,
    waited_ms: payload.waited_ms,
    final_url: payload.final_url,
    final_origin: payload.final_origin,
    final_path: payload.final_path,
    title: payload.title,
    blocked_path: payload.blocked_path,
    success_text_matched: payload.success_text_matched,
    missing_selectors: Array.isArray(payload.missing_selectors) ? payload.missing_selectors : [],
    secrets_redacted: true,
  };
}

async function handleBrowserAuthOps(args) {
  const action = normalizeAction(args, [
    "list_profiles",
    "validate_profile",
    "inspect_login_page",
    "suggest_profile",
    "upsert_profile",
    "ensure_login",
  ]);
  if (action === "list_profiles") {
    return handleListProfiles(args);
  }
  if (action === "validate_profile") {
    return handleValidateProfile(args);
  }
  if (action === "inspect_login_page") {
    return handleInspectLoginPage(args);
  }
  if (action === "suggest_profile") {
    return handleSuggestProfile(args);
  }
  if (action === "upsert_profile") {
    return handleUpsertProfile(args);
  }
  return handleEnsureLogin(args);
}

export {
  handleBrowserAuthOps,
  loadLoginProfiles,
  redactProfile,
};
