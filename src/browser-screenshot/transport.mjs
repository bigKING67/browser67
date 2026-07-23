import {
  cdpEvaluateScript,
  cdpRunCommand,
} from "../cdp-runtime/index.mjs";
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

async function evaluatePageScript(args, preferred, script, runtimeOptions = {}) {
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
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
    switch_tab_id: preferred.context.target.id,
  }, script, runtimeOptions);
  return {
    value: unwrapJsValue(executed.result.value),
    preferred,
    transport_attempts: [],
  };
}

async function runCdpScreenshot(args, preferred, params, runtimeOptions = {}) {
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
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
    switch_tab_id: preferred.context.target.id,
  }, "Page.captureScreenshot", params, runtimeOptions);
  return {
    base64: command.result.response?.data,
    preferred,
    transport_attempts: [],
  };
}

async function runCdpBrowserCommand(args, preferred, method, params = {}, runtimeOptions = {}) {
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
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
    switch_tab_id: preferred.context.target.id,
  }, method, params, runtimeOptions);
  return {
    value: command.result.response,
    preferred,
    transport_attempts: [],
  };
}

export {
  evaluatePageScript,
  runCdpBrowserCommand,
  runCdpScreenshot,
};
