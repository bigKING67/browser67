import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BROWSER67_HOME_DIR = ".browser67";
const LEGACY_TMWD_BROWSER_MCP_HOME_DIR = ".tmwd-browser-mcp";

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function userHome(options = {}) {
  return firstNonEmpty(
    options.env?.HOME,
    options.homeDir,
    os.homedir(),
    options.cwd,
    process.cwd(),
  );
}

function expandUserPath(input, options = {}) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const home = userHome(options);
  if (raw === "~") return home;
  if (raw.startsWith("~/")) return path.join(home, raw.slice(2));
  return raw;
}

function browser67DefaultHomePath(options = {}) {
  return path.resolve(userHome(options), BROWSER67_HOME_DIR);
}

function legacyTmwdBrowserMcpHomePath(options = {}) {
  return path.resolve(userHome(options), LEGACY_TMWD_BROWSER_MCP_HOME_DIR);
}

function existsAt(candidate, exists = existsSync) {
  try {
    return exists(candidate);
  } catch {
    return false;
  }
}

function resolveBrowser67Home(options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const exists = options.exists ?? existsSync;
  const preferExistingLegacy = options.preferExistingLegacy !== false;
  const baseOptions = { ...options, env, cwd };
  const canonicalDefault = browser67DefaultHomePath(baseOptions);
  const legacyDefault = legacyTmwdBrowserMcpHomePath(baseOptions);
  const canonicalExists = existsAt(canonicalDefault, exists);
  const legacyExists = existsAt(legacyDefault, exists);

  const explicitCanonical = firstNonEmpty(env.BROWSER67_HOME);
  if (explicitCanonical) {
    return {
      path: path.resolve(expandUserPath(explicitCanonical, baseOptions)),
      source: "BROWSER67_HOME",
      canonical: true,
      legacy: false,
      canonical_default: canonicalDefault,
      legacy_default: legacyDefault,
      canonical_exists: canonicalExists,
      legacy_exists: legacyExists,
    };
  }

  const explicitLegacy = firstNonEmpty(env.TMWD_BROWSER_MCP_HOME, env.TMWD_HOME);
  if (explicitLegacy) {
    return {
      path: path.resolve(expandUserPath(explicitLegacy, baseOptions)),
      source: env.TMWD_BROWSER_MCP_HOME ? "TMWD_BROWSER_MCP_HOME" : "TMWD_HOME",
      canonical: false,
      legacy: true,
      canonical_default: canonicalDefault,
      legacy_default: legacyDefault,
      canonical_exists: canonicalExists,
      legacy_exists: legacyExists,
    };
  }

  if (canonicalExists) {
    return {
      path: canonicalDefault,
      source: "default_existing_browser67",
      canonical: true,
      legacy: false,
      canonical_default: canonicalDefault,
      legacy_default: legacyDefault,
      canonical_exists: canonicalExists,
      legacy_exists: legacyExists,
    };
  }

  if (preferExistingLegacy && legacyExists) {
    return {
      path: legacyDefault,
      source: "legacy_existing_tmwd_browser_mcp",
      canonical: false,
      legacy: true,
      canonical_default: canonicalDefault,
      legacy_default: legacyDefault,
      canonical_exists: canonicalExists,
      legacy_exists: legacyExists,
    };
  }

  return {
    path: canonicalDefault,
    source: "default_browser67",
    canonical: true,
    legacy: false,
    canonical_default: canonicalDefault,
    legacy_default: legacyDefault,
    canonical_exists: canonicalExists,
    legacy_exists: legacyExists,
  };
}

function resolveBrowser67HomePath(options = {}) {
  return resolveBrowser67Home(options).path;
}

function browser67RuntimePath(...segments) {
  return path.resolve(resolveBrowser67HomePath(), ...segments);
}

export {
  BROWSER67_HOME_DIR,
  LEGACY_TMWD_BROWSER_MCP_HOME_DIR,
  browser67DefaultHomePath,
  browser67RuntimePath,
  expandUserPath,
  legacyTmwdBrowserMcpHomePath,
  resolveBrowser67Home,
  resolveBrowser67HomePath,
};
