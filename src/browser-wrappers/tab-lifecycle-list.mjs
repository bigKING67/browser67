import { CAPABILITIES } from "../tab-workspace/capabilities.mjs";
import { defaultSessionRegistry } from "../runtime/sessions/registry.mjs";
import {
  listManagedTabRecords,
  managedTabGroups,
  managedTabPayload,
} from "../tab-workspace/index.mjs";
import { resolvePreferredBrowserContext } from "../tmwd-runtime/index.mjs";
import {
  liveTabMap,
  resolveManagedRecordLiveness,
} from "./shared.mjs";
import { browserTabKey } from "../tab-workspace/identity.mjs";
import {
  DEFAULT_LIST_MANAGED_MAX_ITEMS,
  DEFAULT_LIST_MANAGED_MAX_STALE_ITEMS,
  limitLiveFilterPayload,
  limitedList,
  normalizeListManagedLimit,
} from "./tab-lifecycle-limits.mjs";

function ownedSessionPointers(sessionStore, ownedSessionKeys) {
  const pointers = sessionStore.sessionPointers();
  const activeSessionId = ownedSessionKeys.has(String(pointers.active_session_id ?? ""))
    ? pointers.active_session_id
    : null;
  const defaultSessionId = ownedSessionKeys.has(String(pointers.default_session_id ?? ""))
    ? pointers.default_session_id
    : null;
  const latestSessionId = ownedSessionKeys.has(String(pointers.latest_session_id ?? ""))
    ? pointers.latest_session_id
    : null;
  return {
    active_session_id: activeSessionId,
    default_session_id: defaultSessionId,
    latest_session_id: latestSessionId,
    active_browser_instance_id: activeSessionId ? pointers.active_browser_instance_id : null,
    default_browser_instance_id: defaultSessionId ? pointers.default_browser_instance_id : null,
  };
}

