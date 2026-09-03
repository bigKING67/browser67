import {
  cdpEvaluateScript,
  cdpRunCommand,
  withTargetClient,
} from "../cdp-runtime/index.mjs";
import { resolveBatchReferences } from "../browser/execution/batch-references.mjs";
import { createToolError } from "../runtime/tool-errors.mjs";
import {
  executeTmwdJsWithFallback,
} from "../tmwd-runtime/index.mjs";
import { normalizeTmwdTransportLabel } from "../runtime/transport-attempts.mjs";

function unwrapJsValue(value) {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "ok")) {
    const hasWrapperPayload = Object.prototype.hasOwnProperty.call(value, "data")
      || Object.prototype.hasOwnProperty.call(value, "results")
      || Object.prototype.hasOwnProperty.call(value, "error");
    if (!hasWrapperPayload) {
      return value;
    }
    if (value.ok === false) {
      throw createToolError(
        "EXECUTION_ERROR",
        String(value.error?.message ?? value.error ?? "page script failed"),
        { retryable: false },
      );
    }
    return Object.prototype.hasOwnProperty.call(value, "data") ? value.data : value.results;
  }
  return value;
}

function extractScreenshotData(executed = {}) {
  const raw = executed.raw;
  const value = executed.value;
  return value?.data
    ?? value?.result?.data
    ?? raw?.data?.data
    ?? raw?.result?.data
    ?? raw?.data
    ?? raw?.result;
}

function isTmwdTransport(preferred) {
  return preferred?.transport === "tmwd_ws" || preferred?.transport === "tmwd_link";
}

function selectedRawTabId(preferred) {
  const target = preferred?.context?.target ?? {};
  return String(target.tab_id ?? target.tabId ?? target.id ?? "").trim();
}

function runtimeEvaluateCommand(script) {
  return {
    cmd: "cdp",
    method: "Runtime.evaluate",
    params: {
      expression: `(async () => {\n${String(script ?? "")}\n})()`,
      awaitPromise: true,
      returnByValue: true,
    },
  };
}

function buildTmwdViewportScreenshotBatch({
  viewportParams,
  settleScript,
  pageMetadataScript,
  layoutMetricsScript: metricsScript,
  targetScript,
  screenshotParams,
} = {}) {
  const commands = [
    {
      cmd: "cdp",
      method: "Emulation.setDeviceMetricsOverride",
      params: viewportParams ?? {},
    },
    runtimeEvaluateCommand(settleScript),
    runtimeEvaluateCommand(pageMetadataScript),
  ];
  const resultIndexes = {
    viewport_override: 0,
    settle: 1,
    page: 2,
    layout_metrics: null,
    target: null,
    screenshot: null,
    cleanup: null,
  };
  if (typeof metricsScript === "string" && metricsScript.length > 0) {
    resultIndexes.layout_metrics = commands.length;
    commands.push(runtimeEvaluateCommand(metricsScript));
  }
  if (typeof targetScript === "string" && targetScript.length > 0) {
    resultIndexes.target = commands.length;
    commands.push(runtimeEvaluateCommand(targetScript));
  }
  if (screenshotParams && typeof screenshotParams === "object") {
    resultIndexes.screenshot = commands.length;
    commands.push({
      cmd: "cdp",
      method: "Page.captureScreenshot",
      params: screenshotParams,
    });
  }
  resultIndexes.cleanup = commands.length;
  commands.push({
    cmd: "cdp",
    method: "Emulation.clearDeviceMetricsOverride",
    params: {},
  });
  return {
    command: {
      cmd: "batch",
      commands,
    },
    result_indexes: resultIndexes,
  };
}

function extractTmwdBatchResults(executed = {}) {
  const candidates = [
    executed.value,
    executed.raw,
    executed.raw?.data,
    executed.raw?.result,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (Array.isArray(candidate?.results)) return candidate.results;
  }
  return [];
}

function unwrapBatchCommandResult(value) {
  if (
    value
    && typeof value === "object"
    && Object.prototype.hasOwnProperty.call(value, "ok")
  ) {
    if (value.ok === false) {
      throw createToolError(
        "EXECUTION_ERROR",
        String(value.error?.message ?? value.error ?? "TMWD screenshot batch command failed"),
        { retryable: false },
      );
    }
    if (Object.prototype.hasOwnProperty.call(value, "data")) return value.data;
    if (Object.prototype.hasOwnProperty.call(value, "result")) return value.result;
  }
  return value;
}

