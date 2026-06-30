import assert from "node:assert/strict";

import { waitFor } from "./helpers.mjs";

async function runManagedLifecycleCase(context) {
  const managedPath = `/tmwd-managed-lifecycle-smoke-${String(Date.now())}`;
  const managedUrl = `${context.fixture.origin}${managedPath}`;
  const managedArgs = {
    ...context.baseArgs,
    action: "select_or_create",
    url: managedUrl,
    workspace_key: context.workspaceKey,
    active: false,
    wait_until: "listed",
    wait_timeout_ms: 5_000,
    wait_poll_ms: 100,
  };
  const firstManaged = await context.callTool("browser_tab_lifecycle", managedArgs);
  const managedTabId = String(firstManaged?.managed_tab?.tab_id ?? "");
  assert.ok(managedTabId, "managed lifecycle create did not return tab id");
  context.openedTabIds.add(managedTabId);
  assert.equal(firstManaged.created, true, "first select_or_create should create a managed tab");
  assert.equal(firstManaged.ready, true, "managed tab should become visible before timeout");
  assert.equal(firstManaged.finalize_hint?.required, true, "created managed tab should carry a required finalize hint");
  assert.equal(
    firstManaged.finalize_hint?.suggested_arguments?.workspace_key,
    context.workspaceKey,
    "finalize hint should point at the live smoke workspace",
  );

  const secondManaged = await context.callTool("browser_tab_lifecycle", managedArgs);
  assert.equal(secondManaged.reused, true, "second select_or_create should reuse the managed tab");
  assert.equal(String(secondManaged?.managed_tab?.tab_id ?? ""), managedTabId, "managed lifecycle reused a different tab");
  assert.equal(secondManaged.finalize_hint?.required, true, "reused managed tab should still carry a required finalize hint");

  const managedFinalize = await context.callTool("browser_tab_lifecycle", {
    ...context.baseArgs,
    action: "finalize_task",
    workspace_key: context.workspaceKey,
    prune_stale: false,
  });
  assert.equal(managedFinalize.status, "success", "managed finalize_task did not succeed");
  assert.equal(
    managedFinalize.close_unkept.closed.some((row) => String(row?.tab_id ?? "") === managedTabId && row.closed === true),
    true,
    "managed finalize_task did not close the managed tab",
  );
  assert.equal(
    managedFinalize.close_unkept.closed.some((row) => String(row?.tab_id ?? "") === managedTabId && row.close_verified === true),
    true,
    "managed finalize_task did not verify the managed tab closure",
  );
  context.openedTabIds.delete(managedTabId);

  const managedGone = await waitFor(async () => {
    const tabs = await context.listTabs();
    return {
      ok: !tabs.some((tab) => tab.id === managedTabId),
      tabs,
    };
  }, 5_000);
  assert.equal(managedGone.ok, true, "managed tab remained after close_unkept");

  const managedList = await context.callTool("browser_tab_lifecycle", {
    ...context.baseArgs,
    action: "list_managed",
  });
  assert.equal(Array.isArray(managedList.managed_tabs), true);
  assert.equal(managedList.managed_tabs.length, 0, "isolated managed registry should be empty after close");

  return {
    first_created: firstManaged.created === true,
    first_ready: firstManaged.ready === true,
    second_reused: secondManaged.reused === true,
    tab_id: managedTabId,
    closed_count: managedFinalize.close_unkept.closed.length,
  };
}

export {
  runManagedLifecycleCase,
};
