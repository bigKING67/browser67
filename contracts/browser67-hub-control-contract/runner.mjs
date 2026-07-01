import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { callControl } from "./control-client.mjs";
import { pickFreePortPair } from "./ports.mjs";

async function buildContext() {
  const tempDir = await mkdtemp(resolve(tmpdir(), "tmwd-browser-mcp-hub-control-"));
  const ports = await pickFreePortPair();
  return {
    tempDir,
    baseArgs: {
      tmwdWsEndpoint: `ws://127.0.0.1:${String(ports.wsPort)}`,
      tmwdLinkEndpoint: `http://127.0.0.1:${String(ports.linkPort)}/link`,
      stateFilePath: resolve(tempDir, "tmwd-hub-state.json"),
    },
  };
}

async function cleanupContext(context, finalStatusPayload) {
  try {
    callControl("stop", context.baseArgs);
  } catch {
    // best effort cleanup
  }
  await rm(context.tempDir, { recursive: true, force: true }).catch(() => {});
  if (finalStatusPayload && finalStatusPayload.running === true) {
    throw new Error("hub-control contract cleanup failed: hub still running");
  }
}

async function runHubControlContract() {
  const context = await buildContext();
  let finalStatusPayload = null;
  try {
    const statusBefore = callControl("status", context.baseArgs);
    assert.equal(statusBefore.payload?.action, "status");
    assert.equal(statusBefore.payload?.running, false);

    const start = callControl("start", context.baseArgs);
    assert.equal(start.payload?.action, "start");
    assert.equal(start.payload?.ok, true);
    assert.equal(start.payload?.started, true);
    assert.equal(start.exitCode, 0);

    const statusRunning = callControl("status", context.baseArgs);
    assert.equal(statusRunning.payload?.running, true);
    assert.equal(statusRunning.payload?.managed, true);
    assert.equal(statusRunning.payload?.pid_alive, true);
    assert.equal(typeof statusRunning.payload?.state?.pid, "number");
    assert.equal(statusRunning.payload?.checks?.link_http?.ok, true);
    assert.equal(statusRunning.payload?.checks?.link_cmd?.ok, true);

    const stop = callControl("stop", context.baseArgs);
    assert.equal(stop.payload?.action, "stop");
    assert.equal(stop.payload?.ok, true);
    assert.equal(stop.payload?.stopped, true);
    assert.equal(stop.exitCode, 0);

    const statusAfter = callControl("status", context.baseArgs);
    finalStatusPayload = statusAfter.payload;
    assert.equal(statusAfter.payload?.running, false);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      ws_endpoint: context.baseArgs.tmwdWsEndpoint,
      link_endpoint: context.baseArgs.tmwdLinkEndpoint,
      final_running: statusAfter.payload?.running,
      final_managed: statusAfter.payload?.managed,
      final_pid_source: statusAfter.payload?.pid_source,
    })}\n`);
  } finally {
    await cleanupContext(context, finalStatusPayload);
  }
}

export {
  runHubControlContract,
};
