import { normalizeIdToken } from "../../runtime/sessions/registry.mjs";
import { normalizeBrowserInstanceId } from "../../tab-workspace/identity.mjs";

function normalizeNewTab(item) {
  const tabId = normalizeIdToken(item?.tab_id ?? item?.tabId ?? item?.id);
  if (!tabId) return null;
  const browserInstanceId = normalizeBrowserInstanceId(
    item?.browser_instance_id ?? item?.browserInstanceId,
  );
  const explicitSessionKey = normalizeIdToken(item?.session_key ?? item?.sessionKey);
  const sessionKey = explicitSessionKey
    || (browserInstanceId ? `${browserInstanceId}:${tabId}` : tabId);
  return {
    id: tabId,
    tab_id: tabId,
    browser_instance_id: browserInstanceId || undefined,
    session_key: sessionKey,
    url: String(item?.url ?? ""),
    title: String(item?.title ?? ""),
  };
}

function mergeNewTabs(...groups) {
  const merged = new Map();
  for (const item of groups.flat()) {
    const normalized = normalizeNewTab(item);
    if (!normalized) continue;
    const prior = merged.get(normalized.session_key);
    merged.set(normalized.session_key, {
      ...normalized,
      url: normalized.url || prior?.url || "",
      title: normalized.title || prior?.title || "",
    });
  }
  return [...merged.values()];
}

function newTabSessionTargets(newTabs = []) {
  return newTabs.map((item) => ({
    ...item,
    id: item.session_key || item.id,
    active: false,
  }));
}

export {
  mergeNewTabs,
  newTabSessionTargets,
  normalizeNewTab,
};
