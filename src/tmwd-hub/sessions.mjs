import {
  browserInstanceError,
  normalizeBrowserInstanceId,
  sessionKey,
} from "./browser-instance.mjs";
import { nowIso, nowMs } from "./time.mjs";

function normalizeSessionId(raw) {
  return String(raw ?? "").trim();
}

function normalizeTab(browserInstanceId, tab) {
  if (!tab || typeof tab !== "object") return null;
  const tabId = normalizeSessionId(tab.id ?? tab.tabId ?? tab.sessionId);
  const key = sessionKey(browserInstanceId, tabId);
  if (!key) return null;
  return {
    id: key,
    session_key: key,
    tab_id: tabId,
    browser_instance_id: browserInstanceId,
    url: String(tab.url ?? ""),
    title: String(tab.title ?? ""),
    type: "ext_ws",
    connected_at: nowIso(),
    disconnect_at: null,
    active: true,
  };
}

function isSessionActive(hub, key) {
  const session = hub.sessions.get(key);
  return Boolean(session && session.disconnect_at === null);
}

function markSessionDisconnected(hub, key) {
  const session = hub.sessions.get(key);
  if (!session || session.disconnect_at !== null) return;
  session.active = false;
  session.disconnect_at = nowIso();
}

function markBrowserInstanceSessionsDisconnected(hub, browserInstanceId) {
  for (const [key, session] of hub.sessions.entries()) {
    if (session.browser_instance_id === browserInstanceId) markSessionDisconnected(hub, key);
  }
}

function activeBrowserInstanceIds(hub) {
  return [...hub.browserInstances.entries()]
    .filter(([, instance]) => instance.socket !== null)
    .map(([id]) => id)
    .sort();
}

function cleanupInactiveSessions(hub, sessionTtlMs) {
  const deadline = nowMs() - sessionTtlMs;
  for (const [key, session] of hub.sessions.entries()) {
    if (session.disconnect_at === null) continue;
    const disconnectAt = Date.parse(session.disconnect_at);
    if (!Number.isFinite(disconnectAt) || disconnectAt < deadline) hub.sessions.delete(key);
  }
  for (const [instanceId, key] of hub.defaultSessionByInstance.entries()) {
    if (!isSessionActive(hub, key)) hub.defaultSessionByInstance.delete(instanceId);
  }
  if (hub.latestSessionKey && !hub.sessions.has(hub.latestSessionKey)) hub.latestSessionKey = "";
}

function registerTabs(hub, browserInstanceId, tabs, sessionTtlMs) {
  const instanceId = normalizeBrowserInstanceId(browserInstanceId);
  if (!instanceId) throw browserInstanceError("BROWSER_INSTANCE_INVALID", "browser_instance_id is invalid");
  const normalizedTabs = Array.isArray(tabs)
    ? tabs.map((tab) => normalizeTab(instanceId, tab)).filter((tab) => tab !== null)
    : [];
  const activeSet = new Set(normalizedTabs.map((tab) => tab.id));
  for (const [key, session] of hub.sessions.entries()) {
    if (
      session.browser_instance_id === instanceId
      && session.disconnect_at === null
      && !activeSet.has(key)
    ) markSessionDisconnected(hub, key);
  }
  for (const tab of normalizedTabs) {
    const existing = hub.sessions.get(tab.id);
    if (existing) Object.assign(existing, tab);
    else hub.sessions.set(tab.id, tab);
    hub.latestSessionKey = tab.id;
    if (!hub.defaultSessionByInstance.has(instanceId)) {
      hub.defaultSessionByInstance.set(instanceId, tab.id);
    }
  }
  cleanupInactiveSessions(hub, sessionTtlMs);
}

function toPublicSession(session, hub) {
  return {
    id: session.tab_id,
    tab_id: session.tab_id,
    session_key: session.session_key,
    browser_instance_id: session.browser_instance_id,
    browser_instance_default: session.browser_instance_id === hub.defaultBrowserInstanceId,
    url: session.url,
    title: session.title,
    type: session.type,
    connected_at: session.connected_at,
  };
}

function listActiveSessions(hub, sessionTtlMs) {
  cleanupInactiveSessions(hub, sessionTtlMs);
  return [...hub.sessions.values()]
    .filter((session) => session.disconnect_at === null)
    .map((session) => toPublicSession(session, hub));
}

