import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import {
  DEFAULT_MANAGED_TAB_SCOPE_LIMIT,
  evaluateManagedTabCapacity,
} from "../../src/tab-workspace/capacity.mjs";
import {
  navigateReusableManagedTab,
} from "../../src/browser-wrappers/tab-lifecycle-navigation.mjs";
import {
  assertTextJsonContent,
  firstJsonContent,
  firstOutcomeContent,
} from "./rpc-content.mjs";

async function assertExternalRegistryRefresh({ registryPath, rpc, timeoutMs }) {
  if (!registryPath) {
    throw new Error("registryPath is required for external registry refresh contract");
  }
  const now = new Date().toISOString();
  await writeFile(registryPath, `${JSON.stringify({
    version: 1,
    updated_at: now,
    managed_tabs: [{
      tab_id: "external-disk-tab",
      owner: "tmwd",
      source: "contract",
      workspace_key: "external-disk-workspace",
      reuse_key: "http://external.example/path",
      url: "http://external.example/path/page",
      title: "External disk tab",
      origin: "http://external.example",
      path_scope: "/path",
      keep: false,
      dry_run: false,
      status: "open",
      created_at: now,
      updated_at: now,
      last_used_at: now,
    }],
  }, null, 2)}\n`);
  const externalListCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "list_managed",
        include_disconnected: true,
        summary_only: false,
      },
    },
    timeoutMs,
  );
  assert.equal(externalListCall?.result?.isError, undefined);
  const externalListPayload = firstJsonContent(externalListCall.result);
  assert.equal(externalListPayload?.summary?.registry_count, 1);
  assert.equal(externalListPayload?.managed_tabs?.[0]?.tab_id, "external-disk-tab");

  const sharedTabId = "same-tab-id";
  const baseRecord = {
    tab_id: sharedTabId,
    owner: "tmwd",
    source: "contract",
    workspace_key: "multi-instance-workspace",
    reuse_key: "http://multi.example/path",
    url: "http://multi.example/path/page",
    title: "Multi-instance tab",
    origin: "http://multi.example",
    path_scope: "/path",
    keep: false,
    dry_run: false,
    status: "open",
    created_at: now,
    updated_at: now,
    last_used_at: now,
  };
  await writeFile(registryPath, `${JSON.stringify({
    version: 3,
    updated_at: new Date().toISOString(),
    managed_tabs: [
      { ...baseRecord, browser_instance_id: "browser-instance-a" },
      { ...baseRecord, browser_instance_id: "browser-instance-b" },
    ],
  }, null, 2)}\n`);
  const multiInstanceListCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: { action: "list_managed", include_disconnected: true, summary_only: false },
    },
    timeoutMs,
  );
  const multiInstanceListPayload = firstJsonContent(multiInstanceListCall.result);
  assert.equal(multiInstanceListPayload?.summary?.registry_count, 2);
  assert.deepEqual(
    multiInstanceListPayload?.managed_tabs?.map((row) => row.session_key).sort(),
    ["browser-instance-a:same-tab-id", "browser-instance-b:same-tab-id"],
  );

  const markInstanceACall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "mark_keep",
        browser_instance_id: "browser-instance-a",
        tab_id: sharedTabId,
        keep: true,
      },
    },
    timeoutMs,
  );
  assert.equal(markInstanceACall?.result?.isError, undefined);
  const persistedMultiInstanceRegistry = JSON.parse(await readFile(registryPath, "utf8"));
  if (process.platform !== "win32") {
    assert.equal((await stat(registryPath)).mode & 0o777, 0o600);
  }
  assert.equal(persistedMultiInstanceRegistry.version, 3);
  assert.equal(persistedMultiInstanceRegistry.managed_tabs.length, 2);
  assert.equal(
    persistedMultiInstanceRegistry.managed_tabs.find((row) => row.browser_instance_id === "browser-instance-a")?.keep,
    true,
  );
  assert.equal(
    persistedMultiInstanceRegistry.managed_tabs.find((row) => row.browser_instance_id === "browser-instance-b")?.keep,
    false,
  );

  const finalizeInstanceACall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "finalize_task",
        workspace_key: "multi-instance-workspace",
        browser_instance_id: "browser-instance-a",
        prune_stale: false,
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(finalizeInstanceACall?.result?.isError, undefined);
  const finalizeInstanceAPayload = firstJsonContent(finalizeInstanceACall.result);
  assert.equal(finalizeInstanceAPayload?.close_scope?.browser_instance_id, "browser-instance-a");
  assert.equal(finalizeInstanceAPayload?.close_scope?.browser_instance_scope, "explicit");
  assert.equal(finalizeInstanceAPayload?.remaining?.total_count, 1);
  assert.equal(finalizeInstanceAPayload?.remaining?.kept_count, 1);
  assert.equal(finalizeInstanceAPayload?.cleanup_summary?.browser_instance_id, "browser-instance-a");
  assert.match(
    finalizeInstanceAPayload?.delivery_summary ?? "",
    /browser_instance_id=browser-instance-a/,
  );

  const ambiguousFinalizeCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "finalize_task",
        workspace_key: "multi-instance-workspace",
        prune_stale: false,
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(ambiguousFinalizeCall?.result?.isError, true);
  assert.equal(firstJsonContent(ambiguousFinalizeCall.result)?.error_code, "AMBIGUOUS_TARGET");

  const confirmedAllInstancesCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "finalize_task",
        workspace_key: "multi-instance-workspace",
        confirm_all_browser_instances: true,
        prune_stale: false,
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(confirmedAllInstancesCall?.result?.isError, undefined);
  const confirmedAllInstancesPayload = firstJsonContent(confirmedAllInstancesCall.result);
  assert.equal(confirmedAllInstancesPayload?.close_scope?.browser_instance_scope, "confirmed_all");
  assert.equal(confirmedAllInstancesPayload?.close_scope?.all_browser_instances, true);
  assert.equal(confirmedAllInstancesPayload?.remaining?.total_count, 2);
  assert.equal(confirmedAllInstancesPayload?.cleanup_summary?.all_browser_instances, true);
  assert.match(
    confirmedAllInstancesPayload?.delivery_summary ?? "",
    /browser_instances=all_confirmed/,
  );

  const conflictingInstanceScopeCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "finalize_task",
        workspace_key: "multi-instance-workspace",
        browser_instance_id: "browser-instance-a",
        confirm_all_browser_instances: true,
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(conflictingInstanceScopeCall?.result?.isError, true);
  assert.equal(firstJsonContent(conflictingInstanceScopeCall.result)?.error_code, "INVALID_ARGUMENT");

  await writeFile(registryPath, `${JSON.stringify({
    version: 3,
    updated_at: new Date().toISOString(),
    managed_tabs: [],
  }, null, 2)}\n`);
  const clearedListCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "list_managed",
        include_disconnected: true,
        summary_only: false,
      },
    },
    timeoutMs,
  );
  assert.equal(clearedListCall?.result?.isError, undefined);
  const clearedListPayload = firstJsonContent(clearedListCall.result);
  assert.equal(clearedListPayload?.summary?.registry_count, 0);
}

