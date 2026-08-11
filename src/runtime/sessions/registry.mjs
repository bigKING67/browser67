import { compactText } from "../../browser/content/output-limits.mjs";
import { nowIso } from "../identity.mjs";

const SESSION_RETAIN_MS = 10 * 60 * 1000;
const MAX_SESSION_RECORDS = 2_000;

function normalizeIdToken(raw) {
  const value = String(raw ?? "").trim();
  return value.length > 0 ? value : "";
}

function selectionError(code, message, details = {}) {
  return Object.assign(new Error(message), {
    errorCode: code,
    details,
  });
}

function createSessionRegistry(options = {}) {
  const retainMs = Math.max(0, Number(options.retain_ms ?? SESSION_RETAIN_MS));
  const maxRecords = Math.max(1, Number(options.max_records ?? MAX_SESSION_RECORDS));
  const sessions = new Map();
  let activeTargetId = "";
  let defaultSessionId = "";
  let latestSessionId = "";

  function getActiveTargetId() {
    return activeTargetId;
  }

  function sessionPointers() {
    const activeRecord = sessions.get(activeTargetId);
    const defaultRecord = sessions.get(defaultSessionId);
    return {
      active_session_id: activeTargetId || null,
      default_session_id: defaultSessionId || null,
      latest_session_id: latestSessionId || null,
      active_browser_instance_id: activeRecord?.browser_instance_id || null,
      default_browser_instance_id: defaultRecord?.browser_instance_id || null,
    };
  }

  function pruneDisconnectedSessions(nowMs) {
    for (const [sessionId, record] of sessions.entries()) {
      if (!record.disconnect_at) continue;
      const disconnectedAtMs = Date.parse(record.disconnect_at);
      if (Number.isFinite(disconnectedAtMs) && nowMs - disconnectedAtMs > retainMs) {
        sessions.delete(sessionId);
      }
    }
  }

  function enforceBound() {
    if (sessions.size <= maxRecords) return;
    const rows = [...sessions.values()].sort((left, right) => {
      const leftDisconnected = left.disconnect_at ? 0 : 1;
      const rightDisconnected = right.disconnect_at ? 0 : 1;
      if (leftDisconnected !== rightDisconnected) return leftDisconnected - rightDisconnected;
      return Date.parse(left.disconnect_at || left.connected_at) - Date.parse(right.disconnect_at || right.connected_at);
    });
    for (const record of rows) {
      if (sessions.size <= maxRecords) break;
      if (record.id === activeTargetId || record.id === defaultSessionId) continue;
      sessions.delete(record.id);
    }
    if (latestSessionId && !sessions.has(latestSessionId)) {
      latestSessionId = activeTargetId || defaultSessionId || sessions.keys().next().value || "";
    }
  }

  function sync(targets) {
    const normalizedTargets = Array.isArray(targets) ? targets : [];
    const nowIsoValue = nowIso();
    const nowMs = Date.now();
    const targetIds = new Set(normalizedTargets.map((item) => item.id));
    for (const [sessionId, record] of sessions.entries()) {
      if (!targetIds.has(sessionId) && !record.disconnect_at) {
        sessions.set(sessionId, { ...record, disconnect_at: nowIsoValue });
      }
    }
    for (const target of normalizedTargets) {
      const existing = sessions.get(target.id);
      if (!existing) {
        sessions.set(target.id, {
          id: target.id,
          tab_id: target.tab_id ?? target.id,
          browser_instance_id: target.browser_instance_id ?? "",
          browser_instance_default: target.browser_instance_default === true,
          url: target.url,
          title: target.title,
          type: "ext_ws",
          connected_at: nowIsoValue,
          disconnect_at: null,
        });
        latestSessionId = target.id;
        if (!defaultSessionId) defaultSessionId = target.id;
        continue;
      }
      sessions.set(target.id, {
        ...existing,
        tab_id: target.tab_id ?? target.id,
        browser_instance_id: target.browser_instance_id ?? "",
        browser_instance_default: target.browser_instance_default === true,
        url: target.url,
        title: target.title,
        disconnect_at: null,
      });
      latestSessionId = target.id;
    }
    pruneDisconnectedSessions(nowMs);
    if (!defaultSessionId || !targetIds.has(defaultSessionId)) {
      const fallback = normalizedTargets.find((item) => item.active) ?? normalizedTargets[0];
      defaultSessionId = fallback?.id ?? "";
    }
    if (!activeTargetId || !targetIds.has(activeTargetId)) {
      activeTargetId = defaultSessionId || normalizedTargets[0]?.id || "";
    }
    enforceBound();
  }

  function list(options = {}) {
    const includeDisconnected = options.include_disconnected === true;
    const rows = [];
    for (const record of sessions.values()) {
      const active = record.disconnect_at === null;
      if (!includeDisconnected && !active) continue;
      rows.push({
        id: record.id,
        tab_id: record.tab_id,
        browser_instance_id: record.browser_instance_id,
        browser_instance_default: record.browser_instance_default,
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
      if (left.active !== right.active) return left.active ? -1 : 1;
      if (left.is_default !== right.is_default) return left.is_default ? -1 : 1;
      return left.id.localeCompare(right.id);
    });
    return rows;
  }

  function resolveByPattern(targets, pattern) {
    const normalized = String(pattern ?? "").trim();
    if (!normalized) return [];
    return targets.filter((item) => item.url.includes(normalized) || item.title.includes(normalized));
  }

  function select(sessionId, options = {}) {
    const normalizedSessionId = normalizeIdToken(sessionId);
    if (!normalizedSessionId) return;
    activeTargetId = normalizedSessionId;
    latestSessionId = normalizedSessionId;
    if (options.make_default === true || !defaultSessionId) defaultSessionId = normalizedSessionId;
  }

  function selectTarget(targets, args) {
    if (!Array.isArray(targets) || targets.length === 0) throw new Error("no candidate targets");
    const explicitBrowserInstanceId = normalizeIdToken(args?.browser_instance_id ?? args?.browserInstanceId);
    const availableBrowserInstanceIds = [...new Set(targets
      .map((item) => normalizeIdToken(item.browser_instance_id))
      .filter(Boolean))].sort();
    let browserInstanceId = explicitBrowserInstanceId;
    let instanceSelectedBy = explicitBrowserInstanceId ? "browser_instance_id" : "";
    if (browserInstanceId && !availableBrowserInstanceIds.includes(browserInstanceId)) {
      throw selectionError(
        "BROWSER_INSTANCE_UNAVAILABLE",
        `browser instance is unavailable: ${browserInstanceId}`,
        { browser_instance_id: browserInstanceId, available_browser_instance_ids: availableBrowserInstanceIds },
      );
    }
    if (!browserInstanceId && availableBrowserInstanceIds.length > 0) {
      const defaults = [...new Set(targets
        .filter((item) => item.browser_instance_default === true)
        .map((item) => item.browser_instance_id))];
      if (defaults.length === 1) {
        browserInstanceId = defaults[0];
        instanceSelectedBy = "default_browser_instance";
      } else if (availableBrowserInstanceIds.length === 1) {
        browserInstanceId = availableBrowserInstanceIds[0];
        instanceSelectedBy = "sole_active_browser_instance";
      } else {
        throw selectionError(
          "AMBIGUOUS_TARGET",
          "multiple browser instances are active; specify browser_instance_id or set an explicit default",
          { available_browser_instance_ids: availableBrowserInstanceIds },
        );
      }
    }
    const candidateTargets = browserInstanceId
      ? targets.filter((item) => item.browser_instance_id === browserInstanceId)
      : targets;
    if (candidateTargets.length === 0) {
      throw selectionError("BROWSER_INSTANCE_UNAVAILABLE", "selected browser instance has no active tabs");
    }
    const explicitTabId = normalizeIdToken(args?.switch_tab_id ?? args?.tab_id ?? args?.tabId);
    const explicitSessionId = normalizeIdToken(args?.session_id ?? args?.sessionId);
    const explicitSessionPattern = String(args?.session_url_pattern ?? args?.url_pattern ?? "").trim();
    const urlHint = String(args?.target_url_contains ?? "").trim();
    let selected = null;
    let selectedBy = "";
    if (explicitTabId) {
      selected = candidateTargets.find((item) => (
        item.id === explicitTabId || normalizeIdToken(item.tab_id) === explicitTabId
      )) ?? null;
      if (!selected) throw new Error(`tab not found: ${explicitTabId}`);
      selectedBy = "tab_id";
    }
    if (!selected && explicitSessionId) {
      selected = candidateTargets.find((item) => (
        item.id === explicitSessionId || normalizeIdToken(item.tab_id) === explicitSessionId
      )) ?? null;
      if (!selected) throw new Error(`session not found: ${explicitSessionId}`);
      selectedBy = "session_id";
    }
    if (!selected && explicitSessionPattern) {
      const matched = resolveByPattern(candidateTargets, explicitSessionPattern);
      if (matched.length > 1) {
        throw selectionError("AMBIGUOUS_TARGET", "session_url_pattern matched multiple tabs");
      }
      if (matched.length === 1) {
        selected = matched[0];
        selectedBy = "session_url_pattern";
      }
    }
    if (!selected && urlHint) {
      const matched = candidateTargets.filter((item) => item.url.includes(urlHint));
      if (matched.length > 1) throw selectionError("AMBIGUOUS_TARGET", "target_url_contains matched multiple tabs");
      selected = matched[0] ?? null;
      if (selected) selectedBy = "target_url_contains";
    }
    if (!selected && activeTargetId) {
      selected = candidateTargets.find((item) => item.id === activeTargetId) ?? null;
      if (selected) selectedBy = "active_target";
    }
    if (!selected && defaultSessionId) {
      selected = candidateTargets.find((item) => item.id === defaultSessionId) ?? null;
      if (selected) selectedBy = "default_session";
    }
    if (!selected) {
      selected = candidateTargets.find((item) => item.active) ?? candidateTargets[0];
      selectedBy = selected?.active ? "browser_active" : "first_target";
    }
    if (!selected) throw new Error("no target selected");
    return {
      target: selected,
      selection: {
        selected_by: selectedBy || "unknown",
        browser_instance_id: selected.browser_instance_id || undefined,
        browser_instance_selected_by: instanceSelectedBy || undefined,
      },
    };
  }

  function asShortTabs(targets) {
    return targets.map((item) => ({
      id: item.id,
      tab_id: item.tab_id,
      browser_instance_id: item.browser_instance_id,
      url: compactText(item.url, 50),
      title: compactText(item.title, 80),
      active: item.id === activeTargetId || item.active,
      is_default: item.id === defaultSessionId,
      is_latest: item.id === latestSessionId,
    }));
  }

  function stats() {
    return {
      session_count: sessions.size,
      max_records: maxRecords,
      ...sessionPointers(),
    };
  }

  function reset() {
    sessions.clear();
    activeTargetId = "";
    defaultSessionId = "";
    latestSessionId = "";
  }

  async function dispose() {
    reset();
  }

  return Object.freeze({
    asShortTabs,
    dispose,
    getActiveTargetId,
    list,
    reset,
    resolveByPattern,
    select,
    selectTarget,
    sessionPointers,
    stats,
    sync,
  });
}

const defaultSessionRegistry = createSessionRegistry();
const asShortTabs = (...args) => defaultSessionRegistry.asShortTabs(...args);
const getActiveTargetId = () => defaultSessionRegistry.getActiveTargetId();
const listSessionsSnapshot = (...args) => defaultSessionRegistry.list(...args);
const markSessionSelected = (...args) => defaultSessionRegistry.select(...args);
const resolveSessionByPattern = (...args) => defaultSessionRegistry.resolveByPattern(...args);
const selectTargetFromCandidates = (...args) => defaultSessionRegistry.selectTarget(...args);
const sessionPointers = () => defaultSessionRegistry.sessionPointers();
const syncSessionRegistry = (...args) => defaultSessionRegistry.sync(...args);

export {
  SESSION_RETAIN_MS,
  MAX_SESSION_RECORDS,
  asShortTabs,
  createSessionRegistry,
  defaultSessionRegistry,
  getActiveTargetId,
  listSessionsSnapshot,
  markSessionSelected,
  normalizeIdToken,
  resolveSessionByPattern,
  selectTargetFromCandidates,
  sessionPointers,
  syncSessionRegistry,
};
