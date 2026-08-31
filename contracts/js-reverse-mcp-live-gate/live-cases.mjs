import assert from "node:assert/strict";

import { startHttpFixture } from "../browser-managed-tab-live-smoke/fixture.mjs";
import { callTool } from "./tool-call.mjs";

function buildCommonArgs(cli) {
  return {
    tmwd_mode: "tmwd",
    tmwd_transport: cli.tmwd_transport,
    tmwd_ws_endpoint: cli.tmwd_ws_endpoint,
    tmwd_link_endpoint: cli.tmwd_link_endpoint,
    timeout_ms: cli.timeout_ms,
  };
}

async function runLiveCases(rpc, cli) {
  const commonArgs = buildCommonArgs(cli);
  const health = await callTool(rpc, "check_browser_health", {
    ...commonArgs,
    summary_only: true,
  }, cli.timeout_ms);
  assert.equal(health?.ok, true);
  if (!cli.allow_empty_tabs) {
    assert.equal(health?.readiness?.ready, true);
  }

  const fixture = await startHttpFixture();
  const workspaceKey = `js-reverse-live-${String(Date.now())}`;
  let finalized;
  let agentWindowCreated = false;
  try {
    const created = await callTool(rpc, "new_page", {
      ...commonArgs,
      url: `${fixture.origin}/js-reverse-managed-live`,
      workspace_key: workspaceKey,
    }, cli.timeout_ms);
    const pageId = String(created?.managed_page?.tab_id ?? created?.page?.id ?? "");
    assert.ok(pageId, "js-reverse new_page did not return a managed page id");
    assert.equal(created?.created, true);
    assert.equal(created?.ready, true);
    assert.equal(created?.presentation?.focus_policy, "background_preferred");
    assert.equal(created?.presentation?.window_policy, "dedicated");
    assert.equal(created?.presentation?.active, false);
    assert.equal(created?.managed_page?.window_ownership, "browser67_agent");
    assert.equal(created?.managed_page?.management_policy_applied, true);
    agentWindowCreated = created?.agent_window?.created === true;

    const scriptsPayload = await callTool(rpc, "list_scripts", {
      ...commonArgs,
      page_id: pageId,
    }, cli.timeout_ms);
    const scripts = Array.isArray(scriptsPayload?.scripts) ? scriptsPayload.scripts : [];
    const networkPayload = await callTool(rpc, "list_network_requests", {
      ...commonArgs,
      page_id: pageId,
    }, cli.timeout_ms);
    const requests = Array.isArray(networkPayload?.requests) ? networkPayload.requests : [];

    finalized = await callTool(rpc, "finalize_task", {
      ...commonArgs,
      workspace_key: workspaceKey,
      prune_stale: false,
      cleanup_created_agent_window: true,
    }, cli.timeout_ms);
    assert.equal(finalized?.ok, true);
    assert.equal(finalized?.remaining?.unkept_count, 0);
    if (agentWindowCreated) {
      assert.equal(finalized?.agent_window_cleanup?.closed, true);
      assert.equal(finalized?.agent_window_cleanup?.close_verified, true);
    }
    return {
      health,
      pages_count: 1,
      scripts_count: scripts.length,
      requests_count: requests.length,
      managed_lifecycle: {
        created: true,
        ready: true,
        dedicated_agent_window: true,
        background_default: true,
        policy_applied: true,
        finalized: true,
      },
    };
  } finally {
    if (!finalized) {
      await callTool(rpc, "finalize_task", {
        ...commonArgs,
        workspace_key: workspaceKey,
        prune_stale: false,
        cleanup_created_agent_window: true,
      }, cli.timeout_ms).catch(() => {});
    }
    await fixture.close();
  }
}

export {
  runLiveCases,
};