export async function assertTabLifecycleOpsContract({ registryPath, rpc, timeoutMs }) {
  const navigationCommands = [];
  const navigated = await navigateReusableManagedTab(
    { workspace_key: "navigation-contract", task_id: "exact-target" },
    { transport: "tmwd_ws", context: { target: { id: "bridge-host" } } },
    {
      tab_id: "managed-tab",
      browser_instance_id: "managed-browser",
      ownership_origin: "agent_created",
      observed_url: "about:blank",
      url: "about:blank",
      title: "about:blank",
    },
    "http://example.test/exact",
    async (command) => {
      navigationCommands.push(command);
      return {
        transport: "tmwd_ws",
        transport_attempts: [{ transport: "tmwd_ws", status: "ok" }],
      };
    },
    {
      wait_for_managed_tab_visible: async () => ({
        ready: true,
        ready_source: "runtime_session",
        ready_after_ms: 12,
        tab: {
          id: "managed-tab",
          tab_id: "managed-tab",
          browser_instance_id: "managed-browser",
          url: "http://example.test/exact",
          title: "Exact managed target",
        },
      }),
    },
  );
  assert.deepEqual(navigationCommands, [{
    cmd: "cdp",
    method: "Page.navigate",
    tabId: "managed-tab",
    params: { url: "http://example.test/exact" },
  }]);
  assert.equal(navigated.navigation.result.url, "http://example.test/exact");
  assert.equal(navigated.navigation.result.title, "Exact managed target");
  assert.equal(navigated.navigation.ready, true);

  let mismatchCommandCount = 0;
  await assert.rejects(
    navigateReusableManagedTab(
      { workspace_key: "navigation-contract", task_id: "adopted-exact-target" },
      { transport: "tmwd_ws", context: { target: { id: "bridge-host" } } },
      {
        tab_id: "adopted-tab",
        browser_instance_id: "managed-browser",
        ownership_origin: "user_adopted",
        observed_url: "http://example.test/old",
        url: "http://example.test/old",
        title: "Adopted target",
      },
      "http://example.test/new",
      async () => {
        mismatchCommandCount += 1;
        return { transport: "tmwd_ws" };
      },
      {
        resolve_preferred_browser_context: async () => ({
          transport: "tmwd_ws",
          context: {
            target: {
              id: "unmanaged-default-tab",
              browser_instance_id: "managed-browser",
            },
          },
        }),
      },
    ),
    (error) => error?.errorCode === "NO_SESSION",
  );
  assert.equal(mismatchCommandCount, 0);

  const capacityRows = Array.from({ length: DEFAULT_MANAGED_TAB_SCOPE_LIMIT }, (_item, index) => ({
    tab_id: `capacity-${String(index)}`,
    browser_instance_id: "capacity-browser",
    workspace_key: "capacity-workspace",
    task_id: "capacity-task",
    keep: false,
    status: "open",
  }));
  const capacityOwnership = {
    browser_instance_id: "capacity-browser",
    workspace_key: "capacity-workspace",
    task_id: "capacity-task",
  };
  assert.equal(evaluateManagedTabCapacity(capacityRows, capacityOwnership).allowed, false);
  assert.equal(evaluateManagedTabCapacity(
    capacityRows,
    capacityOwnership,
    { confirm_overflow: true },
  ).allowed, true);
  const tabCreateDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "create_managed",
        url: "about:blank",
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(tabCreateDryRunCall?.result?.isError, undefined);
  assertTextJsonContent(tabCreateDryRunCall.result, "browser_tab_lifecycle create dry-run result");
  const tabCreateDryRunOutcome = firstOutcomeContent(tabCreateDryRunCall.result);
  assert.equal(tabCreateDryRunOutcome?.schema, "browser67.tool-outcome.v3");
  assert.equal(tabCreateDryRunOutcome?.ok, true);
  assert.equal(tabCreateDryRunOutcome?.status, "completed");
  assert.equal(tabCreateDryRunOutcome?.meta?.tool, "browser_tab_lifecycle");
  assert.equal(Array.isArray(tabCreateDryRunOutcome?.warnings), true);
  assert.equal(Array.isArray(tabCreateDryRunOutcome?.artifacts), true);
  const tabCreateDryRunPayload = firstJsonContent(tabCreateDryRunCall.result);
  assert.equal(tabCreateDryRunPayload?.status, "success");
  assert.equal(tabCreateDryRunPayload?.created, false);
  assert.equal(tabCreateDryRunPayload?.owner, "tmwd");
  assert.equal(tabCreateDryRunPayload?.presentation?.focus_policy, "background_preferred");
  assert.equal(tabCreateDryRunPayload?.presentation?.window_policy, "dedicated");
  assert.equal(tabCreateDryRunPayload?.presentation?.active, false);
  assert.equal(typeof tabCreateDryRunPayload?.managed_tab?.tab_id, "string");
  assert.equal(tabCreateDryRunPayload?.managed_tab?.focus_policy, "background_preferred");
  assert.equal(tabCreateDryRunPayload?.managed_tab?.window_policy, "dedicated");
  assert.equal(tabCreateDryRunPayload?.managed_tab?.window_ownership, "browser67_agent");
  assert.equal(tabCreateDryRunPayload?.finalize_hint?.required, false);
  assert.equal(tabCreateDryRunPayload?.finalize_hint?.tool, "browser_tab_lifecycle");
  assert.equal(tabCreateDryRunPayload?.finalize_hint?.suggested_arguments?.action, "finalize_task");

  const remoteCdpDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "create_managed",
        url: "about:blank",
        tmwd_mode: "remote_cdp",
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(remoteCdpDryRunCall?.result?.isError, undefined);
  const remoteCdpDryRunPayload = firstJsonContent(remoteCdpDryRunCall.result);
  assert.equal(remoteCdpDryRunPayload?.presentation?.requested_window_policy, "dedicated");
  assert.equal(remoteCdpDryRunPayload?.presentation?.window_policy, "isolated_target");
  assert.equal(remoteCdpDryRunPayload?.managed_tab?.window_policy, "isolated_target");
  assert.equal(remoteCdpDryRunPayload?.managed_tab?.window_ownership, "remote_cdp");

  const tabSelectOrCreateDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "select_or_create",
        url: "http://example.test/reports/a",
        workspace_key: "contract-workspace",
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(tabSelectOrCreateDryRunCall?.result?.isError, undefined);
  assertTextJsonContent(tabSelectOrCreateDryRunCall.result, "browser_tab_lifecycle select_or_create dry-run result");
  const tabSelectOrCreateDryRunPayload = firstJsonContent(tabSelectOrCreateDryRunCall.result);
  assert.equal(tabSelectOrCreateDryRunPayload?.status, "success");
  assert.equal(tabSelectOrCreateDryRunPayload?.action, "select_or_create");
  assert.equal(tabSelectOrCreateDryRunPayload?.owner, "tmwd");
  assert.equal(tabSelectOrCreateDryRunPayload?.created, false);
  assert.equal(tabSelectOrCreateDryRunPayload?.reused, false);
  assert.equal(tabSelectOrCreateDryRunPayload?.would_create, true);
  assert.equal(tabSelectOrCreateDryRunPayload?.presentation?.active, false);
  assert.equal(tabSelectOrCreateDryRunPayload?.presentation?.window_policy, "dedicated");
  assert.equal(tabSelectOrCreateDryRunPayload?.managed_tab?.workspace_key, "contract-workspace");
  assert.equal(tabSelectOrCreateDryRunPayload?.finalize_hint?.required, false);
  assert.equal(tabSelectOrCreateDryRunPayload?.finalize_hint?.workspace_key, "contract-workspace");
  assert.equal(tabSelectOrCreateDryRunPayload?.finalize_hint?.suggested_arguments?.action, "finalize_task");

  const tabSelectOrCreateReuseDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "select_or_create",
        url: "http://example.test/reports/b",
        workspace_key: "contract-workspace",
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(tabSelectOrCreateReuseDryRunCall?.result?.isError, undefined);
  const tabSelectOrCreateReuseDryRunPayload = firstJsonContent(tabSelectOrCreateReuseDryRunCall.result);
  assert.equal(tabSelectOrCreateReuseDryRunPayload?.status, "success");
  assert.equal(tabSelectOrCreateReuseDryRunPayload?.created, false);
  assert.equal(tabSelectOrCreateReuseDryRunPayload?.reused, false);
  assert.equal(tabSelectOrCreateReuseDryRunPayload?.would_create, true);

  const currentWindowDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "create_managed",
        url: "about:blank",
        focus_policy: "foreground",
        window_policy: "current",
        confirm_foreground: true,
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(currentWindowDryRunCall?.result?.isError, true);
  assert.equal(firstOutcomeContent(currentWindowDryRunCall.result)?.error?.code, "CURRENT_WINDOW_REQUIRES_ADOPTION");

  const unconfirmedForegroundCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "create_managed",
        url: "about:blank",
        focus_policy: "foreground",
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(unconfirmedForegroundCall?.result?.isError, true);
  assert.equal(firstOutcomeContent(unconfirmedForegroundCall.result)?.error?.code, "FOREGROUND_NOT_CONFIRMED");

  const foregroundDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "create_managed",
        url: "about:blank",
        focus_policy: "foreground",
        confirm_foreground: true,
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(foregroundDryRunCall?.result?.isError, undefined);
  const foregroundDryRunPayload = firstJsonContent(foregroundDryRunCall.result);
  assert.equal(foregroundDryRunPayload?.presentation?.focus_policy, "foreground");
  assert.equal(foregroundDryRunPayload?.presentation?.window_policy, "dedicated");
  assert.equal(foregroundDryRunPayload?.presentation?.active, true);

  const conflictingFocusCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "create_managed",
        url: "about:blank",
        focus_policy: "background_only",
        active: true,
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(conflictingFocusCall?.result?.isError, true);
  assert.equal(firstJsonContent(conflictingFocusCall.result)?.error_code, "INVALID_ARGUMENT");

  const tabMissingCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "create_managed",
      },
    },
    timeoutMs,
  );
  assert.equal(tabMissingCall?.result?.isError, true);
  assertTextJsonContent(tabMissingCall.result, "browser_tab_lifecycle missing args error");
  const tabMissingPayload = firstJsonContent(tabMissingCall.result);
  assert.equal(tabMissingPayload?.error_code, "INVALID_ARGUMENT");

  const tabUnsupportedCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "unsupported_tab_action",
      },
    },
    timeoutMs,
  );
  assert.equal(tabUnsupportedCall?.result?.isError, true);
  const tabUnsupportedPayload = firstJsonContent(tabUnsupportedCall.result);
  assert.equal(tabUnsupportedPayload?.error_code, "INVALID_ARGUMENTS");

  const tabCloseMissingScopeCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "close_unkept",
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(tabCloseMissingScopeCall?.result?.isError, true);
  const tabCloseMissingScopePayload = firstJsonContent(tabCloseMissingScopeCall.result);
  assert.equal(tabCloseMissingScopePayload?.error_code, "INVALID_ARGUMENT");

  const tabCloseAllDryRunCalls = await Promise.all([
    { action: "close_unkept", scope: "all", dry_run: true },
    { action: "close_unkept", all: true, dry_run: true },
    { action: "close_unkept", confirm_all: true, dry_run: true },
  ].map((args) => rpc.call(
      "tools/call",
      {
        name: "browser_tab_lifecycle",
        arguments: args,
      },
      timeoutMs,
    )));
  tabCloseAllDryRunCalls.forEach((tabCloseAllDryRunCall) => {
    assert.equal(tabCloseAllDryRunCall?.result?.isError, undefined);
    const tabCloseAllDryRunPayload = firstJsonContent(tabCloseAllDryRunCall.result);
    assert.equal(tabCloseAllDryRunPayload?.status, "success");
    assert.equal(tabCloseAllDryRunPayload?.close_scope?.all, true);
  });

  const tabCloseUnmanagedCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "close_unkept",
        tab_id: "user-tab-not-managed",
        workspace_key: "contract-workspace",
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(tabCloseUnmanagedCall?.result?.isError, undefined);
  assertTextJsonContent(tabCloseUnmanagedCall.result, "browser_tab_lifecycle close_unkept result");
  const tabCloseUnmanagedPayload = firstJsonContent(tabCloseUnmanagedCall.result);
  assert.equal(tabCloseUnmanagedPayload?.status, "success");
  assert.deepEqual(tabCloseUnmanagedPayload?.unmanaged_tabs_ignored, ["user-tab-not-managed"]);

  const finalizeScopeRunId = "finalize-scope-contract-run";
  const finalizeScopePrepareCall = await rpc.call(
    "tools/call",
    {
      name: "browser_run_ops",
      arguments: {
        action: "prepare",
        workspace_key: "contract-workspace",
        task_id: "contract-task",
        run_id: finalizeScopeRunId,
      },
    },
    timeoutMs,
  );
  assert.equal(finalizeScopePrepareCall?.result?.isError, undefined);

  const tabFinalizeDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "finalize_task",
        workspace_key: "contract-workspace",
        task_id: "contract-task",
        prune_stale: false,
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(tabFinalizeDryRunCall?.result?.isError, undefined);
  const tabFinalizeDryRunPayload = firstJsonContent(tabFinalizeDryRunCall.result);
  assert.equal(tabFinalizeDryRunPayload?.status, "success");
  assert.equal(tabFinalizeDryRunPayload?.action, "finalize_task");
  assert.equal(tabFinalizeDryRunPayload?.dry_run, true);
  assert.equal(tabFinalizeDryRunPayload?.finalizer_policy?.closes_only_managed_tabs, true);
  assert.equal(tabFinalizeDryRunPayload?.finalizer_policy?.preserves_keep_true, true);
  assert.equal(tabFinalizeDryRunPayload?.close_unkept?.action, "close_unkept");
  assert.equal(tabFinalizeDryRunPayload?.remaining?.unkept_count, 0);
  assert.equal(tabFinalizeDryRunPayload?.cleanup_summary?.workspace_key, "contract-workspace");
  assert.equal(tabFinalizeDryRunPayload?.cleanup_summary?.remaining_unkept_count, 0);
  assert.equal(tabFinalizeDryRunPayload?.run_finalize?.would_finish_count, 1);
  assert.match(tabFinalizeDryRunPayload?.delivery_summary ?? "", /browser67 cleanup: finalize_task workspace_key=contract-workspace/);

  const tabFinalizeCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "finalize_task",
        workspace_key: "contract-workspace",
        task_id: "contract-task",
        prune_stale: false,
      },
    },
    timeoutMs,
  );
  assert.equal(tabFinalizeCall?.result?.isError, undefined);
  const tabFinalizePayload = firstJsonContent(tabFinalizeCall.result);
  assert.equal(tabFinalizePayload?.run_finalize?.finished_count, 1);
  const finalizeScopeStatusCall = await rpc.call(
    "tools/call",
    {
      name: "browser_run_ops",
      arguments: {
        action: "status",
        workspace_key: "contract-workspace",
        run_id: finalizeScopeRunId,
        summary_only: true,
      },
    },
    timeoutMs,
  );
  assert.equal(firstJsonContent(finalizeScopeStatusCall.result)?.run?.status, "interrupted");

  const adoptionNow = new Date().toISOString();
  const adoptedRecord = {
    tab_id: "user-adopted-contract-tab",
    owner: "tmwd",
    managed: true,
    ownership_origin: "user_adopted",
    close_on_finalize: false,
    ownership_generation: "ownership-adopted-contract",
    owning_runtime_id: "contract-runtime",
    lease_id: "lease-adopted-contract",
    lease_started_at: adoptionNow,
    lease_renewed_at: adoptionNow,
    lease_expires_at: new Date(Date.now() + 600_000).toISOString(),
    management_policy: {
      csp_override: "off",
      dialog: "native",
      badge: "managed",
    },
    suspended: false,
    source: "contract",
    workspace_key: "adoption-contract-workspace",
    task_id: "adoption-contract-task",
    reuse_key: "http://adopted.example/path",
    url: "http://adopted.example/path",
    title: "User adopted contract tab",
    origin: "http://adopted.example",
    path_scope: "/path",
    keep: false,
    dry_run: false,
    status: "open",
    created_at: adoptionNow,
    updated_at: adoptionNow,
    last_used_at: adoptionNow,
  };
  await writeFile(registryPath, `${JSON.stringify({
    version: 2,
    updated_at: adoptionNow,
    managed_tabs: [adoptedRecord],
  }, null, 2)}\n`);

  const adoptedDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "finalize_task",
        workspace_key: adoptedRecord.workspace_key,
        task_id: adoptedRecord.task_id,
        prune_stale: false,
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(adoptedDryRunCall?.result?.isError, undefined);
  const adoptedDryRunPayload = firstJsonContent(adoptedDryRunCall.result);
  assert.equal(adoptedDryRunPayload?.release_adopted?.length, 1);
  assert.equal(adoptedDryRunPayload?.release_adopted?.[0]?.would_release, true);
  assert.equal(adoptedDryRunPayload?.release_adopted?.[0]?.closed, false);
  assert.equal(adoptedDryRunPayload?.finalizer_policy?.closes_user_adopted_tabs, false);

  const adoptedCloseUnconfirmedCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "close_adopted",
        tab_id: adoptedRecord.tab_id,
        workspace_key: adoptedRecord.workspace_key,
        task_id: adoptedRecord.task_id,
      },
    },
    timeoutMs,
  );
  assert.equal(adoptedCloseUnconfirmedCall?.result?.isError, true);
  assert.equal(
    firstJsonContent(adoptedCloseUnconfirmedCall.result)?.error_code,
    "ADOPTED_CLOSE_NOT_CONFIRMED",
  );

  const crossScopeCloseInspectCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "inspect_close_adopted",
        tab_id: adoptedRecord.tab_id,
        workspace_key: "another-workspace",
        task_id: adoptedRecord.task_id,
      },
    },
    timeoutMs,
  );
  assert.equal(crossScopeCloseInspectCall?.result?.isError, true);
  assert.equal(
    firstJsonContent(crossScopeCloseInspectCall.result)?.error_code,
    "TAB_OWNED_BY_OTHER_SCOPE",
  );

  const adoptedCloseInspectCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "inspect_close_adopted",
        tab_id: adoptedRecord.tab_id,
        workspace_key: adoptedRecord.workspace_key,
        task_id: adoptedRecord.task_id,
      },
    },
    timeoutMs,
  );
  assert.equal(adoptedCloseInspectCall?.result?.isError, undefined);
  const adoptedCloseInspectPayload = firstJsonContent(adoptedCloseInspectCall.result);
  assert.equal(typeof adoptedCloseInspectPayload?.close_token, "string");
  assert.equal(adoptedCloseInspectPayload?.requires_user_confirmation, true);

  const adoptedFinalizeCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "finalize_task",
        workspace_key: adoptedRecord.workspace_key,
        task_id: adoptedRecord.task_id,
        prune_stale: false,
      },
    },
    timeoutMs,
  );
  assert.equal(
    adoptedFinalizeCall?.result?.isError,
    undefined,
    `adopted finalize failed: ${JSON.stringify(adoptedFinalizeCall?.result ?? null)}`,
  );
  const adoptedFinalizePayload = firstJsonContent(adoptedFinalizeCall.result);
  assert.equal(adoptedFinalizePayload?.release_adopted?.length, 1);
  assert.equal(adoptedFinalizePayload?.release_adopted?.[0]?.released, true);
  assert.equal(adoptedFinalizePayload?.release_adopted?.[0]?.closed, false);
  assert.equal(adoptedFinalizePayload?.remaining?.unkept_count, 0);

  const registryAfterAdoptedFinalize = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(
    registryAfterAdoptedFinalize.managed_tabs.some((row) => row.tab_id === adoptedRecord.tab_id),
    false,
  );

  const tabListManagedCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "list_managed",
      },
    },
    timeoutMs,
  );
  assert.equal(tabListManagedCall?.result?.isError, undefined);
  const tabListManagedPayload = firstJsonContent(tabListManagedCall.result);
  assert.equal(tabListManagedPayload?.status, "success");
  assert.equal(tabListManagedPayload?.capabilities?.supports_tabs_get, true);
  assert.equal(tabListManagedPayload?.capabilities?.server_revision, "managed-tabs-v9");
  assert.equal(tabListManagedPayload?.capabilities?.schema_revision, 9);
  assert.equal(tabListManagedPayload?.capabilities?.list_managed_summary_only_default, true);
  assert.equal(tabListManagedPayload?.capabilities?.managed_tab_scope_limit_default, 8);
  assert.equal(tabListManagedPayload?.capabilities?.supports_dedicated_agent_window, true);
  assert.equal(tabListManagedPayload?.capabilities?.supports_focus_policy, true);
  assert.equal(tabListManagedPayload?.capabilities?.supports_focus_lease, true);
  assert.equal(tabListManagedPayload?.capabilities?.supports_focus_restore_guard, true);
  assert.equal(tabListManagedPayload?.capabilities?.managed_window_policy_default, "dedicated");
  assert.equal(tabListManagedPayload?.capabilities?.managed_focus_policy_default, "background_preferred");
  assert.equal(tabListManagedPayload?.capabilities?.supports_durable_jobs, true);
  assert.equal(tabListManagedPayload?.capabilities?.supports_job_restart_recovery, true);
  assert.equal(tabListManagedPayload?.capabilities?.supports_job_abort, false);
  assert.equal(tabListManagedPayload?.capabilities?.supports_persistent_debugger, false);
  assert.deepEqual(
    tabListManagedPayload?.capabilities?.screenshot_viewport_override_atomic_targets,
    ["viewport", "clip", "selector", "full_page"],
  );
  assert.equal(
    tabListManagedPayload?.capabilities?.supports_persistent_screenshot_viewport_override,
    false,
  );
  assert.equal(tabListManagedPayload?.capabilities?.supports_bounded_console_observation, true);
  assert.equal(tabListManagedPayload?.capabilities?.supports_protocol_solver_apply, false);
  assert.equal(tabListManagedPayload?.capabilities?.supports_finalize_hint, true);
  assert.equal(tabListManagedPayload?.capabilities?.supports_created_agent_window_cleanup, true);
  assert.equal(
    tabListManagedPayload?.capabilities?.supports_exact_agent_window_orphan_recovery,
    true,
  );
  assert.equal(
    tabListManagedPayload?.capabilities?.agent_window_orphan_recovery_policy,
    "same_browser_profile_epoch_exact_window_sole_browser_new_tab",
  );
  assert.equal(tabListManagedPayload?.capabilities?.supports_close_verification, true);
  assert.equal(tabListManagedPayload?.summary?.summary_only, true);
  assert.equal(Array.isArray(tabListManagedPayload?.live_sessions), true);
  assert.equal(tabListManagedPayload.live_sessions.length, 0);
  assert.equal(Array.isArray(tabListManagedPayload?.sessions), true);
  assert.equal(tabListManagedPayload.sessions.length, 0);
  assert.equal(tabListManagedPayload?.active_session_id, null);
  assert.equal(tabListManagedPayload?.default_session_id, null);
  assert.equal(tabListManagedPayload?.latest_session_id, null);
  assert.equal(typeof tabListManagedPayload?.summary?.managed_total_count, "number");
  assert.equal(tabListManagedPayload?.result_limits?.max_items, 50);

  const tabListManagedSummaryCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "list_managed",
        summary_only: false,
      },
    },
    timeoutMs,
  );
  assert.equal(tabListManagedSummaryCall?.result?.isError, undefined);
  const tabListManagedSummaryPayload = firstJsonContent(tabListManagedSummaryCall.result);
  assert.equal(tabListManagedSummaryPayload?.status, "success");
  assert.equal(tabListManagedSummaryPayload?.summary?.summary_only, false);
  assert.equal(Array.isArray(tabListManagedSummaryPayload?.live_sessions), true);
  assert.equal(Array.isArray(tabListManagedSummaryPayload?.sessions), true);
  const managedKeys = new Set(
    (tabListManagedSummaryPayload?.managed_tabs ?? []).map((row) => row.session_key),
  );
  assert.equal(
    tabListManagedSummaryPayload.sessions.every((row) => managedKeys.has(row.id)),
    true,
    "expanded list_managed must never return unmanaged ordinary user sessions",
  );

  await assertExternalRegistryRefresh({ registryPath, rpc, timeoutMs });

  const tabPruneStaleCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "prune_stale",
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(tabPruneStaleCall?.result?.isError, undefined);
  const tabPruneStalePayload = firstJsonContent(tabPruneStaleCall.result);
  assert.equal(tabPruneStalePayload?.status, "success");
  assert.equal(tabPruneStalePayload?.action, "prune_stale");
  assert.equal(tabPruneStalePayload?.capabilities?.supports_prune_stale, true);
  assert.equal(tabPruneStalePayload?.capabilities?.supports_finalize_task, true);
  assert.equal(tabPruneStalePayload?.capabilities?.supports_finalize_hint, true);

  return {
    tabCloseUnmanagedPayload,
  };
}
