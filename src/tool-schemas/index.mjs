import { AUTH_TOOL_SCHEMAS } from "./auth.mjs";
import { BROWSER_CORE_TOOL_SCHEMAS } from "./browser-core.mjs";
import { BROWSER_INSTANCE_TOOL_SCHEMAS } from "./browser-instance-ops.mjs";
import { IO_TOOL_SCHEMAS } from "./io-ops.mjs";
import { NATIVE_INPUT_TOOL_SCHEMAS } from "./native-input.mjs";
import { SCREENSHOT_TOOL_SCHEMAS } from "./screenshot-ops.mjs";
import { TAB_LIFECYCLE_TOOL_SCHEMAS } from "./tab-lifecycle.mjs";

const TOOL_SCHEMAS = {
  ...BROWSER_CORE_TOOL_SCHEMAS,
  ...BROWSER_INSTANCE_TOOL_SCHEMAS,
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
    browser_instance_id: inputSchema.properties?.browser_instance_id ?? {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._-]+$",
      description: "Opaque Browser Profile instance id. Required when multiple instances are active and no default is set.",
    },
  };
}

export { TOOL_SCHEMAS };
