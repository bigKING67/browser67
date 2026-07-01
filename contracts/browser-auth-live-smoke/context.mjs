import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRpcClient } from "../browser67-browser-mcp-contract/rpc-client.mjs";
import { startAuthFixture } from "./fixture.mjs";
import { commonArgs, createToolCaller } from "./helpers.mjs";

async function createAuthLiveContext(cli) {
  const registryDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-auth-live-registry-"));
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-auth-live-profiles-"));
  const previousRegistryPath = process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
  const previousProfileDir = process.env.BROWSER_STRUCTURED_LOGIN_PROFILE_DIR;
  process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = path.join(registryDir, "managed-tabs.json");
  process.env.BROWSER_STRUCTURED_LOGIN_PROFILE_DIR = profileDir;

  const fixture = await startAuthFixture();
  const rpc = createRpcClient();
  const workspaceKey = `auth-live-${String(Date.now())}`;
  const callTool = createToolCaller({ rpc, cli });

  return {
    callTool,
    cli,
    fixture,
    previousProfileDir,
    previousRegistryPath,
    profileDir,
    registryDir,
    rpc,
    workspaceKey,
    async close() {
      try {
        await callTool("browser_tab_lifecycle", {
          ...commonArgs(cli),
          action: "finalize_task",
          workspace_key: workspaceKey,
          prune_stale: false,
        });
      } catch {
        // Best effort cleanup only.
      }
      await rpc.close();
      await fixture.close();
      restoreEnv("BROWSER_STRUCTURED_TAB_REGISTRY_PATH", previousRegistryPath);
      restoreEnv("BROWSER_STRUCTURED_LOGIN_PROFILE_DIR", previousProfileDir);
      await rm(registryDir, { recursive: true, force: true });
      await rm(profileDir, { recursive: true, force: true });
    },
  };
}

async function initializeMcp(context) {
  const init = await context.rpc.call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "browser-auth-live-smoke",
      version: "1.0.0",
    },
  }, context.cli.timeout_ms);
  assert.equal(init?.result?.serverInfo?.name, "browser67-tmwd-browser");
  context.rpc.notify("notifications/initialized", {});
}

function restoreEnv(name, previousValue) {
  if (previousValue === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = previousValue;
}

export {
  createAuthLiveContext,
  initializeMcp,
};