async function listManagedTabs(args = {}, options = {}) {
  const sessionStore = options.runtime?.sessionStore ?? defaultSessionRegistry;
  const includeDisconnected = args?.include_disconnected === true || args?.history === true;
  const summaryOnly = args?.summary_only !== false;
  const maxItems = normalizeListManagedLimit(args?.max_items, DEFAULT_LIST_MANAGED_MAX_ITEMS);
  const maxStaleItems = normalizeListManagedLimit(args?.max_stale_items, DEFAULT_LIST_MANAGED_MAX_STALE_ITEMS);
  const liveSessions = sessionStore.list();
  const sessions = includeDisconnected
    ? sessionStore.list({ include_disconnected: true })
    : liveSessions;
  const pruneStale = args?.prune_stale === true
    ? await options.pruneStaleManagedTabs({ ...args, dry_run: args?.dry_run === true }, options)
    : undefined;
  const registryRecords = await listManagedTabRecords({
    include_closed: includeDisconnected,
    workspace_key: String(args.workspace_key ?? args.workspaceKey ?? "").trim(),
    task_id: String(args.task_id ?? args.taskId ?? "").trim(),
    browser_instance_id: String(args.browser_instance_id ?? args.browserInstanceId ?? "").trim(),
  });
  let managedRecords = registryRecords;
  let liveFilter;
  if (!includeDisconnected) {
    liveFilter = {
      applied: true,
      source: "none",
      before_count: registryRecords.length,
      after_count: registryRecords.length,
      stale_count: 0,
      stale: [],
    };
    if (registryRecords.length > 0) {
      let preferred = null;
      let liveCheckUnavailable = false;
      try {
        preferred = await resolvePreferredBrowserContext({ ...args, refresh_sessions: true }, options);
      } catch (error) {
        liveCheckUnavailable = true;
        liveFilter.warning = `live browser check unavailable; returning registry records without liveness filtering: ${String(error?.message ?? error)}`;
      }
      if (preferred) {
        const liveTabs = Array.isArray(preferred.context?.targets) ? preferred.context.targets : liveSessions;
        const liveById = liveTabMap(liveTabs);
        const kept = [];
        const stale = [];
        const livenessRows = await Promise.all(registryRecords.map(async (record) => ({
          record,
          liveness: await resolveManagedRecordLiveness(args, preferred, record, liveById, options),
        })));
        livenessRows.forEach(({ record, liveness }) => {
          if (liveness.live === true) {
            kept.push(record);
            return;
          }
          stale.push({
            tab_id: record.tab_id,
            browser_instance_id: record.browser_instance_id || undefined,
            session_key: record.session_key,
            workspace_key: record.workspace_key,
            url: record.url,
            reason: liveness.reason,
          });
        });
        managedRecords = kept;
        liveFilter = {
          ...liveFilter,
          source: preferred.transport,
          transport_attempts: Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [],
          after_count: kept.length,
          stale_count: stale.length,
          stale,
        };
      } else if (!liveCheckUnavailable) {
        const liveById = liveTabMap(liveSessions);
        const kept = registryRecords.filter((record) => liveById.has(browserTabKey(record)));
        const stale = registryRecords
          .filter((record) => !liveById.has(browserTabKey(record)))
          .map((record) => ({
            tab_id: record.tab_id,
            browser_instance_id: record.browser_instance_id || undefined,
            session_key: record.session_key,
            workspace_key: record.workspace_key,
            url: record.url,
            reason: "live_check_unavailable",
          }));
        managedRecords = kept;
        liveFilter = {
          ...liveFilter,
          source: "session_registry",
          after_count: kept.length,
          stale_count: stale.length,
          stale,
        };
      } else {
        managedRecords = registryRecords;
        liveFilter = {
          ...liveFilter,
          applied: false,
          source: "unavailable",
          reason: "live_browser_selection_unavailable",
          after_count: registryRecords.length,
        };
      }
    }
  } else {
    liveFilter = {
      applied: false,
      reason: "include_disconnected_or_history",
      before_count: registryRecords.length,
      after_count: registryRecords.length,
      stale_count: 0,
      stale: [],
    };
  }
  const managedPayloads = managedRecords.map((record) => managedTabPayload(record));
  const ownedSessionKeys = new Set(registryRecords.map((record) => browserTabKey(record)).filter(Boolean));
  const ownedLiveSessions = liveSessions.filter((session) => ownedSessionKeys.has(browserTabKey(session)));
  const ownedSessions = sessions.filter((session) => ownedSessionKeys.has(browserTabKey(session)));
  const ownedDisconnectedSessions = includeDisconnected
    ? ownedSessions.filter((session) => session.active !== true)
    : undefined;
  const managedLimit = limitedList(managedPayloads, maxItems, summaryOnly);
  const groupPayloads = (await managedTabGroups(managedRecords)).map((group) => {
    const tabs = Array.isArray(group.tabs) ? group.tabs : [];
    const limitedTabs = tabs.slice(0, maxItems);
    return {
      ...group,
      tabs: summaryOnly ? [] : limitedTabs,
      tabs_total_count: tabs.length,
      tabs_returned_count: summaryOnly ? 0 : limitedTabs.length,
      tabs_truncated: tabs.length > limitedTabs.length,
    };
  });
  const groupLimit = limitedList(groupPayloads, maxItems, summaryOnly);
  const limitedLiveFilter = limitLiveFilterPayload(liveFilter, maxStaleItems, summaryOnly);
  const sessionPointers = ownedSessionPointers(sessionStore, ownedSessionKeys);
  return {
    status: "success",
    action: "list_managed",
    capabilities: CAPABILITIES,
    managed_tabs: managedLimit.values,
    groups: groupLimit.values,
    live_filter: limitedLiveFilter,
    summary: {
      include_disconnected: includeDisconnected,
      summary_only: summaryOnly,
      registry_count: registryRecords.length,
      managed_total_count: managedLimit.total_count,
      managed_returned_count: managedLimit.returned_count,
      groups_total_count: groupLimit.total_count,
      groups_returned_count: groupLimit.returned_count,
      live_session_count: ownedLiveSessions.length,
      live_session_returned_count: summaryOnly ? 0 : ownedLiveSessions.length,
      disconnected_session_count: ownedDisconnectedSessions?.length ?? 0,
      disconnected_session_returned_count: summaryOnly ? 0 : (ownedDisconnectedSessions?.length ?? 0),
      stale_total_count: limitedLiveFilter?.stale_total_count ?? 0,
      stale_returned_count: limitedLiveFilter?.stale_returned_count ?? 0,
    },
    result_limits: {
      max_items: maxItems,
      max_stale_items: maxStaleItems,
      managed_tabs_truncated: managedLimit.truncated,
      groups_truncated: groupLimit.truncated,
      stale_truncated: limitedLiveFilter?.stale_truncated === true,
    },
    live_sessions: summaryOnly ? [] : ownedLiveSessions,
    disconnected_sessions: summaryOnly ? [] : ownedDisconnectedSessions,
    sessions: summaryOnly ? [] : ownedSessions,
    prune_stale: pruneStale ? { ...pruneStale, ...sessionPointers } : undefined,
    ...sessionPointers,
  };
}

export {
  listManagedTabs,
  ownedSessionPointers,
};
