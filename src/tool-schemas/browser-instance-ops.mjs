const BROWSER_INSTANCE_TOOL_SCHEMAS = {
  browser_instance_ops: {
    description: "List active Browser Profile instances or set/clear the explicit default Browser Instance.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "set_default", "clear_default"],
          default: "list",
        },
        browser_instance_id: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9._-]+$",
        },
        tmwd_link_endpoint: { type: "string" },
        timeout_ms: { type: "number", minimum: 500, maximum: 120000 },
      },
      required: ["action"],
    },
  },
};

export { BROWSER_INSTANCE_TOOL_SCHEMAS };
