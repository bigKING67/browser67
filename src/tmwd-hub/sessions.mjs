import { nowIso, nowMs } from "./time.mjs";

function normalizeSessionId(raw) {
  return String(raw ?? "").trim();
}

function normalizeTab(tab) {
  if (!tab || typeof tab !== "object") {
    return null;
  }
  const id = normalizeSessionId(tab.id ?? tab.tabId ?? tab.sessionId);
  if (!id) {
    return null;
  }
  return {
    id,
    url: String(tab.url ?? ""),
    title: String(tab.title ?? ""),
    type: "ext_ws",
    connected_at: nowIso(),
    disconnect_at: null,
    active: true,
  };
}

function isSessionActive(hub, sessionId) {
  const session = hub.sessions.get(sessionId);
  return Boolean(session && session.disconnect_at === null);
}

function markSessionDisconnected(hub, sessionId) {
  const session = hub.sessions.get(sessionId);
  if (!session || session.disconnect_at !== null) {
    return;
  }
  session.active = false;
  session.disconnect_at = nowIso();
}

function markAllExtensionSessionsDisconnected(hub) {
  for (const session of hub.sessions.values()) {
    if (session.type === "ext_ws") {
      markSessionDisconnected(hub, session.id);
    }
  }
}

function cleanupInactiveSessions(hub, sessionTtlMs) {
  const deadline = nowMs() - sessionTtlMs;
  for (const [id, session] of hub.sessions.entries()) {
    if (session.disconnect_at === null) {
      continue;
    }
    const disconnectAt = Date.parse(session.disconnect_at);
    if (!Number.isFinite(disconnectAt) || disconnectAt < deadline) {
      hub.sessions.delete(id);
    }
  }
  if (hub.defaultSessionId && !isSessionActive(hub, hub.defaultSessionId)) {
    hub.defaultSessionId = "";
  }
  if (hub.latestSessionId && !hub.sessions.has(hub.latestSessionId)) {
    hub.latestSessionId = "";
  }
}

function registerTabs(hub, tabs, sessionTtlMs) {
  const normalizedTabs = Array.isArray(tabs)
    ? tabs.map((tab) => normalizeTab(tab)).filter((tab) => tab !== null)
    : [];
  const activeSet = new Set(normalizedTabs.map((tab) => tab.id));

  for (const [id, session] of hub.sessions.entries()) {
    if (session.type === "ext_ws" && session.disconnect_at === null && !activeSet.has(id)) {
      markSessionDisconnected(hub, id);
    }
  }

  for (const tab of normalizedTabs) {
    const existing = hub.sessions.get(tab.id);
    if (existing) {
      existing.url = tab.url;
      existing.title = tab.title;
      existing.type = "ext_ws";
      existing.connected_at = tab.connected_at;
      existing.disconnect_at = null;
      existing.active = true;
    } else {
      hub.sessions.set(tab.id, tab);
    }
    hub.latestSessionId = tab.id;
    if (!hub.defaultSessionId) {
      hub.defaultSessionId = tab.id;
    }
  }

  cleanupInactiveSessions(hub, sessionTtlMs);
}

function toPublicSession(session) {
  return {
    id: session.id,
    url: session.url,
    title: session.title,
    type: session.type,
    connected_at: session.connected_at,
  };
}

function listActiveSessions(hub, sessionTtlMs) {
  cleanupInactiveSessions(hub, sessionTtlMs);
  return Array.from(hub.sessions.values())
    .filter((session) => session.disconnect_at === null)
    .map((session) => toPublicSession(session));
}

function pickSession(hub, sessionTtlMs, sessionId) {
  cleanupInactiveSessions(hub, sessionTtlMs);
  const requestedId = normalizeSessionId(sessionId);
  if (requestedId && isSessionActive(hub, requestedId)) {
    return hub.sessions.get(requestedId);
  }
  if (hub.defaultSessionId && isSessionActive(hub, hub.defaultSessionId)) {
    return hub.sessions.get(hub.defaultSessionId);
  }
  const first = Array.from(hub.sessions.values()).find((session) => session.disconnect_at === null);
  if (first) {
    hub.defaultSessionId = first.id;
  }
  return first ?? null;
}

function findSessions(hub, sessionTtlMs, urlPattern) {
  cleanupInactiveSessions(hub, sessionTtlMs);
  const pattern = String(urlPattern ?? "");
  if (!pattern) {
    if (hub.latestSessionId && hub.sessions.has(hub.latestSessionId)) {
      const latest = hub.sessions.get(hub.latestSessionId);
      if (latest && latest.disconnect_at === null) {
        return [[latest.id, toPublicSession(latest)]];
      }
    }
    return [];
  }
  const matches = [];
  for (const session of hub.sessions.values()) {
    if (session.disconnect_at !== null) {
      continue;
    }
    if (session.url.includes(pattern) || session.title.includes(pattern)) {
      matches.push([session.id, toPublicSession(session)]);
    }
  }
  return matches;
}

export {
  cleanupInactiveSessions,
  findSessions,
  isSessionActive,
  listActiveSessions,
  markAllExtensionSessionsDisconnected,
  markSessionDisconnected,
  normalizeSessionId,
  normalizeTab,
  pickSession,
  registerTabs,
};
