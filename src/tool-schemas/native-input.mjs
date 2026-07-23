import { NATIVE_INPUT_MAX_TIMEOUT_MS } from "../native/input.mjs";

const NATIVE_INPUT_TOOL_SCHEMAS = {
  browser_native_input: {
    description: "Cross-platform native input fallback (Windows/macOS/Linux) for blocked browser cases.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "activate_window",
            "move",
            "drag",
            "click",
            "double_click",
            "press",
            "type",
            "paste",
            "scroll",
            "get_window_rect",
            "capabilities",
          ],
        },
        x: { type: "number" },
        y: { type: "number" },
        from_x: { type: "number" },
        from_y: { type: "number" },
        to_x: { type: "number" },
        to_y: { type: "number" },
        button: { type: "string", enum: ["left", "middle", "right"], default: "left" },
        key: { type: "string" },
        text: { type: "string" },
        delay_ms: { type: "number", minimum: 0, maximum: 10_000 },
        duration_ms: { type: "number", minimum: 0, maximum: 10_000 },
        steps: { type: "number", minimum: 1, maximum: 240 },
        delta_x: { type: "number" },
        delta_y: { type: "number" },
        window_title: { type: "string" },
        window_pid: { type: "number" },
        window_tab_id: {
          type: "integer",
          minimum: 1,
          description: "Optional exact Chrome/Edge tab id. On macOS this is preferred over URL matching for managed-tab activation and window-scoped physical input.",
        },
        window_url: {
          type: "string",
          description: "Optional Chromium tab URL selector. On macOS this activates or locates the exact Chrome/Edge tab before window-scoped physical input; query and hash are ignored for matching.",
        },
        window_application: {
          type: "string",
          enum: ["Google Chrome", "Microsoft Edge"],
          description: "Optional preferred Chromium application when window_tab_id or window_url is used on macOS.",
        },
        dry_run: { type: "boolean", default: false },
        timeout_ms: { type: "number", minimum: 500, maximum: NATIVE_INPUT_MAX_TIMEOUT_MS },
      },
      required: ["action"],
    },
  },
};

export { NATIVE_INPUT_TOOL_SCHEMAS };
