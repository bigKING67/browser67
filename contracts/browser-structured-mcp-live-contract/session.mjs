import assert from "node:assert/strict";

const REQUIRED_TOOLS = [
  "browser_scan",
  "browser_execute_js",
  "browser_tab_ops",
  "browser_file_ops",
  "browser_download_ops",
  "browser_tab_lifecycle",
  "browser_clipboard_ops",
];

async function initializeAndAssertTools(rpc, cli) {
  const init = await rpc.call(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "browser-structured-mcp-live-contract",
        version: "1.0.0",
      },
    },
    cli.timeout_ms,
  );
  assert.equal(init?.result?.serverInfo?.name, "browser67-tmwd-browser");
  rpc.notify("notifications/initialized", {});

  const toolsList = await rpc.call("tools/list", {}, cli.timeout_ms);
  const tools = Array.isArray(toolsList?.result?.tools) ? toolsList.result.tools : [];
  const names = tools
    .map((entry) => (typeof entry?.name === "string" ? entry.name : ""))
    .filter((name) => name.length > 0);
  for (const name of REQUIRED_TOOLS) {
    assert.equal(names.includes(name), true);
  }
}

export {
  initializeAndAssertTools,
};
