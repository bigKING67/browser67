import { AUTH_TOOL_SCHEMAS } from "./auth.mjs";
import { BROWSER_CORE_TOOL_SCHEMAS } from "./browser-core.mjs";
import { IO_TOOL_SCHEMAS } from "./io-ops.mjs";
import { NATIVE_INPUT_TOOL_SCHEMAS } from "./native-input.mjs";
import { SCREENSHOT_TOOL_SCHEMAS } from "./screenshot-ops.mjs";
import { TAB_LIFECYCLE_TOOL_SCHEMAS } from "./tab-lifecycle.mjs";

const TOOL_SCHEMAS = {
  ...BROWSER_CORE_TOOL_SCHEMAS,
  ...SCREENSHOT_TOOL_SCHEMAS,
  ...NATIVE_INPUT_TOOL_SCHEMAS,
  ...IO_TOOL_SCHEMAS,
  ...TAB_LIFECYCLE_TOOL_SCHEMAS,
  ...AUTH_TOOL_SCHEMAS,
};

for (const schema of Object.values(TOOL_SCHEMAS)) {
  const inputSchema = schema.inputSchema ?? {};
  inputSchema.properties = {
    ...(inputSchema.properties ?? {}),
    output_mode: inputSchema.properties?.output_mode ?? {
      type: "string",
      enum: ["full", "compact"],
      description: "Controls diagnostic verbosity only; tool-specific content limits remain authoritative.",
    },
  };
}

export { TOOL_SCHEMAS };
