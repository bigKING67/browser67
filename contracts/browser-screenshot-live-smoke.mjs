#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRpcClient } from "./browser-structured-mcp-contract/rpc-client.mjs";
import { firstJsonContent } from "./browser-structured-mcp-contract/rpc-content.mjs";
import {
  commonArgs,
  parseArgs,
} from "./browser-captcha-assist-live-smoke/cli.mjs";

async function startScreenshotFixture() {
  const sockets = new Set();
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    if (pathname !== "/screenshot") {
      res.end("<!doctype html><title>not found</title><main>not found</main>");
      return;
    }
    res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>TMWD screenshot smoke</title>
  <style>
    html, body { margin: 0; min-height: 100%; font-family: system-ui, sans-serif; background: #f6f4ef; color: #1f2937; }
    .hero { min-height: 420px; padding: 48px; background: linear-gradient(135deg, #111827, #3b82f6); color: white; }
    .hero h1 { margin: 0 0 16px; font-size: 48px; line-height: 1.05; }
    .capture-target { width: 360px; height: 180px; margin-top: 32px; border-radius: 24px; background: #f97316; display: grid; place-items: center; font-weight: 800; }
    .content { height: 860px; padding: 48px; }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>TMWD screenshot smoke</h1>
      <p>Viewport, selector, and bounded full-page capture fixture.</p>
      <div id="capture-target" class="capture-target">selector target</div>
    </section>
    <section class="content">
      <h2>Lower content</h2>
      <p>Extra height keeps full_page distinct from viewport without creating a large artifact.</p>
    </section>
  </main>
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
    throw new Error("screenshot fixture did not expose a TCP port");
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

async function initializeRpc(rpc, timeoutMs) {
  const init = await rpc.call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "browser-screenshot-live-smoke",
      version: "1.0.0",
    },
  }, timeoutMs);
  assert.equal(init?.result?.serverInfo?.name, "browser-structured-mcp");
  rpc.notify("notifications/initialized", {});
}

function createToolCaller(rpc, timeoutMs) {
  return async function callTool(name, args) {
    const response = await rpc.call("tools/call", { name, arguments: args }, timeoutMs);
    const payload = firstJsonContent(response.result);
    if (response?.result?.isError === true) {
      throw new Error(`${name} failed: ${String(payload?.error ?? "tool error")}`);
    }
    if (payload?.ok === false || payload?.status === "failed") {
      throw new Error(`${name} returned failure: ${JSON.stringify(payload)}`);
    }
    return payload;
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForReady(check, timeoutMs = 10_000, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last?.ok) {
        return last;
      }
    } catch (error) {
      last = {
        ok: false,
        error: String(error?.message ?? error),
      };
    }
    await sleep(intervalMs);
  }
  return last ?? { ok: false, error: "readiness timeout" };
}

async function assertScreenshotArtifact(payload, label) {
  assert.equal(payload?.ok, true, `${label} should succeed`);
  assert.equal(payload?.status, "success", `${label} status`);
  assert.equal(payload?.artifact?.mime_type, "image/png", `${label} mime`);
  assert.equal(typeof payload?.artifact?.sha256, "string", `${label} sha`);
  assert.equal(payload.artifact.sha256.length, 64, `${label} sha length`);
  assert.equal(payload?.artifact?.fullscreen, false, `${label} fullscreen flag`);
  assert.equal(payload?.capture?.returns_base64, false, `${label} base64 contract`);
  assert.equal(typeof payload?.artifact?.width, "number", `${label} width`);
  assert.equal(typeof payload?.artifact?.height, "number", `${label} height`);
  assert.ok(payload.artifact.width > 0, `${label} width positive`);
  assert.ok(payload.artifact.height > 0, `${label} height positive`);
  const info = await stat(payload.artifact.path);
  assert.ok(info.size > 0, `${label} artifact size`);
  assert.equal(info.size, payload.artifact.bytes, `${label} byte metadata`);
}

async function run() {
  const cli = parseArgs(process.argv.slice(2));
  const baseArgs = commonArgs(cli);
  const registryDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-screenshot-live-registry-"));
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "tmwd-screenshot-live-runs-"));
  const previousRegistryPath = process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
  const previousRunRoot = process.env.BROWSER_STRUCTURED_RUN_ROOT;
  process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = path.join(registryDir, "managed-tabs.json");
  process.env.BROWSER_STRUCTURED_RUN_ROOT = runRoot;

  const fixture = await startScreenshotFixture();
  const rpc = createRpcClient();
  const callTool = createToolCaller(rpc, cli.timeout_ms);
  const workspaceKey = `screenshot-live-${String(Date.now())}`;
  let tabId = "";
  try {
    await initializeRpc(rpc, cli.timeout_ms);
    const managed = await callTool("browser_tab_lifecycle", {
      ...baseArgs,
      action: "select_or_create",
      url: `${fixture.origin}/screenshot`,
      workspace_key: workspaceKey,
      fresh: true,
      active: true,
      wait_until: "listed",
      wait_timeout_ms: 5_000,
      wait_poll_ms: 100,
    });
    tabId = String(managed?.managed_tab?.tab_id ?? "");
    assert.ok(tabId, "managed tab id required");
    assert.equal(managed.created, true, "screenshot smoke should create isolated managed tab");
    assert.equal(managed.ready, true, "screenshot smoke managed tab should become visible");

    const ready = await waitForReady(async () => {
      const payload = await callTool("browser_wait", {
        ...baseArgs,
        tab_id: tabId,
        type: "selector",
        selector: "#capture-target",
        timeout_ms: 2_000,
      });
      return {
        ok: payload.status === "passed",
        payload,
      };
    }, 10_000);
    assert.equal(ready.ok, true, `screenshot fixture did not settle: ${JSON.stringify(ready)}`);

    const viewport = await callTool("browser_screenshot_ops", {
      ...baseArgs,
      tab_id: tabId,
      target: "viewport",
      workspace_key: workspaceKey,
      task_id: "screenshot-live-smoke",
      title: "viewport",
      max_pixels: 8_000_000,
    });
    await assertScreenshotArtifact(viewport, "viewport");
    assert.equal(viewport.target, "viewport");

    const mobileViewport = await callTool("browser_screenshot_ops", {
      ...baseArgs,
      tab_id: tabId,
      target: "viewport",
      viewport: {
        width: 390,
        height: 844,
        dpr: 2,
        is_mobile: true,
      },
      layout_selectors: {
        capture_target: "#capture-target",
      },
      workspace_key: workspaceKey,
      task_id: "screenshot-live-smoke",
      title: "mobile-viewport",
      max_pixels: 8_000_000,
    });
    await assertScreenshotArtifact(mobileViewport, "mobile_viewport");
    assert.equal(mobileViewport.target, "viewport");
    assert.equal(mobileViewport.viewport_override?.requested?.width, 390);
    assert.equal(mobileViewport.viewport_override?.requested?.height, 844);
    assert.equal(mobileViewport.viewport_override?.cleanup?.cleared, true);
    assert.equal(mobileViewport.page?.viewport?.inner_width, 390);
    assert.equal(mobileViewport.page?.viewport?.inner_height, 844);
    assert.equal(mobileViewport.layout_metrics?.selectors?.capture_target?.found, true);
    assert.equal(typeof mobileViewport.layout_metrics?.horizontal_overflow, "boolean");

    const selector = await callTool("browser_screenshot_ops", {
      ...baseArgs,
      tab_id: tabId,
      target: "selector",
      selector: "#capture-target",
      workspace_key: workspaceKey,
      task_id: "screenshot-live-smoke",
      title: "selector",
      max_pixels: 8_000_000,
    });
    await assertScreenshotArtifact(selector, "selector");
    assert.equal(selector.target, "selector");
    assert.equal(selector.selector, "#capture-target");
    assert.ok(selector.capture.clip.width > 0, "selector clip width");

    const fullPage = await callTool("browser_screenshot_ops", {
      ...baseArgs,
      tab_id: tabId,
      target: "full_page",
      workspace_key: workspaceKey,
      task_id: "screenshot-live-smoke",
      title: "full-page",
      max_pixels: 8_000_000,
    });
    await assertScreenshotArtifact(fullPage, "full_page");
    assert.equal(fullPage.target, "full_page");
    assert.equal(fullPage.capture.capture_beyond_viewport, true);

    const finalized = await callTool("browser_tab_lifecycle", {
      ...baseArgs,
      action: "finalize_task",
      workspace_key: workspaceKey,
      prune_stale: true,
    });

    process.stdout.write(`${JSON.stringify({
      ok: true,
      tab_id: tabId,
      workspace_key: workspaceKey,
      viewport_artifact: viewport.artifact.path,
      mobile_viewport_artifact: mobileViewport.artifact.path,
      selector_artifact: selector.artifact.path,
      full_page_artifact: fullPage.artifact.path,
      finalized_status: finalized.status,
      run_root: runRoot,
    })}\n`);
  } finally {
    if (tabId) {
      try {
        await callTool("browser_tab_lifecycle", {
          ...baseArgs,
          action: "finalize_task",
          workspace_key: workspaceKey,
          prune_stale: true,
        });
      } catch {
        // Best-effort finalizer. Test assertions above report authoritative cleanup failures.
      }
    }
    await rpc.close();
    await fixture.close();
    if (previousRegistryPath === undefined) {
      delete process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
    } else {
      process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = previousRegistryPath;
    }
    if (previousRunRoot === undefined) {
      delete process.env.BROWSER_STRUCTURED_RUN_ROOT;
    } else {
      process.env.BROWSER_STRUCTURED_RUN_ROOT = previousRunRoot;
    }
    await rm(registryDir, { recursive: true, force: true });
    await rm(runRoot, { recursive: true, force: true });
  }
}

try {
  await run();
} catch (error) {
  process.stderr.write(`${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
}
