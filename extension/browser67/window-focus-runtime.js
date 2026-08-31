const BROWSER67_AGENT_WINDOW_STORAGE_KEY = "browser67.agent-window.v1";
const BROWSER67_AGENT_WINDOW_ORPHANS_STORAGE_KEY = "browser67.agent-window-orphans.v1";
const BROWSER67_AGENT_WINDOW_SESSION_EPOCH_STORAGE_KEY = "browser67.agent-window-session.v1";
const BROWSER67_FOCUS_LEASE_STORAGE_KEY = "browser67.focus-lease.v1";
const BROWSER67_FOCUS_LEASE_ALARM = "browser67-focus-lease-expiry";
const BROWSER67_FOCUS_LEASE_DEFAULT_TTL_MS = 30_000;
const BROWSER67_FOCUS_LEASE_MAX_TTL_MS = 120_000;
const BROWSER67_AGENT_WINDOW_ORPHAN_RECOVERY_DELAY_MS = 500;
const BROWSER67_AGENT_WINDOW_ORPHAN_LIMIT = 16;

let browser67AgentWindowFlight = null;
let browser67AgentWindowSessionToken = "";
let browser67AgentWindowSessionTokenFlight = null;
let browser67ActiveFocusLease = null;
let browser67FocusLeaseLoaded = false;
let browser67FocusLeaseLoadFlight = null;
let browser67FocusCommandFlight = Promise.resolve();

