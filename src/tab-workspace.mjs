export {
  buildReusePolicy,
  normalizeOwnershipPolicy,
  normalizeReuseKey,
  normalizeReuseScope,
  normalizeWorkspaceKey,
} from "./tab-workspace/policy.mjs";
export {
  managedTabFinalizeHint,
  managedTabPayload,
  planManagedTab,
} from "./tab-workspace/records.mjs";
export {
  buildFinalizeCleanupSummary,
  formatFinalizeDeliverySummary,
} from "./tab-workspace/finalizer-summary.mjs";
export {
  deleteManagedTab,
  getManagedTab,
  listManagedTabRecords,
  recordManagedTab,
  updateManagedTab,
} from "./tab-workspace/registry.mjs";
export {
  extractCreatedTabId,
  findReusableManagedTab,
  isManagedTabWithinLiveGrace,
  managedTabGroups,
  summarizeUnmanagedMatches,
} from "./tab-workspace/reuse.mjs";
