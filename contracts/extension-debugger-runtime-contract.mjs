#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(repoRoot, "extension/browser67/debugger-runtime.js"), "utf8");

function createRuntime(debuggerApi) {
  const context = vm.createContext({
    chrome: { debugger: debuggerApi },
    console,
    Date,
    Error,
    Map,
    Promise,
    Set,
    clearTimeout,
    setTimeout,
    structuredClone,
  });
  context.globalThis = context;
  context.browser67ResolveBatchReferences = (value) => structuredClone(value);
  vm.runInContext(source, context, { filename: "extension/browser67/debugger-runtime.js" });
  return context;
}

function createEventHook() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
    emit(...args) {
      for (const listener of [...listeners]) listener(...args);
    },
    listenerCount() { return listeners.size; },
  };
}

async function assertSameTabSerialization() {
  const events = [];
  let releaseFirst;
  const firstSendGate = new Promise((resolvePromise) => { releaseFirst = resolvePromise; });
  let sendCount = 0;
  const runtime = createRuntime({
    async attach(target) { events.push(`attach:${String(target.tabId)}`); },
    async sendCommand(target, method) {
      sendCount += 1;
      events.push(`send:${String(target.tabId)}:${method}`);
      if (sendCount === 1) await firstSendGate;
      return { send_count: sendCount };
    },
    async detach(target) { events.push(`detach:${String(target.tabId)}`); },
  });
  const helpers = { normalizeNumericTabId: (value) => Number(value) };
  const first = runtime.browser67HandleDebuggerCommand({ tabId: 7, method: "Runtime.evaluate" }, {}, helpers);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  const second = runtime.browser67HandleDebuggerCommand({ tabId: 7, method: "Page.captureScreenshot" }, {}, helpers);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.deepEqual(events, ["attach:7", "send:7:Runtime.evaluate"]);
  releaseFirst();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.deepEqual(events, [
    "attach:7",
    "send:7:Runtime.evaluate",
    "detach:7",
    "attach:7",
    "send:7:Page.captureScreenshot",
    "detach:7",
  ]);
  assert.equal(runtime.browser67DebuggerStatus().queued_tab_count, 0);
  assert.equal(runtime.browser67DebuggerStatus().ui_scope, "browser_profile");
  assert.equal(runtime.browser67DebuggerStatus().isolation_requires_separate_browser_instance, true);
}

