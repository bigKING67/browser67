export {
  DEFAULT_MANAGED_TAB_SCOPE_LIMIT,
  MAX_MANAGED_TAB_SCOPE_LIMIT,
  assertManagedTabCapacity,
  evaluateManagedTabCapacity,
  managedTabScopeLimit,
} from "./capacity.mjs";
export {
  browserInstanceIdFrom,
  browserTabIdFrom,
  browserTabKey,
  normalizeBrowserInstanceId,
  normalizeBrowserTabId,
  sameBrowserTab,
} from "./identity.mjs";
export {
  buildReusePolicy,
  normalizeOwnershipPolicy,
  normalizeReuseKey,
  normalizeReuseScope,
  normalizeWorkspaceKey,
} from "./policy.mjs";
export {
  managedTabFinalizeHint,
  managedTabPayload,
  planManagedTab,
} from "./records.mjs";
export {
  buildFinalizeCleanupSummary,
  formatFinalizeDeliverySummary,
} from "./finalizer-summary.mjs";
export {
  deleteManagedTab,
  getManagedTab,
  listManagedTabRecords,
  recordManagedTab,
  updateManagedTab,
} from "./registry.mjs";
export {
  extractCreatedTabId,
  findReusableManagedTab,
  isManagedTabWithinLiveGrace,
  managedTabGroups,
  summarizeUnmanagedMatches,
} from "./reuse.mjs";
export {
  NAVIGATION_AUTHORIZATION_TTL_MS,
  browserConnectionGeneration,
  browserDocumentIdentity,
  createNavigationAuthorization,
  navigationStatusFromPolicy,
  reconcileAdoptedNavigation,
} from "./navigation-guard.mjs";
export {
  FOCUS_POLICIES,
  WINDOW_POLICIES,
  agentWindowMetadata,
  bridgeCommandData,
  createdTabMetadata,
  managedWindowRecordFields,
  normalizeFocusPolicy,
  normalizeWindowId,
  normalizeWindowPolicy,
  resolveManagedPresentation,
} from "./presentation.mjs";
