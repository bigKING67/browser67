import assert from "node:assert/strict";

import { waitFor } from "./helpers.mjs";

async function runManagedLifecycleCase(context) {
  const beforeTabs = await context.listTabs();
  const previouslyActiveTabIds = beforeTabs.filter((tab) => tab.active).map((tab) => tab.id);
  const preexistingTabUrls = new Map(beforeTabs.map((tab) => [tab.id, tab.url]));
  const managedPath = `/tmwd-managed-lifecycle-smoke-${String(Date.now())}`;
  const managedUrl = `${context.fixture.origin}${managedPath}`;
  const managedArgs = {
    ...context.baseArgs,
    action: "select_or_create",
    url: managedUrl,
    workspace_key: context.workspaceKey,
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
  assert.equal(firstManaged.presentation?.focus_policy, "background_preferred");
  assert.equal(firstManaged.presentation?.window_policy, "dedicated");
  assert.equal(firstManaged.presentation?.active, false);
  assert.equal(firstManaged.agent_window?.ownership, "browser67_agent");
  assert.equal(firstManaged.agent_window?.presentation?.status, "ready");
  assert.equal(firstManaged.agent_window?.presentation?.toolbar_preserved, true);
  if (process.platform === "darwin") {
    assert.equal(firstManaged.agent_window?.presentation?.mode, "macos_native_fullscreen_space");
    assert.equal(firstManaged.agent_window?.presentation?.native_fullscreen, true);
    assert.equal(firstManaged.agent_window?.presentation?.window_state, "fullscreen");
  } else if (process.platform === "win32") {
    assert.equal(firstManaged.agent_window?.presentation?.mode, "windows_maximized");
    assert.equal(firstManaged.agent_window?.presentation?.maximized, true);
    assert.equal(firstManaged.agent_window?.presentation?.window_state, "maximized");
  }
  assert.equal(firstManaged.managed_tab?.window_ownership, "browser67_agent");
  assert.equal(firstManaged.managed_tab?.window_id, firstManaged.agent_window?.window_id);
  const createdTab = await context.bridgeCommand({
    cmd: "tabs",
    method: "get",
    tabId: managedTabId,
  });
  assert.equal(createdTab?.active, false, "default managed tab unexpectedly activated");
  assert.equal(createdTab?.windowId, firstManaged.agent_window?.window_id);
  const afterCreateTabs = await context.listTabs();
  for (const tabId of previouslyActiveTabIds) {
    assert.equal(
      afterCreateTabs.find((tab) => tab.id === tabId)?.active,
      true,
      `pre-existing active tab lost activation: ${tabId}`,
    );
  }
  assert.equal(
    firstManaged.policy_application?.applied,
    true,
    `managed extension policy was not applied: ${JSON.stringify(firstManaged.policy_application)}`,
  );
  assert.equal(firstManaged.managed_tab?.management_policy_applied, true, "managed registry did not persist policy application");
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

  const unscriptableReuseKey = `about-blank-reuse-${String(Date.now())}`;
  const unscriptableManaged = await context.callTool("browser_tab_lifecycle", {
    ...context.baseArgs,
    action: "select_or_create",
    url: "about:blank",
    workspace_key: context.workspaceKey,
    reuse_key: unscriptableReuseKey,
    reuse_scope: "exact",
    wait_until: "listed",
    wait_timeout_ms: 250,
    wait_poll_ms: 50,
  });
  const unscriptableTabId = String(unscriptableManaged?.managed_tab?.tab_id ?? "");
  assert.ok(unscriptableTabId, "about:blank managed create did not return tab id");
  context.openedTabIds.add(unscriptableTabId);
  assert.equal(unscriptableManaged.created, true, "about:blank fixture should create a managed tab");
  assert.equal(unscriptableManaged.ready, false, "about:blank should not claim runtime-session readiness");

  const exactReusePath = `/tmwd-managed-exact-reuse-${String(Date.now())}`;
  const exactReuseUrl = `${context.fixture.origin}${exactReusePath}`;
  const exactReuse = await context.callTool("browser_tab_lifecycle", {
    ...context.baseArgs,
    action: "select_or_create",
    url: exactReuseUrl,
    workspace_key: context.workspaceKey,
    reuse_key: unscriptableReuseKey,
    reuse_scope: "exact",
    navigate_reused: true,
    wait_until: "listed",
    wait_timeout_ms: 5_000,
    wait_poll_ms: 100,
  });
  assert.equal(exactReuse.reused, true, "about:blank fixture should be reused for exact navigation");
  assert.equal(String(exactReuse?.managed_tab?.tab_id ?? ""), unscriptableTabId);
  assert.equal(exactReuse.navigation?.ready, true, "exact reuse navigation did not become routable");
  assert.equal(exactReuse.navigation?.result?.url, exactReuseUrl);
  const exactReusedTab = await context.bridgeCommand({
    cmd: "tabs",
    method: "get",
    tabId: unscriptableTabId,
  });
  assert.equal(exactReusedTab?.url, exactReuseUrl, "exact managed tab did not receive reuse navigation");
  const afterExactReuseTabs = await context.listTabs();
  for (const [tabId, previousUrl] of preexistingTabUrls.entries()) {
    assert.equal(
      afterExactReuseTabs.find((tab) => tab.id === tabId)?.url,
      previousUrl,
      `reuse navigation changed a pre-existing tab: ${tabId}`,
    );
  }

  const managedFinalize = await context.callTool("browser_tab_lifecycle", {
    ...context.baseArgs,
    action: "finalize_task",
    workspace_key: context.workspaceKey,
    prune_stale: false,
    cleanup_created_agent_window: true,
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
  context.openedTabIds.delete(unscriptableTabId);

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
    summary_only: false,
  });
  assert.equal(Array.isArray(managedList.managed_tabs), true);
  assert.equal(managedList.managed_tabs.length, 0, "isolated managed registry should be empty after close");

  return {
    first_created: firstManaged.created === true,
    first_ready: firstManaged.ready === true,
    policy_applied: firstManaged.policy_application?.applied === true,
    dedicated_agent_window: firstManaged.managed_tab?.window_ownership === "browser67_agent",
    agent_window_presentation: firstManaged.agent_window?.presentation,
    background_default: createdTab?.active === false,
    preexisting_active_tabs_preserved: true,
    second_reused: secondManaged.reused === true,
    unscriptable_reuse_exact_target: exactReusedTab?.url === exactReuseUrl,
    preexisting_tab_urls_preserved: true,
    tab_id: managedTabId,
    closed_count: managedFinalize.close_unkept.closed.length,
  };
}

export {
  runManagedLifecycleCase,
};
