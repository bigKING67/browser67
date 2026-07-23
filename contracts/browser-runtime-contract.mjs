#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  assertLiveTargetIdentity,
  buildLiveTargetRoute,
} from "./browser67-live-contract/target-routing.mjs";
import { parseArgs as parseLiveContractArgs } from "./browser67-live-contract/cli.mjs";
import { buildLiveArgs } from "./browser67-live-gate/args.mjs";
import { parseArgs as parseLiveGateArgs } from "./browser67-live-gate/cli.mjs";
import { createBrowserRuntime } from "../src/runtime/browser-runtime.mjs";
import { createSessionRegistry } from "../src/runtime/sessions/registry.mjs";
import { handleBrowserRunOps } from "../src/runtime/runs/lifecycle.mjs";

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

  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "browser67-runtime-contract-"));
  const runtimeA = createBrowserRuntime({
    runtime_id: "isolated-a",
    runs: { root: path.join(runtimeRoot, "a") },
  });
  const runtimeB = createBrowserRuntime({
    runtime_id: "isolated-b",
    runs: { root: path.join(runtimeRoot, "b") },
  });
  runtimeA.sessionStore.sync([{ id: "tab-a", url: "https://a.example/", title: "A", active: true }]);
  runtimeB.sessionStore.sync([{ id: "tab-b", url: "https://b.example/", title: "B", active: true }]);
  runtimeA.snapshotStore.put({ snapshot_id: "snapshot-a", tab_id: "tab-a", nodes: [] });
  runtimeB.downloadStore.put({ token: "download-b", download_dir: "/tmp", since_ms: 1 });
  runtimeA.adoptionRuntime.adoptionTokens.set("adoption-a", { expires_at_ms: Date.now() + 60_000 });
  runtimeA.jobState.jobs.set("job-a", { job_id: "job-a", status: "pending" });
  runtimeA.networkObservations.remember({ network_observation_id: "network-a", stopped: true });
  runtimeA.transportHealth.record({ tmwd_ws_endpoint: "ws://127.0.0.1:18765" }, "ws", false, {
    error: "fixture",
  });
  const preparedRun = await handleBrowserRunOps({
    action: "prepare",
    workspace_key: "runtime-a",
    task_id: "run-store-isolation",
  }, { runtime: runtimeA });
  assert.equal(preparedRun.ok, true);
  assert.equal((await handleBrowserRunOps({
    action: "list",
    workspace_key: "runtime-a",
  }, { runtime: runtimeA })).runs.length, 1);
  assert.equal((await handleBrowserRunOps({
    action: "list",
    workspace_key: "runtime-a",
  }, { runtime: runtimeB })).runs.length, 0);
  assert.deepEqual(runtimeA.sessionStore.list().map((item) => item.id), ["tab-a"]);
  assert.deepEqual(runtimeB.sessionStore.list().map((item) => item.id), ["tab-b"]);
  assert.equal(runtimeB.snapshotStore.stats().snapshot_count, 0);
  assert.equal(runtimeA.downloadStore.stats().session_count, 0);
  assert.equal(runtimeB.adoptionRuntime.stats().adoption_token_count, 0);
  assert.equal(runtimeB.jobState.stats().job_count, 0);
  assert.equal(runtimeB.networkObservations.stats().observation_count, 0);
  assert.equal(runtimeB.transportHealth.stats().endpoint_count, 0);
  await runtimeA.dispose();
  assert.equal(runtimeA.stats().sessions.session_count, 0);
  assert.equal(runtimeA.stats().snapshots.snapshot_count, 0);
  assert.equal(runtimeA.stats().adoption.adoption_token_count, 0);
  assert.equal(runtimeA.stats().transport_health.endpoint_count, 0);
  assert.equal(runtimeA.stats().jobs.job_count, 0);
  assert.equal(runtimeA.stats().network_observations.observation_count, 0);
  assert.equal(runtimeA.stats().tmwd_ws.pending_count, 0);
  assert.equal(runtimeA.stats().run_store.disposed, true);
  assert.equal(runtimeB.stats().sessions.session_count, 1);
  assert.equal(runtimeB.stats().run_store.disposed, false);
  await runtimeB.dispose();
  await rm(runtimeRoot, { recursive: true, force: true });

  const targets = [
    { id: "startup", url: "about:blank", title: "", active: true },
    { id: "fixture", url: "http://127.0.0.1:4567/", title: "remote-cdp-fixture", active: false },
  ];
  const targetSelector = createSessionRegistry();
  const explicit = targetSelector.selectTarget(targets, {
    switch_tab_id: "fixture",
    target_url_contains: "about:blank",
  });
  assert.equal(explicit.target.id, "fixture");
  assert.equal(explicit.selection.selected_by, "tab_id");
  assert.throws(
    () => targetSelector.selectTarget(targets, {
      switch_tab_id: "missing",
      target_url_contains: "about:blank",
    }),
    /tab not found: missing/,
  );

  assert.deepEqual(buildLiveTargetRoute({
    target_tab_id: "fixture",
    target_url_contains: "http://127.0.0.1:4567/",
  }), {
    switch_tab_id: "fixture",
  });
  const liveGateArgs = parseLiveGateArgs([
    "--target-tab-id", "fixture",
    "--target-url-contains", "http://127.0.0.1:4567/",
  ]);
  assert.equal(liveGateArgs.target_tab_id, "fixture");
  assert.deepEqual(
    buildLiveArgs(liveGateArgs).slice(-4),
    ["--target-tab-id", "fixture", "--target-url-contains", "http://127.0.0.1:4567/"],
  );
  const liveContractArgs = parseLiveContractArgs([
    "--target-tab-id", "fixture",
    "--target-url-contains", "http://127.0.0.1:4567/",
  ]);
  assert.equal(liveContractArgs.target_tab_id, "fixture");
  const scanPayload = { metadata: { active_tab: "fixture" } };
  const executePayload = {
    tab_id: "fixture",
    js_return: { href: "http://127.0.0.1:4567/" },
  };
  assert.doesNotThrow(() => assertLiveTargetIdentity({
    cli: {
      target_tab_id: "fixture",
      target_url_contains: "http://127.0.0.1:4567/",
    },
    scanPayload,
    executePayload,
  }));
  assert.throws(
    () => assertLiveTargetIdentity({
      cli: { target_url_contains: "http://127.0.0.1:4567/" },
      scanPayload,
      executePayload: {
        tab_id: "startup",
        js_return: { href: "about:blank" },
      },
    }),
    /live target URL mismatch/,
  );
  assert.throws(
    () => assertLiveTargetIdentity({
      cli: {},
      scanPayload,
      executePayload: {
        tab_id: "startup",
        js_return: { href: "about:blank" },
      },
    }),
    /live scan\/execute target drift/,
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "browser-runtime-contract",
    same_tab_max_active: sameTabMax,
    different_tab_max_active: differentTabMax,
    disposed_scheduler: disposed.scheduler,
    explicit_target_routing: explicit.selection.selected_by,
    isolated_runtime_stores: true,
    target_mismatch_rejected: true,
  })}\n`);
}

run().catch((error) => {
  process.stderr.write(`browser-runtime-contract failed: ${error?.stack || String(error)}\n`);
  process.exitCode = 1;
});
