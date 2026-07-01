import {
  DEFAULT_MAX_SCREENSHOT_PIXELS,
  HARD_MAX_SCREENSHOT_PIXELS,
} from "../browser-screenshot/clip.mjs";

const SCREENSHOT_TOOL_SCHEMAS = {
  browser_screenshot_ops: {
    description: "Capture real-browser PNG screenshots through TMWD/CDP and write repo-external artifacts. selector captures pre-sample layout metrics and may fall back to the measured clip when the selector detaches between probes. Returns metadata and artifact path, never screenshot base64.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["capture"],
          default: "capture",
        },
        target: {
          type: "string",
          enum: ["viewport", "clip", "selector", "full_page"],
          default: "viewport",
        },
        format: {
          type: "string",
          enum: ["png"],
          default: "png",
        },
        tab_id: { type: "string" },
        switch_tab_id: { type: "string" },
        session_id: { type: "string" },
        session_url_pattern: { type: "string" },
        target_url_contains: { type: "string" },
        tmwd_mode: { type: "string", enum: ["auto", "tmwd", "remote_cdp", "cdp"], default: "tmwd" },
        tmwd_transport: { type: "string", enum: ["auto", "ws", "link"], default: "auto" },
        tmwd_ws_endpoint: { type: "string" },
        tmwd_link_endpoint: { type: "string" },
        cdp_endpoint: { type: "string" },
        workspace_key: { type: "string" },
        task_id: { type: "string" },
        run_id: { type: "string" },
        title: { type: "string" },
        prepare_run: { type: "boolean", default: true },
        include_page_metadata: { type: "boolean", default: true },
        include_layout_metrics: { type: "boolean", default: false },
        layout_selectors: {
          type: "object",
          description: "Optional map of stable names to CSS selectors. Returned as compact layout metrics for visual QA evidence.",
          additionalProperties: { type: "string" },
        },
        viewport: {
          type: "object",
          description: "Optional temporary viewport override for responsive screenshot capture. Cleared after capture by default.",
          properties: {
            width: { type: "number", minimum: 1 },
            height: { type: "number", minimum: 1 },
            dpr: { type: "number", minimum: 0.1, maximum: 8, default: 1 },
            device_scale_factor: { type: "number", minimum: 0.1, maximum: 8 },
            mobile: { type: "boolean", default: false },
            is_mobile: { type: "boolean", default: false },
            scale: { type: "number", minimum: 0.1, maximum: 4 },
            clear_after: { type: "boolean", default: true },
          },
        },
        selector: { type: "string" },
        clip: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
            scale: { type: "number", minimum: 0.01, maximum: 4, default: 1 },
          },
        },
        max_pixels: {
          type: "number",
          minimum: 1,
          maximum: HARD_MAX_SCREENSHOT_PIXELS,
          default: DEFAULT_MAX_SCREENSHOT_PIXELS,
        },
        timeout_ms: { type: "number", minimum: 100, maximum: 120_000 },
      },
    },
  },
  browser_evidence_bundle_ops: {
    description: "Build design-craft L4 screenshot evidence manifests from browser_screenshot_ops metadata. Optional writes require write=true and confirm_write=true.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["build_design_craft_l4_manifest"],
          default: "build_design_craft_l4_manifest",
        },
        case_id: {
          type: "string",
          description: "Stable design-craft before/after case id.",
        },
        entries: {
          type: "array",
          description: "Screenshot payloads captured by browser_screenshot_ops, annotated with phase and artifact key.",
          items: {
            type: "object",
            properties: {
              phase: { type: "string", enum: ["before", "after"] },
              key: { type: "string" },
              artifact_key: { type: "string" },
              target: { type: "string", enum: ["viewport", "clip", "selector", "full_page"] },
              tool: { type: "string" },
              viewport: { type: "object" },
              screenshot: { type: "object" },
              payload: { type: "object" },
              artifact: { type: "object" },
            },
          },
        },
        transport_health: {
          type: "object",
          description: "Optional browser_transport_health payload to preserve in evidence metadata.",
        },
        finalize_summary: {
          type: "object",
          description: "Optional browser_tab_lifecycle finalize_task payload to preserve in evidence metadata.",
        },
        run: {
          type: "object",
          description: "Optional browser_run_ops run summary to preserve in evidence metadata.",
        },
        require_shared_keys: {
          type: "boolean",
          default: true,
          description: "Require at least one shared artifact key across before and after phases.",
        },
        redact_url_query: {
          type: "boolean",
          default: true,
          description: "Strip query/hash from captured page URLs before writing the manifest.",
        },
        verify_artifacts: {
          type: "boolean",
          default: false,
          description: "Read local PNG artifacts and verify SHA-256 plus dimensions.",
        },
        write: {
          type: "boolean",
          default: false,
          description: "Write the manifest to output_path. Requires confirm_write=true.",
        },
        confirm_write: {
          type: "boolean",
          default: false,
        },
        output_path: {
          type: "string",
          description: "Optional path ending in screenshots.json when write=true.",
        },
      },
    },
  },
};

export {
  SCREENSHOT_TOOL_SCHEMAS,
};
