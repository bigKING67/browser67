import { CAPABILITIES } from "../capabilities.mjs";
import {
  listSessionsSnapshot,
  sessionPointers,
} from "../session-registry.mjs";
import {
  listManagedTabRecords,
  managedTabGroups,
  managedTabPayload,
} from "../tab-workspace.mjs";
import { resolvePreferredBrowserContext } from "../tmwd-runtime.mjs";
import {
  liveTabMap,
  resolveManagedRecordLiveness,
} from "./shared.mjs";
import {
  DEFAULT_LIST_MANAGED_MAX_ITEMS,
  DEFAULT_LIST_MANAGED_MAX_STALE_ITEMS,
  limitLiveFilterPayload,
  limitedList,
  normalizeListManagedLimit,
} from "./tab-lifecycle-limits.mjs";

async function listManagedTabs(args = {}, options = {}) {
  const includeDisconnected = args?.include_disconnected === true || args?.history === true;
  const summaryOnly = args?.summary_only === true;
  const maxItems = normalizeListManagedLimit(args?.max_items, DEFAULT_LIST_MANAGED_MAX_ITEMS);
  const maxStaleItems = normalizeListManagedLimit(args?.max_stale_items, DEFAULT_LIST_MANAGED_MAX_STALE_ITEMS);
  const liveSessions = listSessionsSnapshot();
  const sessions = includeDisconnected
    ? listSessionsSnapshot({ include_disconnected: true })
    : liveSessions;
  const disconnectedSessions = includeDisconnected
    ? sessions.filter((session) => session.active !== true)
    : undefined;
  const pruneStale = args?.prune_stale === true
    ? await options.pruneStaleManagedTabs({ ...args, dry_run: args?.dry_run === true })
    : undefined;
  const registryRecords = await listManagedTabRecords({ include_closed: includeDisconnected });
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
      try {
        preferred = await resolvePreferredBrowserContext({ ...args, refresh_sessions: true });
      } catch (error) {
        liveFilter.warning = `live browser check unavailable; returning only tabs known in the active session registry: ${String(error?.message ?? error)}`;
      }
      if (preferred) {
        const liveTabs = Array.isArray(preferred.context?.targets) ? preferred.context.targets : liveSessions;
        const liveById = liveTabMap(liveTabs);
        const kept = [];
        const stale = [];
        const livenessRows = await Promise.all(registryRecords.map(async (record) => ({
          record,
          liveness: await resolveManagedRecordLiveness(args, preferred, record, liveById),
        })));
        livenessRows.forEach(({ record, liveness }) => {
          if (liveness.live === true) {
            kept.push(record);
            return;
          }
          stale.push({
            tab_id: record.tab_id,
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
      } else {
        const liveById = liveTabMap(liveSessions);
        const kept = registryRecords.filter((record) => liveById.has(record.tab_id));
        const stale = registryRecords
          .filter((record) => !liveById.has(record.tab_id))
          .map((record) => ({
            tab_id: record.tab_id,
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
      live_session_count: liveSessions.length,
      live_session_returned_count: summaryOnly ? 0 : liveSessions.length,
      disconnected_session_count: disconnectedSessions?.length ?? 0,
      disconnected_session_returned_count: summaryOnly ? 0 : (disconnectedSessions?.length ?? 0),
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
    live_sessions: summaryOnly ? [] : liveSessions,
    disconnected_sessions: summaryOnly ? [] : disconnectedSessions,
    sessions: summaryOnly ? [] : sessions,
    prune_stale: pruneStale,
    ...sessionPointers(),
  };
}

export {
  listManagedTabs,
};
