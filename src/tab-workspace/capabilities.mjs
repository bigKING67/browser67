const CAPABILITIES = Object.freeze({
  schema_revision: 3,
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
  supports_durable_jobs: true,
  supports_job_restart_recovery: true,
  supports_job_abort: false,
  supports_persistent_debugger: false,
  supports_protocol_solver_apply: false,
  managed_registry_default_path: "~/.browser67/tab-workspace/managed-tabs.json",
  legacy_managed_registry_path: "~/.tmwd-browser-mcp/tab-workspace/managed-tabs.json",
});

export {
  CAPABILITIES,
};
