import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";

import { compactText, nowIso, randomId } from "./common.mjs";

const managedTabs = new Map();
const deletedTabIds = new Set();

const OWNERSHIP_POLICIES = new Set(["tmwd_only", "fresh"]);
const REUSE_SCOPES = new Set(["exact", "origin_path", "origin", "none"]);
const RECENT_MANAGED_TAB_LIVE_GRACE_MS = 30_000;
let registryLoaded = false;

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

const registryPath = resolveRegistryPath();

function readRegistryRecordsFromDisk() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(registryPath, "utf8"));
  } catch {
    return [];
  }
  return Array.isArray(parsed?.managed_tabs)
    ? parsed.managed_tabs.map((row) => buildManagedRecord(row))
    : [];
}

function loadRegistry() {
  if (registryLoaded) {
    return;
  }
  registryLoaded = true;
  for (const record of readRegistryRecordsFromDisk()) {
    if (record.dry_run === true || record.status === "closed") {
      continue;
    }
    managedTabs.set(record.tab_id, record);
  }
}

function persistRegistry() {
  loadRegistry();

  const merged = new Map();
  for (const record of readRegistryRecordsFromDisk()) {
    if (record.dry_run === true || record.status === "closed") {
      continue;
    }
    merged.set(record.tab_id, record);
  }
  for (const tabId of deletedTabIds) {
    merged.delete(tabId);
  }
  for (const record of managedTabs.values()) {
    if (record.dry_run === true) {
      continue;
    }
    if (record.status === "closed") {
      merged.delete(record.tab_id);
      continue;
    }
    merged.set(record.tab_id, record);
  }

  mkdirSync(dirname(registryPath), { recursive: true });
  const payload = {
    version: 1,
    updated_at: nowIso(),
    managed_tabs: Array.from(merged.values()).map((record) => managedTabPayload(record)),
  };
  const tempPath = `${registryPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(tempPath, registryPath);

  managedTabs.clear();
  for (const record of merged.values()) {
    managedTabs.set(record.tab_id, record);
  }
  deletedTabIds.clear();
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

function buildManagedRecord(input = {}) {
  const url = String(input.url ?? "").trim() || "about:blank";
  const parts = parseUrlParts(url);
  const now = nowIso();
  return {
    tab_id: String(input.tab_id ?? input.tabId ?? "").trim() || randomId("tmwd_tab"),
    owner: "tmwd",
    source: String(input.source ?? "tmwd_browser").trim() || "tmwd_browser",
    task_id: String(input.task_id ?? input.taskId ?? "").trim(),
    workspace_key: String(input.workspace_key ?? input.workspaceKey ?? "").trim()
      || normalizeWorkspaceKey(input, url),
    reuse_key: String(input.reuse_key ?? input.reuseKey ?? "").trim()
      || normalizeReuseKey(input, url),
    url: parts.normalized_url,
    title: String(input.title ?? ""),
    origin: parts.origin,
    path_scope: String(input.path_scope ?? input.pathScope ?? "").trim() || parts.path_scope,
    keep: input.keep === true,
    dry_run: input.dry_run === true,
    status: String(input.status ?? "open").trim() || "open",
    created_at: String(input.created_at ?? now),
    updated_at: String(input.updated_at ?? now),
    last_used_at: String(input.last_used_at ?? now),
  };
}

function managedTabPayload(record) {
  return {
    tab_id: record.tab_id,
    owner: record.owner,
    source: record.source,
    task_id: record.task_id || undefined,
    workspace_key: record.workspace_key,
    reuse_key: record.reuse_key,
    url: record.url,
    title: record.title,
    origin: record.origin,
    path_scope: record.path_scope,
    keep: record.keep === true,
    dry_run: record.dry_run === true,
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
    last_used_at: record.last_used_at,
  };
}

function planManagedTab(input) {
  return buildManagedRecord({
    ...input,
    tab_id: input?.tab_id ?? input?.tabId ?? randomId("dry_tab"),
    dry_run: true,
    status: input?.status ?? "planned",
  });
}

function recordManagedTab(input) {
  loadRegistry();
  if (input?.dry_run === true) {
    return planManagedTab(input);
  }
  const record = buildManagedRecord(input);
  managedTabs.set(record.tab_id, record);
  persistRegistry();
  return record;
}

function getManagedTab(tabId) {
  loadRegistry();
  return managedTabs.get(String(tabId ?? "").trim()) ?? null;
}

function updateManagedTab(tabId, patch = {}) {
  loadRegistry();
  const normalizedTabId = String(tabId ?? "").trim();
  const existing = managedTabs.get(normalizedTabId);
  if (!existing) {
    return null;
  }
  const { touch, ...recordPatch } = patch;
  const nextUrl = Object.prototype.hasOwnProperty.call(recordPatch, "url")
    ? String(recordPatch.url ?? "").trim()
    : existing.url;
  const parts = parseUrlParts(nextUrl || existing.url);
  const next = {
    ...existing,
    ...recordPatch,
    tab_id: existing.tab_id,
    owner: "tmwd",
    url: parts.normalized_url,
    origin: parts.origin,
    path_scope: String(recordPatch.path_scope ?? recordPatch.pathScope ?? existing.path_scope ?? "").trim()
      || parts.path_scope,
    updated_at: nowIso(),
    last_used_at: touch === false ? existing.last_used_at : nowIso(),
  };
  managedTabs.set(normalizedTabId, next);
  persistRegistry();
  return next;
}

function deleteManagedTab(tabId) {
  loadRegistry();
  const normalizedTabId = String(tabId ?? "").trim();
  if (!normalizedTabId) {
    return;
  }
  managedTabs.delete(normalizedTabId);
  deletedTabIds.add(normalizedTabId);
  persistRegistry();
}

function listManagedTabRecords(options = {}) {
  loadRegistry();
  const includeClosed = options.include_closed === true;
  const rows = Array.from(managedTabs.values()).filter((record) => {
    if (!includeClosed && record.status === "closed") {
      return false;
    }
    if (options.task_id && record.task_id !== options.task_id) {
      return false;
    }
    if (options.workspace_key && record.workspace_key !== options.workspace_key) {
      return false;
    }
    return true;
  });
  rows.sort((left, right) => String(right.last_used_at).localeCompare(String(left.last_used_at)));
  return rows;
}

function liveTabMap(liveTabs = []) {
  const rows = Array.isArray(liveTabs) ? liveTabs : [];
  return new Map(
    rows
      .map((item) => [String(item?.id ?? item?.tab_id ?? item?.tabId ?? "").trim(), item])
      .filter(([id]) => id.length > 0),
  );
}

function recordIsLive(record, liveById) {
  if (record.dry_run === true) {
    return true;
  }
  if (!liveById || liveById.size === 0) {
    return record.status !== "closed";
  }
  if (liveById.has(record.tab_id)) {
    return true;
  }
  const lastSeenAtMs = Math.max(
    Date.parse(record.last_used_at || ""),
    Date.parse(record.updated_at || ""),
    Date.parse(record.created_at || ""),
  );
  return Number.isFinite(lastSeenAtMs) && Date.now() - lastSeenAtMs <= RECENT_MANAGED_TAB_LIVE_GRACE_MS;
}

function candidateMatches(record, target, policy) {
  if (!record || record.owner !== "tmwd" || record.status === "closed") {
    return false;
  }
  if (policy.workspace_key && record.workspace_key !== policy.workspace_key) {
    return false;
  }
  if (policy.task_id && record.task_id !== policy.task_id) {
    return false;
  }
  if (policy.explicit_reuse_key && policy.reuse_key && record.reuse_key === policy.reuse_key) {
    return true;
  }
  if (policy.reuse_scope === "exact") {
    return record.url === target.normalized_url;
  }
  if (policy.reuse_scope === "origin_path") {
    return record.origin === target.origin && record.path_scope === target.path_scope;
  }
  if (policy.reuse_scope === "origin") {
    return Boolean(record.origin) && record.origin === target.origin;
  }
  return false;
}

function scoreCandidate(record, target, policy) {
  let score = 0;
  if (policy.workspace_key && record.workspace_key === policy.workspace_key) {
    score += 50;
  }
  if (policy.explicit_reuse_key && policy.reuse_key && record.reuse_key === policy.reuse_key) {
    score += 40;
  }
  if (record.url === target.normalized_url) {
    score += 30;
  }
  if (record.origin === target.origin && record.path_scope === target.path_scope) {
    score += 20;
  }
  if (record.origin && record.origin === target.origin) {
    score += 10;
  }
  if (record.keep === true) {
    score += 2;
  }
  return score;
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

function findReusableManagedTab(args = {}, url = "", liveTabs = []) {
  const policy = buildReusePolicy(args, url);
  if (policy.force_fresh) {
    return {
      record: null,
      policy,
      selected_by: "fresh",
      reason: "fresh_or_reuse_disabled",
    };
  }
  const liveById = liveTabMap(liveTabs);
  const candidates = listManagedTabRecords()
    .filter((record) => record.dry_run !== true)
    .filter((record) => recordIsLive(record, liveById))
    .filter((record) => candidateMatches(record, policy.target, policy))
    .map((record) => ({
      record,
      score: scoreCandidate(record, policy.target, policy),
    }))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return String(right.record.last_used_at).localeCompare(String(left.record.last_used_at));
    });
  if (candidates.length === 0) {
    return {
      record: null,
      policy,
      selected_by: "none",
      reason: "no_tmwd_owned_match",
    };
  }
  const picked = candidates[0].record;
  const selectedBy = policy.explicit_reuse_key && picked.reuse_key === policy.reuse_key
    ? "reuse_key"
    : (picked.url === policy.target.normalized_url ? "exact" : policy.reuse_scope);
  return {
    record: picked,
    policy,
    selected_by: selectedBy,
    reason: "tmwd_owned_match",
  };
}

function summarizeUnmanagedMatches(args = {}, url = "", liveTabs = []) {
  const policy = buildReusePolicy(args, url);
  const managedIds = new Set(listManagedTabRecords({ include_closed: true }).map((record) => record.tab_id));
  return (Array.isArray(liveTabs) ? liveTabs : [])
    .filter((tab) => {
      const id = String(tab?.id ?? tab?.tab_id ?? tab?.tabId ?? "").trim();
      if (!id || managedIds.has(id)) {
        return false;
      }
      const candidate = parseUrlParts(tab?.url ?? "");
      if (policy.reuse_scope === "exact") {
        return candidate.normalized_url === policy.target.normalized_url;
      }
      if (policy.reuse_scope === "origin") {
        return Boolean(candidate.origin) && candidate.origin === policy.target.origin;
      }
      return candidate.origin === policy.target.origin && candidate.path_scope === policy.target.path_scope;
    })
    .slice(0, 5)
    .map((tab) => ({
      tab_id: String(tab?.id ?? tab?.tab_id ?? tab?.tabId ?? ""),
      url: compactText(tab?.url ?? "", 90),
      title: compactText(tab?.title ?? "", 90),
      reason: "user_unmanaged_tab_not_reused",
    }));
}

function managedTabGroups() {
  const groups = new Map();
  for (const record of listManagedTabRecords()) {
    const key = record.workspace_key || record.origin || "tmwd-workspace";
    const existing = groups.get(key) ?? {
      workspace_key: key,
      open_count: 0,
      kept_count: 0,
      tabs: [],
    };
    existing.open_count += 1;
    if (record.keep === true) {
      existing.kept_count += 1;
    }
    existing.tabs.push(record.tab_id);
    groups.set(key, existing);
  }
  return Array.from(groups.values()).sort((left, right) => left.workspace_key.localeCompare(right.workspace_key));
}

function extractCreatedTabId(commandResult) {
  const candidates = [
    commandResult?.value?.id,
    commandResult?.value?.tabId,
    commandResult?.value?.tab_id,
    commandResult?.value?.data?.id,
    commandResult?.value?.data?.tabId,
    commandResult?.value?.data?.tab_id,
    commandResult?.raw?.id,
    commandResult?.raw?.tabId,
    commandResult?.raw?.tab_id,
    commandResult?.raw?.data?.id,
    commandResult?.raw?.data?.tabId,
    commandResult?.raw?.data?.tab_id,
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

export {
  buildReusePolicy,
  deleteManagedTab,
  extractCreatedTabId,
  findReusableManagedTab,
  getManagedTab,
  listManagedTabRecords,
  managedTabGroups,
  managedTabPayload,
  normalizeOwnershipPolicy,
  normalizeReuseScope,
  normalizeReuseKey,
  normalizeWorkspaceKey,
  planManagedTab,
  recordManagedTab,
  summarizeUnmanagedMatches,
  updateManagedTab,
};
