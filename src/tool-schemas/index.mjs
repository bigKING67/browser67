import { AUTH_TOOL_SCHEMAS } from "./auth.mjs";
import { BROWSER_CORE_TOOL_SCHEMAS } from "./browser-core.mjs";
import { IO_TOOL_SCHEMAS } from "./io-ops.mjs";
import { NATIVE_INPUT_TOOL_SCHEMAS } from "./native-input.mjs";
import { TAB_LIFECYCLE_TOOL_SCHEMAS } from "./tab-lifecycle.mjs";

const TOOL_SCHEMAS = {
  ...BROWSER_CORE_TOOL_SCHEMAS,
  ...NATIVE_INPUT_TOOL_SCHEMAS,
  ...IO_TOOL_SCHEMAS,
  ...TAB_LIFECYCLE_TOOL_SCHEMAS,
  ...AUTH_TOOL_SCHEMAS,
};

export { TOOL_SCHEMAS };
