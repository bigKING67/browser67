#!/usr/bin/env node

import assert from "node:assert/strict";
import { WebSocketServer } from "ws";

import { reloadBrowser67Extension } from "../scripts/reload-extension-live.mjs";

async function listen(server) {
  if (server.address()) return;
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("listening", resolvePromise);
    server.once("error", rejectPromise);
  });
}

async function close(server) {
  for (const client of server.clients) client.close();
  await new Promise((resolvePromise) => server.close(resolvePromise));
}

async function run() {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  let reloadRequestCount = 0;
  server.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const request = JSON.parse(String(raw));
      if (request.code?.cmd === "tabs") {
        assert.deepEqual(request.code, { cmd: "tabs", method: "list" });
        socket.send(JSON.stringify({
          id: request.id,
          success: true,
          browser_instance_id: "browser-instance-a",
          result: [{
            id: "42",
            tab_id: "42",
            browser_instance_id: "browser-instance-a",
          }],
        }));
        return;
      }
      reloadRequestCount += 1;
      assert.equal(request.browser_instance_id, "browser-instance-a");
      assert.equal(request.tabId, 42);
      assert.deepEqual(request.code, { cmd: "management", method: "reload" });
      socket.send(JSON.stringify({ type: "ack", id: request.id }));
      if (reloadRequestCount === 1) {
        socket.send(JSON.stringify({
          type: "result",
          id: request.id,
          result: { ok: true },
        }));
      } else {
        socket.send(JSON.stringify({
          type: "error",
          id: request.id,
          error: "reload rejected",
        }));
      }
    });
  });
  await listen(server);
  const address = server.address();
  assert.equal(typeof address, "object");
  const endpoint = `ws://127.0.0.1:${String(address.port)}`;

  try {
    const reloaded = await reloadBrowser67Extension({ endpoint, timeoutMs: 2_000 });
    assert.equal(reloaded.ok, true);
    assert.equal(reloaded.status, "reload_scheduled");
    assert.equal(reloaded.endpoint, endpoint);
    await assert.rejects(
      reloadBrowser67Extension({ endpoint, timeoutMs: 2_000 }),
      /reload rejected/,
    );
    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "extension-reload-live-contract",
      reload_request_shape: true,
      live_target_discovery: true,
      ack_ignored: true,
      extension_error_propagated: true,
    })}\n`);
  } finally {
    await close(server);
  }
}

try {
  await run();
} catch (error) {
  process.stderr.write(`extension-reload-live-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