function batchRuntimeValue(results, index, label) {
  const response = unwrapBatchCommandResult(results[index]);
  if (response?.exceptionDetails) {
    throw createToolError(
      "EXECUTION_ERROR",
      `${label} failed during TMWD screenshot batch evaluation`,
      {
        retryable: false,
        details: {
          command_index: index,
          exception_text: String(response.exceptionDetails.text ?? "Runtime.evaluate exception"),
        },
      },
    );
  }
  if (!response?.result || !Object.prototype.hasOwnProperty.call(response.result, "value")) {
    throw createToolError(
      "EXECUTION_ERROR",
      `${label} did not return a by-value result during TMWD screenshot batch evaluation`,
      {
        retryable: false,
        details: { command_index: index },
      },
    );
  }
  return response.result.value;
}

function parseTmwdViewportScreenshotBatchResults(executed, plan) {
  if (executed?.raw?.ok === false) {
    throw createToolError(
      "EXECUTION_ERROR",
      String(executed.raw.error?.message ?? executed.raw.error ?? "TMWD viewport screenshot batch failed"),
      { retryable: false },
    );
  }
  const results = extractTmwdBatchResults(executed);
  const indexes = plan?.result_indexes ?? {};
  const expectedCount = Array.isArray(plan?.command?.commands)
    ? plan.command.commands.length
    : 0;
  if (expectedCount === 0 || results.length !== expectedCount) {
    throw createToolError(
      "EXECUTION_ERROR",
      "TMWD viewport screenshot batch returned an incomplete result set",
      {
        retryable: false,
        details: {
          expected_results: expectedCount,
          actual_results: results.length,
        },
      },
    );
  }

  unwrapBatchCommandResult(results[indexes.viewport_override]);
  const screenshotResponse = Number.isInteger(indexes.screenshot)
    ? unwrapBatchCommandResult(results[indexes.screenshot])
    : null;
  const base64 = screenshotResponse?.data ?? screenshotResponse?.result?.data;
  unwrapBatchCommandResult(results[indexes.cleanup]);
  return {
    settle: batchRuntimeValue(results, indexes.settle, "viewport settle probe"),
    page: batchRuntimeValue(results, indexes.page, "page metadata probe"),
    layout_metrics: Number.isInteger(indexes.layout_metrics)
      ? batchRuntimeValue(results, indexes.layout_metrics, "layout metrics probe")
      : null,
    target: Number.isInteger(indexes.target)
      ? batchRuntimeValue(results, indexes.target, "capture target probe")
      : null,
    base64,
    cleanup: {
      cleared: true,
      method: "Emulation.clearDeviceMetricsOverride",
    },
  };
}

async function executeCdpViewportBatch(args, preferred, plan, runtimeOptions = {}) {
  const targetTabId = selectedRawTabId(preferred);
  const run = await withTargetClient({
    ...(args ?? {}),
    switch_tab_id: targetTabId,
  }, async (client, _target, _endpoint, timeoutMs, _resolved, operationDeadline) => {
    const results = [];
    const deadlineAt = Date.now() + timeoutMs;
    let overrideActive = false;
    let cleanup = null;
    try {
      for (const rawCommand of plan.command.commands) {
        const command = resolveBatchReferences(rawCommand, results, {
          command_index: results.length,
        });
        if (command?.cmd !== "cdp") {
          throw createToolError(
            "INVALID_ARGUMENT",
            `CDP viewport batch only accepts cdp commands, got ${String(command?.cmd ?? "")}`,
            { retryable: false, details: { command_index: results.length } },
          );
        }
        const remainingMs = Math.min(
          Math.floor(deadlineAt - Date.now()),
          operationDeadline.remaining("viewport_batch"),
        );
        if (remainingMs < 100) {
          throw createToolError("TIMEOUT", "CDP viewport batch deadline exceeded", {
            retryable: true,
            details: { command_index: results.length, failed_phase: "viewport_batch" },
          });
        }
        const response = await client.send(command.method, command.params || {}, remainingMs);
        results.push(response);
        if (command.method === "Emulation.setDeviceMetricsOverride") overrideActive = true;
        if (command.method === "Emulation.clearDeviceMetricsOverride") overrideActive = false;
      }
      return { ok: true, results };
    } finally {
      if (overrideActive) {
        try {
          await client.send("Emulation.clearDeviceMetricsOverride", {}, Math.max(100, deadlineAt - Date.now()));
          cleanup = { cleared: true, method: "Emulation.clearDeviceMetricsOverride" };
        } catch (error) {
          cleanup = {
            cleared: false,
            method: "Emulation.clearDeviceMetricsOverride",
            error: String(error?.message ?? error),
          };
        }
      }
      if (cleanup?.cleared === false) {
        throw createToolError(
          "VIEWPORT_CLEANUP_FAILED",
          "CDP viewport batch cleanup failed",
          { retryable: true, details: { cleanup } },
        );
      }
    }
  }, runtimeOptions);
  return {
    executed: {
      raw: run.result,
      value: run.result.results,
    },
    preferred,
    transport_attempts: [],
  };
}

