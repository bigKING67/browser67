import Ajv from "ajv";

import { createBrowserRuntime } from "../../runtime/browser-runtime.mjs";
import { randomId } from "../../runtime/identity.mjs";
import {
  completedOutcome,
  failedOutcome,
  formatMcpOutcome,
} from "../../runtime/tool-outcome.mjs";
import { JS_REVERSE_HANDLERS } from "../../js-reverse-server/dispatch.mjs";
import { TOOL_SCHEMAS } from "../../js-reverse-server/tool-schemas.mjs";
import { disposeJsReverseState } from "../../js-reverse-server/state.mjs";

function topLevelClosedSchema(inputSchema = {}) {
  return {
    ...inputSchema,
    additionalProperties: inputSchema.additionalProperties ?? false,
  };
}

function validationErrors(errors = []) {
  return errors.map((error) => ({
    path: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message,
    params: error.params,
  }));
}

function createJsReverseToolRegistry() {
  const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: false });
  const registry = {};
  for (const [name, schema] of Object.entries(TOOL_SCHEMAS)) {
    const handler = JS_REVERSE_HANDLERS[name];
    if (typeof handler !== "function") throw new Error(`js-reverse registry missing handler: ${name}`);
    const inputSchema = topLevelClosedSchema(schema.inputSchema);
    registry[name] = Object.freeze({
      name,
      description: schema.description,
      inputSchema,
      validate: ajv.compile(inputSchema),
      handler,
      concurrencyKey: (args = {}) => String(args.page_id || args.session_id || "js-reverse-runtime"),
    });
  }
  return Object.freeze(registry);
}

const JS_REVERSE_TOOL_REGISTRY = createJsReverseToolRegistry();
const JS_REVERSE_RUNTIME = createBrowserRuntime();

function listJsReverseTools() {
  return Object.values(JS_REVERSE_TOOL_REGISTRY).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

async function dispatchJsReverseTool(name, args = {}) {
  const startedAt = performance.now();
  const requestId = randomId("js_reverse_tool");
  const journal = async (entry = {}) => JS_REVERSE_RUNTIME.toolJournal?.record?.({
    runtime_id: JS_REVERSE_RUNTIME.runtime_id,
    request_id: requestId,
    surface: "js-reverse",
    tool: String(name),
    args,
    ...entry,
  });
  const tool = JS_REVERSE_TOOL_REGISTRY[name];
  if (!tool) {
    await journal({ status: "error", error_code: "TOOL_NOT_FOUND", retryable: false });
    return formatMcpOutcome(failedOutcome(new Error(`unknown tool: ${String(name)}`), {
      code: "TOOL_NOT_FOUND",
      retryable: false,
      request_id: requestId,
      meta: { tool: String(name), surface: "js-reverse" },
    }));
  }
  if (!tool.validate(args)) {
    await journal({ status: "error", error_code: "INVALID_ARGUMENTS", retryable: false });
    return formatMcpOutcome(failedOutcome(new Error("tool arguments failed validation"), {
      code: "INVALID_ARGUMENTS",
      retryable: false,
      request_id: requestId,
      details: { validation_errors: validationErrors(tool.validate.errors) },
      meta: { tool: name, surface: "js-reverse" },
    }));
  }
  try {
    const data = await JS_REVERSE_RUNTIME.runForTab(tool.concurrencyKey(args), () => tool.handler(args));
    const durationMs = Number((performance.now() - startedAt).toFixed(2));
    await journal({ status: "success", duration_ms: durationMs, result: data });
    return formatMcpOutcome(completedOutcome(data, {
      request_id: requestId,
      duration_ms: durationMs,
      meta: { tool: name, surface: "js-reverse" },
    }));
  } catch (error) {
    const durationMs = Number((performance.now() - startedAt).toFixed(2));
    await journal({
      status: "error",
      error_code: error?.errorCode || "EXECUTION_ERROR",
      retryable: error?.retryable === true,
      duration_ms: durationMs,
    });
    return formatMcpOutcome(failedOutcome(error, {
      code: error?.errorCode || "EXECUTION_ERROR",
      retryable: error?.retryable === true,
      request_id: requestId,
      duration_ms: durationMs,
      details: error?.details,
      meta: { tool: name, surface: "js-reverse" },
    }));
  }
}

async function disposeJsReverseRuntime() {
  try {
    return await JS_REVERSE_RUNTIME.dispose();
  } finally {
    disposeJsReverseState();
  }
}

export {
  JS_REVERSE_TOOL_REGISTRY,
  createJsReverseToolRegistry,
  dispatchJsReverseTool,
  disposeJsReverseRuntime,
  listJsReverseTools,
};
