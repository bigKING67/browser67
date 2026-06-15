#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  collectFinalizeHintsFromToolResult,
  createCodexFinalizerTracker,
  normalizeCodexFinalizeHint,
  planCodexHardFinally,
} from "../src/codex-host-finalizer.mjs";

function mcpTextResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
  };
}

function browserHint(workspaceKey) {
  return {
    required: true,
    reason: "managed keep=false tab should be finalized before task end",
    tool: "browser_tab_lifecycle",
    action: "finalize_task",
    cleanup_scope: "workspace",
    workspace_key: workspaceKey,
    suggested_arguments: {
      action: "finalize_task",
      workspace_key: workspaceKey,
      prune_stale: true,
    },
    closes_only_managed_tabs: true,
    preserves_keep_true: true,
    ignores_unmanaged_user_tabs: true,
  };
}

function jsReverseHint(workspaceKey) {
  return {
    required: true,
    reason: "managed keep=false tab should be finalized before task end",
    tool: "finalize_task",
    action: "finalize_task",
    cleanup_scope: "workspace",
    workspace_key: workspaceKey,
    suggested_arguments: {
      workspace_key: workspaceKey,
      prune_stale: true,
    },
    closes_only_managed_tabs: true,
    preserves_keep_true: true,
    ignores_unmanaged_user_tabs: true,
  };
}

function run() {
  const browserResult = mcpTextResult({
    status: "success",
    action: "select_or_create",
    finalize_hint: browserHint("codex-host-alpha"),
  });
  const jsReverseResult = mcpTextResult({
    ok: true,
    action: "new_page",
    finalize_hint: jsReverseHint("codex-host-beta"),
  });
  const keepResult = mcpTextResult({
    status: "success",
    finalize_hint: {
      ...browserHint("codex-host-kept"),
      required: false,
      reason: "managed tab is marked keep=true; finalize_task will preserve it",
    },
  });
  const scopeAllResult = mcpTextResult({
    status: "success",
    finalize_hint: {
      ...browserHint(""),
      cleanup_scope: "all",
      suggested_arguments: {
        action: "finalize_task",
        scope: "all",
        prune_stale: true,
      },
    },
  });

  const collected = collectFinalizeHintsFromToolResult(browserResult, {
    source_server: "tmwd_browser",
    source_tool: "browser_tab_lifecycle",
  });
  assert.equal(collected.length, 1);
  assert.equal(collected[0].hint.workspace_key, "codex-host-alpha");

  const collectedFromBareContent = collectFinalizeHintsFromToolResult(browserResult.content, {
    source_server: "tmwd_browser",
    source_tool: "browser_tab_lifecycle",
  });
  assert.equal(collectedFromBareContent.length, 1);
  assert.equal(collectedFromBareContent[0].hint.workspace_key, "codex-host-alpha");

  const normalizedBrowser = normalizeCodexFinalizeHint(browserHint("codex-host-alpha"), {
    source_server: "tmwd_browser",
    source_tool: "browser_tab_lifecycle",
  });
  assert.equal(normalizedBrowser.ok, true);
  assert.equal(normalizedBrowser.server, "tmwd_browser");
  assert.equal(normalizedBrowser.tool, "browser_tab_lifecycle");
  assert.equal(normalizedBrowser.arguments.action, "finalize_task");
  assert.equal(normalizedBrowser.arguments.workspace_key, "codex-host-alpha");

  const normalizedJsReverse = normalizeCodexFinalizeHint(jsReverseHint("codex-host-beta"), {
    source_server: "js_reverse",
    source_tool: "new_page",
  });
  assert.equal(normalizedJsReverse.ok, true);
  assert.equal(normalizedJsReverse.server, "js_reverse");
  assert.equal(normalizedJsReverse.tool, "finalize_task");
  assert.equal(Object.hasOwn(normalizedJsReverse.arguments, "action"), false);
  assert.equal(normalizedJsReverse.arguments.workspace_key, "codex-host-beta");

  const plan = planCodexHardFinally({
    default_arguments: {
      tmwd_mode: "tmwd",
      tmwd_transport: "auto",
      timeout_ms: 20_000,
    },
    tool_results: [
      {
        source_server: "tmwd_browser",
        source_tool: "browser_tab_lifecycle",
        result: browserResult,
      },
      {
        source_server: "tmwd_browser",
        source_tool: "browser_tab_lifecycle",
        result: browserResult,
      },
      {
        source_server: "js_reverse",
        source_tool: "new_page",
        result: jsReverseResult,
      },
      {
        source_server: "tmwd_browser",
        source_tool: "browser_tab_lifecycle",
        result: keepResult,
      },
      {
        source_server: "tmwd_browser",
        source_tool: "browser_tab_lifecycle",
        result: scopeAllResult,
      },
    ],
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.policy.hard_finally, true);
  assert.equal(plan.policy.auto_scope_all, false);
  assert.equal(plan.pending_count, 2);
  assert.equal(plan.scope_all_blocked_count, 1);
  assert.equal(plan.ignored.some((entry) => entry.reason === "not_required"), true);
  assert.equal(plan.ignored.some((entry) => entry.reason === "auto_scope_all_blocked"), true);

  const browserCall = plan.calls.find((entry) => entry.server === "tmwd_browser");
  assert.equal(browserCall.tool, "browser_tab_lifecycle");
  assert.equal(browserCall.arguments.action, "finalize_task");
  assert.equal(browserCall.arguments.workspace_key, "codex-host-alpha");
  assert.equal(browserCall.arguments.tmwd_mode, "tmwd");
  assert.equal(browserCall.arguments.tmwd_transport, "auto");

  const jsReverseCall = plan.calls.find((entry) => entry.server === "js_reverse");
  assert.equal(jsReverseCall.tool, "finalize_task");
  assert.equal(Object.hasOwn(jsReverseCall.arguments, "action"), false);
  assert.equal(jsReverseCall.arguments.workspace_key, "codex-host-beta");
  assert.equal(jsReverseCall.arguments.timeout_ms, 20_000);

  const tracker = createCodexFinalizerTracker({
    default_arguments: {
      tmwd_mode: "tmwd",
      tmwd_transport: "auto",
    },
  });
  tracker.addToolResult({
    source_server: "tmwd_browser",
    source_tool: "browser_tab_lifecycle",
    result: browserResult,
  });
  const trackerPlan = tracker.addToolResult({
    source_server: "js_reverse",
    source_tool: "new_page",
    result: jsReverseResult,
  });
  assert.equal(trackerPlan.pending_count, 2);
  tracker.reset();
  assert.equal(tracker.plan().pending_count, 0);

  process.stdout.write(JSON.stringify({
    ok: true,
    pending_count: plan.pending_count,
    ignored_count: plan.ignored_count,
    scope_all_blocked_count: plan.scope_all_blocked_count,
  }) + "\n");
}

run();
