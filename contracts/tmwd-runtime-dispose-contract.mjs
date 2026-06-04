#!/usr/bin/env node
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";

import {
  disposeTmwdRuntime,
  executeTmwdJsWithFallback,
  resolvePreferredBrowserContext,
} from "../src/tmwd-runtime.mjs";

function waitForServerListening(server) {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.once("listening", resolvePromise);
  });
}

function closeServer(server) {
  return new Promise((resolvePromise) => {
    for (const client of server.clients) {
      client.terminate();
    }
    server.close(resolvePromise);
  });
}

async function startMockTmwdWs() {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  let closeCount = 0;
  server.on("connection", (socket) => {
    socket.once("close", () => {
      closeCount += 1;
    });
    socket.on("message", (data) => {
      const request = JSON.parse(String(data));
      const code = request?.code;
      if (code?.cmd === "tabs") {
        socket.send(JSON.stringify({
          id: request.id,
          result: [
            {
              id: "mock-tab",
              url: "https://example.test/runtime-dispose",
              title: "Runtime dispose mock",
            },
          ],
        }));
        return;
      }
      socket.send(JSON.stringify({
        id: request.id,
        result: {
          ok: true,
          data: {
            echoed_tab_id: request.tabId,
            disposed_contract: true,
          },
        },
      }));
    });
  });
  await waitForServerListening(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock TMWD websocket did not expose a TCP address");
  }
  return {
    endpoint: `ws://127.0.0.1:${String(address.port)}`,
    close: () => closeServer(server),
    get close_count() {
      return closeCount;
    },
    get clients_count() {
      return server.clients.size;
    },
  };
}

async function run() {
  const mock = await startMockTmwdWs();
  try {
    const args = {
      tmwd_mode: "tmwd",
      tmwd_transport: "ws",
      tmwd_ws_endpoint: mock.endpoint,
      session_id: "mock-tab",
      timeout_ms: 2_000,
    };
    const preferred = await resolvePreferredBrowserContext(args);
    assert.equal(preferred.transport, "tmwd_ws");
    assert.equal(preferred.context.target.id, "mock-tab");

    const executed = await executeTmwdJsWithFallback(
      args,
      preferred.context,
      "return { disposed_contract: true };",
    );
    assert.equal(executed.executed.value?.disposed_contract, true);

    const disposed = await disposeTmwdRuntime({
      reason: "tmwd-runtime-dispose-contract",
      timeout_ms: 1_000,
    });
    assert.equal(disposed.status, "success");
    assert.equal(disposed.before.had_socket, true);
    assert.equal(disposed.after.had_socket, false);
    assert.equal(disposed.after.pending_count, 0);
    assert.notEqual(disposed.close_status, "timeout");

    const startedAt = Date.now();
    while (mock.close_count === 0 && Date.now() - startedAt < 1_000) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
    assert.equal(mock.close_count > 0, true);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      transport: preferred.transport,
      dispose_close_status: disposed.close_status,
      server_close_count: mock.close_count,
      server_clients_count: mock.clients_count,
    })}\n`);
  } finally {
    await disposeTmwdRuntime({
      reason: "tmwd-runtime-dispose-contract cleanup",
      timeout_ms: 500,
    });
    await mock.close();
  }
}

try {
  await run();
} catch (error) {
  await disposeTmwdRuntime({
    reason: "tmwd-runtime-dispose-contract error cleanup",
    timeout_ms: 500,
  });
  process.stderr.write(`tmwd-runtime-dispose-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
