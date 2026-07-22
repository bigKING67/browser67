import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  assertTextJsonContent,
  firstJsonContent,
} from "./rpc-content.mjs";

async function registerExecuteErrorManagedTab(registryPath) {
  const now = new Date().toISOString();
  let registry = {};
  try {
    registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const record = {
    tab_id: "exec_error_session_1",
    owner: "tmwd",
    managed: true,
    ownership_origin: "agent_created",
    close_on_finalize: true,
    ownership_generation: "fallback-contract-ownership",
    source: "fallback-contract",
    workspace_key: "fallback-contract",
    task_id: "execute-error",
    reuse_key: "https://example.invalid/exec-error",
    url: "https://example.invalid/exec-error",
    title: "ExecError Session",
    origin: "https://example.invalid",
    path_scope: "/",
    keep: true,
    dry_run: false,
    status: "open",
    created_at: now,
    updated_at: now,
    last_used_at: now,
  };
  const managedTabs = Array.isArray(registry?.managed_tabs)
    ? registry.managed_tabs.filter((item) => item?.tab_id !== record.tab_id)
    : [];
  const payload = {
    version: 2,
    updated_at: now,
    managed_tabs: [...managedTabs, record],
  };
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  const tempPath = `${registryPath}.${process.pid}.fallback.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  await fs.rename(tempPath, registryPath);
}

async function assertExecuteJsFallbackPolicy({
  rpc,
  timeoutMs,
  wsEndpoint,
  hangingLinkEndpoint,
  executeErrorLinkEndpoint,
  registryPath,
}) {
  const toolCall = await rpc.call(
    "tools/call",
    {
      name: "browser_execute_js",
      arguments: {
        script: "return document.title;",
        tmwd_mode: "tmwd",
        tmwd_transport: "ws",
        tmwd_ws_endpoint: wsEndpoint,
        timeout_ms: 1_500,
      },
    },
    timeoutMs,
  );
  assert.equal(toolCall?.result?.isError, true, "forced transport failure returns an MCP error");
  assertTextJsonContent(toolCall.result, "browser_execute_js transport error");
  const errorPayload = firstJsonContent(toolCall.result);
  assert.equal(typeof errorPayload?.error_code, "string");
  assert.equal(typeof errorPayload?.retryable, "boolean");
  assert.equal(Array.isArray(errorPayload?.transport_attempts), true, "transport attempts are exposed");
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
        tmwd_ws_endpoint: wsEndpoint,
        timeout_ms: 1_500,
        native_auto_fallback: false,
        native_auto_fallback_policy: "aggressive",
        native_auto_execute: false,
      },
    },
    timeoutMs,
  );
  assert.equal(
    toolCallWithPolicyButNoAutoFallback?.result?.isError,
    true,
    "policy alone does not enable native auto fallback",
  );
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
        tmwd_ws_endpoint: wsEndpoint,
        timeout_ms: 1_500,
        native_auto_fallback: true,
        native_auto_execute: false,
      },
    },
    timeoutMs,
  );
  assert.equal(toolCallWithAutoFallback?.result?.isError, undefined, "balanced native auto fallback returns tool data");
  const autoFallbackPayload = firstJsonContent(toolCallWithAutoFallback.result);
  assert.equal(autoFallbackPayload?.status, "failed");
  assert.equal(
    ["NO_EXTENSION", "TRANSPORT_UNAVAILABLE"].includes(autoFallbackPayload?.error_code),
    true,
    `closed WebSocket endpoint is classified as unavailable (error_code=${String(autoFallbackPayload?.error_code ?? "unknown")} error=${String(autoFallbackPayload?.error ?? "unknown")})`,
  );
  assert.equal(typeof autoFallbackPayload?.retryable, "boolean");
  assert.equal(
    autoFallbackPayload?.native_input_suggested,
    true,
    `balanced transport failure suggests native input (error_code=${String(autoFallbackPayload?.error_code ?? "unknown")})`,
  );
  assert.equal(autoFallbackPayload?.native_input_hint?.policy, "balanced");
  assert.equal(autoFallbackPayload?.native_input_hint?.reason, "transport_or_session_unavailable");
  assert.equal(
    autoFallbackPayload?.native_auto_fallback?.suggestion?.should_escalate,
    true,
    "balanced transport failure emits an escalation signal",
  );
  assert.equal(autoFallbackPayload?.native_auto_fallback?.suggestion?.reason, "transport_or_session_unavailable");
  assert.equal(typeof autoFallbackPayload?.native_auto_fallback?.status, "string");
  assert.equal(autoFallbackPayload?.native_auto_fallback?.attempted, true, "balanced native fallback is attempted");
  assert.equal(autoFallbackPayload?.native_auto_fallback?.policy, "balanced");

  const toolCallWithStrictAutoFallback = await rpc.call(
    "tools/call",
    {
      name: "browser_execute_js",
      arguments: {
        script: "return document.title;",
        tmwd_mode: "tmwd",
        tmwd_transport: "ws",
        tmwd_ws_endpoint: wsEndpoint,
        timeout_ms: 1_500,
        native_auto_fallback: true,
        native_auto_fallback_policy: "strict",
        native_auto_execute: false,
      },
    },
    timeoutMs,
  );
  assert.equal(toolCallWithStrictAutoFallback?.result?.isError, undefined, "strict native auto fallback returns tool data");
  const strictAutoFallbackPayload = firstJsonContent(toolCallWithStrictAutoFallback.result);
  assert.equal(strictAutoFallbackPayload?.status, "failed");
  assert.equal(strictAutoFallbackPayload?.native_input_suggested, false);
  assert.equal(strictAutoFallbackPayload?.native_input_hint, undefined);
  assert.equal(strictAutoFallbackPayload?.native_auto_fallback?.status, "skipped");
  assert.equal(strictAutoFallbackPayload?.native_auto_fallback?.reason, "no_escalation_signal");
  assert.equal(strictAutoFallbackPayload?.native_auto_fallback?.attempted, false);
  assert.equal(strictAutoFallbackPayload?.native_auto_fallback?.executed, false);
  assert.equal(strictAutoFallbackPayload?.native_auto_fallback?.suggestion?.should_escalate, false);
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
        tmwd_ws_endpoint: wsEndpoint,
        timeout_ms: 1_500,
        native_auto_fallback: true,
        native_auto_fallback_policy: "aggressive",
        native_auto_execute: false,
      },
    },
    timeoutMs,
  );
  assert.equal(toolCallWithAggressiveAutoFallback?.result?.isError, undefined, "aggressive native auto fallback returns tool data");
  const aggressiveAutoFallbackPayload = firstJsonContent(toolCallWithAggressiveAutoFallback.result);
  assert.equal(aggressiveAutoFallbackPayload?.status, "failed");
  assert.equal(
    aggressiveAutoFallbackPayload?.native_input_suggested,
    true,
    "aggressive transport failure suggests native input",
  );
  assert.equal(aggressiveAutoFallbackPayload?.native_input_hint?.policy, "aggressive");
  assert.equal(aggressiveAutoFallbackPayload?.native_input_hint?.reason, "transport_or_session_unavailable");
  assert.equal(
    aggressiveAutoFallbackPayload?.native_auto_fallback?.attempted,
    true,
    "aggressive native fallback is attempted",
  );
  assert.equal(
    aggressiveAutoFallbackPayload?.native_auto_fallback?.suggestion?.should_escalate,
    true,
    "aggressive transport failure emits an escalation signal",
  );
  assert.equal(aggressiveAutoFallbackPayload?.native_auto_fallback?.suggestion?.reason, "transport_or_session_unavailable");
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
        tmwd_ws_endpoint: wsEndpoint,
        timeout_ms: 1_500,
        native_auto_fallback: true,
        native_auto_fallback_policy: "unknown_policy_value",
        native_auto_execute: false,
      },
    },
    timeoutMs,
  );
  assert.equal(toolCallWithInvalidPolicy?.result?.isError, true);
  const invalidPolicyPayload = firstJsonContent(toolCallWithInvalidPolicy.result);
  assert.equal(invalidPolicyPayload?.error_code, "INVALID_ARGUMENTS");
  assert.equal(invalidPolicyPayload?.retryable, false);
  assert.equal(
    invalidPolicyPayload?.details?.validation_errors?.some((item) => item.keyword === "enum"),
    true,
    "invalid fallback policy reports an enum validation error",
  );

  const timeoutBalancedCall = await rpc.call(
    "tools/call",
    {
      name: "browser_execute_js",
      arguments: {
        script: "return document.title;",
        tmwd_mode: "tmwd",
        tmwd_transport: "link",
        tmwd_link_endpoint: hangingLinkEndpoint,
        timeout_ms: 200,
        native_auto_fallback: true,
        native_auto_fallback_policy: "balanced",
        native_auto_execute: false,
      },
    },
    timeoutMs,
  );
  assert.equal(timeoutBalancedCall?.result?.isError, undefined, "balanced timeout fallback returns tool data");
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
        tmwd_link_endpoint: hangingLinkEndpoint,
        timeout_ms: 200,
        native_auto_fallback: true,
        native_auto_fallback_policy: "aggressive",
        native_auto_execute: false,
      },
    },
    timeoutMs,
  );
  assert.equal(timeoutAggressiveCall?.result?.isError, undefined, "aggressive timeout fallback returns tool data");
  const timeoutAggressivePayload = firstJsonContent(timeoutAggressiveCall.result);
  assert.equal(timeoutAggressivePayload?.status, "failed");
  assert.equal(timeoutAggressivePayload?.error_code, "TIMEOUT");
  assert.equal(timeoutAggressivePayload?.native_input_suggested, true, "aggressive timeout suggests native input");
  assert.equal(timeoutAggressivePayload?.native_input_hint?.policy, "aggressive");
  assert.equal(timeoutAggressivePayload?.native_input_hint?.reason, "transport_or_session_unavailable");
  assert.equal(typeof timeoutAggressivePayload?.native_auto_fallback?.status, "string");
  assert.notEqual(timeoutAggressivePayload?.native_auto_fallback?.status, "skipped");
  assert.equal(
    timeoutAggressivePayload?.native_auto_fallback?.attempted,
    true,
    "aggressive timeout fallback is attempted",
  );
  assert.equal(
    timeoutAggressivePayload?.native_auto_fallback?.suggestion?.should_escalate,
    true,
    "aggressive timeout emits an escalation signal",
  );
  assert.equal(timeoutAggressivePayload?.native_auto_fallback?.policy, "aggressive");

  await registerExecuteErrorManagedTab(registryPath);

  const executionErrorBalancedCall = await rpc.call(
    "tools/call",
    {
      name: "browser_execute_js",
      arguments: {
        script: "return document.title;",
        tmwd_mode: "tmwd",
        tmwd_transport: "link",
        tmwd_link_endpoint: executeErrorLinkEndpoint,
        timeout_ms: 800,
        native_auto_fallback: true,
        native_auto_fallback_policy: "balanced",
        native_auto_execute: false,
      },
    },
    timeoutMs,
  );
  assert.equal(executionErrorBalancedCall?.result?.isError, undefined, "balanced execution fallback returns tool data");
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
        tmwd_link_endpoint: executeErrorLinkEndpoint,
        timeout_ms: 800,
        native_auto_fallback: true,
        native_auto_fallback_policy: "aggressive",
        native_auto_execute: false,
      },
    },
    timeoutMs,
  );
  assert.equal(executionErrorAggressiveCall?.result?.isError, undefined, "aggressive execution fallback returns tool data");
  const executionErrorAggressivePayload = firstJsonContent(executionErrorAggressiveCall.result);
  assert.equal(executionErrorAggressivePayload?.status, "failed");
  assert.equal(executionErrorAggressivePayload?.error_code, "EXECUTION_ERROR");
  assert.equal(
    executionErrorAggressivePayload?.native_input_suggested,
    true,
    "aggressive execution error suggests native input",
  );
  assert.equal(executionErrorAggressivePayload?.native_input_hint?.policy, "aggressive");
  assert.equal(executionErrorAggressivePayload?.native_input_hint?.reason, "browser_policy_blocked");
  assert.equal(typeof executionErrorAggressivePayload?.native_auto_fallback?.status, "string");
  assert.notEqual(executionErrorAggressivePayload?.native_auto_fallback?.status, "skipped");
  assert.equal(
    executionErrorAggressivePayload?.native_auto_fallback?.attempted,
    true,
    "aggressive execution fallback is attempted",
  );
  assert.equal(
    executionErrorAggressivePayload?.native_auto_fallback?.suggestion?.should_escalate,
    true,
    "aggressive execution error emits an escalation signal",
  );
  assert.equal(executionErrorAggressivePayload?.native_auto_fallback?.suggestion?.reason, "browser_policy_blocked");
  assert.equal(executionErrorAggressivePayload?.native_auto_fallback?.policy, "aggressive");

  return {
    aggressiveAutoFallbackPayload,
    autoFallbackPayload,
    errorPayload,
    executionErrorAggressivePayload,
    executionErrorBalancedPayload,
    invalidPolicyPayload,
    policyIgnoredPayload,
    strictAutoFallbackPayload,
    timeoutAggressivePayload,
    timeoutBalancedPayload,
  };
}

export { assertExecuteJsFallbackPolicy };
