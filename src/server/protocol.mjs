import { TOOL_SCHEMAS } from "../tool-schemas.mjs";
import { dispatchToolCall } from "./tool-dispatch.mjs";

const VERSION = "0.2.0-ga-cdp";
const SERVER_NAME = "browser67-tmwd-browser";

function sendResponse(id, result, output = process.stdout) {
  output.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendError(id, code, message, output = process.stdout) {
  output.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function listToolsPayload() {
  const tools = Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
    name,
    description: schema.description,
    inputSchema: schema.inputSchema,
  }));
  return { tools };
}

function createRequestHandler(options = {}) {
  const output = options.output ?? process.stdout;
  return function handleRequest(request) {
    const { id, method, params } = request;
    if (!method || typeof method !== "string") {
      sendError(id ?? null, -32600, "invalid request: missing method", output);
      return;
    }
    if (method === "initialize") {
      sendResponse(id, {
        protocolVersion: "2024-11-05",
        serverInfo: {
          name: SERVER_NAME,
          version: VERSION,
        },
        capabilities: {
          tools: {},
        },
      }, output);
      return;
    }
    if (method === "tools/list") {
      sendResponse(id, listToolsPayload(), output);
      return;
    }
    if (method === "tools/call") {
      const toolName = params?.name;
      const args = params?.arguments ?? {};
      if (typeof toolName !== "string") {
        sendError(id ?? null, -32602, "tools/call requires string params.name", output);
        return;
      }
      dispatchToolCall(toolName, args)
        .then((result) => {
          sendResponse(id, result, output);
        })
        .catch((error) => {
          sendError(id ?? null, -32000, `tool execution failed: ${String(error)}`, output);
        });
      return;
    }
    if (method === "notifications/initialized") {
      return;
    }
    sendError(id ?? null, -32601, `method not found: ${method}`, output);
  };
}

export {
  VERSION,
  SERVER_NAME,
  createRequestHandler,
  listToolsPayload,
  sendError,
  sendResponse,
};
