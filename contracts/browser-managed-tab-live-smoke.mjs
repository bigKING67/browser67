#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRpcClient } from "./browser-structured-mcp-contract/rpc-client.mjs";
import { firstJsonContent } from "./browser-structured-mcp-contract/rpc-content.mjs";

function parseArgs(argv) {
  const parsed = {
    timeout_ms: 15_000,
    tmwd_mode: "tmwd",
    tmwd_transport: "auto",
    tmwd_ws_endpoint: "ws://127.0.0.1:18765",
    tmwd_link_endpoint: "http://127.0.0.1:18766/link",
    cdp_endpoint: "http://127.0.0.1:9222",
    require_tabs_get: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--timeout-ms") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("invalid --timeout-ms value");
      }
      parsed.timeout_ms = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--tmwd-mode") {
      parsed.tmwd_mode = String(argv[index + 1] ?? "").trim() || "tmwd";
      index += 1;
      continue;
    }
    if (token === "--tmwd-transport") {
      parsed.tmwd_transport = String(argv[index + 1] ?? "").trim() || "auto";
      index += 1;
      continue;
    }
    if (token === "--tmwd-ws-endpoint") {
      parsed.tmwd_ws_endpoint = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--tmwd-link-endpoint") {
      parsed.tmwd_link_endpoint = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--cdp-endpoint") {
      parsed.cdp_endpoint = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--require-tabs-get") {
      parsed.require_tabs_get = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

async function startHttpFixture() {
  const sockets = new Set();
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const title = pathname.replace(/^\//, "") || "tmwd-managed-tab-live-smoke";
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body><main data-smoke-title="${title}">${title}</main></body>
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
    throw new Error("fixture server did not expose a TCP port");
  }
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: () => new Promise((resolvePromise) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      server.close(resolvePromise);
    }),
  };
}

function commonArgs(cli) {
  return {
    tmwd_mode: cli.tmwd_mode,
    tmwd_transport: cli.tmwd_transport,
    tmwd_ws_endpoint: cli.tmwd_ws_endpoint,
    tmwd_link_endpoint: cli.tmwd_link_endpoint,
    cdp_endpoint: cli.cdp_endpoint,
    timeout_ms: cli.timeout_ms,
  };
}

