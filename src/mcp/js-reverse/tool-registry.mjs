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
  const tool = JS_REVERSE_TOOL_REGISTRY[name];
  if (!tool) {
    return formatMcpOutcome(failedOutcome(new Error(`unknown tool: ${String(name)}`), {
      code: "TOOL_NOT_FOUND",
      retryable: false,
      request_id: requestId,
      meta: { tool: String(name), surface: "js-reverse" },
    }));
  }
  if (!tool.validate(args)) {
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
    return formatMcpOutcome(completedOutcome(data, {
      request_id: requestId,
      duration_ms: Number((performance.now() - startedAt).toFixed(2)),
      meta: { tool: name, surface: "js-reverse" },
    }));
  } catch (error) {
    return formatMcpOutcome(failedOutcome(error, {
      code: error?.errorCode || "EXECUTION_ERROR",
      retryable: error?.retryable === true,
      request_id: requestId,
      duration_ms: Number((performance.now() - startedAt).toFixed(2)),
      details: error?.details,
      meta: { tool: name, surface: "js-reverse" },
    }));
  }
}

async function disposeJsReverseRuntime() {
  return JS_REVERSE_RUNTIME.dispose();
}

export {
  JS_REVERSE_TOOL_REGISTRY,
  createJsReverseToolRegistry,
  dispatchJsReverseTool,
  disposeJsReverseRuntime,
  listJsReverseTools,
};
