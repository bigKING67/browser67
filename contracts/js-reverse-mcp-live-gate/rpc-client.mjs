import { createJsReverseRpcClient } from "../js-reverse-mcp-common/rpc-client.mjs";

function createRpcClient() {
  return createJsReverseRpcClient({
    idPrefix: "js_reverse_live",
    defaultTimeoutMs: 12_000,
  });
}

export {
  createRpcClient,
};
