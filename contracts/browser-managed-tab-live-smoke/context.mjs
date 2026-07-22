import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

import {
  executeBrowserScript,
  executeTmwdCommand,
} from "../../src/browser-wrappers/shared.mjs";
import { disposeTmwdRuntime } from "../../src/tmwd-runtime.mjs";
import { createRpcClient } from "../browser67-browser-mcp-contract/rpc-client.mjs";
import { firstJsonContent } from "../browser67-browser-mcp-contract/rpc-content.mjs";
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
  assert.equal(init?.result?.serverInfo?.name, "browser67-tmwd-browser");
  rpc.notify("notifications/initialized", {});
}

function createToolHelpers({ cli, rpc }) {
  const baseArgs = commonArgs(cli);
  const requestTool = async (name, args) => {
    const response = await rpc.call("tools/call", { name, arguments: args }, cli.timeout_ms);
    return {
      payload: firstJsonContent(response?.result),
      response,
    };
  };
  const callTool = async (name, args) => {
    const { payload, response } = await requestTool(name, args);
    if (response?.result?.isError === true) {
      const details = payload?.details ? ` details=${JSON.stringify(payload.details)}` : "";
      throw new Error(`${name} failed: ${String(payload?.error ?? payload?.message ?? "tool error")}${details}`);
    }
    if (payload?.status === "failed") {
      throw new Error(`${name} failed: ${String(payload.error ?? "unknown error")}`);
    }
    return payload;
  };
  const callToolError = async (name, args) => {
    const { payload, response } = await requestTool(name, args);
    assert.equal(response?.result?.isError, true, `${name} should return a tool error`);
    return payload;
  };

  const bridgeCommand = async (command) => {
    const result = await executeTmwdCommand(baseArgs, command);
    return result.value;
  };

  const listTabs = async () => normalizeTabs(await bridgeCommand({
    cmd: "tabs",
    method: "list",
    includeUnscriptable: true,
  }));

  const readPage = async (tabId, body, input = {}) => {
    const result = await executeBrowserScript({
      ...baseArgs,
      tab_id: tabId,
      switch_tab_id: tabId,
      session_id: tabId,
    }, body, input);
    return result.value;
  };

  return {
    baseArgs,
    bridgeCommand,
    callTool,
    callToolError,
    listTabs,
    readPage,
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
  await disposeTmwdRuntime({ reason: "managed tab live smoke partial cleanup" });
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
  await disposeTmwdRuntime({ reason: "managed tab live smoke cleanup" });
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
