const DEFAULT_LIST_MANAGED_MAX_ITEMS = 50;
const DEFAULT_LIST_MANAGED_MAX_STALE_ITEMS = 20;
const MAX_LIST_MANAGED_ITEMS = 500;

function normalizeListManagedLimit(raw, fallback) {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(MAX_LIST_MANAGED_ITEMS, Math.floor(parsed)));
}

function limitedList(items, maxItems, summaryOnly = false) {
  const values = Array.isArray(items) ? items : [];
  const limit = summaryOnly ? 0 : maxItems;
  const returned = values.slice(0, limit);
  return {
    values: returned,
    total_count: values.length,
    returned_count: returned.length,
    truncated: values.length > returned.length,
  };
}

function limitLiveFilterPayload(liveFilter, maxStaleItems, summaryOnly = false) {
  if (!liveFilter || typeof liveFilter !== "object") {
    return liveFilter;
  }
  const stale = Array.isArray(liveFilter.stale) ? liveFilter.stale : [];
  const limited = limitedList(stale, maxStaleItems, summaryOnly);
  return {
    ...liveFilter,
    stale: limited.values,
    stale_total_count: limited.total_count,
    stale_returned_count: limited.returned_count,
    stale_truncated: limited.truncated,
  };
}

export {
  DEFAULT_LIST_MANAGED_MAX_ITEMS,
  DEFAULT_LIST_MANAGED_MAX_STALE_ITEMS,
  MAX_LIST_MANAGED_ITEMS,
  limitLiveFilterPayload,
  limitedList,
  normalizeListManagedLimit,
};
