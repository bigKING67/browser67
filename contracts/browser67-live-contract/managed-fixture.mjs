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
    const browserInstanceId = String(created?.managed_tab?.browser_instance_id ?? "").trim();
    if (!tabId || created?.ready !== true) {
      throw new Error(`managed live fixture did not become ready: ${JSON.stringify(created)}`);
    }
    return {
      fixture,
      tab_id: tabId,
      browser_instance_id: browserInstanceId,
      workspace_key: workspaceKey,
      task_id: taskId,
      created: created?.created === true,
      agent_window_created: created?.agent_window?.created === true,
      agent_window_id: created?.agent_window?.window_id,
      agent_window_anchor_tab_id: created?.agent_window?.anchor_tab_id,
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
      cleanup_created_agent_window: fixtureContext.agent_window_created === true,
    });
    if (finalized?.status !== "success") {
      throw new Error(`managed live fixture finalization failed: ${JSON.stringify(finalized)}`);
    }
    if (
      fixtureContext.agent_window_created === true
      && (
        finalized?.agent_window_cleanup?.closed !== true
        || finalized?.agent_window_cleanup?.close_verified !== true
        || finalized?.agent_window_cleanup?.ownership_record_removed !== true
      )
    ) {
      throw new Error(`managed live fixture Agent window cleanup was not verified: ${JSON.stringify(finalized?.agent_window_cleanup)}`);
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
