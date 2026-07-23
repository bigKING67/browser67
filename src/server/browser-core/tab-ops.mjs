import {
  mergeTransportAttempts,
  normalizeTmwdTransportLabel,
} from "../../runtime/transport-attempts.mjs";
import { defaultSessionRegistry, normalizeIdToken } from "../../runtime/sessions/registry.mjs";
import {
  executeTmwdJsWithFallback,
  resolvePreferredBrowserContext,
} from "../../tmwd-runtime/index.mjs";

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

async function handleBrowserTabOps(args, options = {}) {
  const sessionStore = options.runtime?.sessionStore ?? defaultSessionRegistry;
  const op = String(args?.op ?? "").trim().toLowerCase();
  if (op === "current" || op === "current_session") {
    return {
      status: "ok",
      active_tab: sessionStore.getActiveTargetId() || null,
      ...sessionStore.sessionPointers(),
    };
  }
  const preferred = await resolvePreferredBrowserContext(args ?? {}, options);
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
    const matched = sessionStore.resolveByPattern(tabs, pattern);
    if (matched.length === 0) {
      return {
        status: "error",
        msg: `no session matched pattern: ${pattern}`,
        ...sessionStore.sessionPointers(),
      };
    }
    sessionStore.select(matched[0].id, { make_default: true });
    return {
      status: "ok",
      selected: matched[0].id,
      matched: sessionStore.asShortTabs(matched),
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      selection_source: "url_pattern",
      ...sessionStore.sessionPointers(),
    };
  }
  if (op === "find_session") {
    const pattern = String(args?.url_pattern ?? "").trim();
    return {
      status: "ok",
      pattern,
      matched: sessionStore.asShortTabs(sessionStore.resolveByPattern(tabs, pattern)),
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      ...sessionStore.sessionPointers(),
    };
  }
  if (op === "list_sessions") {
    return {
      status: "ok",
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      sessions: sessionStore.list({
        include_disconnected: args?.include_disconnected === true,
      }),
      ...sessionStore.sessionPointers(),
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
    sessionStore.select(tabId, { make_default: false });
    return {
      status: "ok",
      active_tab: tabId,
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      selection_source: "session_id",
      ...sessionStore.sessionPointers(),
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
          options,
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
          scriptable_tabs: sessionStore.asShortTabs(tabs),
          internal_tabs: allTabs.filter((tab) => tab.scriptable !== true),
          active_tab: sessionStore.getActiveTargetId() || null,
          sessions: sessionStore.list(),
          ...sessionStore.sessionPointers(),
        };
      } catch (error) {
        return {
          status: "partial",
          transport: preferred.transport,
          transport_attempts: transportAttempts,
          include_unscriptable: false,
          include_unscriptable_warning: String(error?.message ?? error),
          tabs_count: tabs.length,
          tabs: sessionStore.asShortTabs(tabs),
          active_tab: sessionStore.getActiveTargetId() || null,
          sessions: sessionStore.list(),
          ...sessionStore.sessionPointers(),
        };
      }
    }
    return {
      status: "ok",
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      tabs_count: tabs.length,
      tabs: sessionStore.asShortTabs(tabs),
      active_tab: sessionStore.getActiveTargetId() || null,
      sessions: sessionStore.list(),
      ...sessionStore.sessionPointers(),
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
