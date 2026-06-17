import { compactText } from "../common.mjs";
import { RECENT_MANAGED_TAB_LIVE_GRACE_MS } from "./constants.mjs";
import {
  buildReusePolicy,
  parseUrlParts,
} from "./policy.mjs";
import { listManagedTabRecords } from "./registry.mjs";

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
  return isManagedTabWithinLiveGrace(record);
}

function isManagedTabWithinLiveGrace(record, nowMs = Date.now()) {
  const lastSeenAtMs = Math.max(
    Date.parse(record?.last_used_at || ""),
    Date.parse(record?.updated_at || ""),
    Date.parse(record?.created_at || ""),
  );
  return Number.isFinite(lastSeenAtMs) && nowMs - lastSeenAtMs <= RECENT_MANAGED_TAB_LIVE_GRACE_MS;
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

async function findReusableManagedTab(args = {}, url = "", liveTabs = []) {
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
  const candidates = (await listManagedTabRecords())
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

async function summarizeUnmanagedMatches(args = {}, url = "", liveTabs = []) {
  const policy = buildReusePolicy(args, url);
  const managedIds = new Set((await listManagedTabRecords({ include_closed: true })).map((record) => record.tab_id));
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

async function managedTabGroups(records = null) {
  const groups = new Map();
  const sourceRecords = Array.isArray(records) ? records : await listManagedTabRecords();
  for (const record of sourceRecords) {
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
  extractCreatedTabId,
  findReusableManagedTab,
  isManagedTabWithinLiveGrace,
  managedTabGroups,
  summarizeUnmanagedMatches,
};
