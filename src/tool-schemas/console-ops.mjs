const CONSOLE_TOOL_SCHEMAS = {
  browser_console_ops: {
    description: "Observe console API calls, uncaught runtime exceptions, and optional Log-domain entries on one browser67-managed TMWD tab. Observation is non-persistent and hard-bounded by duration, entry count, and serialized console-entry characters; listener removal and debugger-lease release must both be verified before success.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["observe"],
        },
        duration_ms: {
          type: "number",
          minimum: 50,
          maximum: 30_000,
          default: 1_000,
        },
        max_entries: {
          type: "number",
          minimum: 1,
          maximum: 500,
          default: 100,
        },
        max_total_chars: {
          type: "number",
          minimum: 1_000,
          maximum: 300_000,
          default: 100_000,
        },
        include_log_entries: { type: "boolean", default: true },
        include_stack_trace: { type: "boolean", default: false },
        workspace_key: { type: "string" },
        task_id: { type: "string" },
        tab_id: { type: "string" },
        switch_tab_id: { type: "string" },
        session_id: { type: "string" },
        session_url_pattern: { type: "string" },
        tmwd_mode: { type: "string", enum: ["auto", "tmwd"], default: "tmwd" },
        tmwd_transport: { type: "string", enum: ["auto", "ws", "link"], default: "auto" },
        tmwd_ws_endpoint: { type: "string" },
        tmwd_link_endpoint: { type: "string" },
        timeout_ms: { type: "number", minimum: 100, maximum: 120_000 },
      },
      required: ["action"],
    },
  },
};

export { CONSOLE_TOOL_SCHEMAS };
