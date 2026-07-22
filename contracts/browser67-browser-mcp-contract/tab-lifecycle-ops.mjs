import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
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
      },
    },
    timeoutMs,
  );
  assert.equal(externalListCall?.result?.isError, undefined);
  const externalListPayload = firstJsonContent(externalListCall.result);
  assert.equal(externalListPayload?.summary?.registry_count, 1);
  assert.equal(externalListPayload?.managed_tabs?.[0]?.tab_id, "external-disk-tab");

  await writeFile(registryPath, `${JSON.stringify({
    version: 1,
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
      },
    },
    timeoutMs,
  );
  assert.equal(clearedListCall?.result?.isError, undefined);
  const clearedListPayload = firstJsonContent(clearedListCall.result);
  assert.equal(clearedListPayload?.summary?.registry_count, 0);
}

export async function assertTabLifecycleOpsContract({ registryPath, rpc, timeoutMs }) {
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
  assert.equal(typeof tabCreateDryRunPayload?.managed_tab?.tab_id, "string");
  assert.equal(tabCreateDryRunPayload?.finalize_hint?.required, false);
  assert.equal(tabCreateDryRunPayload?.finalize_hint?.tool, "browser_tab_lifecycle");
  assert.equal(tabCreateDryRunPayload?.finalize_hint?.suggested_arguments?.action, "finalize_task");

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

  const tabFinalizeDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "finalize_task",
        workspace_key: "contract-workspace",
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
  assert.match(tabFinalizeDryRunPayload?.delivery_summary ?? "", /browser67 cleanup: finalize_task workspace_key=contract-workspace/);

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
  assert.equal(adoptedFinalizeCall?.result?.isError, undefined);
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
  assert.equal(tabListManagedPayload?.capabilities?.server_revision, "managed-tabs-v4");
  assert.equal(tabListManagedPayload?.capabilities?.schema_revision, 3);
  assert.equal(tabListManagedPayload?.capabilities?.supports_durable_jobs, true);
  assert.equal(tabListManagedPayload?.capabilities?.supports_job_restart_recovery, true);
  assert.equal(tabListManagedPayload?.capabilities?.supports_job_abort, false);
  assert.equal(tabListManagedPayload?.capabilities?.supports_persistent_debugger, false);
  assert.equal(tabListManagedPayload?.capabilities?.supports_protocol_solver_apply, false);
  assert.equal(tabListManagedPayload?.capabilities?.supports_finalize_hint, true);
  assert.equal(tabListManagedPayload?.capabilities?.supports_close_verification, true);
  assert.equal(Array.isArray(tabListManagedPayload?.live_sessions), true);
  assert.equal(Array.isArray(tabListManagedPayload?.sessions), true);
  assert.equal(typeof tabListManagedPayload?.summary?.managed_total_count, "number");
  assert.equal(tabListManagedPayload?.result_limits?.max_items, 50);

  const tabListManagedSummaryCall = await rpc.call(
    "tools/call",
    {
      name: "browser_tab_lifecycle",
      arguments: {
        action: "list_managed",
        summary_only: true,
      },
    },
    timeoutMs,
  );
  assert.equal(tabListManagedSummaryCall?.result?.isError, undefined);
  const tabListManagedSummaryPayload = firstJsonContent(tabListManagedSummaryCall.result);
  assert.equal(tabListManagedSummaryPayload?.status, "success");
  assert.equal(tabListManagedSummaryPayload?.summary?.summary_only, true);
  assert.equal(Array.isArray(tabListManagedSummaryPayload?.live_sessions), true);
  assert.equal(tabListManagedSummaryPayload.live_sessions.length, 0);
  assert.equal(Array.isArray(tabListManagedSummaryPayload?.sessions), true);
  assert.equal(tabListManagedSummaryPayload.sessions.length, 0);
  assert.equal(tabListManagedSummaryPayload?.summary?.live_session_returned_count, 0);

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
