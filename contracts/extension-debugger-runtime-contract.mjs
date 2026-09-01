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
    structuredClone,
  });
  context.globalThis = context;
  context.browser67ResolveBatchReferences = (value) => structuredClone(value);
  vm.runInContext(source, context, { filename: "extension/browser67/debugger-runtime.js" });
  return context;
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

async function run() {
  await assertSameTabSerialization();
  await assertExternalOwnerFailsWithoutDetach();
  await assertBatchFailureClearsViewport();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "extension-debugger-runtime-contract",
    serialized: true,
    external_owner_fail_closed: true,
    viewport_cleanup_on_error: true,
  })}\n`);
}

run().catch((error) => {
  process.stderr.write(`extension-debugger-runtime-contract failed: ${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
});
