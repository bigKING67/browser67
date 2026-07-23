import { firstJsonContent } from "../browser67-browser-mcp-contract/rpc-content.mjs";
import { startHttpFixture } from "../browser-managed-tab-live-smoke/fixture.mjs";
import { buildLivePrereqHint, toToolErrorSummary } from "./errors.mjs";

async function callLifecycle(rpc, cli, argumentsPayload) {
  const response = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: argumentsPayload,
    },
    cli.timeout_ms,
  );
  const payload = firstJsonContent(response?.result);
  if (response?.result?.isError === true) {
    throw new Error(`live browser_tab_lifecycle failed: ${toToolErrorSummary(payload)} ${buildLivePrereqHint(cli)}`);
  }
  return payload;
}

async function createManagedLiveFixture({ rpc, cli, commonArgs }) {
  const fixture = await startHttpFixture();
  const suffix = `${String(process.pid)}-${String(Date.now())}`;
  const workspaceKey = `browser67-live-contract-${suffix}`;
  const taskId = `browser67-live-contract-${suffix}`;
  try {
    const created = await callLifecycle(rpc, cli, {
      ...commonArgs,
      action: "select_or_create",
      url: `${fixture.origin}/browser67-live-contract`,
      workspace_key: workspaceKey,
      task_id: taskId,
      active: false,
      fresh: true,
      reuse: false,
      reuse_scope: "none",
      wait_until: "listed",
      wait_timeout_ms: 5_000,
      wait_poll_ms: 100,
      policy: {
        csp_override: "off",
        dialog: "native",
        badge: "off",
        marker: "off",
      },
    });
    const tabId = String(created?.managed_tab?.tab_id ?? "").trim();
    if (!tabId || created?.ready !== true) {
      throw new Error(`managed live fixture did not become ready: ${JSON.stringify(created)}`);
    }
    return {
      fixture,
      tab_id: tabId,
      workspace_key: workspaceKey,
      task_id: taskId,
      created: created?.created === true,
    };
  } catch (error) {
    await fixture.close();
    throw error;
  }
}

async function finalizeManagedLiveFixture({ rpc, cli, commonArgs, fixtureContext }) {
  if (!fixtureContext) return null;
  try {
    const finalized = await callLifecycle(rpc, cli, {
      ...commonArgs,
      action: "finalize_task",
      workspace_key: fixtureContext.workspace_key,
      task_id: fixtureContext.task_id,
      prune_stale: false,
      summary_only: true,
    });
    if (finalized?.status !== "success") {
      throw new Error(`managed live fixture finalization failed: ${JSON.stringify(finalized)}`);
    }
    return finalized;
  } finally {
    await fixtureContext.fixture.close();
  }
}

export {
  createManagedLiveFixture,
  finalizeManagedLiveFixture,
};
