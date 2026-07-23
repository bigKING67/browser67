import Ajv from "ajv";

import { handleBrowserAuthOps } from "../../auth/index.mjs";
import {
  handleBrowserClipboardOps,
  handleBrowserDownloadOps,
  handleBrowserFileOps,
  handleBrowserTabLifecycle,
} from "../../browser-wrappers/index.mjs";
import {
  classifyBrowserErrorCode,
  isRetryableBrowserErrorCode,
} from "../../runtime/tool-errors.mjs";
import { handleBrowserNativeInput } from "../../native/input.mjs";
import { createBrowserRuntime } from "../../runtime/browser-runtime.mjs";
import { randomId } from "../../runtime/identity.mjs";
import {
  compactToolData,
  compactTransportAttempts,
  resolveOutputMode,
} from "../../runtime/output-mode.mjs";
import { resolvePageContext } from "../../runtime/page-context.mjs";
import { handleBrowserRunOps } from "../../runtime/runs/lifecycle.mjs";
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
import { TOOL_SCHEMAS } from "../../tool-schemas/index.mjs";

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

function createBrowserToolRegistry(options = {}) {
  const ajv = new Ajv({
    allErrors: true,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
    strict: false,
  });
  const registry = {};
  for (const [name, schema] of Object.entries(TOOL_SCHEMAS)) {
    const handler = options.handlers?.[name] ?? HANDLERS[name];
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
      outputPolicy: "full_or_compact",
      defaultOutputMode: inputSchema.properties?.output_mode?.default ?? "full",
      compactPolicy: compactToolData,
      pagePolicy: resolvePageContext,
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
  const registry = options.registry ?? BROWSER_TOOL_REGISTRY;
  const runtime = options.runtime ?? DEFAULT_BROWSER_RUNTIME;
  const tool = registry[name];
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
    const rawData = await runtime.runForTab(
      tool.concurrencyKey(args),
      () => tool.handler(args, { runtime }),
    );
    const page = await tool.pagePolicy(name, args, rawData, { runtime });
    const outputMode = resolveOutputMode(args, tool.defaultOutputMode);
    const data = tool.compactPolicy(name, rawData, page, { mode: outputMode });
    const rawTransportAttempts = Array.isArray(rawData?.transport_attempts)
      ? rawData.transport_attempts
      : undefined;
    const transportAttempts = outputMode === "compact"
      ? compactTransportAttempts(rawTransportAttempts)
      : rawTransportAttempts;
    return formatMcpOutcome(completedOutcome(data, {
      page,
      request_id: requestId,
      duration_ms: Number((performance.now() - startedAt).toFixed(2)),
      transport_attempts: transportAttempts,
      meta: {
        tool: name,
        output_policy: tool.outputPolicy,
        output_mode: outputMode,
      },
    }));
  } catch (error) {
    const message = String(error?.message ?? error ?? "tool execution failed");
    const code = String(error?.errorCode || classifyBrowserErrorCode(message));
    const retryable = typeof error?.retryable === "boolean"
      ? error.retryable
      : isRetryableBrowserErrorCode(code);
    const outputMode = resolveOutputMode(args, tool.defaultOutputMode);
    const page = await tool.pagePolicy(name, args, error?.details ?? {}, { runtime });
    const transportAttempts = outputMode === "compact"
      ? compactTransportAttempts(error?.transportAttempts)
      : error?.transportAttempts;
    return formatMcpOutcome(failedOutcome(error, {
      page,
      code,
      retryable,
      request_id: requestId,
      duration_ms: Number((performance.now() - startedAt).toFixed(2)),
      details: error?.details,
      transport_attempts: transportAttempts,
      meta: { tool: name, output_policy: tool.outputPolicy, output_mode: outputMode },
    }));
  }
}

function createBrowserToolDispatcher(options = {}) {
  const runtime = options.runtime ?? createBrowserRuntime(options.runtime_options);
  const registry = options.registry ?? createBrowserToolRegistry(options.registry_options);
  return Object.freeze({
    dispatch: (name, args = {}, dispatchOptions = {}) => dispatchRegisteredTool(name, args, {
      ...dispatchOptions,
      registry,
      runtime,
    }),
    dispose: () => runtime.dispose(),
    listTools: () => Object.values(registry).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
    registry,
    runtime,
  });
}

async function disposeRegisteredBrowserRuntime() {
  return DEFAULT_BROWSER_RUNTIME.dispose();
}

export {
  BROWSER_TOOL_REGISTRY,
  createBrowserToolDispatcher,
  createBrowserToolRegistry,
  dispatchRegisteredTool,
  disposeRegisteredBrowserRuntime,
  listRegisteredTools,
  validateToolArguments,
};
