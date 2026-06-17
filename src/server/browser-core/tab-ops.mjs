import {
  mergeTransportAttempts,
  normalizeTmwdTransportLabel,
} from "../../common.mjs";
import {
  asShortTabs,
  getActiveTargetId,
  listSessionsSnapshot,
  markSessionSelected,
  normalizeIdToken,
  resolveSessionByPattern,
  sessionPointers,
} from "../../session-registry.mjs";
import {
  executeTmwdJsWithFallback,
  resolvePreferredBrowserContext,
} from "../../tmwd-runtime.mjs";

function wantsUnscriptableTabs(args = {}) {
  return args.include_unscriptable === true
    || args.include_internal === true
    || args.includeUnscriptable === true
    || args.includeInternal === true;
}

function normalizeBridgeTabRows(raw) {
  const rows = Array.isArray(raw)
    ? raw
    : (Array.isArray(raw?.data) ? raw.data : []);
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      const id = normalizeIdToken(row.id ?? row.tab_id ?? row.tabId ?? row.sessionId);
      if (!id) {
        return null;
      }
      const url = String(row.url ?? "");
      return {
        id,
        url,
        title: String(row.title ?? ""),
        active: row.active === true,
        windowId: row.windowId,
        scriptable: row.scriptable === true || /^https?:/.test(url),
      };
    })
    .filter((row) => row !== null);
}

async function handleBrowserTabOps(args) {
  const op = String(args?.op ?? "").trim().toLowerCase();
  if (op === "current" || op === "current_session") {
    return {
      status: "ok",
      active_tab: getActiveTargetId() || null,
      ...sessionPointers(),
    };
  }
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  const tabs = preferred.context.targets;
  const transportAttempts = Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [];
  if (op === "set_session") {
    const pattern = String(args?.url_pattern ?? "").trim();
    if (!pattern) {
      return {
        status: "error",
        msg: "url_pattern is required for op=set_session",
      };
    }
    const matched = resolveSessionByPattern(tabs, pattern);
    if (matched.length === 0) {
      return {
        status: "error",
        msg: `no session matched pattern: ${pattern}`,
        ...sessionPointers(),
      };
    }
    markSessionSelected(matched[0].id, { make_default: true });
    return {
      status: "ok",
      selected: matched[0].id,
      matched: asShortTabs(matched),
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      selection_source: "url_pattern",
      ...sessionPointers(),
    };
  }
  if (op === "find_session") {
    const pattern = String(args?.url_pattern ?? "").trim();
    return {
      status: "ok",
      pattern,
      matched: asShortTabs(resolveSessionByPattern(tabs, pattern)),
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      ...sessionPointers(),
    };
  }
  if (op === "list_sessions") {
    return {
      status: "ok",
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      sessions: listSessionsSnapshot({
        include_disconnected: args?.include_disconnected === true,
      }),
      ...sessionPointers(),
    };
  }
  if (op === "switch") {
    const tabId = String(args?.tab_id ?? args?.session_id ?? "").trim();
    if (!tabId) {
      return {
        status: "error",
        msg: "tab_id or session_id is required for op=switch",
      };
    }
    if (!tabs.some((item) => item.id === tabId)) {
      return {
        status: "error",
        msg: `tab not found: ${tabId}`,
      };
    }
    markSessionSelected(tabId, { make_default: false });
    return {
      status: "ok",
      active_tab: tabId,
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      selection_source: "session_id",
      ...sessionPointers(),
    };
  }
  if (op === "list") {
    const includeUnscriptable = wantsUnscriptableTabs(args ?? {});
    if (includeUnscriptable && (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link")) {
      try {
        const allTabsResult = await executeTmwdJsWithFallback(
          args ?? {},
          preferred.context,
          {
            cmd: "tabs",
            method: "list",
            includeUnscriptable: true,
          },
        );
        const allTabs = normalizeBridgeTabRows(allTabsResult.executed.value);
        return {
          status: "ok",
          transport: normalizeTmwdTransportLabel(allTabsResult.context.tmwd_transport),
          transport_attempts: mergeTransportAttempts(
            preferred.transport_attempts,
            allTabsResult.transport_attempts,
          ),
          include_unscriptable: true,
          tabs_count: allTabs.length,
          tabs: allTabs,
          scriptable_tabs_count: tabs.length,
          scriptable_tabs: asShortTabs(tabs),
          internal_tabs: allTabs.filter((tab) => tab.scriptable !== true),
          active_tab: getActiveTargetId() || null,
          sessions: listSessionsSnapshot(),
          ...sessionPointers(),
        };
      } catch (error) {
        return {
          status: "partial",
          transport: preferred.transport,
          transport_attempts: transportAttempts,
          include_unscriptable: false,
          include_unscriptable_warning: String(error?.message ?? error),
          tabs_count: tabs.length,
          tabs: asShortTabs(tabs),
          active_tab: getActiveTargetId() || null,
          sessions: listSessionsSnapshot(),
          ...sessionPointers(),
        };
      }
    }
    return {
      status: "ok",
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      tabs_count: tabs.length,
      tabs: asShortTabs(tabs),
      active_tab: getActiveTargetId() || null,
      sessions: listSessionsSnapshot(),
      ...sessionPointers(),
    };
  }
  return {
    status: "error",
    msg: `unsupported op: ${op}`,
  };
}

export {
  handleBrowserTabOps,
};
