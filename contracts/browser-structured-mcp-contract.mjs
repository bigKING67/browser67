#!/usr/bin/env node
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRpcClient } from "./browser-structured-mcp-contract/rpc-client.mjs";
import {
  assertTextJsonContent,
  firstJsonContent,
} from "./browser-structured-mcp-contract/rpc-content.mjs";
import { assertOpenAiToolSchemaCompatibility } from "./browser-structured-mcp-contract/schema-compat.mjs";
import {
  startExecuteErrorTmwdLinkServer,
  startHangingTmwdLinkServer,
} from "./browser-structured-mcp-contract/tmwd-link-fixtures.mjs";

function parseArgs(argv) {
  const parsed = {
    timeout_ms: 8_000,
    ws_endpoint: "ws://127.0.0.1:9",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--timeout-ms") {
      const raw = argv[index + 1] ?? "";
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("invalid --timeout-ms value");
      }
      parsed.timeout_ms = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--ws-endpoint") {
      const raw = argv[index + 1] ?? "";
      if (!raw) {
        throw new Error("invalid --ws-endpoint value");
      }
      parsed.ws_endpoint = raw;
      index += 1;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

async function run() {
  const cli = parseArgs(process.argv.slice(2));
  const previousTabRegistryPath = process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
  const tmpTabRegistryPath = path.join(
    os.tmpdir(),
    `tmwd-tab-registry-contract-${process.pid}-${Date.now()}.json`,
  );
  process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = tmpTabRegistryPath;
  const rpc = createRpcClient();
  let hangingTmwdLinkServer;
  let executeErrorTmwdLinkServer;
  let tmpDownloadDir;
  try {
    hangingTmwdLinkServer = await startHangingTmwdLinkServer();
    executeErrorTmwdLinkServer = await startExecuteErrorTmwdLinkServer();
    const init = await rpc.call(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "browser-structured-mcp-contract",
          version: "1.0.0",
        },
      },
      cli.timeout_ms,
    );
    assert.equal(typeof init?.result?.serverInfo?.name, "string");
    assert.equal(init.result.serverInfo.name, "browser-structured-mcp");
    rpc.notify("notifications/initialized", {});

    const toolsList = await rpc.call("tools/list", {}, cli.timeout_ms);
    const tools = Array.isArray(toolsList?.result?.tools) ? toolsList.result.tools : [];
    assertOpenAiToolSchemaCompatibility(tools, "browser-structured-mcp");
    const names = tools
      .map((entry) => (typeof entry?.name === "string" ? entry.name : ""))
      .filter((name) => name.length > 0);
    assert.equal(names.includes("browser_scan"), true);
    assert.equal(names.includes("browser_execute_js"), true);
    assert.equal(names.includes("browser_extract"), true);
    assert.equal(names.includes("browser_tab_ops"), true);
    assert.equal(names.includes("browser_native_input"), true);
    assert.equal(names.includes("browser_file_ops"), true);
    assert.equal(names.includes("browser_download_ops"), true);
    assert.equal(names.includes("browser_tab_lifecycle"), true);
    assert.equal(names.includes("browser_clipboard_ops"), true);
    const executeJsTool = tools.find((entry) => entry?.name === "browser_execute_js");
    assert.equal(
      executeJsTool?.inputSchema?.properties?.native_auto_fallback?.type,
      "boolean",
    );
    assert.equal(
      executeJsTool?.inputSchema?.properties?.native_auto_fallback_policy?.type,
      "string",
    );
    assert.deepEqual(
      executeJsTool?.inputSchema?.properties?.native_auto_fallback_policy?.enum,
      ["strict", "balanced", "aggressive"],
    );
    assert.equal(
      executeJsTool?.inputSchema?.properties?.native_auto_fallback_policy?.default,
      "balanced",
    );
    assert.equal(
      executeJsTool?.inputSchema?.properties?.native_auto_execute?.type,
      "boolean",
    );
    assert.equal(
      executeJsTool?.inputSchema?.properties?.native_execute_action_scope?.type,
      "string",
    );
    assert.equal(
      executeJsTool?.inputSchema?.properties?.native_fallback_action?.type,
      "string",
    );
    assert.equal(
      executeJsTool?.inputSchema?.properties?.native_fallback_args?.type,
      "object",
    );
    const tabLifecycleTool = tools.find((entry) => entry?.name === "browser_tab_lifecycle");
    assert.equal(
      tabLifecycleTool?.inputSchema?.properties?.action?.enum?.includes("select_or_create"),
      true,
    );
    assert.equal(
      tabLifecycleTool?.inputSchema?.properties?.action?.enum?.includes("prune_stale"),
      true,
    );
    assert.equal(
      tabLifecycleTool?.inputSchema?.properties?.ownership_policy?.default,
      "tmwd_only",
    );
    assert.equal(
      tabLifecycleTool?.inputSchema?.properties?.reuse_scope?.default,
      "origin_path",
    );
    assert.equal(
      tabLifecycleTool?.inputSchema?.properties?.scope?.enum?.includes("all"),
      true,
    );
    assert.equal(
      tabLifecycleTool?.inputSchema?.properties?.all?.type,
      "boolean",
    );
    assert.equal(
      tabLifecycleTool?.inputSchema?.properties?.confirm_all?.type,
      "boolean",
    );
    assert.equal(
      tabLifecycleTool?.inputSchema?.properties?.wait_until?.default,
      "listed",
    );
    assert.equal(
      tabLifecycleTool?.inputSchema?.properties?.wait_until?.enum?.includes("none"),
      true,
    );
    assert.equal(
      tabLifecycleTool?.inputSchema?.properties?.prune_stale?.type,
      "boolean",
    );

    const missingScriptCall = await rpc.call(
      "tools/call",
      {
        name: "browser_execute_js",
        arguments: {
          tmwd_mode: "tmwd",
          tmwd_transport: "ws",
        },
      },
      cli.timeout_ms,
    );
    assert.equal(missingScriptCall?.result?.isError, true);
    assertTextJsonContent(missingScriptCall.result, "browser_execute_js missing script error");
    const missingScriptPayload = firstJsonContent(missingScriptCall.result);
    assert.equal(missingScriptPayload?.error_code, "INVALID_ARGUMENT");
    assert.equal(missingScriptPayload?.retryable, false);

    const nativeCapabilitiesCall = await rpc.call(
      "tools/call",
      {
        name: "browser_native_input",
        arguments: {
          action: "capabilities",
        },
      },
      cli.timeout_ms,
    );
    assert.equal(nativeCapabilitiesCall?.result?.isError, undefined);
    assertTextJsonContent(nativeCapabilitiesCall.result, "browser_native_input capabilities result");
    const nativeCapabilitiesPayload = firstJsonContent(nativeCapabilitiesCall.result);
    assert.equal(nativeCapabilitiesPayload?.status, "success");
    assert.equal(nativeCapabilitiesPayload?.action, "capabilities");
    assert.equal(typeof nativeCapabilitiesPayload?.platform, "string");
    assert.equal(Array.isArray(nativeCapabilitiesPayload?.supported_actions), true);
    assert.equal(Array.isArray(nativeCapabilitiesPayload?.unsupported_actions), true);

    const nativeDryRunCall = await rpc.call(
      "tools/call",
      {
        name: "browser_native_input",
        arguments: {
          action: "click",
          x: 120,
          y: 200,
          button: "left",
          dry_run: true,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(nativeDryRunCall?.result?.isError, undefined);
    const nativeDryRunPayload = firstJsonContent(nativeDryRunCall.result);
    assert.equal(nativeDryRunPayload?.status, "success");
    assert.equal(nativeDryRunPayload?.action, "click");
    assert.equal(nativeDryRunPayload?.dry_run, true);
    assert.equal(typeof nativeDryRunPayload?.next_step, "string");
    assert.equal(typeof nativeDryRunPayload?.capabilities_summary?.supported, "boolean");

    const filePlanCall = await rpc.call(
      "tools/call",
      {
        name: "browser_file_ops",
        arguments: {
          action: "native_file_chooser_plan",
          selector: "input[type=file]",
          files: ["/tmp/example-upload.txt"],
        },
      },
      cli.timeout_ms,
    );
    assert.equal(filePlanCall?.result?.isError, undefined);
    assertTextJsonContent(filePlanCall.result, "browser_file_ops success result");
    const filePlanPayload = firstJsonContent(filePlanCall.result);
    assert.equal(filePlanPayload?.status, "success");
    assert.equal(filePlanPayload?.action, "native_file_chooser_plan");
    assert.equal(filePlanPayload?.executable, false);

    const fileMissingCall = await rpc.call(
      "tools/call",
      {
        name: "browser_file_ops",
        arguments: {
          action: "set_input_files",
          selector: "input[type=file]",
        },
      },
      cli.timeout_ms,
    );
    assert.equal(fileMissingCall?.result?.isError, true);
    assertTextJsonContent(fileMissingCall.result, "browser_file_ops missing args error");
    const fileMissingPayload = firstJsonContent(fileMissingCall.result);
    assert.equal(fileMissingPayload?.error_code, "INVALID_ARGUMENT");

    const fileUnsupportedCall = await rpc.call(
      "tools/call",
      {
        name: "browser_file_ops",
        arguments: {
          action: "unsupported_file_action",
        },
      },
      cli.timeout_ms,
    );
    assert.equal(fileUnsupportedCall?.result?.isError, true);
    const fileUnsupportedPayload = firstJsonContent(fileUnsupportedCall.result);
    assert.equal(fileUnsupportedPayload?.error_code, "ACTION_NOT_SUPPORTED");

    tmpDownloadDir = await fs.mkdtemp(path.join(os.tmpdir(), "tmwd-download-contract-"));
    const downloadPrepareCall = await rpc.call(
      "tools/call",
      {
        name: "browser_download_ops",
        arguments: {
          action: "prepare",
          download_dir: tmpDownloadDir,
          set_behavior: false,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(downloadPrepareCall?.result?.isError, undefined);
    assertTextJsonContent(downloadPrepareCall.result, "browser_download_ops prepare result");
    const downloadPreparePayload = firstJsonContent(downloadPrepareCall.result);
    assert.equal(downloadPreparePayload?.status, "success");
    assert.equal(downloadPreparePayload?.action, "prepare");
    assert.equal(typeof downloadPreparePayload?.token, "string");

    const downloadMissingCall = await rpc.call(
      "tools/call",
      {
        name: "browser_download_ops",
        arguments: {
          action: "wait",
        },
      },
      cli.timeout_ms,
    );
    assert.equal(downloadMissingCall?.result?.isError, true);
    assertTextJsonContent(downloadMissingCall.result, "browser_download_ops missing args error");
    const downloadMissingPayload = firstJsonContent(downloadMissingCall.result);
    assert.equal(downloadMissingPayload?.error_code, "INVALID_ARGUMENT");

    const downloadUnsupportedCall = await rpc.call(
      "tools/call",
      {
        name: "browser_download_ops",
        arguments: {
          action: "unsupported_download_action",
        },
      },
      cli.timeout_ms,
    );
    assert.equal(downloadUnsupportedCall?.result?.isError, true);
    const downloadUnsupportedPayload = firstJsonContent(downloadUnsupportedCall.result);
    assert.equal(downloadUnsupportedPayload?.error_code, "ACTION_NOT_SUPPORTED");

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
      cli.timeout_ms,
    );
    assert.equal(tabCreateDryRunCall?.result?.isError, undefined);
    assertTextJsonContent(tabCreateDryRunCall.result, "browser_tab_lifecycle create dry-run result");
    const tabCreateDryRunPayload = firstJsonContent(tabCreateDryRunCall.result);
    assert.equal(tabCreateDryRunPayload?.status, "success");
    assert.equal(tabCreateDryRunPayload?.created, false);
    assert.equal(tabCreateDryRunPayload?.owner, "tmwd");
    assert.equal(typeof tabCreateDryRunPayload?.managed_tab?.tab_id, "string");

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
      cli.timeout_ms,
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
      cli.timeout_ms,
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
      cli.timeout_ms,
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
      cli.timeout_ms,
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
      cli.timeout_ms,
    );
    assert.equal(tabCloseMissingScopeCall?.result?.isError, true);
    const tabCloseMissingScopePayload = firstJsonContent(tabCloseMissingScopeCall.result);
    assert.equal(tabCloseMissingScopePayload?.error_code, "INVALID_ARGUMENT");

    for (const args of [
      { action: "close_unkept", scope: "all", dry_run: true },
      { action: "close_unkept", all: true, dry_run: true },
      { action: "close_unkept", confirm_all: true, dry_run: true },
    ]) {
      const tabCloseAllDryRunCall = await rpc.call(
        "tools/call",
        {
          name: "browser_tab_lifecycle",
          arguments: args,
        },
        cli.timeout_ms,
      );
      assert.equal(tabCloseAllDryRunCall?.result?.isError, undefined);
      const tabCloseAllDryRunPayload = firstJsonContent(tabCloseAllDryRunCall.result);
      assert.equal(tabCloseAllDryRunPayload?.status, "success");
      assert.equal(tabCloseAllDryRunPayload?.close_scope?.all, true);
    }

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
      cli.timeout_ms,
    );
    assert.equal(tabCloseUnmanagedCall?.result?.isError, undefined);
    assertTextJsonContent(tabCloseUnmanagedCall.result, "browser_tab_lifecycle close_unkept result");
    const tabCloseUnmanagedPayload = firstJsonContent(tabCloseUnmanagedCall.result);
    assert.equal(tabCloseUnmanagedPayload?.status, "success");
    assert.deepEqual(tabCloseUnmanagedPayload?.unmanaged_tabs_ignored, ["user-tab-not-managed"]);

    const tabListManagedCall = await rpc.call(
      "tools/call",
      {
        name: "browser_tab_lifecycle",
        arguments: {
          action: "list_managed",
        },
      },
      cli.timeout_ms,
    );
    assert.equal(tabListManagedCall?.result?.isError, undefined);
    const tabListManagedPayload = firstJsonContent(tabListManagedCall.result);
    assert.equal(tabListManagedPayload?.status, "success");
    assert.equal(tabListManagedPayload?.capabilities?.supports_tabs_get, true);
    assert.equal(Array.isArray(tabListManagedPayload?.live_sessions), true);
    assert.equal(Array.isArray(tabListManagedPayload?.sessions), true);

    const tabPruneStaleCall = await rpc.call(
      "tools/call",
      {
        name: "browser_tab_lifecycle",
        arguments: {
          action: "prune_stale",
          dry_run: true,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(tabPruneStaleCall?.result?.isError, undefined);
    const tabPruneStalePayload = firstJsonContent(tabPruneStaleCall.result);
    assert.equal(tabPruneStalePayload?.status, "success");
    assert.equal(tabPruneStalePayload?.action, "prune_stale");
    assert.equal(tabPruneStalePayload?.capabilities?.supports_prune_stale, true);

    const clipboardDryRunCall = await rpc.call(
      "tools/call",
      {
        name: "browser_clipboard_ops",
        arguments: {
          action: "write_text",
          text: "contract clipboard text",
          dry_run: true,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(clipboardDryRunCall?.result?.isError, undefined);
    assertTextJsonContent(clipboardDryRunCall.result, "browser_clipboard_ops success result");
    const clipboardDryRunPayload = firstJsonContent(clipboardDryRunCall.result);
    assert.equal(clipboardDryRunPayload?.status, "success");
    assert.equal(clipboardDryRunPayload?.action, "write_text");
    assert.equal(clipboardDryRunPayload?.read_supported, false);

    const clipboardMissingCall = await rpc.call(
      "tools/call",
      {
        name: "browser_clipboard_ops",
        arguments: {
          action: "write_text",
        },
      },
      cli.timeout_ms,
    );
    assert.equal(clipboardMissingCall?.result?.isError, true);
    assertTextJsonContent(clipboardMissingCall.result, "browser_clipboard_ops missing args error");
    const clipboardMissingPayload = firstJsonContent(clipboardMissingCall.result);
    assert.equal(clipboardMissingPayload?.error_code, "INVALID_ARGUMENT");

    const clipboardUnsupportedCall = await rpc.call(
      "tools/call",
      {
        name: "browser_clipboard_ops",
        arguments: {
          action: "read_text",
        },
      },
      cli.timeout_ms,
    );
    assert.equal(clipboardUnsupportedCall?.result?.isError, true);
    const clipboardUnsupportedPayload = firstJsonContent(clipboardUnsupportedCall.result);
    assert.equal(clipboardUnsupportedPayload?.error_code, "ACTION_NOT_SUPPORTED");

    const toolCall = await rpc.call(
      "tools/call",
      {
        name: "browser_execute_js",
        arguments: {
          script: "return document.title;",
          tmwd_mode: "tmwd",
          tmwd_transport: "ws",
          tmwd_ws_endpoint: cli.ws_endpoint,
          timeout_ms: 1_500,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(toolCall?.result?.isError, true);
    assertTextJsonContent(toolCall.result, "browser_execute_js transport error");
    const errorPayload = firstJsonContent(toolCall.result);
    assert.equal(typeof errorPayload?.error_code, "string");
    assert.equal(typeof errorPayload?.retryable, "boolean");
    assert.equal(Array.isArray(errorPayload?.transport_attempts), true);
    assert.equal(errorPayload?.tool, "browser_execute_js");
    assert.equal(errorPayload?.native_auto_fallback, undefined);
    assert.equal(errorPayload?.native_input_hint, undefined);

    const toolCallWithPolicyButNoAutoFallback = await rpc.call(
      "tools/call",
      {
        name: "browser_execute_js",
        arguments: {
          script: "return document.title;",
          tmwd_mode: "tmwd",
          tmwd_transport: "ws",
          tmwd_ws_endpoint: cli.ws_endpoint,
          timeout_ms: 1_500,
          native_auto_fallback: false,
          native_auto_fallback_policy: "aggressive",
          native_auto_execute: false,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(toolCallWithPolicyButNoAutoFallback?.result?.isError, true);
    const policyIgnoredPayload = firstJsonContent(toolCallWithPolicyButNoAutoFallback.result);
    assert.equal(typeof policyIgnoredPayload?.error_code, "string");
    assert.equal(policyIgnoredPayload?.native_auto_fallback, undefined);
    assert.equal(policyIgnoredPayload?.native_input_hint, undefined);
    assert.equal(policyIgnoredPayload?.native_input_suggested, undefined);

    const toolCallWithAutoFallback = await rpc.call(
      "tools/call",
      {
        name: "browser_execute_js",
        arguments: {
          script: "return document.title;",
          tmwd_mode: "tmwd",
          tmwd_transport: "ws",
          tmwd_ws_endpoint: cli.ws_endpoint,
          timeout_ms: 1_500,
          native_auto_fallback: true,
          native_auto_execute: false,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(toolCallWithAutoFallback?.result?.isError, undefined);
    const autoFallbackPayload = firstJsonContent(toolCallWithAutoFallback.result);
    assert.equal(autoFallbackPayload?.status, "failed");
    assert.equal(typeof autoFallbackPayload?.error_code, "string");
    assert.equal(typeof autoFallbackPayload?.retryable, "boolean");
    assert.equal(autoFallbackPayload?.native_input_suggested, true);
    assert.equal(autoFallbackPayload?.native_input_hint?.policy, "balanced");
    assert.equal(
      autoFallbackPayload?.native_input_hint?.reason,
      "transport_or_session_unavailable",
    );
    assert.equal(
      autoFallbackPayload?.native_auto_fallback?.suggestion?.should_escalate,
      true,
    );
    assert.equal(
      autoFallbackPayload?.native_auto_fallback?.suggestion?.reason,
      "transport_or_session_unavailable",
    );
    assert.equal(typeof autoFallbackPayload?.native_auto_fallback?.status, "string");
    assert.equal(autoFallbackPayload?.native_auto_fallback?.attempted, true);
    assert.equal(autoFallbackPayload?.native_auto_fallback?.policy, "balanced");

    const toolCallWithStrictAutoFallback = await rpc.call(
      "tools/call",
      {
        name: "browser_execute_js",
        arguments: {
          script: "return document.title;",
          tmwd_mode: "tmwd",
          tmwd_transport: "ws",
          tmwd_ws_endpoint: cli.ws_endpoint,
          timeout_ms: 1_500,
          native_auto_fallback: true,
          native_auto_fallback_policy: "strict",
          native_auto_execute: false,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(toolCallWithStrictAutoFallback?.result?.isError, undefined);
    const strictAutoFallbackPayload = firstJsonContent(toolCallWithStrictAutoFallback.result);
    assert.equal(strictAutoFallbackPayload?.status, "failed");
    assert.equal(strictAutoFallbackPayload?.native_input_suggested, false);
    assert.equal(strictAutoFallbackPayload?.native_input_hint, undefined);
    assert.equal(strictAutoFallbackPayload?.native_auto_fallback?.status, "skipped");
    assert.equal(strictAutoFallbackPayload?.native_auto_fallback?.reason, "no_escalation_signal");
    assert.equal(strictAutoFallbackPayload?.native_auto_fallback?.attempted, false);
    assert.equal(strictAutoFallbackPayload?.native_auto_fallback?.executed, false);
    assert.equal(
      strictAutoFallbackPayload?.native_auto_fallback?.suggestion?.should_escalate,
      false,
    );
    assert.equal(strictAutoFallbackPayload?.native_auto_fallback?.suggestion?.policy, "strict");
    assert.equal(strictAutoFallbackPayload?.native_auto_fallback?.policy, "strict");

    const toolCallWithAggressiveAutoFallback = await rpc.call(
      "tools/call",
      {
        name: "browser_execute_js",
        arguments: {
          script: "return document.title;",
          tmwd_mode: "tmwd",
          tmwd_transport: "ws",
          tmwd_ws_endpoint: cli.ws_endpoint,
          timeout_ms: 1_500,
          native_auto_fallback: true,
          native_auto_fallback_policy: "aggressive",
          native_auto_execute: false,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(toolCallWithAggressiveAutoFallback?.result?.isError, undefined);
    const aggressiveAutoFallbackPayload = firstJsonContent(toolCallWithAggressiveAutoFallback.result);
    assert.equal(aggressiveAutoFallbackPayload?.status, "failed");
    assert.equal(aggressiveAutoFallbackPayload?.native_input_suggested, true);
    assert.equal(aggressiveAutoFallbackPayload?.native_input_hint?.policy, "aggressive");
    assert.equal(
      aggressiveAutoFallbackPayload?.native_input_hint?.reason,
      "transport_or_session_unavailable",
    );
    assert.equal(aggressiveAutoFallbackPayload?.native_auto_fallback?.attempted, true);
    assert.equal(
      aggressiveAutoFallbackPayload?.native_auto_fallback?.suggestion?.should_escalate,
      true,
    );
    assert.equal(
      aggressiveAutoFallbackPayload?.native_auto_fallback?.suggestion?.reason,
      "transport_or_session_unavailable",
    );
    assert.equal(aggressiveAutoFallbackPayload?.native_auto_fallback?.policy, "aggressive");
    assert.equal(typeof aggressiveAutoFallbackPayload?.native_auto_fallback?.status, "string");

    const toolCallWithInvalidPolicy = await rpc.call(
      "tools/call",
      {
        name: "browser_execute_js",
        arguments: {
          script: "return document.title;",
          tmwd_mode: "tmwd",
          tmwd_transport: "ws",
          tmwd_ws_endpoint: cli.ws_endpoint,
          timeout_ms: 1_500,
          native_auto_fallback: true,
          native_auto_fallback_policy: "unknown_policy_value",
          native_auto_execute: false,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(toolCallWithInvalidPolicy?.result?.isError, undefined);
    const invalidPolicyPayload = firstJsonContent(toolCallWithInvalidPolicy.result);
    assert.equal(invalidPolicyPayload?.status, "failed");
    assert.equal(invalidPolicyPayload?.native_input_suggested, true);
    assert.equal(invalidPolicyPayload?.native_input_hint?.policy, "balanced");
    assert.equal(
      invalidPolicyPayload?.native_input_hint?.reason,
      "transport_or_session_unavailable",
    );
    assert.equal(
      invalidPolicyPayload?.native_auto_fallback?.suggestion?.reason,
      "transport_or_session_unavailable",
    );
    assert.equal(invalidPolicyPayload?.native_auto_fallback?.policy, "balanced");

    const timeoutBalancedCall = await rpc.call(
      "tools/call",
      {
        name: "browser_execute_js",
        arguments: {
          script: "return document.title;",
          tmwd_mode: "tmwd",
          tmwd_transport: "link",
          tmwd_link_endpoint: hangingTmwdLinkServer.endpoint,
          timeout_ms: 200,
          native_auto_fallback: true,
          native_auto_fallback_policy: "balanced",
          native_auto_execute: false,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(timeoutBalancedCall?.result?.isError, undefined);
    const timeoutBalancedPayload = firstJsonContent(timeoutBalancedCall.result);
    assert.equal(timeoutBalancedPayload?.status, "failed");
    assert.equal(timeoutBalancedPayload?.error_code, "TIMEOUT");
    assert.equal(timeoutBalancedPayload?.native_input_suggested, false);
    assert.equal(timeoutBalancedPayload?.native_input_hint, undefined);
    assert.equal(timeoutBalancedPayload?.native_auto_fallback?.status, "skipped");
    assert.equal(timeoutBalancedPayload?.native_auto_fallback?.reason, "no_escalation_signal");
    assert.equal(timeoutBalancedPayload?.native_auto_fallback?.attempted, false);
    assert.equal(timeoutBalancedPayload?.native_auto_fallback?.policy, "balanced");

    const timeoutAggressiveCall = await rpc.call(
      "tools/call",
      {
        name: "browser_execute_js",
        arguments: {
          script: "return document.title;",
          tmwd_mode: "tmwd",
          tmwd_transport: "link",
          tmwd_link_endpoint: hangingTmwdLinkServer.endpoint,
          timeout_ms: 200,
          native_auto_fallback: true,
          native_auto_fallback_policy: "aggressive",
          native_auto_execute: false,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(timeoutAggressiveCall?.result?.isError, undefined);
    const timeoutAggressivePayload = firstJsonContent(timeoutAggressiveCall.result);
    assert.equal(timeoutAggressivePayload?.status, "failed");
    assert.equal(timeoutAggressivePayload?.error_code, "TIMEOUT");
    assert.equal(timeoutAggressivePayload?.native_input_suggested, true);
    assert.equal(timeoutAggressivePayload?.native_input_hint?.policy, "aggressive");
    assert.equal(
      timeoutAggressivePayload?.native_input_hint?.reason,
      "transport_or_session_unavailable",
    );
    assert.equal(typeof timeoutAggressivePayload?.native_auto_fallback?.status, "string");
    assert.notEqual(timeoutAggressivePayload?.native_auto_fallback?.status, "skipped");
    assert.equal(timeoutAggressivePayload?.native_auto_fallback?.attempted, true);
    assert.equal(
      timeoutAggressivePayload?.native_auto_fallback?.suggestion?.should_escalate,
      true,
    );
    assert.equal(timeoutAggressivePayload?.native_auto_fallback?.policy, "aggressive");

    const executionErrorBalancedCall = await rpc.call(
      "tools/call",
      {
        name: "browser_execute_js",
        arguments: {
          script: "return document.title;",
          tmwd_mode: "tmwd",
          tmwd_transport: "link",
          tmwd_link_endpoint: executeErrorTmwdLinkServer.endpoint,
          timeout_ms: 800,
          native_auto_fallback: true,
          native_auto_fallback_policy: "balanced",
          native_auto_execute: false,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(executionErrorBalancedCall?.result?.isError, undefined);
    const executionErrorBalancedPayload = firstJsonContent(executionErrorBalancedCall.result);
    assert.equal(executionErrorBalancedPayload?.status, "failed");
    assert.equal(executionErrorBalancedPayload?.error_code, "EXECUTION_ERROR");
    assert.equal(executionErrorBalancedPayload?.native_input_suggested, false);
    assert.equal(executionErrorBalancedPayload?.native_input_hint, undefined);
    assert.equal(executionErrorBalancedPayload?.native_auto_fallback?.status, "skipped");
    assert.equal(executionErrorBalancedPayload?.native_auto_fallback?.reason, "no_escalation_signal");
    assert.equal(executionErrorBalancedPayload?.native_auto_fallback?.attempted, false);
    assert.equal(executionErrorBalancedPayload?.native_auto_fallback?.policy, "balanced");

    const executionErrorAggressiveCall = await rpc.call(
      "tools/call",
      {
        name: "browser_execute_js",
        arguments: {
          script: "return document.title;",
          tmwd_mode: "tmwd",
          tmwd_transport: "link",
          tmwd_link_endpoint: executeErrorTmwdLinkServer.endpoint,
          timeout_ms: 800,
          native_auto_fallback: true,
          native_auto_fallback_policy: "aggressive",
          native_auto_execute: false,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(executionErrorAggressiveCall?.result?.isError, undefined);
    const executionErrorAggressivePayload = firstJsonContent(executionErrorAggressiveCall.result);
    assert.equal(executionErrorAggressivePayload?.status, "failed");
    assert.equal(executionErrorAggressivePayload?.error_code, "EXECUTION_ERROR");
    assert.equal(executionErrorAggressivePayload?.native_input_suggested, true);
    assert.equal(executionErrorAggressivePayload?.native_input_hint?.policy, "aggressive");
    assert.equal(
      executionErrorAggressivePayload?.native_input_hint?.reason,
      "browser_policy_blocked",
    );
    assert.equal(typeof executionErrorAggressivePayload?.native_auto_fallback?.status, "string");
    assert.notEqual(executionErrorAggressivePayload?.native_auto_fallback?.status, "skipped");
    assert.equal(executionErrorAggressivePayload?.native_auto_fallback?.attempted, true);
    assert.equal(
      executionErrorAggressivePayload?.native_auto_fallback?.suggestion?.should_escalate,
      true,
    );
    assert.equal(
      executionErrorAggressivePayload?.native_auto_fallback?.suggestion?.reason,
      "browser_policy_blocked",
    );
    assert.equal(executionErrorAggressivePayload?.native_auto_fallback?.policy, "aggressive");

    const nativeUnsupportedCall = await rpc.call(
      "tools/call",
      {
        name: "browser_native_input",
        arguments: {
          action: "not_supported_action",
        },
      },
      cli.timeout_ms,
    );
    assert.equal(nativeUnsupportedCall?.result?.isError, true);
    const nativeUnsupportedPayload = firstJsonContent(nativeUnsupportedCall.result);
    assert.equal(nativeUnsupportedPayload?.tool, "browser_native_input");
    assert.equal(nativeUnsupportedPayload?.error_code, "ACTION_NOT_SUPPORTED");

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        initialize_ok: true,
        tools_list_ok: true,
        tool_call_error_ok: true,
        tool_call_error_code: errorPayload.error_code,
        tool_call_retryable: errorPayload.retryable,
        tool_call_policy_ignored_error_code: policyIgnoredPayload?.error_code,
        tool_call_transport_attempts: errorPayload.transport_attempts,
        tool_call_auto_fallback_error_code: autoFallbackPayload?.error_code,
        tool_call_auto_fallback_status: autoFallbackPayload?.native_auto_fallback?.status,
        tool_call_strict_auto_fallback_status: strictAutoFallbackPayload?.native_auto_fallback?.status,
        tool_call_aggressive_auto_fallback_status: aggressiveAutoFallbackPayload?.native_auto_fallback?.status,
        tool_call_invalid_policy_normalized: invalidPolicyPayload?.native_auto_fallback?.policy,
        tool_call_timeout_balanced_status: timeoutBalancedPayload?.native_auto_fallback?.status,
        tool_call_timeout_aggressive_status: timeoutAggressivePayload?.native_auto_fallback?.status,
        tool_call_exec_error_balanced_status: executionErrorBalancedPayload?.native_auto_fallback?.status,
        tool_call_exec_error_aggressive_status: executionErrorAggressivePayload?.native_auto_fallback?.status,
        native_input_capabilities_ok: true,
        native_input_platform: nativeCapabilitiesPayload?.platform,
        native_input_supported_actions: nativeCapabilitiesPayload?.supported_actions,
        native_input_dry_run_ok: true,
        native_input_dry_run_next_step: nativeDryRunPayload?.next_step,
        native_input_unsupported_ok: true,
        native_input_error_code: nativeUnsupportedPayload?.error_code,
        wrapper_file_ops_ok: true,
        wrapper_download_ops_ok: true,
        wrapper_tab_lifecycle_ok: true,
        wrapper_tab_lifecycle_unmanaged_ignored: tabCloseUnmanagedPayload?.unmanaged_tabs_ignored,
        wrapper_clipboard_ops_ok: true,
        ws_endpoint: cli.ws_endpoint,
      })}\n`,
    );
  } finally {
    await rpc.close();
    if (previousTabRegistryPath === undefined) {
      delete process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
    } else {
      process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = previousTabRegistryPath;
    }
    if (hangingTmwdLinkServer && typeof hangingTmwdLinkServer.close === "function") {
      await hangingTmwdLinkServer.close();
    }
    if (executeErrorTmwdLinkServer && typeof executeErrorTmwdLinkServer.close === "function") {
      await executeErrorTmwdLinkServer.close();
    }
    if (tmpDownloadDir) {
      await fs.rm(tmpDownloadDir, { recursive: true, force: true });
    }
    await fs.rm(tmpTabRegistryPath, { force: true });
  }
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser-structured-mcp-contract failed: ${message}\n`);
  process.exitCode = 1;
}
