import { compactText, nowIso } from "./common.mjs";

const SESSION_RETAIN_MS = 10 * 60 * 1000;

let activeTargetId = "";
let defaultSessionId = "";
let latestSessionId = "";
const sessionRegistry = new Map();

function normalizeIdToken(raw) {
  const value = String(raw ?? "").trim();
  return value.length > 0 ? value : "";
}

function getActiveTargetId() {
  return activeTargetId;
}

function sessionPointers() {
  return {
    active_session_id: activeTargetId || null,
    default_session_id: defaultSessionId || null,
    latest_session_id: latestSessionId || null,
  };
}

function pruneDisconnectedSessions(nowMs) {
  for (const [sessionId, record] of sessionRegistry.entries()) {
    if (!record.disconnect_at) {
      continue;
    }
    const disconnectedAtMs = Date.parse(record.disconnect_at);
    if (!Number.isFinite(disconnectedAtMs)) {
      continue;
    }
    if (nowMs - disconnectedAtMs > SESSION_RETAIN_MS) {
      sessionRegistry.delete(sessionId);
    }
  }
}

function syncSessionRegistry(targets) {
  const nowIsoValue = nowIso();
  const nowMs = Date.now();
  const targetIds = new Set(targets.map((item) => item.id));
  for (const [sessionId, record] of sessionRegistry.entries()) {
    if (targetIds.has(sessionId)) {
      continue;
    }
    if (!record.disconnect_at) {
      sessionRegistry.set(sessionId, {
        ...record,
        disconnect_at: nowIsoValue,
      });
    }
  }
  for (const target of targets) {
    const existing = sessionRegistry.get(target.id);
    if (!existing) {
      sessionRegistry.set(target.id, {
        id: target.id,
        url: target.url,
        title: target.title,
        type: "ext_ws",
        connected_at: nowIsoValue,
        disconnect_at: null,
      });
      latestSessionId = target.id;
      if (!defaultSessionId) {
        defaultSessionId = target.id;
      }
      continue;
    }
    sessionRegistry.set(target.id, {
      ...existing,
      url: target.url,
      title: target.title,
      disconnect_at: null,
    });
    latestSessionId = target.id;
  }
  pruneDisconnectedSessions(nowMs);
  if (!defaultSessionId || !targetIds.has(defaultSessionId)) {
    const fallback = targets.find((item) => item.active) ?? targets[0];
    defaultSessionId = fallback?.id ?? "";
  }
  if (!activeTargetId || !targetIds.has(activeTargetId)) {
    activeTargetId = defaultSessionId || targets[0]?.id || "";
  }
}

function listSessionsSnapshot(options = {}) {
  const includeDisconnected = options.include_disconnected === true;
  const rows = [];
  for (const record of sessionRegistry.values()) {
    const active = record.disconnect_at === null;
    if (!includeDisconnected && !active) {
      continue;
    }
    rows.push({
      id: record.id,
      url: record.url,
      title: record.title,
      type: record.type,
      active,
      connected_at: record.connected_at,
      disconnect_at: record.disconnect_at,
      is_default: record.id === defaultSessionId,
      is_latest: record.id === latestSessionId,
    });
  }
  rows.sort((left, right) => {
    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }
    if (left.is_default !== right.is_default) {
      return left.is_default ? -1 : 1;
    }
    return left.id.localeCompare(right.id);
  });
  return rows;
}

function resolveSessionByPattern(targets, pattern) {
  const normalized = String(pattern ?? "").trim();
  if (!normalized) {
    return [];
  }
  return targets.filter((item) => item.url.includes(normalized) || item.title.includes(normalized));
}

function markSessionSelected(sessionId, options = {}) {
  const normalizedSessionId = normalizeIdToken(sessionId);
  if (!normalizedSessionId) {
    return;
  }
  activeTargetId = normalizedSessionId;
  latestSessionId = normalizedSessionId;
  if (options.make_default === true || !defaultSessionId) {
    defaultSessionId = normalizedSessionId;
  }
}

function selectTargetFromCandidates(targets, args) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("no candidate targets");
  }
  const explicitTabId = normalizeIdToken(args?.switch_tab_id ?? args?.tab_id ?? args?.tabId);
  const explicitSessionId = normalizeIdToken(args?.session_id ?? args?.sessionId);
  const explicitSessionPattern = String(args?.session_url_pattern ?? args?.url_pattern ?? "").trim();
  const urlHint = String(args?.target_url_contains ?? "").trim();
  let selected = null;
  let selectedBy = "";
  let selectionWarning = "";
  if (explicitTabId) {
    selected = targets.find((item) => item.id === explicitTabId) ?? null;
    if (!selected) {
      throw new Error(`tab not found: ${explicitTabId}`);
    }
    selectedBy = "tab_id";
  }
  if (!selected && explicitSessionId) {
    selected = targets.find((item) => item.id === explicitSessionId) ?? null;
    if (selected) {
      selectedBy = "session_id";
    }
  }
  if (!selected && explicitSessionPattern) {
    const matched = resolveSessionByPattern(targets, explicitSessionPattern);
    if (matched.length > 0) {
      selected = matched[0];
      selectedBy = "session_url_pattern";
    }
  }
  if (!selected && urlHint) {
    selected = targets.find((item) => item.url.includes(urlHint)) ?? null;
    if (selected) {
      selectedBy = "target_url_contains";
    }
  }
  if (!selected && activeTargetId) {
    selected = targets.find((item) => item.id === activeTargetId) ?? null;
    if (selected) {
      selectedBy = "active_target";
    }
  }
  if (!selected && defaultSessionId) {
    selected = targets.find((item) => item.id === defaultSessionId) ?? null;
    if (selected) {
      selectedBy = "default_session";
    }
  }
  if (!selected) {
    selected = targets.find((item) => item.active) ?? targets[0];
    selectedBy = selected?.active ? "browser_active" : "first_target";
  }
  if (!selected) {
    throw new Error("no target selected");
  }
  if (explicitSessionId && selected.id !== explicitSessionId) {
    selectionWarning = `session_id=${explicitSessionId} unavailable, fallback=${selected.id}`;
    defaultSessionId = selected.id;
  }
  return {
    target: selected,
    selection: {
      selected_by: selectedBy || "unknown",
      warning: selectionWarning || undefined,
    },
  };
}

function asShortTabs(targets) {
  return targets.map((item) => ({
    id: item.id,
    url: compactText(item.url, 50),
    title: compactText(item.title, 80),
    active: item.id === activeTargetId || item.active,
    is_default: item.id === defaultSessionId,
    is_latest: item.id === latestSessionId,
  }));
}

export {
  asShortTabs,
  getActiveTargetId,
  listSessionsSnapshot,
  markSessionSelected,
  normalizeIdToken,
  resolveSessionByPattern,
  selectTargetFromCandidates,
  sessionPointers,
  syncSessionRegistry,
};
