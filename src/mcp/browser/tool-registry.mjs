import Ajv from "ajv";

import { handleBrowserAuthOps } from "../../browser-auth.mjs";
import {
  handleBrowserClipboardOps,
  handleBrowserDownloadOps,
  handleBrowserFileOps,
  handleBrowserTabLifecycle,
} from "../../browser-wrappers.mjs";
import { randomId } from "../../common.mjs";
import {
  classifyBrowserErrorCode,
  isRetryableBrowserErrorCode,
} from "../../errors.mjs";
import { handleBrowserNativeInput } from "../../native-input.mjs";
import { handleBrowserRunOps } from "../../run-lifecycle.mjs";
import { createBrowserRuntime } from "../../runtime/browser-runtime.mjs";
import {
  completedOutcome,
  failedOutcome,
  formatMcpOutcome,
} from "../../runtime/tool-outcome.mjs";
import {
  handleBrowserDiff,
  handleBrowserEvidenceBundleOps,
  handleBrowserExecuteJs,
  handleBrowserExtract,
  handleBrowserJobOps,
  handleBrowserScan,
  handleBrowserScreenshotOps,
  handleBrowserTabOps,
  handleBrowserTransportHealth,
  handleBrowserWait,
} from "../../server/browser-core.mjs";
import { TOOL_SCHEMAS } from "../../tool-schemas.mjs";

const HANDLERS = {
  browser_scan: handleBrowserScan,
  browser_execute_js: handleBrowserExecuteJs,
  browser_wait: handleBrowserWait,
  browser_transport_health: handleBrowserTransportHealth,
  browser_run_ops: handleBrowserRunOps,
  browser_job_ops: handleBrowserJobOps,
  browser_extract: handleBrowserExtract,
  browser_diff: handleBrowserDiff,
  browser_screenshot_ops: handleBrowserScreenshotOps,
  browser_evidence_bundle_ops: handleBrowserEvidenceBundleOps,
  browser_tab_ops: handleBrowserTabOps,
  browser_native_input: handleBrowserNativeInput,
  browser_file_ops: handleBrowserFileOps,
  browser_download_ops: handleBrowserDownloadOps,
  browser_tab_lifecycle: handleBrowserTabLifecycle,
  browser_auth_ops: handleBrowserAuthOps,
  browser_clipboard_ops: handleBrowserClipboardOps,
};

function topLevelClosedSchema(inputSchema = {}) {
  return {
    ...inputSchema,
    additionalProperties: inputSchema.additionalProperties ?? false,
  };
}

function formatValidationErrors(errors = []) {
  return errors.map((error) => ({
    path: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message,
    params: error.params,
  }));
}

function createBrowserToolRegistry() {
  const ajv = new Ajv({
    allErrors: true,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
    strict: false,
  });
  const registry = {};
  for (const [name, schema] of Object.entries(TOOL_SCHEMAS)) {
    const handler = HANDLERS[name];
    if (typeof handler !== "function") {
      throw new Error(`tool registry missing handler: ${name}`);
    }
    const inputSchema = topLevelClosedSchema(schema.inputSchema);
    registry[name] = Object.freeze({
      name,
      description: schema.description,
      inputSchema,
      handler,
      validate: ajv.compile(inputSchema),
      outputPolicy: name === "browser_execute_js" ? "compact_by_request" : "bounded",
      concurrencyKey: (args = {}) => String(args.tab_id || args.switch_tab_id || args.session_id || "runtime"),
    });
  }
  return Object.freeze(registry);
}

const BROWSER_TOOL_REGISTRY = createBrowserToolRegistry();
const DEFAULT_BROWSER_RUNTIME = createBrowserRuntime();

function listRegisteredTools() {
  return Object.values(BROWSER_TOOL_REGISTRY).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

function validateToolArguments(tool, args) {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return [{
      path: "/",
      keyword: "type",
      message: "must be an object",
      params: { type: "object" },
    }];
  }
  return tool.validate(args) ? [] : formatValidationErrors(tool.validate.errors);
}

async function dispatchRegisteredTool(name, args = {}, options = {}) {
  const startedAt = performance.now();
  const requestId = options.request_id || randomId("tool");
  const tool = BROWSER_TOOL_REGISTRY[name];
  if (!tool) {
    return formatMcpOutcome(failedOutcome(new Error(`unknown tool: ${String(name)}`), {
      code: "TOOL_NOT_FOUND",
      retryable: false,
      request_id: requestId,
      duration_ms: Number((performance.now() - startedAt).toFixed(2)),
      meta: { tool: String(name) },
    }));
  }
  const validationErrors = validateToolArguments(tool, args);
  if (validationErrors.length > 0) {
    return formatMcpOutcome(failedOutcome(new Error("tool arguments failed validation"), {
      code: "INVALID_ARGUMENTS",
      retryable: false,
      request_id: requestId,
      duration_ms: Number((performance.now() - startedAt).toFixed(2)),
      details: { validation_errors: validationErrors },
      meta: { tool: name },
    }));
  }
  try {
    const data = await DEFAULT_BROWSER_RUNTIME.runForTab(
      tool.concurrencyKey(args),
      () => tool.handler(args),
    );
    const transportAttempts = Array.isArray(data?.transport_attempts)
      ? data.transport_attempts
      : undefined;
    return formatMcpOutcome(completedOutcome(data, {
      request_id: requestId,
      duration_ms: Number((performance.now() - startedAt).toFixed(2)),
      transport_attempts: transportAttempts,
      meta: {
        tool: name,
        output_policy: tool.outputPolicy,
      },
    }));
  } catch (error) {
    const message = String(error?.message ?? error ?? "tool execution failed");
    const code = String(error?.errorCode || classifyBrowserErrorCode(message));
    const retryable = typeof error?.retryable === "boolean"
      ? error.retryable
      : isRetryableBrowserErrorCode(code);
    return formatMcpOutcome(failedOutcome(error, {
      code,
      retryable,
      request_id: requestId,
      duration_ms: Number((performance.now() - startedAt).toFixed(2)),
      details: error?.details,
      transport_attempts: error?.transportAttempts,
      meta: { tool: name },
    }));
  }
}

async function disposeRegisteredBrowserRuntime() {
  return DEFAULT_BROWSER_RUNTIME.dispose();
}

export {
  BROWSER_TOOL_REGISTRY,
  createBrowserToolRegistry,
  dispatchRegisteredTool,
  disposeRegisteredBrowserRuntime,
  listRegisteredTools,
  validateToolArguments,
};
