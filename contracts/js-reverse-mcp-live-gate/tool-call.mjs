import { firstJsonContent } from "../browser-structured-mcp-contract/rpc-content.mjs";

function summarizeToolError(name, response) {
  const payload = firstJsonContent(response?.result);
  return `${name} failed ok=${String(payload?.ok)} readiness=${String(payload?.readiness?.reason ?? "")} error=${String(payload?.error ?? "")}`;
}

async function callTool(rpc, name, args, timeoutMs) {
  const response = await rpc.call(
    "tools/call",
    {
      name,
      arguments: args,
    },
    timeoutMs,
  );
  if (response?.result?.isError === true) {
    throw new Error(summarizeToolError(name, response));
  }
  const payload = firstJsonContent(response.result);
  if (!payload || typeof payload !== "object") {
    throw new Error(`${name} returned no json payload`);
  }
  return payload;
}

export {
  callTool,
};
