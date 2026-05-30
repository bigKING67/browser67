#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const hubControlPath = resolve(
  repoRoot,
  "src/tmwd-hub-control.mjs",
);

function runNodeScript(scriptPath, args) {
  return spawnSync("node", [scriptPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
}

function parseLastJsonLine(stdout) {
  const rows = String(stdout ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const line = rows[index];
    try {
      return JSON.parse(line);
    } catch {
      // continue
    }
  }
  return null;
}

async function isPortReachable(host, port, timeoutMs = 200) {
  return await new Promise((resolvePromise) => {
    const socket = new Socket();
    let settled = false;
    const finish = (reachable) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolvePromise(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function pickFreePortPair() {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const wsPort = 24000 + Math.floor(Math.random() * 10000);
    const linkPort = wsPort + 1;
    const wsBusy = await isPortReachable("127.0.0.1", wsPort);
    const linkBusy = await isPortReachable("127.0.0.1", linkPort);
    if (!wsBusy && !linkBusy) {
      return { wsPort, linkPort };
    }
  }
  throw new Error("unable to find free port pair for tmwd-hub-control contract");
}

function buildControlArgs(command, baseArgs) {
  return [
    command,
    "--json",
    "--wait-ms", "5000",
    "--timeout-ms", "1000",
    "--tmwd-ws-endpoint", baseArgs.tmwdWsEndpoint,
    "--tmwd-link-endpoint", baseArgs.tmwdLinkEndpoint,
    "--state-file", baseArgs.stateFilePath,
  ];
}

function callControl(command, baseArgs) {
  const result = runNodeScript(hubControlPath, buildControlArgs(command, baseArgs));
  if (result.error) {
    throw result.error;
  }
  const payload = parseLastJsonLine(result.stdout);
  if (!payload || typeof payload !== "object") {
    throw new Error(`hub-control invalid output command=${command} stdout=${result.stdout} stderr=${result.stderr}`);
  }
  return {
    exitCode: Number.isFinite(Number(result.status)) ? Number(result.status) : 1,
    payload,
  };
}

async function runContract() {
  const tempDir = mkdtempSync(resolve(tmpdir(), "tmwd-browser-mcp-hub-control-"));
  const ports = await pickFreePortPair();
  const baseArgs = {
    tmwdWsEndpoint: `ws://127.0.0.1:${String(ports.wsPort)}`,
    tmwdLinkEndpoint: `http://127.0.0.1:${String(ports.linkPort)}/link`,
    stateFilePath: resolve(tempDir, "tmwd-hub-state.json"),
  };

  let finalStatusPayload = null;
  try {
    const statusBefore = callControl("status", baseArgs);
    assert.equal(statusBefore.payload?.action, "status");
    assert.equal(statusBefore.payload?.running, false);

    const start = callControl("start", baseArgs);
    assert.equal(start.payload?.action, "start");
    assert.equal(start.payload?.ok, true);
    assert.equal(start.payload?.started, true);
    assert.equal(start.exitCode, 0);

    const statusRunning = callControl("status", baseArgs);
    assert.equal(statusRunning.payload?.running, true);
    assert.equal(statusRunning.payload?.managed, true);
    assert.equal(statusRunning.payload?.pid_alive, true);
    assert.equal(typeof statusRunning.payload?.state?.pid, "number");
    assert.equal(statusRunning.payload?.checks?.link_http?.ok, true);
    assert.equal(statusRunning.payload?.checks?.link_cmd?.ok, true);

    const stop = callControl("stop", baseArgs);
    assert.equal(stop.payload?.action, "stop");
    assert.equal(stop.payload?.ok, true);
    assert.equal(stop.payload?.stopped, true);
    assert.equal(stop.exitCode, 0);

    const statusAfter = callControl("status", baseArgs);
    finalStatusPayload = statusAfter.payload;
    assert.equal(statusAfter.payload?.running, false);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      ws_endpoint: baseArgs.tmwdWsEndpoint,
      link_endpoint: baseArgs.tmwdLinkEndpoint,
      final_running: statusAfter.payload?.running,
      final_managed: statusAfter.payload?.managed,
      final_pid_source: statusAfter.payload?.pid_source,
    })}\n`);
  } finally {
    try {
      callControl("stop", baseArgs);
    } catch {
      // best effort cleanup
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
    if (finalStatusPayload && finalStatusPayload.running === true) {
      throw new Error("hub-control contract cleanup failed: hub still running");
    }
  }
}

try {
  await runContract();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser-structured-mcp-hub-control-contract failed: ${message}\n`);
  process.exitCode = 1;
}
