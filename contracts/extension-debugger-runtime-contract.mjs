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

async function assertBatchTimeoutCancelsAndReleases() {
  const methods = [];
  let attachCount = 0;
  let detachCount = 0;
  const runtime = createRuntime({
    async attach() { attachCount += 1; },
    async sendCommand(_target, method) {
      methods.push(method);
      if (method === "Runtime.evaluate") {
        return new Promise(() => {});
      }
      return {};
    },
    async detach() { detachCount += 1; },
  });
  const startedAt = Date.now();
  const result = await runtime.browser67HandleDebuggerBatch({
    tabId: 15,
    timeoutMs: 200,
    commands: [
      { cmd: "cdp", method: "Emulation.setDeviceMetricsOverride", params: { width: 390, height: 844 } },
      { cmd: "cdp", method: "Runtime.evaluate", params: { expression: "new Promise(() => {})", awaitPromise: true } },
      { cmd: "cdp", method: "Emulation.clearDeviceMetricsOverride", params: {} },
    ],
  }, {}, {
    normalizeNumericTabId: (value) => Number(value),
    handleCookies: async () => ({ ok: true, data: [] }),
    handleTabs: async () => ({ ok: true, data: [] }),
  });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "TIMEOUT");
  assert.equal(result.errorDetails?.timeout_kind, "extension_debugger_deadline");
  assert.equal(result.errorDetails?.failed_phase, "debugger_batch_command");
  assert.equal(result.errorDetails?.command_index, 1);
  assert.equal(result.errorDetails?.method, "Runtime.evaluate");
  assert.ok(elapsedMs >= 100, `batch timeout returned too early: ${String(elapsedMs)}ms`);
  assert.ok(elapsedMs < 500, `batch timeout exceeded its bounded envelope: ${String(elapsedMs)}ms`);
  assert.deepEqual(methods, [
    "Emulation.setDeviceMetricsOverride",
    "Runtime.evaluate",
    "Emulation.clearDeviceMetricsOverride",
  ]);
  assert.equal(attachCount, 1, "timed-out debugger should preserve the cleanup attachment");
  assert.equal(detachCount, 1, "timed-out debugger should detach after same-session cleanup");
  assert.equal(
    result.errorDetails.cleanup.some((entry) => entry.cleared === true),
    true,
    "timed-out viewport batch must clear its emulation override",
  );
  assert.equal(
    result.errorDetails.cleanup.some((entry) => entry.cancelled_inflight === true),
    true,
    "timed-out debugger command must be cancelled by the final detach",
  );
  assert.equal(result.debuggerCleanup.debugger_released, true);
  assert.equal(runtime.browser67DebuggerStatus().queued_tab_count, 0);
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

