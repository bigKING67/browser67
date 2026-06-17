const NATIVE_INPUT_DEFAULT_TIMEOUT_MS = 8_000;
const NATIVE_INPUT_MAX_TIMEOUT_MS = 30_000;

const NATIVE_INPUT_ACTIONS = [
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
];

const NATIVE_INPUT_ACTIONS_WITH_CAPABILITIES = [
  ...NATIVE_INPUT_ACTIONS,
  "capabilities",
];

function allNativeInputActions() {
  return [...NATIVE_INPUT_ACTIONS];
}

export {
  NATIVE_INPUT_ACTIONS_WITH_CAPABILITIES,
  NATIVE_INPUT_DEFAULT_TIMEOUT_MS,
  NATIVE_INPUT_MAX_TIMEOUT_MS,
  allNativeInputActions,
};
