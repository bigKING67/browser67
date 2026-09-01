#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { createRpcClient } from "./browser67-browser-mcp-contract/rpc-client.mjs";
import { firstJsonContent } from "./browser67-browser-mcp-contract/rpc-content.mjs";
import {
  commonArgs,
  parseArgs,
} from "./browser-captcha-assist-live-smoke/cli.mjs";

async function startConsoleFixture() {
  const sockets = new Set();
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    if (pathname !== "/console") {
      res.end("<!doctype html><title>not found</title><main>not found</main>");
      return;
    }
    res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>browser67 console observation smoke</title>
</head>
<body>
  <main id="console-ready">Console observation fixture</main>
</body>
</html>`);
  });
  server.keepAliveTimeout = 1_000;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("console fixture did not expose a TCP port");
  }
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: () => new Promise((resolvePromise) => {
      for (const socket of sockets) socket.destroy();
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      server.close(resolvePromise);
    }),
  };
}

async function initializeRpc(rpc, timeoutMs) {
  const init = await rpc.call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "browser-console-live-smoke",
      version: "1.0.0",
    },
  }, timeoutMs);
  assert.equal(init?.result?.serverInfo?.name, "browser67-tmwd-browser");
  rpc.notify("notifications/initialized", {});
}

function createToolCaller(rpc, timeoutMs) {
  return async function callTool(name, args) {
    const response = await rpc.call("tools/call", { name, arguments: args }, timeoutMs);
    const payload = firstJsonContent(response.result);
    if (response?.result?.isError === true || payload?.ok === false || payload?.status === "failed") {
      throw new Error(`${name} failed: ${JSON.stringify({
        error: String(payload?.error ?? "tool error"),
        error_code: payload?.error_code,
        details: payload?.details,
      })}`);
    }
    return payload;
  };
}

function browserInstanceArgs(browserInstanceId) {
  return browserInstanceId ? { browser_instance_id: browserInstanceId } : {};
}

function includesEntry(entries, marker) {
  return (Array.isArray(entries) ? entries : []).some((entry) => String(entry?.text ?? "").includes(marker));
}

async function assertRemoved(targetPath, label) {
  await assert.rejects(
    access(targetPath),
    (error) => error?.code === "ENOENT",
    `${label} should be removed`,
  );
}

async function run() {
  const cli = parseArgs(process.argv.slice(2));
  const baseArgs = commonArgs(cli);
  const registryDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-console-live-registry-"));
  const previousRegistryPath = process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
  process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = path.join(registryDir, "managed-tabs.json");

  let fixture;
  let rpc;
  let callTool;
  let tabId = "";
  let browserInstanceId = "";
  const workspaceKey = `console-live-${String(Date.now())}`;
  let summary;
  try {
    fixture = await startConsoleFixture();
    rpc = createRpcClient();
    callTool = createToolCaller(rpc, cli.timeout_ms);
    await initializeRpc(rpc, cli.timeout_ms);

    const managed = await callTool("browser_tab_lifecycle", {
      ...baseArgs,
      action: "select_or_create",
      url: `${fixture.origin}/console`,
      workspace_key: workspaceKey,
      fresh: true,
      window_policy: "dedicated",
      focus_policy: "background_preferred",
      active: false,
      wait_until: "listed",
      wait_timeout_ms: 5_000,
      wait_poll_ms: 100,
    });
    tabId = String(managed?.managed_tab?.tab_id ?? "");
    browserInstanceId = String(managed?.managed_tab?.browser_instance_id ?? "");
    assert.ok(tabId, "console live smoke requires a managed tab id");
    assert.equal(managed.created, true, "console live smoke should create an isolated managed tab");
    assert.equal(managed.ready, true, "console live smoke managed tab should become visible");

    const ready = await callTool("browser_wait", {
      ...baseArgs,
      ...browserInstanceArgs(browserInstanceId),
      tab_id: tabId,
      type: "selector",
      selector: "#console-ready",
      timeout_ms: 10_000,
    });
    assert.equal(ready.status, "passed", "console fixture should settle");

    const scheduled = await callTool("browser_execute_js", {
      ...baseArgs,
      ...browserInstanceArgs(browserInstanceId),
      tab_id: tabId,
      workspace_key: workspaceKey,
      script: `
        globalThis.__browser67ConsoleTimers = [
          setTimeout(() => console.log("browser67-console-log", 67), 800),
          setTimeout(() => console.warn("browser67-console-warning"), 1100),
          setTimeout(() => { throw new Error("browser67-console-exception"); }, 1400)
        ];
        return { scheduled: globalThis.__browser67ConsoleTimers.length };
      `,
    });
    assert.equal(scheduled?.js_return?.scheduled, 3);

    const observed = await callTool("browser_console_ops", {
      ...baseArgs,
      ...browserInstanceArgs(browserInstanceId),
      action: "observe",
      tab_id: tabId,
      workspace_key: workspaceKey,
      duration_ms: 2_200,
      max_entries: 20,
      max_total_chars: 20_000,
      include_log_entries: false,
      include_stack_trace: true,
    });
    assert.equal(observed.schema, "browser67.console-observation.v1");
    assert.equal(observed.status, "success");
    assert.equal(observed.stop_reason, "duration_elapsed");
    assert.equal(observed.persistent_debugger, false);
    assert.equal(observed.cleanup?.listeners_removed, true);
    assert.equal(observed.cleanup?.debugger_released, true);
    assert.equal(observed.cleanup?.debugger_detach?.detached, true);
    assert.equal(observed.cleanup?.errors?.length, 0);
    assert.ok(
      observed.entry_count >= 3,
      `console observation should capture scheduled entries: ${JSON.stringify({
        entry_count: observed.entry_count,
        source_counts: observed.source_counts,
        entries: observed.entries?.map((entry) => ({
          source: entry?.source,
          level: entry?.level,
          text: String(entry?.text ?? "").slice(0, 160),
        })),
      })}`,
    );
    assert.equal(includesEntry(observed.entries, "browser67-console-log"), true);
    assert.equal(includesEntry(observed.entries, "browser67-console-warning"), true);
    assert.equal(includesEntry(observed.entries, "browser67-console-exception"), true);
    assert.ok(observed.total_chars <= observed.limits.max_total_chars);

    const burstScheduled = await callTool("browser_execute_js", {
      ...baseArgs,
      ...browserInstanceArgs(browserInstanceId),
      tab_id: tabId,
      workspace_key: workspaceKey,
      script: `
        setTimeout(() => {
          for (let index = 0; index < 10; index += 1) {
            console.info("browser67-console-burst-" + String(index));
          }
        }, 300);
        return { scheduled: true };
      `,
    });
    assert.equal(burstScheduled?.js_return?.scheduled, true);

    const entryBounded = await callTool("browser_console_ops", {
      ...baseArgs,
      ...browserInstanceArgs(browserInstanceId),
      action: "observe",
      tab_id: tabId,
      workspace_key: workspaceKey,
      duration_ms: 2_000,
      max_entries: 3,
      max_total_chars: 20_000,
      include_log_entries: false,
    });
    assert.equal(entryBounded.stop_reason, "max_entries");
    assert.equal(entryBounded.entry_count, 3);
    assert.equal(entryBounded.limits.max_entries, 3);
    assert.equal(entryBounded.cleanup?.listeners_removed, true);
    assert.equal(entryBounded.cleanup?.debugger_released, true);
    assert.equal(entryBounded.cleanup?.debugger_detach?.detached, true);

    const budgetScheduled = await callTool("browser_execute_js", {
      ...baseArgs,
      ...browserInstanceArgs(browserInstanceId),
      tab_id: tabId,
      workspace_key: workspaceKey,
      script: `
        setTimeout(() => {
          for (let index = 0; index < 3; index += 1) {
            console.log("browser67-console-budget-" + String(index) + "-" + "x".repeat(4000));
          }
        }, 300);
        return { scheduled: true };
      `,
    });
    assert.equal(budgetScheduled?.js_return?.scheduled, true);

    const characterBounded = await callTool("browser_console_ops", {
      ...baseArgs,
      ...browserInstanceArgs(browserInstanceId),
      action: "observe",
      tab_id: tabId,
      workspace_key: workspaceKey,
      duration_ms: 2_000,
      max_entries: 100,
      max_total_chars: 1_000,
      include_log_entries: false,
    });
    assert.equal(characterBounded.stop_reason, "max_total_chars");
    assert.ok(characterBounded.entry_count >= 1);
    assert.ok(characterBounded.total_chars <= 1_000);
    assert.equal(
      characterBounded.dropped_entries > 0
        || characterBounded.entries?.some((entry) => entry?.truncated === true),
      true,
      "character budget must either truncate an entry or report the entry that did not fit",
    );
    assert.equal(characterBounded.cleanup?.listeners_removed, true);
    assert.equal(characterBounded.cleanup?.debugger_released, true);
    assert.equal(characterBounded.cleanup?.debugger_detach?.detached, true);

    const finalized = await callTool("browser_tab_lifecycle", {
      ...baseArgs,
      ...browserInstanceArgs(browserInstanceId),
      action: "finalize_task",
      workspace_key: workspaceKey,
      prune_stale: true,
      cleanup_created_agent_window: true,
    });
    summary = {
      ok: true,
      tab_id: tabId,
      browser_instance_id: browserInstanceId || undefined,
      workspace_key: workspaceKey,
      captured_entry_count: observed.entry_count,
      captured_sources: observed.source_counts,
      duration_stop_reason: observed.stop_reason,
      entry_bound_stop_reason: entryBounded.stop_reason,
      character_bound_stop_reason: characterBounded.stop_reason,
      max_total_chars_observed: characterBounded.total_chars,
      listeners_removed: true,
      debugger_detached: true,
      finalized_status: finalized.status,
    };
    tabId = "";
  } finally {
    if (tabId && callTool) {
      try {
        await callTool("browser_tab_lifecycle", {
          ...baseArgs,
          ...browserInstanceArgs(browserInstanceId),
          action: "finalize_task",
          workspace_key: workspaceKey,
          prune_stale: true,
          cleanup_created_agent_window: true,
        });
      } catch {
        // Best-effort finalizer; the main assertions report authoritative failures.
      }
    }
    if (rpc) await rpc.close();
    if (fixture) await fixture.close();
    if (previousRegistryPath === undefined) {
      delete process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
    } else {
      process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = previousRegistryPath;
    }
    await rm(registryDir, { recursive: true, force: true });
  }

  await assertRemoved(registryDir, "isolated console managed-tab registry");
  process.stdout.write(`${JSON.stringify({
    ...summary,
    isolated_registry_removed: true,
  })}\n`);
}

try {
  await run();
} catch (error) {
  process.stderr.write(`${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
}