async function assertLateAttachRecovery() {
  for (const mode of ["command", "batch"]) {
    for (const outcome of ["success", "external_owner", "delayed_detach", "detach_failure"]) {
      let settleAttach;
      let rejectAttach;
      let attached = false;
      let attachCount = 0;
      let detachCount = 0;
      let completeDetach;
      const pendingDetach = new Promise((resolve) => { completeDetach = resolve; });
      const pendingAttach = new Promise((resolve, reject) => {
        settleAttach = resolve;
        rejectAttach = reject;
      });
      const runtime = createRuntime({
        async attach() {
          attachCount += 1;
          if (attached) throw new Error("Another debugger is already attached");
          if (attachCount === 1) await pendingAttach;
          attached = true;
        },
        async sendCommand() { return {}; },
        async detach() {
          detachCount += 1;
          if (outcome === "detach_failure") throw new Error("detach failed");
          if (outcome === "delayed_detach") await pendingDetach;
          attached = false;
        },
      });
      const invoke = () => mode === "command"
        ? runtime.browser67HandleDebuggerCommand({ tabId: 7, timeoutMs: 100, method: "Runtime.evaluate" }, {}, { normalizeNumericTabId: Number })
        : runtime.browser67HandleDebuggerBatch({ tabId: 7, timeoutMs: 100, commands: [{ cmd: "cdp", method: "Runtime.evaluate" }] }, {}, { normalizeNumericTabId: Number });
      const timedOut = await invoke();
      assert.equal(timedOut.errorCode, "TIMEOUT");
      assert.equal(timedOut.debuggerCleanup.debugger_released, false, `${mode}: unresolved attach must not claim release`);
      assert.equal(runtime.browser67DebuggerStatus().queued_tab_count, 1);
      await assert.rejects(invoke(), (error) => error.code === "TIMEOUT");
      assert.equal(attachCount, 1, "queued successor must not attach before recovery");
      if (outcome === "external_owner") rejectAttach(new Error("Another debugger is already attached"));
      else settleAttach();
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (outcome === "delayed_detach") {
        assert.equal(attached, true);
        await assert.rejects(invoke(), (error) => error.code === "TIMEOUT");
        assert.equal(attachCount, 1, "successor must wait for detach acknowledgement");
        completeDetach();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (outcome === "detach_failure") {
        assert.equal(attached, true);
        assert.equal(runtime.browser67DebuggerStatus().queued_tab_count, 1);
        await assert.rejects(invoke(), (error) => error.code === "TIMEOUT");
        assert.equal(attachCount, 1);
      } else {
        assert.equal(attached, false);
        assert.equal(detachCount, outcome === "external_owner" ? 0 : 1);
        assert.equal(runtime.browser67DebuggerStatus().queued_tab_count, 0);
        assert.equal((await invoke()).ok, true, "same-tab command must recover after cleanup");
      }
    }
  }
}

async function assertBatchCleanupDoesNotReenterPendingAttach() {
  let finishAttach;
  let attachCount = 0;
  let detachCount = 0;
  const pendingAttach = new Promise((resolve) => { finishAttach = resolve; });
  const runtime = createRuntime({
    async attach() {
      attachCount += 1;
      if (attachCount === 3) await pendingAttach;
    },
    async detach() { detachCount += 1; },
    async sendCommand() { return {}; },
  });
  const result = await runtime.browser67HandleDebuggerBatch({
    tabId: 7,
    timeoutMs: 200,
    commands: [
      { cmd: "cdp", tabId: 7, method: "Emulation.setDeviceMetricsOverride" },
      { cmd: "cdp", tabId: 8, method: "Runtime.evaluate" },
      { cmd: "cdp", tabId: 7, method: "Runtime.evaluate" },
    ],
  }, {}, { normalizeNumericTabId: Number });
  assert.equal(result.errorCode, "TIMEOUT");
  assert.equal(result.debuggerCleanup.debugger_released, false);
  assert.equal(attachCount, 3, "viewport cleanup must not reenter a pending attach");
  assert.equal(runtime.browser67DebuggerStatus().pending_attach_count, 1);
  await assert.rejects(runtime.browser67HandleDebuggerCommand({
    tabId: 7, timeoutMs: 100, method: "Runtime.evaluate",
  }, {}, { normalizeNumericTabId: Number }), (error) => error.code === "TIMEOUT");
  assert.equal(attachCount, 3);
  finishAttach();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(detachCount, 3);
  assert.equal(runtime.browser67DebuggerStatus().queued_tab_count, 0);
  assert.equal(runtime.browser67DebuggerStatus().pending_attach_count, 0);
  assert.equal((await runtime.browser67HandleDebuggerCommand({
    tabId: 7, timeoutMs: 100, method: "Runtime.evaluate",
  }, {}, { normalizeNumericTabId: Number })).ok, true);
}

async function run() {
  await assertLateAttachRecovery();
  await assertBatchCleanupDoesNotReenterPendingAttach();
  await assertSameTabSerialization();
  await assertExternalOwnerFailsWithoutDetach();
  await assertBatchFailureClearsViewport();
  await assertBatchTimeoutCancelsAndReleases();
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
    batch_timeout_cancelled_and_released: true,
    late_attach_recovery_and_queue_isolation: true,
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
