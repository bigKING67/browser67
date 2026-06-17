import assert from "node:assert/strict";
import { assertOpenAiToolSchemaCompatibility } from "./schema-compat.mjs";

async function assertToolSurface({ rpc, timeoutMs }) {
  const toolsList = await rpc.call("tools/list", {}, timeoutMs);
  const tools = Array.isArray(toolsList?.result?.tools) ? toolsList.result.tools : [];
  assertOpenAiToolSchemaCompatibility(tools, "browser-structured-mcp");
  const names = tools
    .map((entry) => (typeof entry?.name === "string" ? entry.name : ""))
    .filter((name) => name.length > 0);
  assert.equal(names.includes("browser_scan"), true);
  assert.equal(names.includes("browser_execute_js"), true);
  assert.equal(names.includes("browser_extract"), true);
  assert.equal(names.includes("browser_tab_ops"), true);
  assert.equal(names.includes("browser_native_input"), true);
  assert.equal(names.includes("browser_file_ops"), true);
  assert.equal(names.includes("browser_download_ops"), true);
  assert.equal(names.includes("browser_tab_lifecycle"), true);
  assert.equal(names.includes("browser_auth_ops"), true);
  assert.equal(names.includes("browser_clipboard_ops"), true);

  const executeJsTool = tools.find((entry) => entry?.name === "browser_execute_js");
  assert.equal(
    executeJsTool?.inputSchema?.properties?.native_auto_fallback?.type,
    "boolean",
  );
  assert.equal(
    executeJsTool?.inputSchema?.properties?.native_auto_fallback_policy?.type,
    "string",
  );
  assert.deepEqual(
    executeJsTool?.inputSchema?.properties?.native_auto_fallback_policy?.enum,
    ["strict", "balanced", "aggressive"],
  );
  assert.equal(
    executeJsTool?.inputSchema?.properties?.native_auto_fallback_policy?.default,
    "balanced",
  );
  assert.equal(
    executeJsTool?.inputSchema?.properties?.native_auto_execute?.type,
    "boolean",
  );
  assert.equal(
    executeJsTool?.inputSchema?.properties?.native_execute_action_scope?.type,
    "string",
  );
  assert.equal(
    executeJsTool?.inputSchema?.properties?.native_fallback_action?.type,
    "string",
  );
  assert.equal(
    executeJsTool?.inputSchema?.properties?.native_fallback_args?.type,
    "object",
  );

  const tabLifecycleTool = tools.find((entry) => entry?.name === "browser_tab_lifecycle");
  assert.equal(
    tabLifecycleTool?.inputSchema?.properties?.action?.enum?.includes("select_or_create"),
    true,
  );
  assert.equal(
    tabLifecycleTool?.inputSchema?.properties?.action?.enum?.includes("prune_stale"),
    true,
  );
  assert.equal(
    tabLifecycleTool?.inputSchema?.properties?.action?.enum?.includes("finalize_task"),
    true,
  );
  assert.equal(
    tabLifecycleTool?.inputSchema?.properties?.ownership_policy?.default,
    "tmwd_only",
  );
  assert.equal(
    tabLifecycleTool?.inputSchema?.properties?.reuse_scope?.default,
    "origin_path",
  );
  assert.equal(
    tabLifecycleTool?.inputSchema?.properties?.scope?.enum?.includes("all"),
    true,
  );
  assert.equal(tabLifecycleTool?.inputSchema?.properties?.all?.type, "boolean");
  assert.equal(tabLifecycleTool?.inputSchema?.properties?.confirm_all?.type, "boolean");
  assert.equal(
    tabLifecycleTool?.inputSchema?.properties?.wait_until?.default,
    "listed",
  );
  assert.equal(
    tabLifecycleTool?.inputSchema?.properties?.wait_until?.enum?.includes("none"),
    true,
  );
  assert.equal(tabLifecycleTool?.inputSchema?.properties?.prune_stale?.type, "boolean");
  assert.equal(tabLifecycleTool?.inputSchema?.properties?.summary_only?.type, "boolean");
  assert.equal(tabLifecycleTool?.inputSchema?.properties?.max_items?.maximum, 500);
  assert.equal(tabLifecycleTool?.inputSchema?.properties?.max_stale_items?.maximum, 500);

  const authTool = tools.find((entry) => entry?.name === "browser_auth_ops");
  assert.equal(authTool?.inputSchema?.properties?.action?.enum?.includes("ensure_login"), true);
  assert.equal(authTool?.inputSchema?.properties?.action?.enum?.includes("list_profiles"), true);
  assert.equal(authTool?.inputSchema?.properties?.action?.enum?.includes("suggest_profile"), true);
  assert.equal(authTool?.inputSchema?.properties?.action?.enum?.includes("upsert_profile"), true);
  assert.equal(authTool?.inputSchema?.properties?.action?.enum?.includes("plan_captcha_assist"), true);
  assert.equal(authTool?.inputSchema?.properties?.action?.enum?.includes("assist_captcha"), true);
  assert.equal(authTool?.inputSchema?.properties?.assist_target?.enum?.includes("slider"), true);
  assert.equal(authTool?.inputSchema?.properties?.physical_input_provider?.enum?.includes("ljq-ctrl"), true);
  assert.equal(authTool?.inputSchema?.properties?.confirm_physical_input?.type, "boolean");
  assert.equal(authTool?.inputSchema?.properties?.auto_screen_coordinates?.type, "boolean");
  assert.equal(authTool?.inputSchema?.properties?.confirm_auto_coordinates?.type, "boolean");
  assert.equal(authTool?.inputSchema?.properties?.run_vision_correction?.type, "boolean");
  assert.equal(authTool?.inputSchema?.properties?.use_vision_corrected_coordinates?.type, "boolean");
  assert.equal(authTool?.inputSchema?.properties?.confirm_corrected_coordinates?.type, "boolean");
  assert.equal(authTool?.inputSchema?.properties?.screen_to_x?.type, "number");
  assert.equal(authTool?.inputSchema?.properties?.drag_steps?.maximum, 240);
  assert.equal(authTool?.inputSchema?.properties?.wait_after_ms?.minimum, 5_000);
  assert.equal(authTool?.inputSchema?.properties?.tmwd_mode?.default, "tmwd");

  return { tools, names };
}

export { assertToolSurface };
