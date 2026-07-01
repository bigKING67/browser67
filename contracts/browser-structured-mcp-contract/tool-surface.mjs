import assert from "node:assert/strict";
import { assertOpenAiToolSchemaCompatibility } from "./schema-compat.mjs";

async function assertToolSurface({ rpc, timeoutMs }) {
  const toolsList = await rpc.call("tools/list", {}, timeoutMs);
  const tools = Array.isArray(toolsList?.result?.tools) ? toolsList.result.tools : [];
  assertOpenAiToolSchemaCompatibility(tools, "browser67-tmwd-browser");
  const names = tools
    .map((entry) => (typeof entry?.name === "string" ? entry.name : ""))
    .filter((name) => name.length > 0);
  assert.equal(names.includes("browser_scan"), true);
  assert.equal(names.includes("browser_execute_js"), true);
  assert.equal(names.includes("browser_extract"), true);
  assert.equal(names.includes("browser_wait"), true);
  assert.equal(names.includes("browser_transport_health"), true);
  assert.equal(names.includes("browser_run_ops"), true);
  assert.equal(names.includes("browser_job_ops"), true);
  assert.equal(names.includes("browser_screenshot_ops"), true);
  assert.equal(names.includes("browser_evidence_bundle_ops"), true);
  assert.equal(names.includes("browser_tab_ops"), true);
  assert.equal(names.includes("browser_native_input"), true);
  assert.equal(names.includes("browser_file_ops"), true);
  assert.equal(names.includes("browser_download_ops"), true);
  assert.equal(names.includes("browser_tab_lifecycle"), true);
  assert.equal(names.includes("browser_auth_ops"), true);
  assert.equal(names.includes("browser_clipboard_ops"), true);

  const executeJsTool = tools.find((entry) => entry?.name === "browser_execute_js");
  assert.equal(executeJsTool?.inputSchema?.properties?.output_mode?.enum?.includes("compact"), true);
  assert.equal(executeJsTool?.inputSchema?.properties?.max_return_chars?.maximum, 300_000);

  const waitTool = tools.find((entry) => entry?.name === "browser_wait");
  assert.equal(waitTool?.inputSchema?.properties?.type?.enum?.includes("selector"), true);
  assert.equal(waitTool?.inputSchema?.properties?.type?.enum?.includes("dom_stable"), true);
  assert.equal(waitTool?.inputSchema?.properties?.timeout_ms?.maximum, 120_000);

  const runOpsTool = tools.find((entry) => entry?.name === "browser_run_ops");
  assert.equal(runOpsTool?.inputSchema?.properties?.action?.enum?.includes("prepare"), true);
  assert.equal(runOpsTool?.inputSchema?.properties?.action?.enum?.includes("record_event"), true);
  assert.equal(runOpsTool?.inputSchema?.properties?.evidence?.type, "object");

  const transportHealthTool = tools.find((entry) => entry?.name === "browser_transport_health");
  assert.equal(transportHealthTool?.inputSchema?.properties?.tmwd_transport?.enum?.includes("ws"), true);

  const jobOpsTool = tools.find((entry) => entry?.name === "browser_job_ops");
  assert.equal(jobOpsTool?.inputSchema?.properties?.action?.enum?.includes("start"), true);
  assert.equal(jobOpsTool?.inputSchema?.properties?.action?.enum?.includes("result"), true);
  assert.equal(jobOpsTool?.inputSchema?.properties?.action?.enum?.includes("cancel"), true);
  assert.equal(jobOpsTool?.inputSchema?.properties?.output_mode?.default, "compact");

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

  const screenshotTool = tools.find((entry) => entry?.name === "browser_screenshot_ops");
  assert.equal(screenshotTool?.inputSchema?.properties?.action?.enum?.includes("capture"), true);
  assert.equal(screenshotTool?.inputSchema?.properties?.target?.enum?.includes("viewport"), true);
  assert.equal(screenshotTool?.inputSchema?.properties?.target?.enum?.includes("clip"), true);
  assert.equal(screenshotTool?.inputSchema?.properties?.target?.enum?.includes("selector"), true);
  assert.equal(screenshotTool?.inputSchema?.properties?.target?.enum?.includes("full_page"), true);
  assert.deepEqual(screenshotTool?.inputSchema?.properties?.format?.enum, ["png"]);
  assert.equal(screenshotTool?.inputSchema?.properties?.clip?.type, "object");
  assert.equal(screenshotTool?.inputSchema?.properties?.viewport?.type, "object");
  assert.equal(screenshotTool?.inputSchema?.properties?.layout_selectors?.type, "object");
  assert.equal(screenshotTool?.inputSchema?.properties?.include_layout_metrics?.type, "boolean");
  assert.equal(screenshotTool?.inputSchema?.properties?.max_pixels?.maximum, 50_000_000);
  assert.equal(screenshotTool?.inputSchema?.properties?.prepare_run?.default, true);
  assert.equal(screenshotTool?.description?.includes("never screenshot base64"), true);

  const evidenceBundleTool = tools.find((entry) => entry?.name === "browser_evidence_bundle_ops");
  assert.equal(
    evidenceBundleTool?.inputSchema?.properties?.action?.enum?.includes("build_design_craft_l4_manifest"),
    true,
  );
  assert.equal(evidenceBundleTool?.inputSchema?.properties?.case_id?.type, "string");
  assert.equal(evidenceBundleTool?.inputSchema?.properties?.entries?.type, "array");
  assert.deepEqual(evidenceBundleTool?.inputSchema?.properties?.entries?.items?.properties?.phase?.enum, ["before", "after"]);
  assert.equal(evidenceBundleTool?.inputSchema?.properties?.write?.default, false);
  assert.equal(evidenceBundleTool?.inputSchema?.properties?.confirm_write?.default, false);
  assert.equal(evidenceBundleTool?.description?.includes("design-craft L4"), true);

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
  assert.deepEqual(
    authTool?.inputSchema?.properties?.captcha_solver_mode?.enum,
    ["auto", "coordinate_only", "protocol_allowed", "manual_only"],
  );
  assert.deepEqual(
    authTool?.inputSchema?.properties?.captcha_locator_provider?.enum,
    ["auto", "local", "vision", "jfbym"],
  );
  assert.equal(authTool?.inputSchema?.properties?.captcha_provider_config_dir?.type, "string");
  assert.equal(authTool?.inputSchema?.properties?.confirm_protocol_solver?.type, "boolean");
  assert.equal(authTool?.inputSchema?.properties?.use_provider_coordinates?.type, "boolean");
  assert.equal(authTool?.inputSchema?.properties?.confirm_provider_coordinates?.type, "boolean");
  assert.equal(authTool?.inputSchema?.properties?.physical_input_provider?.enum?.includes("ljq-ctrl"), true);
  assert.equal(authTool?.inputSchema?.properties?.confirm_physical_input?.type, "boolean");
  assert.equal(authTool?.inputSchema?.properties?.auto_screen_coordinates?.type, "boolean");
  assert.equal(authTool?.inputSchema?.properties?.confirm_auto_coordinates?.type, "boolean");
  assert.equal(authTool?.inputSchema?.properties?.run_vision_correction?.type, "boolean");
  assert.equal(authTool?.inputSchema?.properties?.use_vision_corrected_coordinates?.type, "boolean");
  assert.equal(authTool?.inputSchema?.properties?.confirm_corrected_coordinates?.type, "boolean");
  assert.equal(authTool?.inputSchema?.properties?.screen_to_x?.type, "number");
  assert.equal(authTool?.inputSchema?.properties?.drag_steps?.maximum, 240);
  assert.equal(authTool?.inputSchema?.properties?.pre_input_settle_ms?.maximum, 5_000);
  assert.equal(authTool?.inputSchema?.properties?.wait_after_ms?.minimum, 5_000);
  assert.equal(authTool?.inputSchema?.properties?.tmwd_mode?.default, "tmwd");

  return { tools, names };
}

export { assertToolSurface };
