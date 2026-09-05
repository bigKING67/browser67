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
  assert.equal(health?.ok, true, "health.ok");
  if (!cli.allow_empty_tabs) {
    assert.equal(health?.readiness?.ready, true, "health.readiness.ready");
  }

  const fixture = await startHttpFixture();
  const workspaceKey = `js-reverse-live-${String(Date.now())}`;
  let finalized;
  let phase = "create";
  let failed = false;
  let cleanupErrorCode;
  let agentWindowCreated = false;
  try {
    const created = await callTool(rpc, "new_page", {
      ...commonArgs,
      url: `${fixture.origin}/js-reverse-managed-live`,
      workspace_key: workspaceKey,
    }, cli.timeout_ms);
    const pageId = String(created?.managed_page?.tab_id ?? created?.page?.id ?? "");
    assert.ok(pageId, "js-reverse new_page did not return a managed page id");
    assert.equal(created?.created, true, "create.created");
    assert.equal(created?.ready, true, "create.ready");
    assert.equal(created?.presentation?.focus_policy, "background_preferred", "create.focus_policy");
    assert.equal(created?.presentation?.window_policy, "dedicated", "create.window_policy");
    assert.equal(created?.presentation?.active, false, "create.active");
    assert.equal(created?.managed_page?.window_ownership, "browser67_agent", "create.window_ownership");
    assert.equal(created?.managed_page?.management_policy_applied, true, "create.management_policy_applied");
    agentWindowCreated = created?.agent_window?.created === true;

    phase = "list_scripts";
    const scriptsPayload = await callTool(rpc, "list_scripts", {
      ...commonArgs,
      page_id: pageId,
    }, cli.timeout_ms);
    const scripts = Array.isArray(scriptsPayload?.scripts) ? scriptsPayload.scripts : [];
    phase = "list_network_requests";
    const networkPayload = await callTool(rpc, "list_network_requests", {
      ...commonArgs,
      page_id: pageId,
    }, cli.timeout_ms);
    const requests = Array.isArray(networkPayload?.requests) ? networkPayload.requests : [];

    phase = "finalize";
    finalized = await callTool(rpc, "finalize_task", {
      ...commonArgs,
      workspace_key: workspaceKey,
      prune_stale: false,
      cleanup_created_agent_window: true,
    }, cli.timeout_ms);
    assert.equal(finalized?.ok, true, "finalize.ok");
    assert.equal(finalized?.remaining?.unkept_count, 0, "finalize.remaining.unkept_count");
    if (agentWindowCreated) {
      assert.equal(finalized?.agent_window_cleanup?.closed, true, "finalize.agent_window.closed");
      assert.equal(finalized?.agent_window_cleanup?.close_verified, true, "finalize.agent_window.close_verified");
      assert.equal(finalized?.agent_window_cleanup?.ownership_record_removed, true, "finalize.agent_window.ownership_record_removed");
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
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!finalized) {
      finalized = await callTool(rpc, "finalize_task", {
        ...commonArgs,
        workspace_key: workspaceKey,
        prune_stale: false,
        cleanup_created_agent_window: true,
      }, cli.timeout_ms).catch((error) => {
        cleanupErrorCode = String(error?.code ?? error?.name ?? "cleanup_failed");
      });
    }
    if (failed) {
      process.stderr.write(`${JSON.stringify({
        stage: "js_reverse_live_failure", phase,
        cleanup: {
          ok: finalized?.ok ?? null,
          remaining_unkept_count: finalized?.remaining?.unkept_count ?? null,
          window_closed: finalized?.agent_window_cleanup?.closed ?? null,
          window_cleanup_reason: finalized?.agent_window_cleanup?.reason ?? null,
          close_verified: finalized?.agent_window_cleanup?.close_verified ?? null,
          ownership_record_removed: finalized?.agent_window_cleanup?.ownership_record_removed ?? null,
          error_code: cleanupErrorCode ?? null,
        },
      })}\n`);
    }
    await fixture.close();
  }
}

export {
  runLiveCases,
};
