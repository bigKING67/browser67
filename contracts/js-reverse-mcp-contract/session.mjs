import assert from "node:assert/strict";

import { assertOpenAiToolSchemaCompatibility } from "../browser67-browser-mcp-contract/schema-compat.mjs";

async function initializeJsReverseContractSession(rpc, timeoutMs) {
  const init = await rpc.call(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "js-reverse-mcp-contract",
        version: "1.0.0",
      },
    },
    timeoutMs,
  );
  assert.equal(init?.result?.serverInfo?.name, "js-reverse");
  assert.equal(init?.result?.capabilities?.tools && typeof init.result.capabilities.tools, "object");
  rpc.notify("notifications/initialized", {});

  const toolsList = await rpc.call("tools/list", {}, timeoutMs);
  const tools = Array.isArray(toolsList?.result?.tools) ? toolsList.result.tools : [];
  assertOpenAiToolSchemaCompatibility(tools, "js-reverse");
  return tools;
}

function assertRequiredTools(tools) {
  const names = tools
    .map((entry) => (typeof entry?.name === "string" ? entry.name : ""))
    .filter((name) => name.length > 0);
  for (const requiredName of [
    "check_browser_health",
    "analyze_target",
    "search_in_scripts",
    "list_network_requests",
    "list_frames",
    "detect_microfrontends",
    "create_hook",
    "inject_hook",
    "get_hook_data",
    "export_rebuild_bundle",
    "export_evidence_bundle",
    "get_storage",
    "get_local_storage",
    "get_session_storage",
    "search_storage",
    "watch_storage_changes",
    "finalize_task",
  ]) {
    assert.equal(names.includes(requiredName), true, `missing tool ${requiredName}`);
  }

  const createHookTool = tools.find((entry) => entry?.name === "create_hook");
  assert.equal(createHookTool?.inputSchema?.type, "object");
  assert.equal(createHookTool?.inputSchema?.properties?.hook_id?.type, "string");
  const newPageTool = tools.find((entry) => entry?.name === "new_page");
  assert.equal(newPageTool?.inputSchema?.properties?.ownership_policy?.default, "tmwd_only");
  assert.equal(newPageTool?.inputSchema?.properties?.reuse_scope?.default, "origin_path");
  const listFramesTool = tools.find((entry) => entry?.name === "list_frames");
  assert.equal(listFramesTool?.inputSchema?.properties?.frame_path?.type, "string");
  const storageSearchTool = tools.find((entry) => entry?.name === "search_storage");
  assert.equal(storageSearchTool?.inputSchema?.properties?.storage_area?.enum?.includes("localStorage"), true);
  assert.equal(storageSearchTool?.inputSchema?.properties?.max_value_chars?.maximum, 20000);
  const evidenceBundleTool = tools.find((entry) => entry?.name === "export_evidence_bundle");
  assert.equal(evidenceBundleTool?.inputSchema?.properties?.script_hashes?.items?.type, "string");
  const evidenceTool = tools.find((entry) => entry?.name === "record_reverse_evidence");
  assert.equal(evidenceTool?.inputSchema?.properties?.evidence?.type, "object");
  return names;
}

export {
  assertRequiredTools,
  initializeJsReverseContractSession,
};
