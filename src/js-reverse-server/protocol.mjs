import { makeJsonTextContent } from "../mcp-result.mjs";
import {
  TOOL_SCHEMAS,
  VERSION,
} from "./tool-schemas.mjs";
import { dispatchToolCall } from "./dispatch.mjs";

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
    const tools = Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
      name,
      description: schema.description,
      inputSchema: schema.inputSchema,
    }));
    sendResponse(id, { tools });
    return;
  }
  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments ?? {};
    if (typeof toolName !== "string") {
      sendError(id ?? null, -32602, "tools/call requires string params.name");
      return;
    }
    dispatchToolCall(toolName, args)
      .then((result) => sendResponse(id, result))
      .catch((error) => {
        sendResponse(id, {
          isError: true,
          content: [
            makeJsonTextContent({
              ok: false,
              tool: toolName,
              error: String(error?.message ?? error),
            }),
          ],
        });
      });
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