function resolveBrowserInstance(hub, requestedBrowserInstanceId) {
  const requested = normalizeBrowserInstanceId(requestedBrowserInstanceId);
  const active = activeBrowserInstanceIds(hub);
  if (requested) {
    if (!active.includes(requested)) {
      throw browserInstanceError(
        "BROWSER_INSTANCE_UNAVAILABLE",
        `browser instance is unavailable: ${requested}`,
        { browser_instance_id: requested, available_browser_instance_ids: active },
      );
    }
    return requested;
  }
  if (hub.defaultBrowserInstanceId) {
    if (!active.includes(hub.defaultBrowserInstanceId)) {
      throw browserInstanceError(
        "BROWSER_INSTANCE_UNAVAILABLE",
        `default browser instance is unavailable: ${hub.defaultBrowserInstanceId}`,
        { browser_instance_id: hub.defaultBrowserInstanceId, available_browser_instance_ids: active },
      );
    }
    return hub.defaultBrowserInstanceId;
  }
  if (active.length === 1) return active[0];
  if (active.length > 1) {
    throw browserInstanceError(
      "AMBIGUOUS_TARGET",
      "multiple browser instances are active; specify browser_instance_id or set an explicit default",
      { available_browser_instance_ids: active },
    );
  }
  throw browserInstanceError("BROWSER_INSTANCE_UNAVAILABLE", "no active browser instance is available");
}

function pickSession(hub, sessionTtlMs, sessionId, browserInstanceId) {
  cleanupInactiveSessions(hub, sessionTtlMs);
  const instanceId = resolveBrowserInstance(hub, browserInstanceId);
  const requestedId = normalizeSessionId(sessionId);
  if (requestedId) {
    const requestedKey = sessionKey(instanceId, requestedId.includes(":") ? requestedId.split(":").at(-1) : requestedId);
    if (isSessionActive(hub, requestedKey)) return hub.sessions.get(requestedKey);
    throw browserInstanceError(
      "TARGET_NOT_FOUND",
      `tab not found in browser instance ${instanceId}: ${requestedId}`,
      { browser_instance_id: instanceId, tab_id: requestedId },
    );
  }
  const defaultKey = hub.defaultSessionByInstance.get(instanceId);
  if (defaultKey && isSessionActive(hub, defaultKey)) return hub.sessions.get(defaultKey);
  const first = [...hub.sessions.values()].find((session) => (
    session.browser_instance_id === instanceId && session.disconnect_at === null
  ));
  if (first) hub.defaultSessionByInstance.set(instanceId, first.id);
  return first ?? null;
}

function findSessions(hub, sessionTtlMs, urlPattern, browserInstanceId) {
  cleanupInactiveSessions(hub, sessionTtlMs);
  const instanceId = resolveBrowserInstance(hub, browserInstanceId);
  const pattern = String(urlPattern ?? "");
  const matches = [];
  for (const session of hub.sessions.values()) {
    if (session.disconnect_at !== null) continue;
    if (session.browser_instance_id !== instanceId) continue;
    if (!pattern || session.url.includes(pattern) || session.title.includes(pattern)) {
      matches.push([session.session_key, toPublicSession(session, hub)]);
    }
  }
  return matches;
}

function setDefaultBrowserInstance(hub, browserInstanceId) {
  const instanceId = resolveBrowserInstance(hub, browserInstanceId);
  hub.defaultBrowserInstanceId = instanceId;
  return instanceId;
}

function clearDefaultBrowserInstance(hub) {
  hub.defaultBrowserInstanceId = "";
}

function listBrowserInstances(hub) {
  return [...hub.browserInstances.entries()].map(([id, instance]) => ({
    browser_instance_id: id,
    active: instance.socket !== null,
    is_default: id === hub.defaultBrowserInstanceId,
    connected_at: instance.connected_at,
    disconnected_at: instance.disconnected_at,
    tab_count: [...hub.sessions.values()].filter((session) => (
      session.browser_instance_id === id && session.disconnect_at === null
    )).length,
  })).sort((left, right) => left.browser_instance_id.localeCompare(right.browser_instance_id));
}

export {
  activeBrowserInstanceIds,
  cleanupInactiveSessions,
  clearDefaultBrowserInstance,
  findSessions,
  isSessionActive,
  listActiveSessions,
  listBrowserInstances,
  markBrowserInstanceSessionsDisconnected,
  markSessionDisconnected,
  normalizeSessionId,
  normalizeTab,
  pickSession,
  registerTabs,
  resolveBrowserInstance,
  setDefaultBrowserInstance,
};
