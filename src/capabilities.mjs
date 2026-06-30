const CAPABILITIES = {
  schema_revision: 2,
  server_revision: "managed-tabs-v4",
  supports_select_or_create: true,
  supports_tabs_close: true,
  supports_tabs_get: true,
  supports_include_unscriptable_tabs: true,
  supports_wait_until_visible: true,
  supports_prune_stale: true,
  supports_finalize_task: true,
  supports_finalize_hint: true,
  supports_close_verification: true,
  supports_screenshot_viewport_override: true,
  supports_screenshot_layout_metrics: true,
  supports_design_craft_l4_evidence_manifest: true,
  managed_registry_default_path: "~/.tmwd-browser-mcp/tab-workspace/managed-tabs.json",
};

export {
  CAPABILITIES,
};