async function runTmwdViewportScreenshotBatch(
  args,
  preferred,
  batchInput,
  runtimeOptions = {},
) {
  const plan = buildTmwdViewportScreenshotBatch(batchInput);
  if (!isTmwdTransport(preferred)) {
    if (preferred?.transport !== "cdp") {
      throw createToolError(
        "TRANSPORT_UNAVAILABLE",
        `viewport screenshot batch requires TMWD or CDP transport, got ${String(preferred?.transport ?? "unknown")}`,
        { retryable: true },
      );
    }
    const cdp = await executeCdpViewportBatch(args, preferred, plan, runtimeOptions);
    return {
      ...parseTmwdViewportScreenshotBatchResults(cdp.executed, plan),
      preferred: cdp.preferred,
      transport_attempts: cdp.transport_attempts,
    };
  }
  const tmwd = await executeTmwdJsWithFallback(
    args ?? {},
    preferred.context,
    plan.command,
    runtimeOptions,
  );
  return {
    ...parseTmwdViewportScreenshotBatchResults(tmwd.executed, plan),
    preferred: {
      ...preferred,
      transport: normalizeTmwdTransportLabel(tmwd.context.tmwd_transport),
      context: tmwd.context,
    },
    transport_attempts: tmwd.transport_attempts,
  };
}

async function evaluatePageScript(args, preferred, script, runtimeOptions = {}) {
  if (isTmwdTransport(preferred)) {
    const tmwd = await executeTmwdJsWithFallback(args ?? {}, preferred.context, script, runtimeOptions);
    return {
      value: unwrapJsValue(tmwd.executed.value),
      preferred: {
        ...preferred,
        transport: normalizeTmwdTransportLabel(tmwd.context.tmwd_transport),
        context: tmwd.context,
      },
      transport_attempts: tmwd.transport_attempts,
    };
  }
  const executed = await cdpEvaluateScript({
    ...args,
    switch_tab_id: selectedRawTabId(preferred),
  }, script, runtimeOptions);
  return {
    value: unwrapJsValue(executed.result.value),
    preferred,
    transport_attempts: [],
  };
}

async function runCdpScreenshot(args, preferred, params, runtimeOptions = {}) {
  if (isTmwdTransport(preferred)) {
    const tmwd = await executeTmwdJsWithFallback(args ?? {}, preferred.context, {
      cmd: "cdp",
      method: "Page.captureScreenshot",
      params,
    }, runtimeOptions);
    return {
      base64: extractScreenshotData(tmwd.executed),
      preferred: {
        ...preferred,
        transport: normalizeTmwdTransportLabel(tmwd.context.tmwd_transport),
        context: tmwd.context,
      },
      transport_attempts: tmwd.transport_attempts,
    };
  }
  const command = await cdpRunCommand({
    ...args,
    switch_tab_id: selectedRawTabId(preferred),
  }, "Page.captureScreenshot", params, runtimeOptions);
  return {
    base64: command.result.response?.data,
    preferred,
    transport_attempts: [],
  };
}

async function runCdpBrowserCommand(args, preferred, method, params = {}, runtimeOptions = {}) {
  if (isTmwdTransport(preferred)) {
    const tmwd = await executeTmwdJsWithFallback(args ?? {}, preferred.context, {
      cmd: "cdp",
      method,
      params,
    }, runtimeOptions);
    return {
      value: tmwd.executed.value,
      preferred: {
        ...preferred,
        transport: normalizeTmwdTransportLabel(tmwd.context.tmwd_transport),
        context: tmwd.context,
      },
      transport_attempts: tmwd.transport_attempts,
    };
  }
  const command = await cdpRunCommand({
    ...args,
    switch_tab_id: selectedRawTabId(preferred),
  }, method, params, runtimeOptions);
  return {
    value: command.result.response,
    preferred,
    transport_attempts: [],
  };
}

export {
  buildTmwdViewportScreenshotBatch,
  evaluatePageScript,
  isTmwdTransport,
  parseTmwdViewportScreenshotBatchResults,
  runCdpBrowserCommand,
  runCdpScreenshot,
  runTmwdViewportScreenshotBatch,
};
