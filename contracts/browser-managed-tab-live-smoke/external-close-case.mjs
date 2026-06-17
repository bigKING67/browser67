import assert from "node:assert/strict";

import { waitFor } from "./helpers.mjs";

async function runExternalCloseCase(context) {
  const externallyClosedPath = `/tmwd-managed-external-close-smoke-${String(Date.now())}`;
  const externallyClosedUrl = `${context.fixture.origin}${externallyClosedPath}`;
  const externallyClosedWorkspace = `${context.workspaceKey}-external-close`;
  const externalArgs = {
    ...context.baseArgs,
    action: "select_or_create",
    url: externallyClosedUrl,
    workspace_key: externallyClosedWorkspace,
    active: false,
    wait_until: "listed",
    wait_timeout_ms: 5_000,
    wait_poll_ms: 100,
  };
  const externalFirst = await context.callTool("browser_tab_lifecycle", externalArgs);
  const externallyClosedTabId = String(externalFirst?.managed_tab?.tab_id ?? "");
  assert.ok(externallyClosedTabId, "external-close managed create did not return tab id");
  assert.equal(externalFirst.created, true, "external-close first select_or_create should create a managed tab");
  context.openedTabIds.add(externallyClosedTabId);

  const externalDirectClose = await context.bridgeCommand({
    cmd: "tabs",
    method: "close",
    tabId: externallyClosedTabId,
  });
  assert.equal(externalDirectClose?.closed, true, "external-close tabs.close did not confirm closed=true");
  context.openedTabIds.delete(externallyClosedTabId);

  const externalGone = await waitFor(async () => {
    const tabs = await context.listTabs();
    return {
      ok: !tabs.some((tab) => tab.id === externallyClosedTabId),
      tabs,
    };
  }, 5_000);
  assert.equal(externalGone.ok, true, "externally closed managed tab remained after tabs.close");

  const liveOnlyAfterExternalClose = await context.callTool("browser_tab_lifecycle", {
    ...context.baseArgs,
    action: "list_managed",
  });
  assert.equal(
    liveOnlyAfterExternalClose.managed_tabs.some((row) => String(row?.tab_id ?? "") === externallyClosedTabId),
    false,
    "list_managed default should hide externally closed stale managed tabs",
  );
  assert.equal(
    liveOnlyAfterExternalClose.live_filter?.stale?.some((row) => String(row?.tab_id ?? "") === externallyClosedTabId),
    true,
    "list_managed should report externally closed managed tab as stale evidence",
  );

  const historyAfterExternalClose = await context.callTool("browser_tab_lifecycle", {
    ...context.baseArgs,
    action: "list_managed",
    include_disconnected: true,
  });
  assert.equal(
    historyAfterExternalClose.managed_tabs.some((row) => String(row?.tab_id ?? "") === externallyClosedTabId),
    true,
    "list_managed include_disconnected should expose stale registry history",
  );

  const externalReplacement = await context.callTool("browser_tab_lifecycle", externalArgs);
  const replacementTabId = String(externalReplacement?.managed_tab?.tab_id ?? "");
  assert.ok(replacementTabId, "external-close replacement did not return tab id");
  assert.equal(externalReplacement.created, true, "externally closed managed tab should not be reused");
  assert.notEqual(replacementTabId, externallyClosedTabId, "externally closed managed tab id was reused");
  context.openedTabIds.add(replacementTabId);

  const externalCleanup = await context.callTool("browser_tab_lifecycle", {
    ...context.baseArgs,
    action: "finalize_task",
    workspace_key: externallyClosedWorkspace,
    prune_stale: false,
  });
  assert.equal(externalCleanup.status, "success", "external-close cleanup did not succeed");
  assert.equal(
    externalCleanup.close_unkept.closed.some((row) => String(row?.tab_id ?? "") === replacementTabId && row.closed === true),
    true,
    "external-close cleanup did not close replacement managed tab",
  );
  context.openedTabIds.delete(replacementTabId);

  const finalManagedList = await context.callTool("browser_tab_lifecycle", {
    ...context.baseArgs,
    action: "list_managed",
  });
  assert.equal(Array.isArray(finalManagedList.managed_tabs), true);
  assert.equal(finalManagedList.managed_tabs.length, 0, "isolated managed registry should be empty after external-close cleanup");

  return {
    externally_closed_not_reused: externalReplacement.created === true && replacementTabId !== externallyClosedTabId,
  };
}

export {
  runExternalCloseCase,
};
