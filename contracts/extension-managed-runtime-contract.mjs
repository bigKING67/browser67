#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { inspectReusableManagedTabPresentation } from "../src/browser-wrappers/presentation.mjs";
import {
  cleanupCreatedAgentWindow,
  createdAgentWindowCleanupCandidate,
} from "../src/browser-wrappers/tab-lifecycle-close.mjs";
import { managedWindowRecordFields } from "../src/tab-workspace/presentation.mjs";

function eventBus() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
    async emit(...args) {
      return Promise.all(listeners.map((listener) => listener(...args)));
    },
  };
}

function snapshotEventListeners(events) {
  return Object.fromEntries(
    Object.entries(events).map(([name, bus]) => [name, bus.listeners.length]),
  );
}

function restoreEventListeners(events, snapshot) {
  for (const [name, bus] of Object.entries(events)) {
    bus.listeners.length = snapshot[name];
  }
}

async function run() {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const windowFocusSource = readFileSync(resolve(
    repoRoot,
    "extension/browser67/window-focus-runtime.js",
  ), "utf8");
  const source = readFileSync(resolve(repoRoot, "extension/browser67/runtime.js"), "utf8");
  const storage = {};
  const sessionRuleCalls = [];
  const dynamicRuleCalls = [];
  const scriptCalls = [];
  const alarmsCreated = [];
  const tabQueryCalls = [];
  let platformOs = "mac";
  const anchorUrl = "chrome-extension://fixture/browser67/window-anchor.html";
  const tabRows = new Map([
    [11, { id: 11, windowId: 1, active: true, url: "https://user.fixture.test/work" }],
    [41, { id: 41, windowId: 2, active: true, url: "https://fixture.test/adopted" }],
    [42, { id: 42, windowId: 2, active: false, url: "https://fixture.test/other" }],
  ]);
  const windowRows = new Map([
    [1, { id: 1, focused: true, state: "normal", type: "normal" }],
    [2, { id: 2, focused: false, state: "normal", type: "normal" }],
  ]);
  let nextWindowId = 3;
  let nextTabId = 51;
  let beforeTabRemove = null;
  let lastTabReplacementCount = 0;
  const events = {
    before: eventBus(),
    completed: eventBus(),
    failed: eventBus(),
    tabUpdated: eventBus(),
    tabActivated: eventBus(),
    tabRemoved: eventBus(),
    windowFocusChanged: eventBus(),
    windowRemoved: eventBus(),
    alarm: eventBus(),
    runtimeStartup: eventBus(),
  };
  const chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: storage[key] };
        },
        async set(value) {
          Object.assign(storage, value);
        },
        async remove(key) {
          delete storage[key];
        },
      },
    },
    declarativeNetRequest: {
      async updateSessionRules(value) {
        sessionRuleCalls.push(value);
      },
      async updateDynamicRules(value) {
        dynamicRuleCalls.push(value);
      },
    },
    scripting: {
      async executeScript(value) {
        scriptCalls.push(value);
        return [{ frameId: 0, result: { ok: true } }];
      },
    },
    webRequest: {
      onBeforeRequest: events.before,
      onCompleted: events.completed,
      onErrorOccurred: events.failed,
    },
    tabs: {
      onUpdated: events.tabUpdated,
      onActivated: events.tabActivated,
      onRemoved: events.tabRemoved,
      async get(tabId) {
        const row = tabRows.get(Number(tabId));
        if (!row) throw new Error(`tab not found: ${String(tabId)}`);
        return { ...row };
      },
      async query(query = {}) {
        tabQueryCalls.push({ ...query });
        return [...tabRows.values()]
          .filter((row) => query.windowId === undefined || row.windowId === query.windowId)
          .filter((row) => query.active === undefined || row.active === query.active)
          .filter((row) => query.url === undefined || row.url === query.url)
          .map((row) => ({ ...row }));
      },
      async update(tabId, changes = {}) {
        const row = tabRows.get(Number(tabId));
        if (!row) throw new Error(`tab not found: ${String(tabId)}`);
        if (changes.active === true) {
          for (const candidate of tabRows.values()) {
            if (candidate.windowId === row.windowId) candidate.active = candidate.id === row.id;
          }
          await events.tabActivated.emit({ tabId: row.id, windowId: row.windowId });
        }
        Object.assign(row, changes);
        return { ...row };
      },
      async remove(tabId) {
        const normalized = Number(tabId);
        const row = tabRows.get(normalized);
        if (!row) throw new Error(`tab not found: ${String(tabId)}`);
        if (beforeTabRemove) await beforeTabRemove(normalized, { ...row });
        tabRows.delete(normalized);
        const hasRemainingTab = [...tabRows.values()]
          .some((tab) => tab.windowId === row.windowId);
        if (!hasRemainingTab && lastTabReplacementCount > 0) {
          lastTabReplacementCount -= 1;
          const replacementTabId = nextTabId;
          nextTabId += 1;
          tabRows.set(replacementTabId, {
            id: replacementTabId,
            windowId: row.windowId,
            active: true,
            url: "chrome://newtab/",
          });
        }
        const windowClosing = ![...tabRows.values()].some((tab) => tab.windowId === row.windowId);
        if (windowClosing) windowRows.delete(row.windowId);
        await events.tabRemoved.emit(normalized, {
          windowId: row.windowId,
          isWindowClosing: windowClosing,
        });
        if (windowClosing) await events.windowRemoved.emit(row.windowId);
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: events.windowFocusChanged,
      onRemoved: events.windowRemoved,
      async get(windowId, options = {}) {
        const row = windowRows.get(Number(windowId));
        if (!row) throw new Error(`window not found: ${String(windowId)}`);
        return {
          ...row,
          tabs: options.populate === true
            ? [...tabRows.values()].filter((tab) => tab.windowId === row.id).map((tab) => ({ ...tab }))
            : undefined,
        };
      },
      async getLastFocused() {
        const row = [...windowRows.values()].find((candidate) => candidate.focused)
          || [...windowRows.values()][0];
        return { ...row };
      },
      async create(options = {}) {
        const id = nextWindowId;
        nextWindowId += 1;
        const tabId = nextTabId;
        nextTabId += 1;
        const windowRow = {
          id,
          focused: options.focused === true,
          state: options.state || "normal",
          type: options.type || "normal",
        };
        const tabRow = { id: tabId, windowId: id, active: true, url: String(options.url || "") };
        windowRows.set(id, windowRow);
        tabRows.set(tabId, tabRow);
        return { ...windowRow, tabs: [{ ...tabRow }] };
      },
      async update(windowId, changes = {}) {
        const row = windowRows.get(Number(windowId));
        if (!row) throw new Error(`window not found: ${String(windowId)}`);
        if (changes.focused === true) {
          for (const candidate of windowRows.values()) candidate.focused = candidate.id === row.id;
          await events.windowFocusChanged.emit(row.id);
        }
        Object.assign(row, changes);
        return { ...row };
      },
      async remove(windowId) {
        const normalized = Number(windowId);
        if (!windowRows.has(normalized)) throw new Error(`window not found: ${String(windowId)}`);
        windowRows.delete(normalized);
        for (const [tabId, tab] of tabRows.entries()) {
          if (tab.windowId === normalized) tabRows.delete(tabId);
        }
        await events.windowRemoved.emit(normalized);
      },
    },
    runtime: {
      onStartup: events.runtimeStartup,
      async getPlatformInfo() {
        return { os: platformOs, arch: "arm64" };
      },
      getURL(path) {
        return `chrome-extension://fixture/${String(path)}`;
      },
    },
    alarms: {
      onAlarm: events.alarm,
      create(name, options) {
        alarmsCreated.push({ name, options });
      },
      async clear() {
        return true;
      },
    },
  };
  const context = vm.createContext({
    chrome,
    console,
    Date,
    Map,
    Set,
    Promise,
    setTimeout,
    clearTimeout,
    URL,
    navigator: {
      userAgent: "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
    },
    crypto: {
      randomUUID() {
        return `contract-lease-${String(Date.now())}`;
      },
    },
    globalThis: null,
  });
  context.globalThis = context;
  vm.runInContext(windowFocusSource, context, {
    filename: "extension/browser67/window-focus-runtime.js",
  });
  vm.runInContext(source, context, { filename: "extension/browser67/runtime.js" });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  const handle = context.browser67HandleCommand;
  assert.equal(typeof handle, "function");
  assert.equal(JSON.stringify(dynamicRuleCalls[0]), JSON.stringify({ removeRuleIds: [9999] }));

  const unmanaged = await handle({ cmd: "policy", method: "status", tabId: 41 });
  assert.equal(unmanaged.ok, true);
  assert.equal(unmanaged.data.managed, false);
  assert.equal(scriptCalls.length, 0);
  const unmanagedFocus = await handle({ cmd: "focus", method: "acquire", tabId: 41 });
  assert.equal(unmanagedFocus.ok, false);
  assert.equal(unmanagedFocus.errorCode, "MANAGED_TAB_REQUIRED");
  const agentWindow = await handle({ cmd: "window", method: "ensure_agent_window" });
  assert.equal(agentWindow.ok, true);
  assert.equal(agentWindow.data.created, true);
  assert.equal(typeof agentWindow.data.ownership_token, "string");
  assert.notEqual(agentWindow.data.ownership_token, "");
  assert.equal(agentWindow.data.focused, false);
  assert.equal(agentWindow.data.browser_family, "chrome");
  assert.equal(agentWindow.data.platform_os, "mac");
  assert.equal(agentWindow.data.presentation.mode, "macos_native_fullscreen_space");
  assert.equal(agentWindow.data.presentation.status, "native_required");
  assert.equal(agentWindow.data.presentation.native_action_required, true);
  assert.equal(agentWindow.data.presentation.toolbar_preserved, true);
  assert.equal(agentWindow.data.focus_snapshot.window_id, 1);
  assert.equal(agentWindow.data.focus_snapshot.tab_id, 11);
  assert.equal(agentWindow.data.focus_snapshot.browser_focused, true);
  assert.equal(tabRows.get(agentWindow.data.anchor_tab_id)?.url, anchorUrl);
  assert.equal(windowRows.get(1)?.focused, true);
  assert.equal(tabQueryCalls.some((query) => query.url === anchorUrl), true);
  const reusedAgentWindow = await handle({ cmd: "window", method: "ensure_agent_window" });
  assert.equal(reusedAgentWindow.data.reused, true);
  assert.equal(reusedAgentWindow.data.window_id, agentWindow.data.window_id);
  platformOs = "win";
  const windowsAgentWindow = await handle({ cmd: "window", method: "ensure_agent_window" });
  assert.equal(windowsAgentWindow.data.presentation.mode, "windows_maximized");
  assert.equal(windowsAgentWindow.data.presentation.status, "ready");
  assert.equal(windowsAgentWindow.data.presentation.native_action_required, false);
  assert.equal(windowsAgentWindow.data.presentation.toolbar_preserved, true);
  assert.equal(windowRows.get(agentWindow.data.window_id)?.state, "maximized");
  platformOs = "mac";
  const unmanagedObservation = await handle({
    cmd: "network",
    method: "observe",
    tabId: 41,
    observationId: "unmanaged-observation",
  });
  assert.equal(unmanagedObservation.ok, false);
  assert.match(unmanagedObservation.error, /requires a managed tab policy/);

  const applied = await handle({
    cmd: "policy",
    method: "apply",
    tabId: 41,
    ownershipGeneration: "ownership-1",
    leaseId: "lease-1",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    policy: {
      csp_override: "on",
      dialog: "capture",
      badge: "managed",
      marker: "managed",
    },
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.data.managed, true);
  assert.equal(applied.data.content_bridge, true);
  assert.equal(applied.data.navigation_generation, 0);
  assert.equal(JSON.stringify(sessionRuleCalls.at(-1).addRules[0].condition.tabIds), "[41]");
  assert.equal(scriptCalls.some((call) => call.world === "MAIN"), true);
  assert.equal(scriptCalls.some((call) => call.world === "ISOLATED"), true);
  assert.equal(alarmsCreated.some((alarm) => alarm.name === "browser67-policy-expiry"), true);

  const focusLease = await handle({
    cmd: "focus",
    method: "acquire",
    tabId: 41,
    restore: true,
    ttlMs: 5_000,
  });
  assert.equal(focusLease.ok, true);
  assert.equal(focusLease.data.status, "foregrounded");
  assert.equal(windowRows.get(2)?.focused, true);
  assert.equal(tabRows.get(41)?.active, true);
  const focusRelease = await handle({
    cmd: "focus",
    method: "release",
    leaseId: focusLease.data.lease_id,
  });
  assert.equal(focusRelease.ok, true);
  assert.equal(focusRelease.data.status, "restored");
  assert.equal(focusRelease.data.restored, true);
  assert.equal(windowRows.get(1)?.focused, true);
  assert.equal(tabRows.get(11)?.active, true);

  const intentionalForegroundLease = await handle({
    cmd: "focus",
    method: "acquire",
    tabId: 41,
    restore: false,
  });
  const intentionalForegroundRelease = await handle({
    cmd: "focus",
    method: "release",
    leaseId: intentionalForegroundLease.data.lease_id,
  });
  assert.equal(intentionalForegroundRelease.data.status, "kept_foreground");
  assert.equal(intentionalForegroundRelease.data.restored, false);
  assert.equal(windowRows.get(2)?.focused, true);
  await chrome.windows.update(1, { focused: true });

  const concurrentFocusResults = await Promise.all([
    handle({
      cmd: "focus",
      method: "acquire",
      tabId: 41,
      restore: true,
    }),
    handle({
      cmd: "focus",
      method: "acquire",
      tabId: 41,
      restore: true,
    }),
  ]);
  const concurrentFocusSuccess = concurrentFocusResults.filter((result) => result.ok === true);
  const concurrentFocusBusy = concurrentFocusResults.filter((result) => result.errorCode === "FOCUS_LEASE_BUSY");
  assert.equal(concurrentFocusSuccess.length, 1);
  assert.equal(concurrentFocusBusy.length, 1);
  const concurrentFocusRelease = await handle({
    cmd: "focus",
    method: "release",
    leaseId: concurrentFocusSuccess[0].data.lease_id,
  });
  assert.equal(concurrentFocusRelease.ok, true);
  assert.equal(concurrentFocusRelease.data.restored, true);

  const externalAppFocusLease = await handle({
    cmd: "focus",
    method: "acquire",
    tabId: 41,
    restore: true,
  });
  await events.windowFocusChanged.emit(chrome.windows.WINDOW_ID_NONE);
  const externalAppFocusRelease = await handle({
    cmd: "focus",
    method: "release",
    leaseId: externalAppFocusLease.data.lease_id,
  });
  assert.equal(externalAppFocusRelease.data.restored, false);
  assert.equal(externalAppFocusRelease.data.restore_reason, "window_focus_changed");
  await chrome.windows.update(1, { focused: true });

  const userActivityLease = await handle({
    cmd: "focus",
    method: "acquire",
    tabId: 41,
    restore: true,
  });
  await chrome.tabs.update(42, { active: true });
  const userActivityRelease = await handle({
    cmd: "focus",
    method: "release",
    leaseId: userActivityLease.data.lease_id,
  });
  assert.equal(userActivityRelease.data.restored, false);
  assert.equal(userActivityRelease.data.restore_reason, "tab_activation_changed");
  assert.equal(tabRows.get(42)?.active, true);

  const restartLease = await handle({
    cmd: "focus",
    method: "acquire",
    tabId: 41,
    restore: true,
  });
  const restartListenerSnapshot = snapshotEventListeners(events);
  const restartContext = vm.createContext({
    chrome,
    console,
    Date,
    Map,
    Set,
    Promise,
    setTimeout,
    clearTimeout,
    URL,
    crypto: context.crypto,
    globalThis: null,
  });
  restartContext.globalThis = restartContext;
  vm.runInContext(windowFocusSource, restartContext, {
    filename: "extension/browser67/window-focus-runtime-restart.js",
  });
  vm.runInContext(source, restartContext, {
    filename: "extension/browser67/runtime-restart.js",
  });
  const restartRelease = await restartContext.browser67HandleCommand({
    cmd: "focus",
    method: "release",
    leaseId: restartLease.data.lease_id,
  });
  assert.equal(restartRelease.data.restored, false);
  assert.equal(restartRelease.data.restore_reason, "service_worker_restart");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 600));
  restoreEventListeners(events, restartListenerSnapshot);

  const presentationMatch = await inspectReusableManagedTabPresentation(
    { window_policy: "dedicated" },
    { window_id: 3 },
    { tab_id: "41" },
    async () => ({ value: { id: 41, windowId: 3, active: false } }),
  );
  assert.equal(presentationMatch.reusable, true);
  assert.equal(presentationMatch.reason, "agent_window_match");
  const presentationMoved = await inspectReusableManagedTabPresentation(
    { window_policy: "dedicated" },
    { window_id: 3 },
    { tab_id: "41" },
    async () => ({ value: { id: 41, windowId: 2, active: false } }),
  );
  assert.equal(presentationMoved.reusable, false);
  assert.equal(presentationMoved.reason, "outside_agent_window");
  assert.equal(presentationMoved.record_action, "quarantine");
  const presentationMissing = await inspectReusableManagedTabPresentation(
    { window_policy: "dedicated" },
    { window_id: 3 },
    { tab_id: "41" },
    async () => {
      throw new Error("No tab with id: 41");
    },
  );
  assert.equal(presentationMissing.reusable, false);
  assert.equal(presentationMissing.record_action, "delete");

  const authorization = await handle({
    cmd: "policy",
    method: "authorize_navigation",
    tabId: 41,
    ownershipGeneration: "ownership-1",
    leaseId: "lease-1",
    authorizationId: "navigation-1",
    authorizedUntil: new Date(Date.now() + 5_000).toISOString(),
    reason: "contract_navigation",
  });
  assert.equal(authorization.ok, true);
  assert.equal(authorization.data.navigation_authorization_id, "navigation-1");
  tabRows.get(41).url = "https://fixture.test/agent-navigation";
  await events.tabUpdated.emit(41, { status: "loading", url: tabRows.get(41).url });
  await events.tabUpdated.emit(41, { status: "complete" });
  const authorizedNavigation = await handle({ cmd: "policy", method: "status", tabId: 41 });
  assert.equal(authorizedNavigation.data.navigation_generation, 1);
  assert.equal(authorizedNavigation.data.last_navigation_actor, "agent_authorized");
  assert.equal(authorizedNavigation.data.last_navigation_authorization_id, "navigation-1");
  assert.equal(authorizedNavigation.data.last_navigation_url, tabRows.get(41).url);

  const renewed = await handle({
    cmd: "policy",
    method: "apply",
    tabId: 41,
    ownershipGeneration: "ownership-1",
    leaseId: "lease-1",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    policy: applied.data.policy,
  });
  assert.equal(renewed.data.navigation_generation, 1);

  tabRows.get(41).url = "https://fixture.test/user-navigation";
  await events.tabUpdated.emit(41, { status: "loading", url: tabRows.get(41).url });
  await events.tabUpdated.emit(41, { status: "complete" });
  const outOfBandNavigation = await handle({ cmd: "policy", method: "status", tabId: 41 });
  assert.equal(outOfBandNavigation.data.navigation_generation, 2);
  assert.equal(outOfBandNavigation.data.last_navigation_actor, "out_of_band");

  const observation = await handle({
    cmd: "network",
    method: "observe",
    tabId: 41,
    observationId: "observation-1",
    ignorePatterns: ["analytics"],
    ignoreResourceTypes: ["websocket"],
  });
  assert.equal(observation.ok, true);
  await events.before.emit({ tabId: 41, requestId: "request-1", type: "xmlhttprequest", url: "https://fixture.test/api" });
  await events.before.emit({ tabId: 41, requestId: "request-2", type: "image", url: "https://fixture.test/analytics.gif" });
  const inflight = await handle({ cmd: "network", method: "status", tabId: 41, observationId: "observation-1" });
  assert.equal(inflight.data.inflight_count, 1);
  assert.equal(inflight.data.observed_count, 2);
  assert.equal(inflight.data.ignored_count, 1);
  await events.completed.emit({ tabId: 41, requestId: "request-1" });
  const completed = await handle({ cmd: "network", method: "status", tabId: 41, observationId: "observation-1" });
  assert.equal(completed.data.inflight_count, 0);
  assert.equal(completed.data.completed_count, 1);
  const stopped = await handle({ cmd: "network", method: "unobserve", tabId: 41, observationId: "observation-1" });
  assert.equal(stopped.data.observing, false);

  const released = await handle({ cmd: "policy", method: "release", tabId: 41 });
  assert.equal(released.ok, true);
  assert.equal(released.data.managed, false);
  assert.equal(JSON.stringify(sessionRuleCalls.at(-1).addRules), "[]");
  const releasedStatus = await handle({ cmd: "policy", method: "status", tabId: 41 });
  assert.equal(releasedStatus.data.managed, false);

  storage["browser67.managed-tab-policies.v1"] = [{
    tab_id: 42,
    ownership_generation: "expired-ownership",
    lease_id: "expired-lease",
    lease_expires_at: "2026-01-01T00:00:00.000Z",
    policy: { csp_override: "off", dialog: "native", badge: "managed", marker: "managed" },
  }];
  const expiredPolicyListenerSnapshot = snapshotEventListeners(events);
  const expiredPolicyContext = vm.createContext({
    chrome,
    console,
    Date,
    Map,
    Set,
    Promise,
    setTimeout,
    clearTimeout,
    URL,
    crypto: context.crypto,
    globalThis: null,
  });
  expiredPolicyContext.globalThis = expiredPolicyContext;
  vm.runInContext(windowFocusSource, expiredPolicyContext, {
    filename: "extension/browser67/window-focus-runtime-expired-policy.js",
  });
  vm.runInContext(source, expiredPolicyContext, {
    filename: "extension/browser67/runtime-expired-policy.js",
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.equal(
    storage["browser67.managed-tab-policies.v1"].some((record) => record.tab_id === 42),
    false,
  );
  restoreEventListeners(events, expiredPolicyListenerSnapshot);

  const mismatchedRetirement = await handle({
    cmd: "window",
    method: "retire_agent_window",
    windowId: agentWindow.data.window_id,
    anchorTabId: agentWindow.data.anchor_tab_id,
    ownershipToken: "wrong-window-token",
  });
  assert.equal(mismatchedRetirement.data.status, "preserved");
  assert.equal(mismatchedRetirement.data.reason, "agent_window_identity_mismatch");
  assert.equal(windowRows.has(agentWindow.data.window_id), true);

  tabRows.set(88, {
    id: 88,
    windowId: agentWindow.data.window_id,
    active: false,
    url: "https://user.fixture.test/preserved",
  });
  const nonemptyRetirement = await handle({
    cmd: "window",
    method: "retire_agent_window",
    windowId: agentWindow.data.window_id,
    anchorTabId: agentWindow.data.anchor_tab_id,
    ownershipToken: agentWindow.data.ownership_token,
  });
  assert.equal(nonemptyRetirement.data.status, "preserved");
  assert.equal(nonemptyRetirement.data.reason, "agent_window_not_empty");
  assert.equal(nonemptyRetirement.data.user_content_preserved, true);
  assert.equal(windowRows.has(agentWindow.data.window_id), true);
  tabRows.delete(88);

  const emptyRetirement = await handle({
    cmd: "window",
    method: "retire_agent_window",
    windowId: agentWindow.data.window_id,
    anchorTabId: agentWindow.data.anchor_tab_id,
    ownershipToken: agentWindow.data.ownership_token,
  });
  assert.equal(emptyRetirement.data.status, "closed");
  assert.equal(emptyRetirement.data.closed, true);
  assert.equal(emptyRetirement.data.close_verified, true);
  assert.equal(emptyRetirement.data.ownership_record_removed, true);
  assert.equal(windowRows.has(agentWindow.data.window_id), false);

  const concurrentUserTabAgentWindow = await handle({
    cmd: "window",
    method: "ensure_agent_window",
  });
  beforeTabRemove = async (_tabId, tab) => {
    beforeTabRemove = null;
    tabRows.set(87, {
      id: 87,
      windowId: tab.windowId,
      active: true,
      url: "https://user.fixture.test/arrived-during-retirement",
    });
  };
  const concurrentUserTabRetirement = await handle({
    cmd: "window",
    method: "retire_agent_window",
    windowId: concurrentUserTabAgentWindow.data.window_id,
    anchorTabId: concurrentUserTabAgentWindow.data.anchor_tab_id,
    ownershipToken: concurrentUserTabAgentWindow.data.ownership_token,
  });
  assert.equal(concurrentUserTabRetirement.data.status, "preserved");
  assert.equal(concurrentUserTabRetirement.data.closed, false);
  assert.equal(concurrentUserTabRetirement.data.reason, "concurrent_user_content_preserved");
  assert.equal(concurrentUserTabRetirement.data.internal_tab_removed, true);
  assert.equal(concurrentUserTabRetirement.data.user_content_preserved, true);
  assert.equal(concurrentUserTabRetirement.data.ownership_record_removed, true);
  assert.equal(windowRows.has(concurrentUserTabAgentWindow.data.window_id), true);
  assert.equal(tabRows.has(87), true);
  const concurrentUserTabStatus = await handle({
    cmd: "window",
    method: "status_agent_windows",
  });
  assert.equal(concurrentUserTabStatus.data.status, "not_owned");
  assert.equal(concurrentUserTabStatus.data.owned_orphan_count, 0);
  await chrome.windows.remove(concurrentUserTabAgentWindow.data.window_id);

  const successorNewTabAgentWindow = await handle({
    cmd: "window",
    method: "ensure_agent_window",
  });
  lastTabReplacementCount = 1;
  const successorNewTabRetirement = await handle({
    cmd: "window",
    method: "retire_agent_window",
    windowId: successorNewTabAgentWindow.data.window_id,
    anchorTabId: successorNewTabAgentWindow.data.anchor_tab_id,
    ownershipToken: successorNewTabAgentWindow.data.ownership_token,
  });
  assert.equal(successorNewTabRetirement.data.status, "closed");
  assert.equal(successorNewTabRetirement.data.closed, true);
  assert.equal(successorNewTabRetirement.data.close_verified, true);
  assert.equal(successorNewTabRetirement.data.internal_tab_removed, true);
  assert.equal(successorNewTabRetirement.data.ownership_record_removed, true);
  assert.equal(windowRows.has(successorNewTabAgentWindow.data.window_id), false);
  assert.equal(
    [...tabRows.values()].some((tab) => tab.windowId === successorNewTabAgentWindow.data.window_id),
    false,
  );

  const boundedReplacementAgentWindow = await handle({
    cmd: "window",
    method: "ensure_agent_window",
  });
  lastTabReplacementCount = 4;
  const boundedReplacementRetirement = await handle({
    cmd: "window",
    method: "retire_agent_window",
    windowId: boundedReplacementAgentWindow.data.window_id,
    anchorTabId: boundedReplacementAgentWindow.data.anchor_tab_id,
    ownershipToken: boundedReplacementAgentWindow.data.ownership_token,
  });
  assert.equal(boundedReplacementRetirement.data.status, "close_unverified");
  assert.equal(boundedReplacementRetirement.data.closed, false);
  assert.equal(boundedReplacementRetirement.data.close_verified, false);
  assert.equal(
    boundedReplacementRetirement.data.reason,
    "agent_window_internal_new_tab_replacement_limit_reached",
  );
  assert.equal(boundedReplacementRetirement.data.ownership_record_removed, false);
  assert.equal(windowRows.has(boundedReplacementAgentWindow.data.window_id), true);
  const boundedReplacementStatus = await handle({
    cmd: "window",
    method: "status_agent_windows",
  });
  assert.equal(boundedReplacementStatus.data.status, "not_owned");
  assert.equal(boundedReplacementStatus.data.owned_orphan_count, 1);
  assert.equal(boundedReplacementStatus.data.recoverable_owned_orphan_count, 1);
  lastTabReplacementCount = 0;
  const boundedReplacementCleanup = await handle({
    cmd: "window",
    method: "retire_agent_window",
    windowId: boundedReplacementAgentWindow.data.window_id,
    anchorTabId: boundedReplacementAgentWindow.data.anchor_tab_id,
    ownershipToken: boundedReplacementAgentWindow.data.ownership_token,
  });
  assert.equal(boundedReplacementCleanup.data.status, "closed");
  assert.equal(boundedReplacementCleanup.data.close_verified, true);
  assert.equal(boundedReplacementCleanup.data.ownership_record_removed, true);
  assert.equal(windowRows.has(boundedReplacementAgentWindow.data.window_id), false);

  const extensionReloadAgentWindow = await handle({
    cmd: "window",
    method: "ensure_agent_window",
  });
  const extensionReloadWindowId = extensionReloadAgentWindow.data.window_id;
  const extensionReloadAnchorTabId = extensionReloadAgentWindow.data.anchor_tab_id;
  tabRows.get(extensionReloadAnchorTabId).url = "chrome://newtab/";
  const extensionReloadListenerSnapshot = snapshotEventListeners(events);
  const extensionReloadContext = vm.createContext({
    chrome,
    console,
    Date,
    Map,
    Set,
    Promise,
    setTimeout,
    clearTimeout,
    URL,
    crypto: context.crypto,
    globalThis: null,
  });
  extensionReloadContext.globalThis = extensionReloadContext;
  vm.runInContext(windowFocusSource, extensionReloadContext, {
    filename: "extension/browser67/window-focus-runtime-extension-reload.js",
  });
  vm.runInContext(source, extensionReloadContext, {
    filename: "extension/browser67/runtime-extension-reload.js",
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 600));
  assert.equal(windowRows.has(extensionReloadWindowId), false);
  const extensionReloadStatus = await extensionReloadContext.browser67HandleCommand({
    cmd: "window",
    method: "status_agent_windows",
  });
  assert.equal(extensionReloadStatus.data.status, "not_owned");
  restoreEventListeners(events, extensionReloadListenerSnapshot);

  const coldStartAgentWindow = await handle({
    cmd: "window",
    method: "ensure_agent_window",
  });
  const coldStartWindowId = coldStartAgentWindow.data.window_id;
  const coldStartAnchorTabId = coldStartAgentWindow.data.anchor_tab_id;
  tabRows.get(coldStartAnchorTabId).url = "chrome://newtab/";
  await events.runtimeStartup.emit();
  const coldStartListenerSnapshot = snapshotEventListeners(events);
  const coldStartContext = vm.createContext({
    chrome,
    console,
    Date,
    Map,
    Set,
    Promise,
    setTimeout,
    clearTimeout,
    URL,
    crypto: context.crypto,
    globalThis: null,
  });
  coldStartContext.globalThis = coldStartContext;
  vm.runInContext(windowFocusSource, coldStartContext, {
    filename: "extension/browser67/window-focus-runtime-cold-start.js",
  });
  vm.runInContext(source, coldStartContext, {
    filename: "extension/browser67/runtime-cold-start.js",
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 600));
  assert.equal(windowRows.has(coldStartWindowId), true);
  const coldStartStatus = await coldStartContext.browser67HandleCommand({
    cmd: "window",
    method: "status_agent_windows",
  });
  assert.equal(coldStartStatus.data.status, "not_owned");
  restoreEventListeners(events, coldStartListenerSnapshot);
  await chrome.windows.remove(coldStartWindowId);

  const exactOrphanAgentWindow = await handle({
    cmd: "window",
    method: "ensure_agent_window",
  });
  const exactOrphanWindowId = exactOrphanAgentWindow.data.window_id;
  const exactOrphanAnchorTabId = exactOrphanAgentWindow.data.anchor_tab_id;
  tabRows.set(89, {
    id: 89,
    windowId: exactOrphanWindowId,
    active: true,
    url: "chrome://newtab/",
  });
  tabRows.delete(exactOrphanAnchorTabId);
  await events.tabRemoved.emit(exactOrphanAnchorTabId, {
    windowId: exactOrphanWindowId,
    isWindowClosing: false,
  });
  const exactOrphanStatus = await handle({
    cmd: "window",
    method: "status_agent_windows",
  });
  assert.equal(exactOrphanStatus.data.owned_orphan_count, 1);
  assert.equal(exactOrphanStatus.data.recoverable_owned_orphan_count, 1);
  assert.equal(exactOrphanStatus.data.privacy.user_tab_urls_returned, false);
  const exactOrphanRetirement = await handle({
    cmd: "window",
    method: "retire_agent_window",
    windowId: exactOrphanWindowId,
    anchorTabId: exactOrphanAnchorTabId,
    ownershipToken: exactOrphanAgentWindow.data.ownership_token,
  });
  assert.equal(exactOrphanRetirement.data.status, "closed");
  assert.equal(exactOrphanRetirement.data.recovered_orphan, true);
  assert.equal(
    exactOrphanRetirement.data.orphan_recovery_mode,
    "sole_browser_new_tab_after_anchor_loss",
  );
  assert.equal(exactOrphanRetirement.data.ownership_record_removed, true);
  assert.equal(windowRows.has(exactOrphanWindowId), false);

  const automaticOrphanAgentWindow = await handle({
    cmd: "window",
    method: "ensure_agent_window",
  });
  const automaticOrphanWindowId = automaticOrphanAgentWindow.data.window_id;
  const automaticOrphanAnchorTabId = automaticOrphanAgentWindow.data.anchor_tab_id;
  tabRows.get(automaticOrphanAnchorTabId).url = "chrome-search://local-ntp/local-ntp.html";
  await events.tabUpdated.emit(
    automaticOrphanAnchorTabId,
    { url: "chrome-search://local-ntp/local-ntp.html" },
    { ...tabRows.get(automaticOrphanAnchorTabId) },
  );
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 600));
  assert.equal(windowRows.has(automaticOrphanWindowId), false);
  const automaticOrphanStatus = await handle({
    cmd: "window",
    method: "status_agent_windows",
  });
  assert.equal(automaticOrphanStatus.data.owned_orphan_count, 0);

  const missedEventAgentWindow = await handle({
    cmd: "window",
    method: "ensure_agent_window",
  });
  const missedEventWindowId = missedEventAgentWindow.data.window_id;
  const missedEventAnchorTabId = missedEventAgentWindow.data.anchor_tab_id;
  tabRows.get(missedEventAnchorTabId).url = "chrome://newtab/";
  const postMissedEventAgentWindow = await handle({
    cmd: "window",
    method: "ensure_agent_window",
  });
  assert.equal(windowRows.has(missedEventWindowId), false);
  assert.notEqual(postMissedEventAgentWindow.data.window_id, missedEventWindowId);
  const postMissedEventRetirement = await handle({
    cmd: "window",
    method: "retire_agent_window",
    windowId: postMissedEventAgentWindow.data.window_id,
    anchorTabId: postMissedEventAgentWindow.data.anchor_tab_id,
    ownershipToken: postMissedEventAgentWindow.data.ownership_token,
  });
  assert.equal(postMissedEventRetirement.data.status, "closed");

  const userContentAgentWindow = await handle({
    cmd: "window",
    method: "ensure_agent_window",
  });
  const userContentWindowId = userContentAgentWindow.data.window_id;
  const userContentAnchorTabId = userContentAgentWindow.data.anchor_tab_id;
  tabRows.set(91, {
    id: 91,
    windowId: userContentWindowId,
    active: true,
    url: "https://user.fixture.test/preserved-after-anchor",
  });
  tabRows.delete(userContentAnchorTabId);
  await events.tabRemoved.emit(userContentAnchorTabId, {
    windowId: userContentWindowId,
    isWindowClosing: false,
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 600));
  assert.equal(windowRows.has(userContentWindowId), true);
  const preservedOrphanRetirement = await handle({
    cmd: "window",
    method: "retire_agent_window",
    windowId: userContentWindowId,
    anchorTabId: userContentAnchorTabId,
    ownershipToken: userContentAgentWindow.data.ownership_token,
  });
  assert.equal(preservedOrphanRetirement.data.status, "preserved");
  assert.equal(preservedOrphanRetirement.data.reason, "agent_window_orphan_content_preserved");
  assert.equal(preservedOrphanRetirement.data.user_content_preserved, true);
  assert.equal(windowRows.has(userContentWindowId), true);
  await chrome.windows.remove(userContentWindowId);

  const unmanagedNewTabWindow = await chrome.windows.create({
    url: "chrome://newtab/",
    focused: false,
    type: "normal",
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 600));
  assert.equal(windowRows.has(unmanagedNewTabWindow.id), true);

  const managedWindowFields = managedWindowRecordFields(
    { window_policy: "dedicated", focus_policy: "background_preferred" },
    agentWindow.data,
    { window_id: agentWindow.data.window_id },
  );
  assert.equal(managedWindowFields.agent_window_created, true);
  assert.equal(managedWindowFields.agent_window_ownership_token, agentWindow.data.ownership_token);
  const cleanupCandidate = createdAgentWindowCleanupCandidate([{
    ownership_origin: "agent_created",
    window_ownership: "browser67_agent",
    browser_instance_id: "browser-instance-contract",
    ...managedWindowFields,
  }]);
  assert.equal(cleanupCandidate.eligible, true);
  assert.equal(cleanupCandidate.window_id, agentWindow.data.window_id);
  const finalizerCleanup = await cleanupCreatedAgentWindow(
    { cleanup_created_agent_window: true },
    cleanupCandidate,
    {
      list_managed_tab_records: async () => [],
      run_agent_window_command: async (command) => ({
        value: {
          data: {
            status: "closed",
            closed: true,
            close_verified: true,
            reason: "empty_created_agent_window_retired",
            ownership_record_removed: true,
          },
        },
        transport: "tmwd_ws",
        transport_attempts: [{ transport: "ws", status: "ok" }],
        command,
      }),
    },
  );
  assert.equal(finalizerCleanup.status, "closed");
  assert.equal(finalizerCleanup.closed, true);
  assert.equal(finalizerCleanup.close_verified, true);
  assert.equal(finalizerCleanup.ownership_record_removed, true);
  const reusedWindowCandidate = createdAgentWindowCleanupCandidate([{
    ownership_origin: "agent_created",
    window_ownership: "browser67_agent",
    browser_instance_id: "browser-instance-contract",
    ...managedWindowFields,
    agent_window_created: false,
  }]);
  assert.equal(reusedWindowCandidate.eligible, false);
  assert.equal(reusedWindowCandidate.reason, "no_task_created_agent_window_identity");
  const reusedWindowCleanup = await cleanupCreatedAgentWindow(
    { cleanup_created_agent_window: true },
    reusedWindowCandidate,
  );
  assert.equal(reusedWindowCleanup.status, "not_owned");
  assert.equal(reusedWindowCleanup.closed, false);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "extension-managed-runtime-contract",
    ordinary_tab_side_effects: 0,
    tab_scoped_csp: true,
    managed_policy_apply_release: true,
    managed_network_lifecycle: true,
    managed_navigation_authorization: true,
    out_of_band_navigation_observable: true,
    dedicated_agent_window: true,
    exact_agent_window_retirement: true,
    concurrent_user_tab_retirement_preserved: true,
    successor_new_tab_retirement: true,
    bounded_new_tab_replacement_retains_ownership: true,
    extension_reload_epoch_recovery: true,
    cold_browser_start_preserves_prior_epoch_window: true,
    exact_owned_orphan_new_tab_recovery: true,
    automatic_same_tab_agent_anchor_replacement_recovery: true,
    missed_event_same_tab_recovery: true,
    unmanaged_new_tab_window_preserved: true,
    nonempty_agent_window_preserved: true,
    focus_restore: true,
    user_activity_restore_guard: true,
      restart_restore_guard: true,
      dedicated_reuse_window_guard: true,
    })}\n`);
}

run().catch((error) => {
  process.stderr.write(`extension-managed-runtime-contract failed: ${error?.stack || String(error)}\n`);
  process.exitCode = 1;
});
