import assert from "node:assert/strict";
import {
  assertTextJsonContent,
  firstJsonContent,
} from "./rpc-content.mjs";

async function assertExecuteJsFallbackPolicy({
  rpc,
  timeoutMs,
  wsEndpoint,
  hangingLinkEndpoint,
  executeErrorLinkEndpoint,
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
        tmwd_ws_endpoint: wsEndpoint,
        timeout_ms: 1_500,
        native_auto_fallback: false,
        native_auto_fallback_policy: "aggressive",
        native_auto_execute: false,
      },
    },
    timeoutMs,
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
        tmwd_ws_endpoint: wsEndpoint,
        timeout_ms: 1_500,
        native_auto_fallback: true,
        native_auto_execute: false,
      },
    },
    timeoutMs,
  );
  assert.equal(toolCallWithAutoFallback?.result?.isError, undefined);
  const autoFallbackPayload = firstJsonContent(toolCallWithAutoFallback.result);
  assert.equal(autoFallbackPayload?.status, "failed");
  assert.equal(typeof autoFallbackPayload?.error_code, "string");
  assert.equal(typeof autoFallbackPayload?.retryable, "boolean");
  assert.equal(autoFallbackPayload?.native_input_suggested, true);
  assert.equal(autoFallbackPayload?.native_input_hint?.policy, "balanced");
  assert.equal(autoFallbackPayload?.native_input_hint?.reason, "transport_or_session_unavailable");
  assert.equal(autoFallbackPayload?.native_auto_fallback?.suggestion?.should_escalate, true);
  assert.equal(autoFallbackPayload?.native_auto_fallback?.suggestion?.reason, "transport_or_session_unavailable");
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
        tmwd_ws_endpoint: wsEndpoint,
        timeout_ms: 1_500,
        native_auto_fallback: true,
        native_auto_fallback_policy: "strict",
        native_auto_execute: false,
      },
    },
    timeoutMs,
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
  assert.equal(toolCallWithAggressiveAutoFallback?.result?.isError, undefined);
  const aggressiveAutoFallbackPayload = firstJsonContent(toolCallWithAggressiveAutoFallback.result);
  assert.equal(aggressiveAutoFallbackPayload?.status, "failed");
  assert.equal(aggressiveAutoFallbackPayload?.native_input_suggested, true);
  assert.equal(aggressiveAutoFallbackPayload?.native_input_hint?.policy, "aggressive");
  assert.equal(aggressiveAutoFallbackPayload?.native_input_hint?.reason, "transport_or_session_unavailable");
  assert.equal(aggressiveAutoFallbackPayload?.native_auto_fallback?.attempted, true);
  assert.equal(aggressiveAutoFallbackPayload?.native_auto_fallback?.suggestion?.should_escalate, true);
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
  assert.equal(toolCallWithInvalidPolicy?.result?.isError, undefined);
  const invalidPolicyPayload = firstJsonContent(toolCallWithInvalidPolicy.result);
  assert.equal(invalidPolicyPayload?.status, "failed");
  assert.equal(invalidPolicyPayload?.native_input_suggested, true);
  assert.equal(invalidPolicyPayload?.native_input_hint?.policy, "balanced");
  assert.equal(invalidPolicyPayload?.native_input_hint?.reason, "transport_or_session_unavailable");
  assert.equal(invalidPolicyPayload?.native_auto_fallback?.suggestion?.reason, "transport_or_session_unavailable");
  assert.equal(invalidPolicyPayload?.native_auto_fallback?.policy, "balanced");

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
        tmwd_link_endpoint: hangingLinkEndpoint,
        timeout_ms: 200,
        native_auto_fallback: true,
        native_auto_fallback_policy: "aggressive",
        native_auto_execute: false,
      },
    },
    timeoutMs,
  );
  assert.equal(timeoutAggressiveCall?.result?.isError, undefined);
  const timeoutAggressivePayload = firstJsonContent(timeoutAggressiveCall.result);
  assert.equal(timeoutAggressivePayload?.status, "failed");
  assert.equal(timeoutAggressivePayload?.error_code, "TIMEOUT");
  assert.equal(timeoutAggressivePayload?.native_input_suggested, true);
  assert.equal(timeoutAggressivePayload?.native_input_hint?.policy, "aggressive");
  assert.equal(timeoutAggressivePayload?.native_input_hint?.reason, "transport_or_session_unavailable");
  assert.equal(typeof timeoutAggressivePayload?.native_auto_fallback?.status, "string");
  assert.notEqual(timeoutAggressivePayload?.native_auto_fallback?.status, "skipped");
  assert.equal(timeoutAggressivePayload?.native_auto_fallback?.attempted, true);
  assert.equal(timeoutAggressivePayload?.native_auto_fallback?.suggestion?.should_escalate, true);
  assert.equal(timeoutAggressivePayload?.native_auto_fallback?.policy, "aggressive");

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
        tmwd_link_endpoint: executeErrorLinkEndpoint,
        timeout_ms: 800,
        native_auto_fallback: true,
        native_auto_fallback_policy: "aggressive",
        native_auto_execute: false,
      },
    },
    timeoutMs,
  );
  assert.equal(executionErrorAggressiveCall?.result?.isError, undefined);
  const executionErrorAggressivePayload = firstJsonContent(executionErrorAggressiveCall.result);
  assert.equal(executionErrorAggressivePayload?.status, "failed");
  assert.equal(executionErrorAggressivePayload?.error_code, "EXECUTION_ERROR");
  assert.equal(executionErrorAggressivePayload?.native_input_suggested, true);
  assert.equal(executionErrorAggressivePayload?.native_input_hint?.policy, "aggressive");
  assert.equal(executionErrorAggressivePayload?.native_input_hint?.reason, "browser_policy_blocked");
  assert.equal(typeof executionErrorAggressivePayload?.native_auto_fallback?.status, "string");
  assert.notEqual(executionErrorAggressivePayload?.native_auto_fallback?.status, "skipped");
  assert.equal(executionErrorAggressivePayload?.native_auto_fallback?.attempted, true);
  assert.equal(executionErrorAggressivePayload?.native_auto_fallback?.suggestion?.should_escalate, true);
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
