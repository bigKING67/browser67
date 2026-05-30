#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRpcClient } from "./browser-structured-mcp-contract/rpc-client.mjs";
import { firstJsonContent } from "./browser-structured-mcp-contract/rpc-content.mjs";
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
  const rpc = createRpcClient();
  let hangingTmwdLinkServer;
  let executeErrorTmwdLinkServer;
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
    const names = tools
      .map((entry) => (typeof entry?.name === "string" ? entry.name : ""))
      .filter((name) => name.length > 0);
    assert.equal(names.includes("browser_scan"), true);
    assert.equal(names.includes("browser_execute_js"), true);
    assert.equal(names.includes("browser_extract"), true);
    assert.equal(names.includes("browser_tab_ops"), true);
    assert.equal(names.includes("browser_native_input"), true);
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
        ws_endpoint: cli.ws_endpoint,
      })}\n`,
    );
  } finally {
    await rpc.close();
    if (hangingTmwdLinkServer && typeof hangingTmwdLinkServer.close === "function") {
      await hangingTmwdLinkServer.close();
    }
    if (executeErrorTmwdLinkServer && typeof executeErrorTmwdLinkServer.close === "function") {
      await executeErrorTmwdLinkServer.close();
    }
  }
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser-structured-mcp-contract failed: ${message}\n`);
  process.exitCode = 1;
}
