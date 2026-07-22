import assert from "node:assert/strict";

import { createRpcClient } from "../browser67-browser-mcp-contract/rpc-client.mjs";
import { firstJsonContent } from "../browser67-browser-mcp-contract/rpc-content.mjs";

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
      assert.equal(init?.result?.serverInfo?.name, "browser67-tmwd-browser");
      rpc.notify("notifications/initialized", {});
      return init;
    },

    async callTool(name, args) {
      const response = await rpc.call("tools/call", { name, arguments: args }, cli.timeout_ms);
      if (response?.result?.isError === true) {
        const payload = firstJsonContent(response.result);
        const details = payload?.details
          ? ` details=${JSON.stringify(payload.details)}`
          : "";
        throw new Error(
          `${name} failed: ${String(payload?.error ?? payload?.message ?? "tool error")}${details}`,
        );
      }
      return firstJsonContent(response.result);
    },

    close: () => rpc.close(),
  };
}

export {
  createCaptchaSmokeRpc,
};
