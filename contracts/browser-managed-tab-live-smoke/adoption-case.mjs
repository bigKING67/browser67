import assert from "node:assert/strict";

import { extractTabId, waitFor } from "./helpers.mjs";

const PAGE_POLICY_STATE = `
return {
  badge: Boolean(document.getElementById('browser67-managed-badge')),
  marker: document.documentElement.hasAttribute('data-browser67-managed'),
  confirm_native: /\\[native code\\]/.test(Function.prototype.toString.call(window.confirm)),
  inline_script_ran: globalThis.__browser67InlineScriptRan === true,
  pathname: location.pathname
};`;

function scopedArgs(context, tabId) {
  return {
    ...context.baseArgs,
    tab_id: tabId,
    switch_tab_id: tabId,
    session_id: tabId,
    workspace_key: context.workspaceKey,
    task_id: "adoption-live",
  };
}

async function waitForPolicyState(context, tabId, predicate) {
  return waitFor(async () => {
    const state = await context.bridgeCommand({
      cmd: "policy",
      method: "status",
      tabId,
    });
    return { ok: predicate(state), state };
  }, 5_000, 100);
}

async function runAdoptionCase(context) {
  const ordinaryUrl = `${context.fixture.origin}/ordinary-adoption-live`;
  const ordinaryCreate = await context.bridgeCommand({
    cmd: "tabs",
    method: "create",
    url: ordinaryUrl,
    active: false,
  });
  const tabId = extractTabId(ordinaryCreate);
  assert.ok(tabId, "ordinary adoption fixture did not return tab id");
  context.openedTabIds.add(tabId);

  const ordinaryReady = await waitFor(async () => {
    const tabs = await context.listTabs();
    return {
      ok: tabs.some((tab) => tab.id === tabId && tab.url.includes("/ordinary-adoption-live")),
      tabs,
    };
  }, 5_000);
  assert.equal(ordinaryReady.ok, true, "ordinary adoption fixture did not become visible");

  const ordinaryPolicy = await context.bridgeCommand({ cmd: "policy", method: "status", tabId });
  assert.equal(ordinaryPolicy?.managed, false, "ordinary tab unexpectedly had a managed policy");
  const ordinaryPage = await context.readPage(tabId, PAGE_POLICY_STATE);
  assert.deepEqual({
    badge: ordinaryPage?.badge,
    marker: ordinaryPage?.marker,
    confirm_native: ordinaryPage?.confirm_native,
    inline_script_ran: ordinaryPage?.inline_script_ran,
  }, {
    badge: false,
    marker: false,
    confirm_native: true,
    inline_script_ran: false,
  }, "ordinary tab behavior was modified before adoption");

  const unmanagedExecution = await context.callToolError("browser_execute_js", {
    ...scopedArgs(context, tabId),
    script: "return document.title;",
    no_monitor: true,
  });
  assert.equal(unmanagedExecution?.error_code, "TAB_NOT_MANAGED");

  const inspection = await context.callTool("browser_tab_lifecycle", {
    ...scopedArgs(context, tabId),
    action: "inspect_adoption",
  });
  assert.equal(inspection.current_ownership?.ownership_origin, "user_unmanaged");
  assert.equal(
    inspection.requires_user_confirmation,
    true,
    `adoption inspection did not require confirmation: ${JSON.stringify(inspection)}`,
  );

  const adopted = await context.callTool("browser_tab_lifecycle", {
    ...scopedArgs(context, tabId),
    action: "adopt_existing",
    adoption_token: inspection.adoption_token,
    confirm_adopt: true,
    policy: {
      csp_override: "off",
      dialog: "native",
      badge: "managed",
      marker: "managed",
    },
  });
  assert.equal(adopted.adopted, true, `adopt_existing did not adopt the tab: ${JSON.stringify(adopted)}`);
  assert.equal(adopted.reloaded, false, `adopt_existing unexpectedly reloaded the tab: ${JSON.stringify(adopted)}`);
  assert.equal(
    adopted.managed_tab?.ownership_origin,
    "user_adopted",
    `adopt_existing persisted the wrong ownership: ${JSON.stringify(adopted)}`,
  );
  assert.equal(
    adopted.policy_application?.applied,
    true,
    `adopt_existing did not apply the managed policy: ${JSON.stringify(adopted)}`,
  );
  const firstLeaseId = adopted.lease?.lease_id;

  const managedPage = await context.callTool("browser_execute_js", {
    ...scopedArgs(context, tabId),
    script: PAGE_POLICY_STATE,
    no_monitor: true,
  });
  assert.equal(managedPage.js_return?.badge, true, `managed badge missing after adoption: ${JSON.stringify(managedPage)}`);
  assert.equal(managedPage.js_return?.marker, true, `managed marker missing after adoption: ${JSON.stringify(managedPage)}`);
  assert.equal(
    managedPage.js_return?.confirm_native,
    true,
    `native confirm was replaced after adoption: ${JSON.stringify(managedPage)}`,
  );

  const networkObserved = await context.callTool("browser_execute_js", {
    ...scopedArgs(context, tabId),
    script: "const response = await fetch('/network-probe?ms=120', { cache: 'no-store' }); return await response.json();",
    no_monitor: true,
    network_observation: {
      enabled: true,
      ttl_ms: 3_000,
      idle_ms: 100,
      max_inflight: 0,
      interval_ms: 25,
    },
  });
  assert.equal(networkObserved.status, "success", `network-observed execution failed: ${JSON.stringify(networkObserved)}`);
  assert.equal(networkObserved.js_return?.ok, true, `network probe did not complete: ${JSON.stringify(networkObserved)}`);
  assert.equal(
    networkObserved.network_observation?.idle_status,
    "passed",
    `network observation did not reach idle: ${JSON.stringify(networkObserved.network_observation)}`,
  );
  assert.equal(
    networkObserved.network_observation?.observed_count >= 1,
    true,
    `network observation missed the fixture request: ${JSON.stringify(networkObserved.network_observation)}`,
  );

  const agentNavigation = await context.callTool("browser_execute_js", {
    ...scopedArgs(context, tabId),
    script: "history.pushState({}, '', '/agent-authorized-navigation'); return location.pathname;",
    no_monitor: true,
  });
  assert.equal(
    agentNavigation.navigation_authorization?.present,
    true,
    `Agent navigation authorization was not emitted: ${JSON.stringify(agentNavigation)}`,
  );
  assert.equal(
    agentNavigation.navigation_authorization?.redacted,
    true,
    `Agent navigation authorization leaked through the MCP outcome: ${JSON.stringify(agentNavigation)}`,
  );
  const agentPolicy = await waitForPolicyState(
    context,
    tabId,
    (state) => state?.last_navigation_actor === "agent_authorized" && state?.navigation_generation >= 1,
  );
  assert.equal(agentPolicy.ok, true, "extension did not observe authorized Agent navigation");

  const reconciled = await context.callTool("browser_execute_js", {
    ...scopedArgs(context, tabId),
    script: "return location.pathname;",
    no_monitor: true,
  });
  assert.equal(
    reconciled.management?.navigation_guard?.status,
    "authorized_navigation_accepted",
    `authorized navigation was not reconciled: ${JSON.stringify(reconciled)}`,
  );
  assert.equal(
    reconciled.js_return,
    "/agent-authorized-navigation",
    `Agent navigation reached the wrong path: ${JSON.stringify(reconciled)}`,
  );

  await context.readPage(
    tabId,
    "history.pushState({}, '', input.path); return location.pathname;",
    { path: "/out-of-band-navigation" },
  );
  const outOfBandPolicy = await waitForPolicyState(
    context,
    tabId,
    (state) => state?.last_navigation_actor === "out_of_band" && state?.navigation_generation >= 2,
  );
  assert.equal(outOfBandPolicy.ok, true, "extension did not observe out-of-band navigation");

  const suspended = await context.callToolError("browser_execute_js", {
    ...scopedArgs(context, tabId),
    script: "return location.pathname;",
    no_monitor: true,
  });
  assert.equal(suspended.error_code, "ADOPTED_TAB_SUSPENDED");
  assert.equal(suspended.details?.reason, "out_of_band_navigation");

  const reinspection = await context.callTool("browser_tab_lifecycle", {
    ...scopedArgs(context, tabId),
    action: "inspect_adoption",
  });
  const readopted = await context.callTool("browser_tab_lifecycle", {
    ...scopedArgs(context, tabId),
    action: "adopt_existing",
    adoption_token: reinspection.adoption_token,
    confirm_adopt: true,
  });
  assert.equal(readopted.adopted, true, `re-adoption did not recover the tab: ${JSON.stringify(readopted)}`);
  assert.notEqual(readopted.lease?.lease_id, firstLeaseId);

  const finalized = await context.callTool("browser_tab_lifecycle", {
    ...context.baseArgs,
    action: "finalize_task",
    workspace_key: context.workspaceKey,
    prune_stale: false,
  });
  assert.equal(finalized.status, "success");
  assert.equal(
    finalized.release_adopted?.some((row) => row.tab_id === tabId && row.released === true && row.closed === false),
    true,
    "finalize_task did not release the adopted tab without closing it",
  );
  const remainingTabs = await context.listTabs();
  assert.equal(remainingTabs.some((tab) => tab.id === tabId), true, "finalize_task closed the adopted user tab");
  const releasedPolicy = await context.bridgeCommand({ cmd: "policy", method: "status", tabId });
  assert.equal(releasedPolicy?.managed, false);
  const releasedPage = await context.readPage(tabId, PAGE_POLICY_STATE);
  assert.equal(releasedPage?.badge, false);
  assert.equal(releasedPage?.marker, false);
  assert.equal(releasedPage?.confirm_native, true);

  const closed = await context.bridgeCommand({ cmd: "tabs", method: "close", tabId });
  assert.equal(closed?.closed, true);
  context.openedTabIds.delete(tabId);

  return {
    ordinary_unmanaged: true,
    ordinary_native_dialogs: ordinaryPage.confirm_native === true,
    ordinary_csp_preserved: ordinaryPage.inline_script_ran === false,
    unmanaged_raw_execution_rejected: unmanagedExecution.error_code === "TAB_NOT_MANAGED",
    adopted_in_place: adopted.reloaded === false,
    managed_badge_marker: managedPage.js_return?.badge === true && managedPage.js_return?.marker === true,
    raw_network_observation: networkObserved.network_observation?.idle_status === "passed",
    agent_navigation_authorized: agentPolicy.state?.last_navigation_actor === "agent_authorized",
    out_of_band_navigation_suspended: suspended.error_code === "ADOPTED_TAB_SUSPENDED",
    readoption_recovered: readopted.adopted === true,
    finalize_released_without_close: true,
  };
}

export { runAdoptionCase };