function extractTabId(raw) {
  const candidates = [
    raw?.id,
    raw?.tabId,
    raw?.tab_id,
    raw?.data?.id,
    raw?.data?.tabId,
    raw?.data?.tab_id,
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function normalizeTabs(raw) {
  const rows = Array.isArray(raw)
    ? raw
    : (Array.isArray(raw?.data) ? raw.data : []);
  return rows.map((row) => ({
    id: String(row?.id ?? row?.tabId ?? row?.tab_id ?? ""),
    url: String(row?.url ?? ""),
    title: String(row?.title ?? ""),
    active: row?.active === true,
    scriptable: row?.scriptable === true || /^https?:/.test(String(row?.url ?? "")),
  })).filter((row) => row.id.length > 0);
}

async function waitFor(condition, timeoutMs, pollMs = 100) {
  const startedAt = Date.now();
  let latest;
  while (Date.now() - startedAt <= timeoutMs) {
    latest = await condition();
    if (latest?.ok === true) {
      return latest;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
  }
  return latest ?? { ok: false, reason: "timeout" };
}

async function run() {
  const cli = parseArgs(process.argv.slice(2));
  const registryDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-managed-tab-live-"));
  const previousRegistryPath = process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
  process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = path.join(registryDir, "managed-tabs.json");

  const fixture = await startHttpFixture();
  const rpc = createRpcClient();
  const openedTabIds = new Set();
  const workspaceKey = `managed-live-${String(Date.now())}`;

  const callTool = async (name, args) => {
    const response = await rpc.call("tools/call", { name, arguments: args }, cli.timeout_ms);
    if (response?.result?.isError === true) {
      const payload = firstJsonContent(response.result);
      throw new Error(`${name} failed: ${String(payload?.error ?? payload?.message ?? "tool error")}`);
    }
    const payload = firstJsonContent(response.result);
    if (payload?.status === "failed") {
      throw new Error(`${name} failed: ${String(payload.error ?? "unknown error")}`);
    }
    return payload;
  };

  const bridgeCommand = async (command) => {
    const payload = await callTool("browser_execute_js", {
      ...commonArgs(cli),
      no_monitor: true,
      script: JSON.stringify(command),
    });
    return payload.js_return;
  };

  const listTabs = async () => normalizeTabs(await bridgeCommand({
    cmd: "tabs",
    method: "list",
    includeUnscriptable: true,
  }));

  try {
    const init = await rpc.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "browser-managed-tab-live-smoke",
        version: "1.0.0",
      },
    }, cli.timeout_ms);
    assert.equal(init?.result?.serverInfo?.name, "browser-structured-mcp");
    rpc.notify("notifications/initialized", {});

    const directPath = `/tmwd-direct-close-smoke-${String(Date.now())}`;
    const directUrl = `${fixture.origin}${directPath}`;
    const directCreate = await bridgeCommand({
      cmd: "tabs",
      method: "create",
      url: directUrl,
      active: false,
    });
    const directTabId = extractTabId(directCreate);
    assert.ok(directTabId, "direct bridge create did not return tab id");
    openedTabIds.add(directTabId);

    const directAppeared = await waitFor(async () => {
      const tabs = await listTabs();
      return {
        ok: tabs.some((tab) => tab.id === directTabId && tab.url.includes(directPath)),
        tabs,
      };
    }, 5_000);
    assert.equal(directAppeared.ok, true, "direct bridge tab did not appear in tabs.list");

    let tabsGet = {
      supported: false,
      id_matches: false,
      warning: "",
    };
    try {
      const directGet = await bridgeCommand({
        cmd: "tabs",
        method: "get",
        tabId: directTabId,
      });
      tabsGet = {
        supported: true,
        id_matches: extractTabId(directGet) === directTabId,
        tab: directGet,
      };
      assert.equal(tabsGet.id_matches, true, "tabs.get returned the wrong tab");
    } catch (error) {
      tabsGet.warning = String(error?.message ?? error);
      if (cli.require_tabs_get === true) {
        throw error;
      }
    }

    const directClose = await bridgeCommand({
      cmd: "tabs",
      method: "close",
      tabId: directTabId,
    });
    assert.equal(directClose?.closed, true, "direct tabs.close did not confirm closed=true");
    openedTabIds.delete(directTabId);
    const directGone = await waitFor(async () => {
      const tabs = await listTabs();
      return {
        ok: !tabs.some((tab) => tab.id === directTabId),
        tabs,
      };
    }, 5_000);
    assert.equal(directGone.ok, true, "direct bridge tab remained after tabs.close");

    const managedPath = `/tmwd-managed-lifecycle-smoke-${String(Date.now())}`;
    const managedUrl = `${fixture.origin}${managedPath}`;
    const managedArgs = {
      ...commonArgs(cli),
      action: "select_or_create",
      url: managedUrl,
      workspace_key: workspaceKey,
      active: false,
      wait_until: "listed",
      wait_timeout_ms: 5_000,
      wait_poll_ms: 100,
    };
    const firstManaged = await callTool("browser_tab_lifecycle", managedArgs);
    const managedTabId = String(firstManaged?.managed_tab?.tab_id ?? "");
    assert.ok(managedTabId, "managed lifecycle create did not return tab id");
    openedTabIds.add(managedTabId);
    assert.equal(firstManaged.created, true, "first select_or_create should create a managed tab");
    assert.equal(firstManaged.ready, true, "managed tab should become visible before timeout");

    const secondManaged = await callTool("browser_tab_lifecycle", managedArgs);
    assert.equal(secondManaged.reused, true, "second select_or_create should reuse the managed tab");
    assert.equal(String(secondManaged?.managed_tab?.tab_id ?? ""), managedTabId, "managed lifecycle reused a different tab");

    const managedClose = await callTool("browser_tab_lifecycle", {
      ...commonArgs(cli),
      action: "close_unkept",
      workspace_key: workspaceKey,
    });
    assert.equal(managedClose.status, "success", "managed close_unkept did not succeed");
    assert.equal(
      managedClose.closed.some((row) => String(row?.tab_id ?? "") === managedTabId && row.closed === true),
      true,
      "managed close_unkept did not close the managed tab",
    );
    openedTabIds.delete(managedTabId);

    const managedGone = await waitFor(async () => {
      const tabs = await listTabs();
      return {
        ok: !tabs.some((tab) => tab.id === managedTabId),
        tabs,
      };
    }, 5_000);
    assert.equal(managedGone.ok, true, "managed tab remained after close_unkept");

    const managedList = await callTool("browser_tab_lifecycle", {
      action: "list_managed",
    });
    assert.equal(Array.isArray(managedList.managed_tabs), true);
    assert.equal(managedList.managed_tabs.length, 0, "isolated managed registry should be empty after close");

    let registryRemaining = 0;
    try {
      const registry = JSON.parse(await readFile(process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH, "utf8"));
      registryRemaining = Array.isArray(registry?.managed_tabs) ? registry.managed_tabs.length : 0;
    } catch {
      registryRemaining = 0;
    }

    return {
      ok: true,
      direct_bridge: {
        created_tab_id: directTabId,
        tabs_get: tabsGet,
        close: directClose,
        remaining_matches: directGone.tabs.filter((tab) => tab.id === directTabId).length,
      },
      managed_lifecycle: {
        first_created: firstManaged.created === true,
        first_ready: firstManaged.ready === true,
        second_reused: secondManaged.reused === true,
        tab_id: managedTabId,
        closed_count: managedClose.closed.length,
        registry_remaining: registryRemaining,
      },
    };
  } finally {
    for (const tabId of openedTabIds) {
      try {
        await bridgeCommand({
          cmd: "tabs",
          method: "close",
          tabId,
        });
      } catch {
        // Cleanup is best effort; the main assertions above report authoritative failures.
      }
    }
    try {
      await callTool("browser_tab_lifecycle", {
        ...commonArgs(cli),
        action: "close_unkept",
        workspace_key: workspaceKey,
      });
    } catch {
      // Best effort cleanup only.
    }
    await rpc.close();
    await fixture.close();
    if (previousRegistryPath === undefined) {
      delete process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
    } else {
      process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = previousRegistryPath;
    }
    await rm(registryDir, { recursive: true, force: true });
  }
}

try {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  let message = error instanceof Error ? error.message : String(error);
  if (message.includes("unsupported tabs method: get")) {
    message = `${message}; reload the unpacked TMWD extension so the running bridge picks up tabs.get`;
  }
  process.stderr.write(`browser-managed-tab-live-smoke failed: ${message}\n`);
  process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
}
