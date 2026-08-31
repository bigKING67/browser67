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
  const restartContext = vm.createContext({
    chrome,
    console,
    Date,
    Map,
    Set,
    Promise,
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
  assert.equal(windowRows.has(agentWindow.data.window_id), false);

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
