#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

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
  const source = readFileSync(resolve(
    fileURLToPath(new URL("..", import.meta.url)),
    "extension/browser67/runtime.js",
  ), "utf8");
  const storage = {};
  const sessionRuleCalls = [];
  const dynamicRuleCalls = [];
  const scriptCalls = [];
  const alarmsCreated = [];
  const tabUrls = new Map([[41, "https://fixture.test/adopted"]]);
  const events = {
    before: eventBus(),
    completed: eventBus(),
    failed: eventBus(),
    tabUpdated: eventBus(),
    tabRemoved: eventBus(),
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
      onRemoved: events.tabRemoved,
      async get(tabId) {
        return { id: tabId, url: tabUrls.get(tabId) || "" };
      },
    },
    alarms: {
      onAlarm: events.alarm,
      create(name, options) {
        alarmsCreated.push({ name, options });
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
    globalThis: null,
  });
  context.globalThis = context;
  vm.runInContext(source, context, { filename: "extension/browser67/runtime.js" });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  const handle = context.browser67HandleCommand;
  assert.equal(typeof handle, "function");
  assert.equal(JSON.stringify(dynamicRuleCalls[0]), JSON.stringify({ removeRuleIds: [9999] }));

  const unmanaged = await handle({ cmd: "policy", method: "status", tabId: 41 });
  assert.equal(unmanaged.ok, true);
  assert.equal(unmanaged.data.managed, false);
  assert.equal(scriptCalls.length, 0);
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
  tabUrls.set(41, "https://fixture.test/agent-navigation");
  await events.tabUpdated.emit(41, { status: "loading", url: tabUrls.get(41) });
  await events.tabUpdated.emit(41, { status: "complete" });
  const authorizedNavigation = await handle({ cmd: "policy", method: "status", tabId: 41 });
  assert.equal(authorizedNavigation.data.navigation_generation, 1);
  assert.equal(authorizedNavigation.data.last_navigation_actor, "agent_authorized");
  assert.equal(authorizedNavigation.data.last_navigation_authorization_id, "navigation-1");
  assert.equal(authorizedNavigation.data.last_navigation_url, tabUrls.get(41));

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

  tabUrls.set(41, "https://fixture.test/user-navigation");
  await events.tabUpdated.emit(41, { status: "loading", url: tabUrls.get(41) });
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

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "extension-managed-runtime-contract",
    ordinary_tab_side_effects: 0,
    tab_scoped_csp: true,
    managed_policy_apply_release: true,
    managed_network_lifecycle: true,
    managed_navigation_authorization: true,
    out_of_band_navigation_observable: true,
  })}\n`);
}

run().catch((error) => {
  process.stderr.write(`extension-managed-runtime-contract failed: ${error?.stack || String(error)}\n`);
  process.exitCode = 1;
});
