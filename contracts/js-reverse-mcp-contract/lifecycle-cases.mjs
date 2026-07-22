import assert from "node:assert/strict";

import {
  assertTextJsonContent,
} from "../browser67-browser-mcp-contract/rpc-content.mjs";
import { jsReverseData } from "./outcome.mjs";

async function runLifecycleCases(rpc, cli) {
  const newPageDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "new_page",
      arguments: {
        url: "http://example.test/app/one",
        workspace_key: "js-reverse-contract",
        dry_run: true,
      },
    },
    cli.timeout_ms,
  );
  assert.equal(newPageDryRunCall?.result?.isError, undefined);
  assertTextJsonContent(newPageDryRunCall.result, "js-reverse new_page dry-run result");
  const newPageDryRunPayload = jsReverseData(newPageDryRunCall.result, "new_page dry-run");
  assert.equal(newPageDryRunPayload?.ok, true);
  assert.equal(newPageDryRunPayload?.owner, "tmwd");
  assert.equal(newPageDryRunPayload?.created, false);
  assert.equal(newPageDryRunPayload?.reused, false);
  assert.equal(newPageDryRunPayload?.would_create, true);

  const newPageReuseDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "new_page",
      arguments: {
        url: "http://example.test/app/two",
        workspace_key: "js-reverse-contract",
        dry_run: true,
      },
    },
    cli.timeout_ms,
  );
  assert.equal(newPageReuseDryRunCall?.result?.isError, undefined);
  const newPageReuseDryRunPayload = jsReverseData(newPageReuseDryRunCall.result, "new_page reuse dry-run");
  assert.equal(newPageReuseDryRunPayload?.ok, true);
  assert.equal(newPageReuseDryRunPayload?.created, false);
  assert.equal(newPageReuseDryRunPayload?.reused, false);
  assert.equal(newPageReuseDryRunPayload?.would_create, true);
  assert.equal(newPageReuseDryRunPayload?.finalize_hint?.required, false);
  assert.equal(newPageReuseDryRunPayload?.finalize_hint?.tool, "finalize_task");
  assert.equal(newPageReuseDryRunPayload?.finalize_hint?.workspace_key, "js-reverse-contract");
  assert.equal(newPageReuseDryRunPayload?.finalize_hint?.suggested_arguments?.action, undefined);

  const finalizeMissingScopeCall = await rpc.call(
    "tools/call",
    {
      name: "finalize_task",
      arguments: {
        dry_run: true,
        prune_stale: false,
      },
    },
    cli.timeout_ms,
  );
  assert.equal(finalizeMissingScopeCall?.result?.isError, undefined);
  const finalizeMissingScopePayload = jsReverseData(finalizeMissingScopeCall.result, "finalize missing scope");
  assert.equal(finalizeMissingScopePayload?.ok, false);
  assert.match(finalizeMissingScopePayload?.error ?? "", /workspace_key or task_id/);

  const finalizeDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "finalize_task",
      arguments: {
        workspace_key: "js-reverse-contract",
        dry_run: true,
        prune_stale: false,
      },
    },
    cli.timeout_ms,
  );
  assert.equal(finalizeDryRunCall?.result?.isError, undefined);
  const finalizeDryRunPayload = jsReverseData(finalizeDryRunCall.result, "finalize dry-run");
  assert.equal(finalizeDryRunPayload?.ok, true);
  assert.equal(finalizeDryRunPayload?.action, "finalize_task");
  assert.equal(finalizeDryRunPayload?.dry_run, true);
  assert.equal(finalizeDryRunPayload?.finalizer_policy?.closes_only_managed_tabs, true);
  assert.equal(finalizeDryRunPayload?.finalizer_policy?.preserves_keep_true, true);
  assert.equal(finalizeDryRunPayload?.remaining?.unkept_count, 0);
  assert.equal(finalizeDryRunPayload?.cleanup_summary?.workspace_key, "js-reverse-contract");
  assert.equal(finalizeDryRunPayload?.cleanup_summary?.remaining_unkept_count, 0);
  assert.match(finalizeDryRunPayload?.delivery_summary ?? "", /js-reverse cleanup: finalize_task workspace_key=js-reverse-contract/);
}

export {
  runLifecycleCases,
};
