import assert from "node:assert/strict";
import {
  assertTextJsonContent,
  firstJsonContent,
} from "./rpc-content.mjs";

export async function assertTabLifecycleOpsContract({ rpc, timeoutMs }) {
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
  assert.equal(tabUnsupportedPayload?.error_code, "ACTION_NOT_SUPPORTED");

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
  assert.equal(tabListManagedPayload?.capabilities?.supports_finalize_hint, true);
  assert.equal(Array.isArray(tabListManagedPayload?.live_sessions), true);
  assert.equal(Array.isArray(tabListManagedPayload?.sessions), true);
  assert.equal(typeof tabListManagedPayload?.summary?.managed_total_count, "number");
  assert.equal(tabListManagedPayload?.result_limits?.max_items, 50);

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
