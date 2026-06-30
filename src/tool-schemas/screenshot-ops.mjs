import {
  DEFAULT_MAX_SCREENSHOT_PIXELS,
  HARD_MAX_SCREENSHOT_PIXELS,
} from "../browser-screenshot/clip.mjs";

const SCREENSHOT_TOOL_SCHEMAS = {
  browser_screenshot_ops: {
    description: "Capture real-browser PNG screenshots through TMWD/CDP and write repo-external artifacts. Returns metadata and artifact path, never screenshot base64.",
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
};

export {
  SCREENSHOT_TOOL_SCHEMAS,
};
