import os from "node:os";
import { resolve } from "node:path";

import {
  OWNERSHIP_POLICIES,
  REUSE_SCOPES,
} from "./constants.mjs";

function expandUserPath(input) {
  const value = String(input ?? "").trim();
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return resolve(os.homedir(), value.slice(2));
  }
  return value;
}

function resolveRegistryPath() {
  const explicit = String(process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH ?? "").trim();
  if (explicit) {
    return resolve(expandUserPath(explicit));
  }
  return resolve(os.homedir(), ".tmwd-browser-mcp/tab-workspace/managed-tabs.json");
}

function normalizeBoolean(raw, fallback) {
  if (raw === true || raw === false) {
    return raw;
  }
  return fallback;
}

function normalizeOwnershipPolicy(args = {}) {
  const requested = String(
    args.ownership_policy
      ?? args.tab_ownership_policy
      ?? process.env.BROWSER_STRUCTURED_TAB_OWNERSHIP_POLICY
      ?? "tmwd_only",
  ).trim().toLowerCase();
  return OWNERSHIP_POLICIES.has(requested) ? requested : "tmwd_only";
}

function normalizeReuseScope(args = {}) {
  const requested = String(
    args.reuse_scope
      ?? args.reuse_strategy
      ?? process.env.BROWSER_STRUCTURED_TAB_REUSE_SCOPE
      ?? "origin_path",
  ).trim().toLowerCase();
  return REUSE_SCOPES.has(requested) ? requested : "origin_path";
}

function normalizeWorkspaceKey(args = {}, url = "") {
  const explicit = String(args.workspace_key ?? args.workspaceKey ?? "").trim();
  if (explicit) {
    return explicit;
  }
  const reuseKey = String(args.reuse_key ?? args.reuseKey ?? "").trim();
  if (reuseKey) {
    return reuseKey;
  }
  const parts = parseUrlParts(url);
  return parts.origin || "tmwd-workspace";
}

function normalizeReuseKey(args = {}, url = "") {
  const explicit = String(args.reuse_key ?? args.reuseKey ?? "").trim();
  if (explicit) {
    return explicit;
  }
  const parts = parseUrlParts(url);
  if (!parts.origin) {
    return url || "about:blank";
  }
  return `${parts.origin}${parts.path_scope}`;
}

function parseUrlParts(url) {
  const value = String(url ?? "").trim() || "about:blank";
  try {
    const parsed = new URL(value);
    return {
      normalized_url: parsed.href,
      origin: parsed.origin === "null" ? "" : parsed.origin,
      pathname: parsed.pathname || "/",
      path_scope: derivePathScope(parsed.pathname || "/"),
    };
  } catch {
    return {
      normalized_url: value,
      origin: "",
      pathname: value,
      path_scope: value,
    };
  }
}

function derivePathScope(pathname) {
  const normalized = String(pathname || "/");
  if (normalized === "/" || !normalized.includes("/")) {
    return "/";
  }
  const trimmed = normalized.endsWith("/") && normalized.length > 1
    ? normalized.slice(0, -1)
    : normalized;
  const index = trimmed.lastIndexOf("/");
  if (index <= 0) {
    return "/";
  }
  return trimmed.slice(0, index) || "/";
}

function shouldForceFresh(args = {}) {
  if (args.fresh === true) {
    return true;
  }
  if (args.reuse === false) {
    return true;
  }
  return normalizeOwnershipPolicy(args) === "fresh" || normalizeReuseScope(args) === "none";
}

function buildReusePolicy(args = {}, url = "") {
  const target = parseUrlParts(url);
  const reuseScope = normalizeReuseScope(args);
  const explicitReuseKey = String(args.reuse_key ?? args.reuseKey ?? "").trim().length > 0;
  return {
    ownership_policy: normalizeOwnershipPolicy(args),
    reuse_scope: reuseScope,
    workspace_key: normalizeWorkspaceKey(args, url),
    reuse_key: normalizeReuseKey(args, url),
    explicit_reuse_key: explicitReuseKey,
    task_id: String(args.task_id ?? args.taskId ?? "").trim(),
    navigate_reused: normalizeBoolean(args.navigate_reused, true),
    force_fresh: shouldForceFresh(args),
    target,
  };
}

export {
  buildReusePolicy,
  normalizeOwnershipPolicy,
  normalizeReuseKey,
  normalizeReuseScope,
  normalizeWorkspaceKey,
  parseUrlParts,
  resolveRegistryPath,
};
