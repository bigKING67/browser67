import assert from "node:assert/strict";

async function initializeJsReverseSession(rpc, timeoutMs) {
  const init = await rpc.call(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "js-reverse-mcp-live-gate",
        version: "1.0.0",
      },
    },
    timeoutMs,
  );
  assert.equal(init?.result?.serverInfo?.name, "js-reverse");
  rpc.notify("notifications/initialized", {});
}

export {
  initializeJsReverseSession,
};
