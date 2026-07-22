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
  let tabsRequestCount = 0;
  const executionMonitorFlags = [];
  server.on("connection", (socket) => {
    socket.once("close", () => {
      closeCount += 1;
    });
    socket.on("message", (data) => {
      const request = JSON.parse(String(data));
      const code = request?.code;
      if (code?.cmd === "tabs") {
        tabsRequestCount += 1;
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
      executionMonitorFlags.push(request.monitorNewTabs);
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
    get tabs_request_count() {
      return tabsRequestCount;
    },
    get execution_monitor_flags() {
      return [...executionMonitorFlags];
    },
    push_tabs(tabs) {
      for (const client of server.clients) {
        client.send(JSON.stringify({ type: "tabs_update", tabs }));
      }
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
    assert.equal(preferred.context.session_cache.hit, false);
    assert.equal(mock.tabs_request_count, 1);

    mock.push_tabs([{
      id: "mock-tab",
      url: "https://example.test/runtime-dispose",
      title: "Runtime dispose pushed",
    }]);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    const cachedPreferred = await resolvePreferredBrowserContext(args);
    assert.equal(cachedPreferred.context.session_cache.hit, true);
    assert.equal(cachedPreferred.context.session_cache.source, "push_tabs_update");
    assert.equal(cachedPreferred.context.target.title, "Runtime dispose pushed");
    assert.equal(mock.tabs_request_count, 1);

    const refreshedPreferred = await resolvePreferredBrowserContext({
      ...args,
      refresh_sessions: true,
    });
    assert.equal(refreshedPreferred.context.session_cache.hit, false);
    assert.equal(mock.tabs_request_count, 2);

    const executed = await executeTmwdJsWithFallback(
      { ...args, no_monitor: true },
      preferred.context,
      "return { disposed_contract: true };",
    );
    assert.equal(executed.executed.value?.disposed_contract, true);
    assert.deepEqual(mock.execution_monitor_flags, [false]);

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
      session_cache_push_hit: true,
      tabs_pull_count: mock.tabs_request_count,
      no_monitor_forwarded: mock.execution_monitor_flags[0] === false,
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
