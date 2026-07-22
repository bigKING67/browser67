import {
  dispatchJsReverseTool,
  listJsReverseTools,
} from "../mcp/js-reverse/tool-registry.mjs";
import { VERSION } from "./tool-schemas.mjs";

function sendResponse(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function handleRequest(request) {
  const { id, method, params } = request;
  if (!method || typeof method !== "string") {
    sendError(id ?? null, -32600, "invalid request: missing method");
    return;
  }
  if (method === "initialize") {
    sendResponse(id, {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "js-reverse", version: VERSION },
      capabilities: { tools: {} },
    });
    return;
  }
  if (method === "tools/list") {
    sendResponse(id, { tools: listJsReverseTools() });
    return;
  }
  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments ?? {};
    if (typeof toolName !== "string") {
      sendError(id ?? null, -32602, "tools/call requires string params.name");
      return;
    }
    dispatchJsReverseTool(toolName, args)
      .then((result) => sendResponse(id, result))
      .catch((error) => sendError(id ?? null, -32603, String(error?.message ?? error)));
    return;
  }
  if (method === "notifications/initialized") return;
  sendError(id ?? null, -32601, `method not found: ${method}`);
}

export {
  handleRequest,
  sendError,
  sendResponse,
};
