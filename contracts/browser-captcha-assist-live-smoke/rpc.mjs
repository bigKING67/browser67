import assert from "node:assert/strict";

import { createRpcClient } from "../browser-structured-mcp-contract/rpc-client.mjs";
import { firstJsonContent } from "../browser-structured-mcp-contract/rpc-content.mjs";

function createCaptchaSmokeRpc(cli) {
  const rpc = createRpcClient();

  return {
    async initialize() {
      const init = await rpc.call("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "browser-captcha-assist-live-smoke",
          version: "1.0.0",
        },
      }, cli.timeout_ms);
      assert.equal(init?.result?.serverInfo?.name, "browser-structured-mcp");
      rpc.notify("notifications/initialized", {});
      return init;
    },

    async callTool(name, args) {
      const response = await rpc.call("tools/call", { name, arguments: args }, cli.timeout_ms);
      if (response?.result?.isError === true) {
        const payload = firstJsonContent(response.result);
        throw new Error(`${name} failed: ${String(payload?.error ?? payload?.message ?? "tool error")}`);
      }
      return firstJsonContent(response.result);
    },

    close: () => rpc.close(),
  };
}

export {
  createCaptchaSmokeRpc,
};
