#!/usr/bin/env node

import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { createBrowserRuntime } from "../src/runtime/browser-runtime.mjs";

async function run() {
  const runtime = createBrowserRuntime({ runtime_id: "contract-runtime" });
  let sameTabActive = 0;
  let sameTabMax = 0;
  const sameTabTasks = Array.from({ length: 4 }, () => runtime.runForTab("tab-1", async () => {
    sameTabActive += 1;
    sameTabMax = Math.max(sameTabMax, sameTabActive);
    await delay(15);
    sameTabActive -= 1;
  }));
  await Promise.all(sameTabTasks);
  assert.equal(sameTabMax, 1);

  let differentTabActive = 0;
  let differentTabMax = 0;
  await Promise.all(["tab-2", "tab-3"].map((key) => runtime.runForTab(key, async () => {
    differentTabActive += 1;
    differentTabMax = Math.max(differentTabMax, differentTabActive);
    await delay(20);
    differentTabActive -= 1;
  })));
  assert.equal(differentTabMax, 2);

  const disposed = await runtime.dispose();
  assert.equal(disposed.disposed, true);
  assert.equal(disposed.scheduler.queued_key_count, 0);
  assert.equal(disposed.scheduler.active_key_count, 0);
  await assert.rejects(
    () => runtime.runForTab("tab-4", async () => {}),
    /disposed/,
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "browser-runtime-contract",
    same_tab_max_active: sameTabMax,
    different_tab_max_active: differentTabMax,
    disposed_scheduler: disposed.scheduler,
  })}\n`);
}

run().catch((error) => {
  process.stderr.write(`browser-runtime-contract failed: ${error?.stack || String(error)}\n`);
  process.exitCode = 1;
});
