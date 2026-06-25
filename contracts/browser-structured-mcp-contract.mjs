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
import {
  startExecuteErrorTmwdLinkServer,
  startHangingTmwdLinkServer,
} from "./browser-structured-mcp-contract/tmwd-link-fixtures.mjs";
import { assertExecuteJsFallbackPolicy } from "./browser-structured-mcp-contract/fallback-policy.mjs";
import { assertNativeCapabilitySurface } from "./browser-structured-mcp-contract/native-surface.mjs";
import { assertNativeInputOpsContract } from "./browser-structured-mcp-contract/native-input-ops.mjs";
import { assertOptionalLiveProofContract } from "./browser-structured-mcp-contract/optional-live-proofs.mjs";
import { assertPhysicalLiveGateContract } from "./browser-structured-mcp-contract/physical-live-gate.mjs";
import { assertFileDownloadClipboardOpsContract } from "./browser-structured-mcp-contract/file-download-clipboard-ops.mjs";
import { assertTabLifecycleOpsContract } from "./browser-structured-mcp-contract/tab-lifecycle-ops.mjs";
import { assertAuthOpsContract } from "./browser-structured-mcp-contract/auth-ops.mjs";
import { assertToolSurface } from "./browser-structured-mcp-contract/tool-surface.mjs";
import { assertReadinessLjqCtrlProbeContract } from "./browser-structured-mcp-contract/readiness-audit.mjs";
import { assertManagedTabCleanupBaselineContract } from "./browser-structured-mcp-contract/managed-tab-cleanup.mjs";
import { assertRunWaitHealthOpsContract } from "./browser-structured-mcp-contract/run-wait-health-ops.mjs";

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
  await assertNativeCapabilitySurface();
  await assertOptionalLiveProofContract();
  await assertPhysicalLiveGateContract();
  await assertReadinessLjqCtrlProbeContract();
  await assertManagedTabCleanupBaselineContract();

  const previousTabRegistryPath = process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
  const previousLoginProfileDir = process.env.BROWSER_STRUCTURED_LOGIN_PROFILE_DIR;
  const tmpTabRegistryPath = path.join(
    os.tmpdir(),
    `tmwd-tab-registry-contract-${process.pid}-${Date.now()}.json`,
  );
  const tmpLoginProfileDir = await fs.mkdtemp(path.join(os.tmpdir(), "tmwd-login-profiles-contract-"));
  let tmpTooManyLoginProfileDir;
  await fs.writeFile(
    path.join(tmpLoginProfileDir, "alpha-site.env"),
    [
      "PROFILE_ID=alpha-site",
      "ALLOWED_ORIGINS=http://alpha.example",
      "USERNAME=alpha-user",
      "PASSWORD=alpha-password",
      "LOGIN_PATH_PATTERN=/sign-in",
      "USERNAME_SELECTOR=#email",
      "PASSWORD_SELECTOR=#password",
      "SUBMIT_SELECTOR=button[type=\"submit\"]",
      "SUCCESS_PATH_NOT=/sign-in",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  await fs.writeFile(
    path.join(tmpLoginProfileDir, "contract-site.env"),
    [
      "PROFILE_ID=contract-site",
      "ALLOWED_ORIGINS=http://example.test,http://127.0.0.1:3000",
      "USERNAME=contract-user",
      "PASSWORD=contract-password",
      "LOGIN_PATH_PATTERN=/login",
      "USERNAME_SELECTOR=#username",
      "PASSWORD_SELECTOR=#password",
      "SUBMIT_SELECTOR=button[type=\"submit\"]",
      "SUCCESS_PATH_NOT=/login",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  tmpTooManyLoginProfileDir = await fs.mkdtemp(path.join(os.tmpdir(), "tmwd-login-profiles-overflow-contract-"));
  await Promise.all(Array.from({ length: 201 }, async (_item, index) => fs.writeFile(
    path.join(tmpTooManyLoginProfileDir, `overflow-${String(index).padStart(3, "0")}.env`),
    "",
    { mode: 0o600 },
  )));
  process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = tmpTabRegistryPath;
  process.env.BROWSER_STRUCTURED_LOGIN_PROFILE_DIR = tmpLoginProfileDir;
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

    await assertToolSurface({ rpc, timeoutMs: cli.timeout_ms });

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

    const nativeInputSummary = await assertNativeInputOpsContract({
      rpc,
      timeoutMs: cli.timeout_ms,
    });

    const ioOpsSummary = await assertFileDownloadClipboardOpsContract({
      rpc,
      timeoutMs: cli.timeout_ms,
    });

    const tabLifecycleSummary = await assertTabLifecycleOpsContract({
      registryPath: tmpTabRegistryPath,
      rpc,
      timeoutMs: cli.timeout_ms,
    });

    await assertAuthOpsContract({
      rpc,
      timeoutMs: cli.timeout_ms,
      tmpLoginProfileDir,
      tmpTooManyLoginProfileDir,
    });

    const runWaitHealthSummary = await assertRunWaitHealthOpsContract({
      rpc,
      timeoutMs: cli.timeout_ms,
    });

    const fallbackSummary = await assertExecuteJsFallbackPolicy({
      rpc,
      timeoutMs: cli.timeout_ms,
      wsEndpoint: cli.ws_endpoint,
      hangingLinkEndpoint: hangingTmwdLinkServer.endpoint,
      executeErrorLinkEndpoint: executeErrorTmwdLinkServer.endpoint,
    });

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        initialize_ok: true,
        tools_list_ok: true,
        tool_call_error_ok: true,
        tool_call_error_code: fallbackSummary.errorPayload.error_code,
        tool_call_retryable: fallbackSummary.errorPayload.retryable,
        tool_call_policy_ignored_error_code: fallbackSummary.policyIgnoredPayload?.error_code,
        tool_call_transport_attempts: fallbackSummary.errorPayload.transport_attempts,
        tool_call_auto_fallback_error_code: fallbackSummary.autoFallbackPayload?.error_code,
        tool_call_auto_fallback_status: fallbackSummary.autoFallbackPayload?.native_auto_fallback?.status,
        tool_call_strict_auto_fallback_status: fallbackSummary.strictAutoFallbackPayload?.native_auto_fallback?.status,
        tool_call_aggressive_auto_fallback_status: fallbackSummary.aggressiveAutoFallbackPayload?.native_auto_fallback?.status,
        tool_call_invalid_policy_normalized: fallbackSummary.invalidPolicyPayload?.native_auto_fallback?.policy,
        tool_call_timeout_balanced_status: fallbackSummary.timeoutBalancedPayload?.native_auto_fallback?.status,
        tool_call_timeout_aggressive_status: fallbackSummary.timeoutAggressivePayload?.native_auto_fallback?.status,
        tool_call_exec_error_balanced_status: fallbackSummary.executionErrorBalancedPayload?.native_auto_fallback?.status,
        tool_call_exec_error_aggressive_status: fallbackSummary.executionErrorAggressivePayload?.native_auto_fallback?.status,
        native_input_capabilities_ok: true,
        native_input_platform: nativeInputSummary.nativeCapabilitiesPayload?.platform,
        native_input_supported_actions: nativeInputSummary.nativeCapabilitiesPayload?.supported_actions,
        native_input_dry_run_ok: true,
        native_input_dry_run_next_step: nativeInputSummary.nativeDryRunPayload?.next_step,
        native_input_unsupported_ok: true,
        native_input_error_code: nativeInputSummary.nativeUnsupportedPayload?.error_code,
        wrapper_file_ops_ok: ioOpsSummary.filePlanPayload?.status === "success",
        wrapper_download_ops_ok: ioOpsSummary.downloadPreparePayload?.status === "success",
        wrapper_tab_lifecycle_ok: true,
        wrapper_tab_lifecycle_unmanaged_ignored: tabLifecycleSummary.tabCloseUnmanagedPayload?.unmanaged_tabs_ignored,
        wrapper_auth_ops_ok: true,
        wrapper_clipboard_ops_ok: ioOpsSummary.clipboardDryRunPayload?.status === "success",
        wrapper_run_ops_ok: Boolean(runWaitHealthSummary.run_id),
        wrapper_transport_health_status: runWaitHealthSummary.transport_health_status,
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
    if (previousLoginProfileDir === undefined) {
      delete process.env.BROWSER_STRUCTURED_LOGIN_PROFILE_DIR;
    } else {
      process.env.BROWSER_STRUCTURED_LOGIN_PROFILE_DIR = previousLoginProfileDir;
    }
    if (hangingTmwdLinkServer && typeof hangingTmwdLinkServer.close === "function") {
      await hangingTmwdLinkServer.close();
    }
    if (executeErrorTmwdLinkServer && typeof executeErrorTmwdLinkServer.close === "function") {
      await executeErrorTmwdLinkServer.close();
    }
    await fs.rm(tmpTabRegistryPath, { force: true });
    await fs.rm(tmpLoginProfileDir, { recursive: true, force: true });
    if (tmpTooManyLoginProfileDir) {
      await fs.rm(tmpTooManyLoginProfileDir, { recursive: true, force: true });
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