function browser67NumericId(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function browser67OwnershipToken(raw) {
  return String(raw ?? "").trim();
}

function browser67IsoTimestamp(raw, fallback = "") {
  const timestamp = String(raw ?? "").trim();
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : fallback;
}

function browser67AgentWindowIdentity(record) {
  const windowId = browser67NumericId(record?.window_id);
  const anchorTabId = browser67NumericId(record?.anchor_tab_id);
  const ownershipToken = browser67OwnershipToken(record?.ownership_token);
  if (windowId === null || anchorTabId === null || !ownershipToken) return null;
  return {
    schema: "browser67.agent-window.v2",
    window_id: windowId,
    anchor_tab_id: anchorTabId,
    ownership_token: ownershipToken,
    browser_session_token: browser67OwnershipToken(record?.browser_session_token),
    browser_session_scope: String(record?.browser_session_scope || "unknown"),
    anchor_state: String(record?.anchor_state || "active"),
    anchor_removed_at: browser67IsoTimestamp(record?.anchor_removed_at),
    anchor_removed_window_id: browser67NumericId(record?.anchor_removed_window_id),
    created_at: browser67IsoTimestamp(record?.created_at, new Date().toISOString()),
    updated_at: browser67IsoTimestamp(record?.updated_at, new Date().toISOString()),
  };
}

function browser67AgentWindowIdentityMatches(left, right) {
  const leftIdentity = browser67AgentWindowIdentity(left);
  const rightIdentity = browser67AgentWindowIdentity(right);
  return Boolean(
    leftIdentity
    && rightIdentity
    && leftIdentity.window_id === rightIdentity.window_id
    && leftIdentity.anchor_tab_id === rightIdentity.anchor_tab_id
    && leftIdentity.ownership_token === rightIdentity.ownership_token
  );
}

function browser67IsBrowserNewTab(tab) {
  const url = String(tab?.pendingUrl || tab?.url || "").trim().toLowerCase();
  return /^(?:chrome|edge):\/\/(?:newtab|new-tab-page)(?:\/|$)/u.test(url)
    || /^chrome-search:\/\/local-ntp(?:\/|$)/u.test(url);
}

async function browser67CurrentAgentWindowSession() {
  if (browser67AgentWindowSessionToken) {
    return {
      token: browser67AgentWindowSessionToken,
      scope: "browser_profile_epoch",
    };
  }
  if (browser67AgentWindowSessionTokenFlight) return browser67AgentWindowSessionTokenFlight;
  browser67AgentWindowSessionTokenFlight = (async () => {
    const stored = await chrome.storage.local.get(BROWSER67_AGENT_WINDOW_SESSION_EPOCH_STORAGE_KEY);
    const existing = browser67OwnershipToken(stored[BROWSER67_AGENT_WINDOW_SESSION_EPOCH_STORAGE_KEY]);
    browser67AgentWindowSessionToken = existing || crypto.randomUUID();
    if (!existing) {
      await chrome.storage.local.set({
        [BROWSER67_AGENT_WINDOW_SESSION_EPOCH_STORAGE_KEY]: browser67AgentWindowSessionToken,
      });
    }
    return { token: browser67AgentWindowSessionToken, scope: "browser_profile_epoch" };
  })();
  try {
    return await browser67AgentWindowSessionTokenFlight;
  } finally {
    browser67AgentWindowSessionTokenFlight = null;
  }
}

async function browser67RotateAgentWindowSession() {
  if (browser67AgentWindowSessionTokenFlight) {
    await browser67AgentWindowSessionTokenFlight.catch(() => {});
  }
  browser67AgentWindowSessionToken = crypto.randomUUID();
  await chrome.storage.local.set({
    [BROWSER67_AGENT_WINDOW_SESSION_EPOCH_STORAGE_KEY]: browser67AgentWindowSessionToken,
  });
  return {
    token: browser67AgentWindowSessionToken,
    scope: "browser_profile_epoch",
  };
}

function browser67AnchorUrl() {
  return chrome.runtime.getURL("browser67/window-anchor.html");
}

function browser67BrowserFamily() {
  const userAgent = String(globalThis.navigator?.userAgent || "");
  if (/\bEdg\//u.test(userAgent)) return "edge";
  if (/\b(?:Chrome|Chromium)\//u.test(userAgent)) return "chrome";
  return "chromium_unknown";
}

async function browser67PlatformInfo() {
  try {
    const info = await chrome.runtime.getPlatformInfo();
    return {
      os: String(info?.os || "unknown"),
      arch: String(info?.arch || "unknown"),
    };
  } catch {
    return { os: "unknown", arch: "unknown" };
  }
}

function browser67WindowState(windowRow) {
  const state = String(windowRow?.state || "normal").trim().toLowerCase();
  return state || "normal";
}

async function browser67ApplyAgentWindowPresentation(windowId, platform, windowRow) {
  if (platform.os === "win") {
    const updatedWindow = browser67WindowState(windowRow) === "maximized"
      ? windowRow
      : await chrome.windows.update(windowId, { state: "maximized" });
    const windowState = browser67WindowState(updatedWindow);
    if (windowState !== "maximized") {
      throw new Error(`browser67 Agent window did not enter maximized state: ${windowState}`);
    }
    return {
      mode: "windows_maximized",
      status: "ready",
      native_action_required: false,
      toolbar_preserved: true,
      window_state: windowState,
      window: updatedWindow,
    };
  }
  if (platform.os === "mac") {
    const windowState = browser67WindowState(windowRow);
    const ready = windowState === "fullscreen";
    return {
      mode: "macos_native_fullscreen_space",
      status: ready ? "ready" : "native_required",
      native_action_required: !ready,
      toolbar_preserved: true,
      window_state: windowState,
      window: windowRow,
    };
  }
  return {
    mode: "normal",
    status: "not_applicable",
    native_action_required: false,
    toolbar_preserved: true,
    window_state: browser67WindowState(windowRow),
    window: windowRow,
  };
}

function browser67PublicAgentWindow(record, windowRow, presentation, platform, focusSnapshot, flags) {
  return {
    status: "ready",
    created: flags.created === true,
    reused: flags.reused === true,
    focused: windowRow?.focused === true,
    browser_family: browser67BrowserFamily(),
    platform_os: platform.os,
    platform_arch: platform.arch,
    anchor_url: browser67AnchorUrl(),
    focus_snapshot: focusSnapshot,
    presentation: {
      mode: presentation.mode,
      status: presentation.status,
      native_action_required: presentation.native_action_required === true,
      toolbar_preserved: presentation.toolbar_preserved === true,
      window_state: presentation.window_state,
    },
    ...record,
  };
}

async function browser67GetTab(tabId) {
  const normalized = browser67NumericId(tabId);
  if (normalized === null) return null;
  try {
    return await chrome.tabs.get(normalized);
  } catch {
    return null;
  }
}

async function browser67GetWindow(windowId, populate = false) {
  const normalized = browser67NumericId(windowId);
  if (normalized === null) return null;
  try {
    return await chrome.windows.get(normalized, { populate });
  } catch {
    return null;
  }
}

async function browser67PersistAgentWindow(record) {
  await chrome.storage.local.set({ [BROWSER67_AGENT_WINDOW_STORAGE_KEY]: record });
}

async function browser67StoredAgentWindow() {
  const stored = await chrome.storage.local.get(BROWSER67_AGENT_WINDOW_STORAGE_KEY);
  return stored[BROWSER67_AGENT_WINDOW_STORAGE_KEY] || null;
}

async function browser67StoredAgentWindowOrphans() {
  const stored = await chrome.storage.local.get(BROWSER67_AGENT_WINDOW_ORPHANS_STORAGE_KEY);
  return (Array.isArray(stored[BROWSER67_AGENT_WINDOW_ORPHANS_STORAGE_KEY])
    ? stored[BROWSER67_AGENT_WINDOW_ORPHANS_STORAGE_KEY]
    : [])
    .map(browser67AgentWindowIdentity)
    .filter(Boolean);
}

async function browser67PersistAgentWindowOrphans(records) {
  const normalized = records
    .map(browser67AgentWindowIdentity)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
    .slice(0, BROWSER67_AGENT_WINDOW_ORPHAN_LIMIT);
  if (normalized.length === 0) {
    await chrome.storage.local.remove(BROWSER67_AGENT_WINDOW_ORPHANS_STORAGE_KEY);
    return;
  }
  await chrome.storage.local.set({ [BROWSER67_AGENT_WINDOW_ORPHANS_STORAGE_KEY]: normalized });
}

async function browser67RemoveStoredAgentWindow(record) {
  const current = await browser67StoredAgentWindow();
  if (browser67AgentWindowIdentityMatches(current, record)) {
    await chrome.storage.local.remove(BROWSER67_AGENT_WINDOW_STORAGE_KEY);
  }
}

async function browser67RemoveAgentWindowOrphan(record) {
  const orphans = await browser67StoredAgentWindowOrphans();
  await browser67PersistAgentWindowOrphans(
    orphans.filter((candidate) => !browser67AgentWindowIdentityMatches(candidate, record)),
  );
}

async function browser67RememberAgentWindowOrphan(record, changes = {}) {
  const identity = browser67AgentWindowIdentity({
    ...record,
    ...changes,
    schema: "browser67.agent-window.v2",
    updated_at: new Date().toISOString(),
  });
  if (!identity) return null;
  const orphans = (await browser67StoredAgentWindowOrphans())
    .filter((candidate) => !browser67AgentWindowIdentityMatches(candidate, identity));
  orphans.push(identity);
  await browser67PersistAgentWindowOrphans(orphans);
  await browser67RemoveStoredAgentWindow(identity);
  return identity;
}

async function browser67FindOwnedAgentWindow(record) {
  const current = browser67AgentWindowIdentity(await browser67StoredAgentWindow());
  if (browser67AgentWindowIdentityMatches(current, record)) {
    return { record: current, source: "current" };
  }
  const orphan = (await browser67StoredAgentWindowOrphans())
    .find((candidate) => browser67AgentWindowIdentityMatches(candidate, record));
  return orphan ? { record: orphan, source: "orphan" } : null;
}

async function browser67InspectOwnedAgentWindow(record) {
  const identity = browser67AgentWindowIdentity(record);
  if (!identity) return { status: "identity_invalid", close_safe: false };
  const session = await browser67CurrentAgentWindowSession();
  const windowRow = await browser67GetWindow(identity.window_id, true);
  if (!windowRow) {
    return {
      status: "window_unavailable",
      close_safe: false,
      session_match: identity.browser_session_token === session.token,
      record: identity,
      window: null,
      tab_count: 0,
    };
  }
  const tabs = Array.isArray(windowRow.tabs) ? windowRow.tabs : [];
  const anchor = tabs.find((tab) => browser67NumericId(tab?.id) === identity.anchor_tab_id);
  const anchorValid = Boolean(anchor && anchor.url === browser67AnchorUrl());
  const sessionMatch = Boolean(identity.browser_session_token)
    && identity.browser_session_token === session.token;
  const anchorRemoved = ["removed", "replaced", "missing_detected"].includes(identity.anchor_state)
    && identity.anchor_removed_window_id === identity.window_id;
  const soleBrowserNewTab = tabs.length === 1 && browser67IsBrowserNewTab(tabs[0]);
  if (anchorValid) {
    return {
      status: "active",
      close_safe: tabs.length === 1,
      close_mode: tabs.length === 1 ? "sole_anchor" : "nonempty_agent_window",
      session_match: sessionMatch,
      record: identity,
      window: windowRow,
      tab_count: tabs.length,
      anchor_present: true,
      sole_browser_new_tab: false,
    };
  }
  if (sessionMatch && anchorRemoved && soleBrowserNewTab && windowRow.type === "normal") {
    return {
      status: "recoverable_orphan",
      close_safe: true,
      close_mode: "sole_browser_new_tab_after_anchor_loss",
      session_match: true,
      record: identity,
      window: windowRow,
      tab_count: 1,
      anchor_present: false,
      sole_browser_new_tab: true,
    };
  }
  let reason = "agent_window_anchor_mismatch";
  if (!sessionMatch) reason = "agent_window_orphan_session_mismatch";
  else if (!anchorRemoved) reason = "agent_window_anchor_removal_unproven";
  else if (tabs.length !== 1) reason = "agent_window_orphan_not_empty";
  else if (!soleBrowserNewTab) reason = "agent_window_orphan_content_preserved";
  return {
    status: "preserved_orphan",
    reason,
    close_safe: false,
    session_match: sessionMatch,
    record: identity,
    window: windowRow,
    tab_count: tabs.length,
    anchor_present: false,
    sole_browser_new_tab: soleBrowserNewTab,
  };
}

async function browser67ValidateAgentWindow(record) {
  const windowId = browser67NumericId(record?.window_id);
  const anchorTabId = browser67NumericId(record?.anchor_tab_id);
  if (windowId === null || anchorTabId === null) return null;
  const [windowRow, anchorTab] = await Promise.all([
    browser67GetWindow(windowId),
    browser67GetTab(anchorTabId),
  ]);
  if (
    !windowRow
    || windowRow.type !== "normal"
    || !anchorTab
    || anchorTab.windowId !== windowId
    || anchorTab.url !== browser67AnchorUrl()
  ) {
    return null;
  }
  const session = await browser67CurrentAgentWindowSession();
  return {
    schema: "browser67.agent-window.v2",
    window_id: windowId,
    anchor_tab_id: anchorTabId,
    ownership_token: browser67OwnershipToken(record?.ownership_token) || crypto.randomUUID(),
    browser_session_token: session.token,
    browser_session_scope: session.scope,
    anchor_state: "active",
    anchor_removed_at: "",
    anchor_removed_window_id: null,
    created_at: String(record?.created_at || new Date().toISOString()),
    updated_at: new Date().toISOString(),
  };
}

async function browser67ReconcileCurrentAgentWindow() {
  const storedRecord = await browser67StoredAgentWindow();
  const stored = await browser67ValidateAgentWindow(storedRecord);
  if (stored) {
    await browser67PersistAgentWindow(stored);
    return stored;
  }
  const identity = browser67AgentWindowIdentity(storedRecord);
  if (!identity) return null;
  const [windowRow, anchorTab, session] = await Promise.all([
    browser67GetWindow(identity.window_id, true),
    browser67GetTab(identity.anchor_tab_id),
    browser67CurrentAgentWindowSession(),
  ]);
  if (!windowRow) {
    await browser67RemoveStoredAgentWindow(identity);
    return null;
  }
  const exactBrowserNewTab = Boolean(
    anchorTab
    && browser67NumericId(anchorTab.windowId) === identity.window_id
    && browser67IsBrowserNewTab(anchorTab),
  );
  if (
    identity.browser_session_token === session.token
    && (!anchorTab || exactBrowserNewTab)
  ) {
    await browser67RememberAgentWindowOrphan(identity, {
      anchor_state: exactBrowserNewTab ? "replaced" : "missing_detected",
      anchor_removed_at: new Date().toISOString(),
      anchor_removed_window_id: identity.window_id,
    });
    return null;
  }
  await browser67RemoveStoredAgentWindow(identity);
  return null;
}

async function browser67RecoverOwnedAgentWindowOrphans() {
  const session = await browser67CurrentAgentWindowSession();
  const orphans = await browser67StoredAgentWindowOrphans();
  const results = [];
  for (const orphan of orphans) {
    if (!orphan.browser_session_token || orphan.browser_session_token !== session.token) {
      await browser67RemoveAgentWindowOrphan(orphan);
      results.push({ status: "ownership_expired", window_id: orphan.window_id });
      continue;
    }
    const inspection = await browser67InspectOwnedAgentWindow(orphan);
    if (inspection.status === "window_unavailable") {
      await browser67RemoveAgentWindowOrphan(orphan);
      results.push({ status: "already_closed", window_id: orphan.window_id });
      continue;
    }
    if (inspection.status !== "recoverable_orphan") {
      results.push({
        status: "preserved",
        reason: inspection.reason,
        window_id: orphan.window_id,
        tab_count: inspection.tab_count,
      });
      continue;
    }
    await chrome.windows.remove(orphan.window_id);
    const closeVerified = (await browser67GetWindow(orphan.window_id)) === null;
    if (closeVerified) await browser67RemoveAgentWindowOrphan(orphan);
    results.push({
      status: closeVerified ? "closed" : "close_unverified",
      reason: closeVerified
        ? "orphan_new_tab_agent_window_retired"
        : "window_remained_visible",
      window_id: orphan.window_id,
      closed: closeVerified,
      close_verified: closeVerified,
    });
  }
  return results;
}

async function browser67DiscoverAgentWindow() {
  const tabs = await chrome.tabs.query({ url: browser67AnchorUrl() });
  const anchors = tabs
    .filter((tab) => tab.url === browser67AnchorUrl())
    .sort((left, right) => Number(right.id || 0) - Number(left.id || 0));
  for (const anchor of anchors) {
    const record = await browser67ValidateAgentWindow({
      window_id: anchor.windowId,
      anchor_tab_id: anchor.id,
    });
    if (record) return record;
  }
  return null;
}

async function browser67EnsureAgentWindowInternal() {
  const [focusSnapshot, platform] = await Promise.all([
    browser67CurrentFocus(),
    browser67PlatformInfo(),
  ]);
  const stored = await browser67ReconcileCurrentAgentWindow();
  await browser67RecoverOwnedAgentWindowOrphans();
  const discovered = stored || await browser67DiscoverAgentWindow();
  if (discovered) {
    await browser67PersistAgentWindow(discovered);
    const windowRow = await browser67GetWindow(discovered.window_id);
    const presentation = await browser67ApplyAgentWindowPresentation(
      discovered.window_id,
      platform,
      windowRow,
    );
    return browser67PublicAgentWindow(
      discovered,
      presentation.window,
      presentation,
      platform,
      focusSnapshot,
      { created: false, reused: true },
    );
  }
  const createdWindow = await chrome.windows.create({
    url: browser67AnchorUrl(),
    focused: false,
    type: "normal",
  });
  const windowId = browser67NumericId(createdWindow?.id);
  const anchor = Array.isArray(createdWindow?.tabs)
    ? createdWindow.tabs.find((tab) => tab.url === browser67AnchorUrl()) || createdWindow.tabs[0]
    : null;
  const anchorTabId = browser67NumericId(anchor?.id);
  if (windowId === null || anchorTabId === null) {
    throw new Error("browser67 dedicated window creation did not return window and anchor ids");
  }
  const session = await browser67CurrentAgentWindowSession();
  const record = {
    schema: "browser67.agent-window.v2",
    window_id: windowId,
    anchor_tab_id: anchorTabId,
    ownership_token: crypto.randomUUID(),
    browser_session_token: session.token,
    browser_session_scope: session.scope,
    anchor_state: "active",
    anchor_removed_at: "",
    anchor_removed_window_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await browser67PersistAgentWindow(record);
  const presentation = await browser67ApplyAgentWindowPresentation(
    windowId,
    platform,
    createdWindow,
  );
  return browser67PublicAgentWindow(
    record,
    presentation.window,
    presentation,
    platform,
    focusSnapshot,
    { created: true, reused: false },
  );
}

async function browser67RetireAgentWindow(message = {}) {
  const windowId = browser67NumericId(message.windowId ?? message.window_id);
  const anchorTabId = browser67NumericId(message.anchorTabId ?? message.anchor_tab_id);
  const ownershipToken = browser67OwnershipToken(
    message.ownershipToken ?? message.ownership_token,
  );
  if (windowId === null || anchorTabId === null || !ownershipToken) {
    const error = new Error("retire_agent_window requires exact window, anchor, and ownership token identity");
    error.code = "INVALID_ARGUMENT";
    throw error;
  }
  const requestedIdentity = browser67AgentWindowIdentity({
    window_id: windowId,
    anchor_tab_id: anchorTabId,
    ownership_token: ownershipToken,
  });
  const owned = await browser67FindOwnedAgentWindow(requestedIdentity);
  if (
    !owned
    || owned.record.window_id !== windowId
    || owned.record.anchor_tab_id !== anchorTabId
    || owned.record.ownership_token !== ownershipToken
  ) {
    return {
      status: "preserved",
      closed: false,
      close_verified: false,
      reason: "agent_window_identity_mismatch",
      window_id: windowId,
      anchor_tab_id: anchorTabId,
    };
  }
  const inspection = await browser67InspectOwnedAgentWindow(owned.record);
  if (inspection.status === "window_unavailable") {
    await browser67RemoveStoredAgentWindow(owned.record);
    await browser67RemoveAgentWindowOrphan(owned.record);
    return {
      status: "already_closed",
      closed: false,
      close_verified: true,
      reason: "agent_window_unavailable",
      window_id: windowId,
      anchor_tab_id: anchorTabId,
      ownership_record_removed: true,
    };
  }
  if (inspection.close_safe !== true || inspection.window?.type !== "normal") {
    const reason = inspection.status === "active"
      ? "agent_window_not_empty"
      : String(inspection.reason || "agent_window_anchor_mismatch");
    return {
      status: "preserved",
      closed: false,
      close_verified: false,
      reason,
      window_id: windowId,
      anchor_tab_id: anchorTabId,
      tab_count: inspection.tab_count,
      user_content_preserved: true,
      orphan_recovery_eligible: false,
      ownership_source: owned.source,
    };
  }
  await chrome.windows.remove(windowId);
  const closeVerified = (await browser67GetWindow(windowId)) === null;
  if (closeVerified) {
    await browser67RemoveStoredAgentWindow(owned.record);
    await browser67RemoveAgentWindowOrphan(owned.record);
  }
  const recoveredOrphan = inspection.status === "recoverable_orphan";
  return {
    status: closeVerified ? "closed" : "close_unverified",
    closed: closeVerified,
    close_verified: closeVerified,
    reason: closeVerified
      ? recoveredOrphan
        ? "orphan_new_tab_agent_window_retired"
        : "empty_created_agent_window_retired"
      : "window_remained_visible",
    window_id: windowId,
    anchor_tab_id: anchorTabId,
    recovered_orphan: recoveredOrphan,
    orphan_recovery_mode: recoveredOrphan ? inspection.close_mode : "none",
    ownership_record_removed: closeVerified,
    ownership_source: owned.source,
  };
}

async function browser67AgentWindowStatus() {
  const currentRecord = browser67AgentWindowIdentity(await browser67StoredAgentWindow());
  const current = currentRecord ? await browser67InspectOwnedAgentWindow(currentRecord) : null;
  const orphanRecords = await browser67StoredAgentWindowOrphans();
  const orphanRows = await Promise.all(orphanRecords.map(browser67InspectOwnedAgentWindow));
  return {
    status: current?.status || "not_owned",
    current_window_id: currentRecord?.window_id ?? null,
    current_anchor_tab_id: currentRecord?.anchor_tab_id ?? null,
    current_anchor_present: current?.anchor_present === true,
    owned_orphan_count: orphanRows.length,
    recoverable_owned_orphan_count: orphanRows.filter((row) => row.status === "recoverable_orphan").length,
    preserved_owned_orphan_count: orphanRows.filter((row) => row.status === "preserved_orphan").length,
    orphan_windows: orphanRows.map((row) => ({
      window_id: row.record?.window_id ?? null,
      status: row.status,
      reason: String(row.reason || ""),
      tab_count: row.tab_count,
      sole_browser_new_tab: row.sole_browser_new_tab === true,
      session_match: row.session_match === true,
    })),
    privacy: {
      user_tab_urls_returned: false,
      user_tab_titles_returned: false,
    },
  };
}

async function browser67EnsureAgentWindow() {
  if (browser67AgentWindowFlight) return browser67AgentWindowFlight;
  browser67AgentWindowFlight = browser67EnsureAgentWindowInternal();
  try {
    return await browser67AgentWindowFlight;
  } finally {
    browser67AgentWindowFlight = null;
  }
}

async function browser67CurrentFocus() {
  let windowRow = null;
  try {
    windowRow = await chrome.windows.getLastFocused({ populate: false });
  } catch {
    return { window_id: null, tab_id: null, browser_focused: false };
  }
  const windowId = browser67NumericId(windowRow?.id);
  if (windowId === null) return { window_id: null, tab_id: null, browser_focused: false };
  const activeTabs = await chrome.tabs.query({ active: true, windowId });
  return {
    window_id: windowId,
    tab_id: browser67NumericId(activeTabs[0]?.id),
    browser_focused: windowRow?.focused === true,
  };
}

async function browser67PersistFocusLease() {
  if (!browser67ActiveFocusLease) {
    await chrome.storage.local.remove(BROWSER67_FOCUS_LEASE_STORAGE_KEY);
    return;
  }
  await chrome.storage.local.set({
    [BROWSER67_FOCUS_LEASE_STORAGE_KEY]: browser67ActiveFocusLease,
  });
}

async function browser67LoadFocusLease() {
  if (browser67FocusLeaseLoaded) return browser67ActiveFocusLease;
  if (browser67FocusLeaseLoadFlight) return browser67FocusLeaseLoadFlight;
  browser67FocusLeaseLoadFlight = (async () => {
    const stored = await chrome.storage.local.get(BROWSER67_FOCUS_LEASE_STORAGE_KEY);
    const record = stored[BROWSER67_FOCUS_LEASE_STORAGE_KEY];
    if (record?.lease_id) {
      browser67ActiveFocusLease = {
        ...record,
        phase: "active",
        recovered_after_restart: true,
        user_activity_detected: true,
        user_activity_reason: "service_worker_restart",
      };
      await browser67PersistFocusLease();
    }
    browser67FocusLeaseLoaded = true;
    return browser67ActiveFocusLease;
  })();
  try {
    return await browser67FocusLeaseLoadFlight;
  } finally {
    browser67FocusLeaseLoadFlight = null;
  }
}

function browser67RunFocusCommand(operation) {
  const current = browser67FocusCommandFlight
    .catch(() => {})
    .then(operation);
  browser67FocusCommandFlight = current;
  return current;
}

function browser67FocusLeaseTtl(raw) {
  const value = Number(raw ?? BROWSER67_FOCUS_LEASE_DEFAULT_TTL_MS);
  return Math.min(
    BROWSER67_FOCUS_LEASE_MAX_TTL_MS,
    Math.max(1_000, Number.isFinite(value) ? value : BROWSER67_FOCUS_LEASE_DEFAULT_TTL_MS),
  );
}

function browser67PublicFocusLease(lease, extras = {}) {
  return {
    schema: "browser67.focus-lease.v1",
    lease_id: lease.lease_id,
    status: String(extras.status || lease.phase || "active"),
    target_tab_id: lease.target_tab_id,
    target_window_id: lease.target_window_id,
    restore_requested: lease.restore_requested === true,
    original_browser_focus_captured: lease.original_browser_focused === true,
    user_activity_detected: lease.user_activity_detected === true,
    user_activity_reason: lease.user_activity_reason || undefined,
    acquired_at: lease.acquired_at,
    expires_at: lease.expires_at,
    ...extras,
  };
}

async function browser67AcquireFocusLease(message) {
  const currentLease = await browser67LoadFocusLease();
  if (currentLease) {
    if (Date.parse(currentLease.expires_at || "") <= Date.now()) {
      await browser67ReleaseFocusLease({ leaseId: currentLease.lease_id, reason: "expired_before_acquire" });
    } else {
      const error = new Error("another browser67 focus lease is active");
      error.code = "FOCUS_LEASE_BUSY";
      throw error;
    }
  }
  const targetTabId = browser67NumericId(message.tabId);
  const targetTab = await browser67GetTab(targetTabId);
  if (!targetTab) {
    const error = new Error("focus lease target tab is unavailable");
    error.code = "TAB_NOT_FOUND";
    throw error;
  }
  const original = await browser67CurrentFocus();
  const ttlMs = browser67FocusLeaseTtl(message.ttlMs);
  const now = Date.now();
  const lease = {
    schema: "browser67.focus-lease.v1",
    lease_id: crypto.randomUUID(),
    phase: "acquiring",
    target_tab_id: targetTabId,
    target_window_id: targetTab.windowId,
    original_tab_id: original.tab_id,
    original_window_id: original.window_id,
    original_browser_focused: original.browser_focused === true,
    restore_requested: message.restore !== false,
    user_activity_detected: false,
    user_activity_reason: "",
    recovered_after_restart: false,
    acquired_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString(),
  };
  browser67ActiveFocusLease = lease;
  await browser67PersistFocusLease();
  try {
    await chrome.tabs.update(targetTabId, { active: true });
    await chrome.windows.update(targetTab.windowId, { focused: true });
    lease.phase = "active";
    await browser67PersistFocusLease();
    chrome.alarms.create(BROWSER67_FOCUS_LEASE_ALARM, { when: now + ttlMs });
    return browser67PublicFocusLease(lease, { status: "foregrounded" });
  } catch (error) {
    await browser67ReleaseFocusLease({
      leaseId: lease.lease_id,
      reason: "focus_acquire_failed",
    }).catch(() => {});
    throw error;
  }
}

async function browser67ReleaseFocusLease(message = {}) {
  const lease = await browser67LoadFocusLease();
  if (!lease) return { status: "not_active", restored: false };
  if (message.leaseId && message.leaseId !== lease.lease_id) {
    const error = new Error("focus lease id does not match the active lease");
    error.code = "FOCUS_LEASE_MISMATCH";
    throw error;
  }
  const current = await browser67CurrentFocus();
  const targetStillForeground = current.browser_focused === true
    && current.window_id === lease.target_window_id
    && current.tab_id === lease.target_tab_id;
  let restored = false;
  let status = "not_restored";
  let reason = "restore_not_requested";
  if (lease.restore_requested !== true) {
    status = "kept_foreground";
  } else if (lease.recovered_after_restart === true) {
    reason = "service_worker_restart";
  } else if (lease.user_activity_detected === true) {
    reason = lease.user_activity_reason || "user_activity_detected";
  } else if (!targetStillForeground) {
    reason = "foreground_changed";
  } else if (lease.original_browser_focused !== true) {
    reason = "original_browser_was_not_focused";
  } else {
    const [originalTab, originalWindow] = await Promise.all([
      browser67GetTab(lease.original_tab_id),
      browser67GetWindow(lease.original_window_id),
    ]);
    if (!originalTab || !originalWindow || originalTab.windowId !== originalWindow.id) {
      reason = "original_target_unavailable";
    } else {
      const beforeRestore = await browser67CurrentFocus();
      const targetStillForegroundBeforeRestore = beforeRestore.browser_focused === true
        && beforeRestore.window_id === lease.target_window_id
        && beforeRestore.tab_id === lease.target_tab_id;
      if (lease.user_activity_detected === true) {
        reason = lease.user_activity_reason || "user_activity_detected";
      } else if (!targetStillForegroundBeforeRestore) {
        reason = "foreground_changed_before_restore";
      } else {
        lease.phase = "restoring";
        await chrome.tabs.update(originalTab.id, { active: true });
        await chrome.windows.update(originalWindow.id, { focused: true });
        restored = true;
        status = "restored";
        reason = "original_browser_target_restored";
      }
    }
  }
  const result = browser67PublicFocusLease(lease, {
    status,
    restored,
    restore_reason: reason,
    released_at: new Date().toISOString(),
    release_reason: String(message.reason || "operation_complete"),
  });
  browser67ActiveFocusLease = null;
  await browser67PersistFocusLease();
  await chrome.alarms.clear(BROWSER67_FOCUS_LEASE_ALARM);
  return result;
}

async function browser67MarkFocusActivity(kind, value) {
  const lease = await browser67LoadFocusLease();
  if (!lease) return;
  if (kind === "tab" && value?.tabId === lease.target_tab_id && value?.windowId === lease.target_window_id) {
    return;
  }
  if (kind === "window" && value === lease.target_window_id) {
    return;
  }
  if (
    kind === "window"
    && value === chrome.windows.WINDOW_ID_NONE
    && (lease.phase === "acquiring" || lease.phase === "restoring")
  ) return;
  if (lease.phase === "restoring") {
    if (kind === "tab" && value?.tabId === lease.original_tab_id && value?.windowId === lease.original_window_id) return;
    if (kind === "window" && value === lease.original_window_id) return;
  }
  lease.user_activity_detected = true;
  lease.user_activity_reason = kind === "tab" ? "tab_activation_changed" : "window_focus_changed";
  await browser67PersistFocusLease();
}

async function browser67HandleWindowFocusCommand(message) {
  if (message?.cmd === "window") {
    const method = String(message.method || "");
    if (method === "ensure_agent_window") return browser67EnsureAgentWindow();
    if (method === "retire_agent_window") return browser67RetireAgentWindow(message);
    if (method === "status_agent_windows") return browser67AgentWindowStatus();
    throw new Error(`unsupported window method: ${method}`);
  }
  if (message?.cmd === "focus") {
    return browser67RunFocusCommand(async () => {
      const method = String(message.method || "status");
      if (method === "acquire") return browser67AcquireFocusLease(message);
      if (method === "release") return browser67ReleaseFocusLease(message);
      if (method === "status") {
        const lease = await browser67LoadFocusLease();
        return lease ? browser67PublicFocusLease(lease) : { status: "not_active" };
      }
      throw new Error(`unsupported focus method: ${method}`);
    });
  }
  return undefined;
}

globalThis.browser67HandleWindowFocusCommand = browser67HandleWindowFocusCommand;

chrome.tabs.onActivated.addListener((activeInfo) => {
  browser67MarkFocusActivity("tab", activeInfo).catch(() => {});
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  browser67MarkFocusActivity("window", windowId).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  browser67RotateAgentWindowSession().catch(() => {});
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const normalizedWindowId = browser67NumericId(windowId);
  const current = browser67AgentWindowIdentity(await browser67StoredAgentWindow());
  if (current?.window_id === normalizedWindowId) {
    await browser67RemoveStoredAgentWindow(current);
  }
  const orphans = await browser67StoredAgentWindowOrphans();
  await browser67PersistAgentWindowOrphans(
    orphans.filter((candidate) => candidate.window_id !== normalizedWindowId),
  );
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo = {}) => {
  const current = browser67AgentWindowIdentity(await browser67StoredAgentWindow());
  if (!current || current.anchor_tab_id !== browser67NumericId(tabId)) return;
  if (removeInfo.isWindowClosing === true) {
    await browser67RemoveStoredAgentWindow(current);
    return;
  }
  const removedWindowId = browser67NumericId(removeInfo.windowId);
  if (removedWindowId !== null && removedWindowId !== current.window_id) {
    await browser67RemoveStoredAgentWindow(current);
    return;
  }
  await browser67RememberAgentWindowOrphan(current, {
    anchor_state: "removed",
    anchor_removed_at: new Date().toISOString(),
    anchor_removed_window_id: current.window_id,
  });
  setTimeout(() => {
    browser67RecoverOwnedAgentWindowOrphans().catch(() => {});
  }, BROWSER67_AGENT_WINDOW_ORPHAN_RECOVERY_DELAY_MS);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo = {}, tab = {}) => {
  if (!changeInfo.url || changeInfo.url === browser67AnchorUrl()) return;
  const current = browser67AgentWindowIdentity(await browser67StoredAgentWindow());
  if (!current || current.anchor_tab_id !== browser67NumericId(tabId)) return;
  if (
    browser67NumericId(tab.windowId) === current.window_id
    && browser67IsBrowserNewTab({ ...tab, url: changeInfo.url })
  ) {
    await browser67RememberAgentWindowOrphan(current, {
      anchor_state: "replaced",
      anchor_removed_at: new Date().toISOString(),
      anchor_removed_window_id: current.window_id,
    });
    setTimeout(() => {
      browser67RecoverOwnedAgentWindowOrphans().catch(() => {});
    }, BROWSER67_AGENT_WINDOW_ORPHAN_RECOVERY_DELAY_MS);
    return;
  }
  await browser67RemoveStoredAgentWindow(current);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BROWSER67_FOCUS_LEASE_ALARM) {
    browser67RunFocusCommand(
      () => browser67ReleaseFocusLease({ reason: "lease_expired" }),
    ).catch(() => {});
  }
});

browser67RunFocusCommand(async () => {
  const lease = await browser67LoadFocusLease();
  if (!lease) return;
  const expiresAt = Date.parse(lease.expires_at || "");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await browser67ReleaseFocusLease({
      leaseId: lease.lease_id,
      reason: "expired_after_service_worker_restart",
    });
    return;
  }
  chrome.alarms.create(BROWSER67_FOCUS_LEASE_ALARM, { when: expiresAt });
}).catch(() => {});

setTimeout(() => {
  browser67ReconcileCurrentAgentWindow()
    .then(() => browser67RecoverOwnedAgentWindowOrphans())
    .catch(() => {});
}, BROWSER67_AGENT_WINDOW_ORPHAN_RECOVERY_DELAY_MS);
