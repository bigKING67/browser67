const BROWSER67_AGENT_WINDOW_STORAGE_KEY = "browser67.agent-window.v1";
const BROWSER67_FOCUS_LEASE_STORAGE_KEY = "browser67.focus-lease.v1";
const BROWSER67_FOCUS_LEASE_ALARM = "browser67-focus-lease-expiry";
const BROWSER67_FOCUS_LEASE_DEFAULT_TTL_MS = 30_000;
const BROWSER67_FOCUS_LEASE_MAX_TTL_MS = 120_000;

let browser67AgentWindowFlight = null;
let browser67ActiveFocusLease = null;
let browser67FocusLeaseLoaded = false;
let browser67FocusLeaseLoadFlight = null;
let browser67FocusCommandFlight = Promise.resolve();

function browser67NumericId(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function browser67AnchorUrl() {
  return chrome.runtime.getURL("browser67/window-anchor.html");
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
  return {
    schema: "browser67.agent-window.v1",
    window_id: windowId,
    anchor_tab_id: anchorTabId,
    created_at: String(record?.created_at || new Date().toISOString()),
    updated_at: new Date().toISOString(),
  };
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
  const stored = await browser67ValidateAgentWindow(await browser67StoredAgentWindow());
  const discovered = stored || await browser67DiscoverAgentWindow();
  if (discovered) {
    await browser67PersistAgentWindow(discovered);
    const windowRow = await browser67GetWindow(discovered.window_id);
    return {
      status: "ready",
      created: false,
      reused: true,
      focused: windowRow?.focused === true,
      ...discovered,
    };
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
  const record = {
    schema: "browser67.agent-window.v1",
    window_id: windowId,
    anchor_tab_id: anchorTabId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await browser67PersistAgentWindow(record);
  return {
    status: "ready",
    created: true,
    reused: false,
    focused: createdWindow?.focused === true,
    ...record,
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
    if (String(message.method || "") !== "ensure_agent_window") {
      throw new Error(`unsupported window method: ${String(message.method || "")}`);
    }
    return browser67EnsureAgentWindow();
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

chrome.windows.onRemoved.addListener(async (windowId) => {
  const stored = await browser67StoredAgentWindow();
  if (browser67NumericId(stored?.window_id) === browser67NumericId(windowId)) {
    await chrome.storage.local.remove(BROWSER67_AGENT_WINDOW_STORAGE_KEY);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const stored = await browser67StoredAgentWindow();
  if (browser67NumericId(stored?.anchor_tab_id) === browser67NumericId(tabId)) {
    await chrome.storage.local.remove(BROWSER67_AGENT_WINDOW_STORAGE_KEY);
  }
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