async function assertExternalOwnerFailsWithoutDetach() {
  let detachCount = 0;
  const runtime = createRuntime({
    async attach() { throw new Error("Another debugger is already attached to the tab"); },
    async sendCommand() { throw new Error("send should not run"); },
    async detach() { detachCount += 1; },
  });
  const result = await runtime.browser67HandleDebuggerCommand(
    { tabId: 8, method: "Runtime.evaluate" },
    {},
    { normalizeNumericTabId: (value) => Number(value) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "DEBUGGER_BUSY");
  assert.equal(result.errorDetails.external_owner_possible, true);
  assert.equal(detachCount, 0);
}

async function assertBatchFailureClearsViewport() {
  const methods = [];
  const runtime = createRuntime({
    async attach() {},
    async sendCommand(_target, method) {
      methods.push(method);
      if (method === "Runtime.evaluate") throw new Error("probe failed");
      return {};
    },
    async detach() {},
  });
  const result = await runtime.browser67HandleDebuggerBatch({
    tabId: 9,
    commands: [
      { cmd: "cdp", method: "Emulation.setDeviceMetricsOverride", params: { width: 390, height: 844 } },
      { cmd: "cdp", method: "Runtime.evaluate", params: { expression: "probe" } },
      { cmd: "cdp", method: "Emulation.clearDeviceMetricsOverride", params: {} },
    ],
  }, {}, {
    normalizeNumericTabId: (value) => Number(value),
    handleCookies: async () => ({ ok: true, data: [] }),
    handleTabs: async () => ({ ok: true, data: [] }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(methods, [
    "Emulation.setDeviceMetricsOverride",
    "Runtime.evaluate",
    "Emulation.clearDeviceMetricsOverride",
  ]);
  assert.equal(result.errorDetails.cleanup[0].cleared, true);
}

async function assertConsoleObservationIsBoundedAndReleased() {
  const onEvent = createEventHook();
  const onDetach = createEventHook();
  const methods = [];
  let detachCount = 0;
  const debuggerApi = {
    onEvent,
    onDetach,
    async attach() {},
    async sendCommand(target, method) {
      methods.push(method);
      if (method === "Runtime.enable") {
        onEvent.emit(target, "Runtime.consoleAPICalled", {
          type: "log",
          args: [{ type: "string", value: "console-contract-log" }],
          timestamp: Date.now() / 1_000,
        });
        onEvent.emit(target, "Runtime.exceptionThrown", {
          exceptionDetails: {
            text: "Uncaught",
            exception: { description: "Error: console-contract-exception" },
            timestamp: Date.now() / 1_000,
          },
        });
      }
      return {};
    },
    async detach() { detachCount += 1; },
  };
  const runtime = createRuntime(debuggerApi);
  const result = await runtime.browser67HandleConsoleObservation({
    tabId: 10,
    durationMs: 5_000,
    maxEntries: 2,
    maxTotalChars: 10_000,
    includeLogEntries: true,
  }, {}, { normalizeNumericTabId: (value) => Number(value) });
  const payload = JSON.parse(JSON.stringify(result.data));
  assert.equal(result.ok, true);
  assert.equal(payload.schema, "browser67.console-observation.v1");
  assert.equal(payload.stop_reason, "max_entries");
  assert.equal(payload.entry_count, 2);
  assert.deepEqual(payload.source_counts, {
    runtime_console: 1,
    runtime_exception: 1,
  });
  assert.equal(payload.persistent_debugger, false);
  assert.equal(payload.cleanup.listeners_removed, true);
  assert.equal(payload.cleanup.debugger_released, true);
  assert.equal(payload.cleanup.debugger_detach.detached, true);
  assert.equal(detachCount, 1);
  assert.equal(onEvent.listenerCount(), 0);
  assert.equal(onDetach.listenerCount(), 0);
  assert.deepEqual(methods, [
    "Runtime.enable",
    "Log.enable",
    "Log.disable",
    "Runtime.disable",
  ]);
}

async function assertConsoleObservationCharacterBudget() {
  const onEvent = createEventHook();
  const onDetach = createEventHook();
  const runtime = createRuntime({
    onEvent,
    onDetach,
    async attach() {},
    async sendCommand(target, method) {
      if (method === "Runtime.enable") {
        for (let index = 0; index < 3; index += 1) {
          onEvent.emit(target, "Runtime.consoleAPICalled", {
            type: "log",
            args: [{ type: "string", value: `budget-${String(index)}-${"x".repeat(4_000)}` }],
            timestamp: Date.now() / 1_000,
          });
        }
      }
      return {};
    },
    async detach() {},
  });
  const result = await runtime.browser67HandleConsoleObservation({
    tabId: 11,
    durationMs: 5_000,
    maxEntries: 100,
    maxTotalChars: 1_000,
    includeLogEntries: false,
  }, {}, { normalizeNumericTabId: (value) => Number(value) });
  assert.equal(result.ok, true);
  assert.equal(result.data.stop_reason, "max_total_chars");
  assert.ok(result.data.total_chars <= 1_000);
  assert.ok(result.data.entry_count >= 1);
  assert.equal(result.data.entries[0].truncated, true);
  assert.equal(onEvent.listenerCount(), 0);
  assert.equal(onDetach.listenerCount(), 0);
}

async function assertConsoleLogDomainObservation() {
  const onEvent = createEventHook();
  const onDetach = createEventHook();
  const runtime = createRuntime({
    onEvent,
    onDetach,
    async attach() {},
    async sendCommand(target, method) {
      if (method === "Log.enable") {
        onEvent.emit(target, "Log.entryAdded", {
          entry: {
            source: "javascript",
            level: "warning",
            text: "console-contract-log-domain",
            timestamp: Date.now() / 1_000,
          },
        });
      }
      return {};
    },
    async detach() {},
  });
  const result = await runtime.browser67HandleConsoleObservation({
    tabId: 13,
    durationMs: 50,
    maxEntries: 10,
    maxTotalChars: 10_000,
    includeLogEntries: true,
  }, {}, { normalizeNumericTabId: (value) => Number(value) });
  assert.equal(result.ok, true);
  assert.equal(result.data.stop_reason, "duration_elapsed");
  assert.equal(result.data.entry_count, 1);
  assert.equal(result.data.entries[0].source, "log_javascript");
  assert.equal(result.data.entries[0].text, "console-contract-log-domain");
  assert.equal(result.data.coverage.log_entries, "Log.enable_may_include_buffered_entries");
  assert.equal(onEvent.listenerCount(), 0);
  assert.equal(onDetach.listenerCount(), 0);
}

async function assertConsoleExternalOwnerFailsWithoutDetach() {
  const onEvent = createEventHook();
  const onDetach = createEventHook();
  let detachCount = 0;
  const runtime = createRuntime({
    onEvent,
    onDetach,
    async attach() { throw new Error("Another debugger is already attached to the tab"); },
    async sendCommand() { throw new Error("send should not run"); },
    async detach() { detachCount += 1; },
  });
  const result = await runtime.browser67HandleConsoleObservation({
    tabId: 12,
    durationMs: 50,
  }, {}, { normalizeNumericTabId: (value) => Number(value) });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "DEBUGGER_BUSY");
  assert.equal(detachCount, 0);
  assert.equal(onEvent.listenerCount(), 0);
  assert.equal(onDetach.listenerCount(), 0);
}

async function assertConsoleUnverifiedReleaseFailsClosed() {
  const onEvent = createEventHook();
  const onDetach = createEventHook();
  const runtime = createRuntime({
    onEvent,
    onDetach,
    async attach() {},
    async sendCommand() { return {}; },
    async detach() { throw new Error("detach receipt unavailable"); },
  });
  const result = await runtime.browser67HandleConsoleObservation({
    tabId: 14,
    durationMs: 50,
    includeLogEntries: false,
  }, {}, { normalizeNumericTabId: (value) => Number(value) });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "DEBUGGER_RELEASE_UNVERIFIED");
  assert.equal(result.errorDetails.listeners_removed, true);
  assert.equal(result.errorDetails.debugger_released, false);
  assert.equal(onEvent.listenerCount(), 0);
  assert.equal(onDetach.listenerCount(), 0);
}

async function run() {
  await assertSameTabSerialization();
  await assertExternalOwnerFailsWithoutDetach();
  await assertBatchFailureClearsViewport();
  await assertConsoleObservationIsBoundedAndReleased();
  await assertConsoleObservationCharacterBudget();
  await assertConsoleLogDomainObservation();
  await assertConsoleExternalOwnerFailsWithoutDetach();
  await assertConsoleUnverifiedReleaseFailsClosed();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "extension-debugger-runtime-contract",
    serialized: true,
    external_owner_fail_closed: true,
    viewport_cleanup_on_error: true,
    console_observation_bounded: true,
    console_character_budget: true,
    console_log_domain: true,
    console_listener_cleanup: true,
    console_unverified_release_fails_closed: true,
  })}\n`);
}

run().catch((error) => {
  process.stderr.write(`extension-debugger-runtime-contract failed: ${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
});
