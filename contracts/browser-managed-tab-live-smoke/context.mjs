import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

import { createRpcClient } from "../browser-structured-mcp-contract/rpc-client.mjs";
import { firstJsonContent } from "../browser-structured-mcp-contract/rpc-content.mjs";
import { commonArgs } from "./cli.mjs";
import { startHttpFixture } from "./fixture.mjs";
import { normalizeTabs } from "./helpers.mjs";

async function initializeRpc(rpc, cli) {
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
}

function createToolHelpers({ cli, rpc }) {
  const baseArgs = commonArgs(cli);
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
      ...baseArgs,
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

  return {
    baseArgs,
    bridgeCommand,
    callTool,
    listTabs,
  };
}

async function createManagedSmokeContext(cli) {
  const registryDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-managed-tab-live-"));
  const previousRegistryPath = process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
  process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = path.join(registryDir, "managed-tabs.json");

  let fixture;
  let rpc;
  try {
    fixture = await startHttpFixture();
    rpc = createRpcClient();
    await initializeRpc(rpc, cli);
    const helpers = createToolHelpers({ cli, rpc });
    const context = {
      ...helpers,
      cli,
      fixture,
      openedTabIds: new Set(),
      registryPath: process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH,
      rpc,
      workspaceKey: `managed-live-${String(Date.now())}`,
    };
    context.cleanup = async () => cleanupManagedSmokeContext({
      context,
      previousRegistryPath,
      registryDir,
    });
    return context;
  } catch (error) {
    await cleanupPartialContext({ fixture, previousRegistryPath, registryDir, rpc });
    throw error;
  }
}

async function cleanupPartialContext({ fixture, previousRegistryPath, registryDir, rpc }) {
  try {
    await rpc?.close?.();
  } catch {
    // ignore
  }
  try {
    await fixture?.close?.();
  } catch {
    // ignore
  }
  restoreRegistryPath(previousRegistryPath);
  await rm(registryDir, { recursive: true, force: true });
}

async function cleanupManagedSmokeContext({ context, previousRegistryPath, registryDir }) {
  await Promise.all(Array.from(context.openedTabIds).map(async (tabId) => {
    try {
      await context.bridgeCommand({
        cmd: "tabs",
        method: "close",
        tabId,
      });
    } catch {
      // Cleanup is best effort; case assertions report authoritative failures.
    }
  }));
  try {
    await context.callTool("browser_tab_lifecycle", {
      ...context.baseArgs,
      action: "finalize_task",
      workspace_key: context.workspaceKey,
      prune_stale: false,
    });
  } catch {
    // Best effort cleanup only.
  }
  await context.rpc?.close?.();
  await context.fixture.close();
  restoreRegistryPath(previousRegistryPath);
  await rm(registryDir, { recursive: true, force: true });
}

function restoreRegistryPath(previousRegistryPath) {
  if (previousRegistryPath === undefined) {
    delete process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
  } else {
    process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = previousRegistryPath;
  }
}

export {
  createManagedSmokeContext,
};
