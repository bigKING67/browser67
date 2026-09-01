#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { createRpcClient } from "./browser67-browser-mcp-contract/rpc-client.mjs";
import { firstJsonContent } from "./browser67-browser-mcp-contract/rpc-content.mjs";
import {
  commonArgs,
  parseArgs,
} from "./browser-captcha-assist-live-smoke/cli.mjs";

async function startUploadFixture() {
  const sockets = new Set();
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    if (pathname !== "/upload") {
      res.end("<!doctype html><title>not found</title><main>not found</main>");
      return;
    }
    res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>browser67 file upload smoke</title>
</head>
<body>
  <main>
    <label>Multiple files <input id="multiple-files" type="file" multiple></label>
    <label>Single file <input id="single-file" type="file"></label>
  </main>
  <script>
    window.__browser67UploadEvents = {
      multiple: { input: 0, change: 0 },
      single: { input: 0, change: 0 }
    };
    for (const [id, key] of [["multiple-files", "multiple"], ["single-file", "single"]]) {
      const input = document.getElementById(id);
      for (const type of ["input", "change"]) {
        input.addEventListener(type, () => {
          window.__browser67UploadEvents[key][type] += 1;
        });
      }
    }
  </script>
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
    throw new Error("file upload fixture did not expose a TCP port");
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
      name: "browser-file-ops-live-smoke",
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
  const registryDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-file-live-registry-"));
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-file-live-inputs-"));
  const previousRegistryPath = process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
  process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = path.join(registryDir, "managed-tabs.json");

  const alphaPath = path.join(uploadDir, "alpha.txt");
  const betaPath = path.join(uploadDir, "beta.txt");
  await Promise.all([
    writeFile(alphaPath, "alpha upload fixture\n", "utf8"),
    writeFile(betaPath, "beta upload fixture\n", "utf8"),
  ]);

  let fixture;
  let rpc;
  let callTool;
  let tabId = "";
  let browserInstanceId = "";
  const workspaceKey = `file-ops-live-${String(Date.now())}`;
  let summary;
  try {
    fixture = await startUploadFixture();
    rpc = createRpcClient();
    callTool = createToolCaller(rpc, cli.timeout_ms);
    await initializeRpc(rpc, cli.timeout_ms);

    const managed = await callTool("browser_tab_lifecycle", {
      ...baseArgs,
      action: "select_or_create",
      url: `${fixture.origin}/upload`,
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
    assert.ok(tabId, "file upload smoke requires a managed tab id");
    assert.equal(managed.created, true, "file upload smoke should create an isolated managed tab");
    assert.equal(managed.ready, true, "file upload smoke managed tab should become visible");

    const ready = await callTool("browser_wait", {
      ...baseArgs,
      ...browserInstanceArgs(browserInstanceId),
      tab_id: tabId,
      type: "selector",
      selector: "#multiple-files",
      timeout_ms: 10_000,
    });
    assert.equal(ready.status, "passed", "file upload fixture should settle");

    const inspected = await callTool("browser_file_ops", {
      ...baseArgs,
      ...browserInstanceArgs(browserInstanceId),
      tab_id: tabId,
      action: "inspect_inputs",
      selector: "input[type=file]",
    });
    assert.equal(inspected.inputs?.length, 2, "fixture should expose two file inputs");
    assert.equal(inspected.inputs?.find((item) => item.id === "multiple-files")?.multiple, true);
    assert.equal(inspected.inputs?.find((item) => item.id === "single-file")?.multiple, false);

    const multipleUpload = await callTool("browser_file_ops", {
      ...baseArgs,
      ...browserInstanceArgs(browserInstanceId),
      tab_id: tabId,
      action: "set_input_files",
      selector: "#multiple-files",
      files: [alphaPath, betaPath],
    });
    assert.equal(multipleUpload.files_count, 2, "multi-file operation should report both files");

    const singleUpload = await callTool("browser_file_ops", {
      ...baseArgs,
      ...browserInstanceArgs(browserInstanceId),
      tab_id: tabId,
      action: "set_input_files",
      selector: "#single-file",
      files: [alphaPath],
    });
    assert.equal(singleUpload.files_count, 1, "single-file operation should report one file");

    const observed = await callTool("browser_execute_js", {
      ...baseArgs,
      ...browserInstanceArgs(browserInstanceId),
      tab_id: tabId,
      workspace_key: workspaceKey,
      script: `
        const snapshot = (selector) => {
          const input = document.querySelector(selector);
          return Array.from(input.files ?? []).map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type
          }));
        };
        return {
          multiple: snapshot("#multiple-files"),
          single: snapshot("#single-file"),
          events: window.__browser67UploadEvents
        };
      `,
    });
    const snapshot = observed?.js_return;
    assert.deepEqual(snapshot?.multiple?.map((file) => file.name), ["alpha.txt", "beta.txt"]);
    assert.deepEqual(snapshot?.single?.map((file) => file.name), ["alpha.txt"]);
    assert.equal(snapshot?.multiple?.[0]?.size, Buffer.byteLength("alpha upload fixture\n"));
    assert.equal(snapshot?.multiple?.[1]?.size, Buffer.byteLength("beta upload fixture\n"));
    assert.equal(snapshot?.events?.multiple?.input, 1, "multi-file input event should fire once");
    assert.equal(snapshot?.events?.multiple?.change, 1, "multi-file change event should fire once");
    assert.equal(snapshot?.events?.single?.input, 1, "single-file input event should fire once");
    assert.equal(snapshot?.events?.single?.change, 1, "single-file change event should fire once");

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
      multiple_names: snapshot.multiple.map((file) => file.name),
      single_names: snapshot.single.map((file) => file.name),
      events: snapshot.events,
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
    if (rpc) {
      await rpc.close();
    }
    if (fixture) {
      await fixture.close();
    }
    if (previousRegistryPath === undefined) {
      delete process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
    } else {
      process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = previousRegistryPath;
    }
    await rm(registryDir, { recursive: true, force: true });
    await rm(uploadDir, { recursive: true, force: true });
  }

  await Promise.all([
    assertRemoved(registryDir, "isolated managed-tab registry"),
    assertRemoved(uploadDir, "temporary upload inputs"),
  ]);
  process.stdout.write(`${JSON.stringify({
    ...summary,
    temporary_inputs_removed: true,
    isolated_registry_removed: true,
  })}\n`);
}

try {
  await run();
} catch (error) {
  process.stderr.write(`${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
}
