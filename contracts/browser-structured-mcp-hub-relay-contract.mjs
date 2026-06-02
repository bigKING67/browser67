#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Socket } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const hubPath = resolve(repoRoot, "src/tmwd-hub.mjs");

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function isPortReachable(host, port, timeoutMs = 200) {
  return await new Promise((resolvePromise) => {
    const socket = new Socket();
    let settled = false;
    const finish = (reachable) => {
      if (settled) return;
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
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const wsPort = 34000 + Math.floor(Math.random() * 8000);
    const linkPort = wsPort + 1;
    const wsBusy = await isPortReachable("127.0.0.1", wsPort);
    const linkBusy = await isPortReachable("127.0.0.1", linkPort);
    if (!wsBusy && !linkBusy) {
      return { wsPort, linkPort };
    }
  }
  throw new Error("unable to find free port pair for tmwd hub relay contract");
}

async function waitForPort(host, port, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortReachable(host, port, 100)) {
      return;
    }
    await sleep(50);
  }
  throw new Error(`port did not become reachable: ${host}:${String(port)}`);
}

function openWs(url) {
  return new Promise((resolvePromise, rejectPromise) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolvePromise(ws));
    ws.once("error", rejectPromise);
  });
}

function parseWsMessage(raw) {
  return JSON.parse(String(raw));
}

function waitForWsMessage(ws, predicate, label, timeoutMs = 3_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      cleanup();
      rejectPromise(new Error(`timed out waiting for websocket message: ${label}`));
    }, timeoutMs);
    const onMessage = (raw) => {
      let parsed;
      try {
        parsed = parseWsMessage(raw);
      } catch {
        return;
      }
      if (!predicate(parsed)) {
        return;
      }
      cleanup();
      resolvePromise(parsed);
    };
    const onClose = () => {
      cleanup();
      rejectPromise(new Error(`websocket closed while waiting for: ${label}`));
    };
    const onError = (error) => {
      cleanup();
      rejectPromise(error instanceof Error ? error : new Error(String(error)));
    };
    function cleanup() {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("close", onClose);
      ws.off("error", onError);
    }
    ws.on("message", onMessage);
    ws.once("close", onClose);
    ws.once("error", onError);
  });
}

async function sendControllerRequest(ws, payload) {
  ws.send(JSON.stringify(payload));
  return await waitForWsMessage(
    ws,
    (message) => String(message.id ?? "") === String(payload.id),
    `controller response ${String(payload.id)}`,
  );
}

async function runContract() {
  const { wsPort, linkPort } = await pickFreePortPair();
  const wsUrl = `ws://127.0.0.1:${String(wsPort)}`;
  const linkUrl = `http://127.0.0.1:${String(linkPort)}/link`;
  const child = spawn("node", [hubPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      TMWD_HUB_HOST: "127.0.0.1",
      TMWD_HUB_WS_PORT: String(wsPort),
      TMWD_HUB_LINK_PORT: String(linkPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  let extensionWs;
  let controllerWs;
  try {
    await waitForPort("127.0.0.1", wsPort);
    extensionWs = await openWs(wsUrl);
    controllerWs = await openWs(wsUrl);

    extensionWs.send(JSON.stringify({
      type: "ext_ready",
      tabs: [
        { id: 123, url: "http://127.0.0.1/fake", title: "Fake Tab" },
      ],
    }));

    const listResponse = await sendControllerRequest(controllerWs, {
      id: "list_tabs",
      code: { cmd: "tabs" },
    });
    assert.equal(listResponse?.success, true);
    assert.equal(Array.isArray(listResponse?.result), true);
    assert.equal(listResponse.result[0]?.id, "123");

    const relayedCreatePromise = waitForWsMessage(
      extensionWs,
      (message) => String(message?.code?.cmd ?? "") === "tabs"
        && String(message?.code?.method ?? "") === "create",
      "relayed tabs.create",
    );
    controllerWs.send(JSON.stringify({
      id: "create_tab",
      tabId: 123,
      code: {
        cmd: "tabs",
        method: "create",
        url: "http://127.0.0.1/new",
        active: false,
      },
    }));
    const relayedCreate = await relayedCreatePromise;
    assert.equal(relayedCreate.tabId, 123);
    assert.equal(relayedCreate.code.url, "http://127.0.0.1/new");
    extensionWs.send(JSON.stringify({
      type: "result",
      id: relayedCreate.id,
      result: { id: 456, url: "http://127.0.0.1/new", title: "New Tab" },
      newTabs: [{ id: 456, url: "http://127.0.0.1/new", title: "New Tab" }],
    }));
    const createResponse = await waitForWsMessage(
      controllerWs,
      (message) => String(message.id ?? "") === "create_tab",
      "tabs.create controller response",
    );
    assert.equal(createResponse?.type, "result");
    assert.equal(createResponse?.result?.id, 456);

    extensionWs.close();
    await sleep(100);
    const noExtensionResponse = await sendControllerRequest(controllerWs, {
      id: "no_extension",
      tabId: 123,
      code: { cmd: "cdp", method: "Runtime.evaluate", params: { expression: "1" } },
    });
    assert.equal(noExtensionResponse?.type, "error");
    assert.match(String(noExtensionResponse?.error ?? ""), /no active extension websocket connection/);

    await sleep(100);
    assert.equal(child.exitCode, null);
    const health = await fetch(linkUrl);
    assert.equal(health.ok, true);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      ws_endpoint: wsUrl,
      tabs_list_intercept_ok: true,
      tabs_create_relay_ok: true,
      no_extension_error_nonfatal: true,
    })}\n`);
  } finally {
    try {
      controllerWs?.close();
    } catch {
      // ignore
    }
    try {
      extensionWs?.close();
    } catch {
      // ignore
    }
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await sleep(100);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }
  }
  if (child.exitCode !== null && child.exitCode !== 0 && child.signalCode !== "SIGTERM") {
    throw new Error(`hub exited unexpectedly code=${String(child.exitCode)} signal=${String(child.signalCode)} stdout=${stdout} stderr=${stderr}`);
  }
}

try {
  await runContract();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser-structured-mcp-hub-relay-contract failed: ${message}\n`);
  process.exitCode = 1;
}
