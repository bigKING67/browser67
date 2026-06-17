import {
  NATIVE_OS_PROVIDER_ID,
  getNativeOsPhysicalInputProviderCapabilities,
  runNativeOsPhysicalInputAction,
} from "./providers/native-os.mjs";
import {
  LJQ_CTRL_PROVIDER_ID,
  getLjqCtrlPhysicalInputProviderCapabilities,
  runLjqCtrlPhysicalInputAction,
} from "./providers/ljq-ctrl.mjs";

const PHYSICAL_INPUT_PROVIDER_IDS = new Set(["auto", NATIVE_OS_PROVIDER_ID, LJQ_CTRL_PROVIDER_ID]);
const DEFAULT_PROVIDER_ORDER = [LJQ_CTRL_PROVIDER_ID, NATIVE_OS_PROVIDER_ID];

function normalizePhysicalInputProviderId(raw) {
  const value = String(raw ?? "auto").trim().toLowerCase();
  return PHYSICAL_INPUT_PROVIDER_IDS.has(value) ? value : "auto";
}

function cloneProvider(provider = {}) {
  return {
    ...provider,
    supported_actions: Array.isArray(provider.supported_actions) ? [...provider.supported_actions] : [],
    unsupported_actions: Array.isArray(provider.unsupported_actions) ? [...provider.unsupported_actions] : [],
    planned_actions: Array.isArray(provider.planned_actions) ? [...provider.planned_actions] : undefined,
    requirements: Array.isArray(provider.requirements) ? [...provider.requirements] : [],
    permission_notes: Array.isArray(provider.permission_notes) ? [...provider.permission_notes] : [],
    checks: provider.checks && typeof provider.checks === "object" ? structuredClone(provider.checks) : {},
  };
}

function providerSupportsAction(provider, action) {
  return Array.isArray(provider?.supported_actions) && provider.supported_actions.includes(action);
}

function selectionCandidates(providers = [], action = "") {
  return providers.map((provider) => ({
    provider_id: provider.provider_id,
    status: provider.status,
    execution_mode: provider.execution_mode,
    coordinate_system: provider.coordinate_system,
    supported: providerSupportsAction(provider, action),
    planned: Array.isArray(provider.planned_actions) && provider.planned_actions.includes(action),
    supports_window_region_capture: provider.supports_window_region_capture === true,
    requirements: Array.isArray(provider.requirements) ? [...provider.requirements] : [],
  }));
}

function selectProviderForAction(providers = [], action = "", preferredProvider = "auto") {
  const normalizedPreferred = normalizePhysicalInputProviderId(preferredProvider);
  const orderedIds = normalizedPreferred === "auto"
    ? DEFAULT_PROVIDER_ORDER
    : [normalizedPreferred, ...DEFAULT_PROVIDER_ORDER.filter((id) => id !== normalizedPreferred)];
  for (const providerId of orderedIds) {
    const provider = providers.find((entry) => entry.provider_id === providerId);
    if (providerSupportsAction(provider, action)) {
      return {
        selected_provider: cloneProvider(provider),
        reason: normalizedPreferred === providerId ? "preferred_provider_supported" : "first_supported_provider",
      };
    }
  }
  return {
    selected_provider: null,
    reason: normalizedPreferred === "auto" ? "no_provider_supports_action" : "preferred_provider_unavailable",
  };
}

async function detectPhysicalInputCapabilities(options = {}) {
  const preferredProvider = normalizePhysicalInputProviderId(options?.preferred_provider);
  const action = String(options?.action ?? "").trim().toLowerCase();
  const [ljqCtrl, nativeOs] = await Promise.all([
    getLjqCtrlPhysicalInputProviderCapabilities(options?.ljq_ctrl ?? {}),
    getNativeOsPhysicalInputProviderCapabilities(options?.native_os ?? {}),
  ]);
  const providers = [ljqCtrl, nativeOs].map(cloneProvider);
  const selected = action
    ? selectProviderForAction(providers, action, preferredProvider)
    : { selected_provider: null, reason: "action_not_requested" };
  const captureSelected = selectProviderForAction(providers, "capture_window_region", preferredProvider);
  return {
    preferred_provider: preferredProvider,
    action: action || undefined,
    provider_order: [...DEFAULT_PROVIDER_ORDER],
    providers,
    provider_selection: {
      preferred_provider: preferredProvider,
      action: action || undefined,
      selected_provider_id: selected.selected_provider?.provider_id,
      reason: selected.reason,
      candidates: selectionCandidates(providers, action),
    },
    capture_provider_selection: {
      preferred_provider: preferredProvider,
      action: "capture_window_region",
      selected_provider_id: captureSelected.selected_provider?.provider_id,
      reason: captureSelected.reason,
      candidates: selectionCandidates(providers, "capture_window_region"),
    },
    selected_provider: selected.selected_provider ?? undefined,
    selected_capture_provider: captureSelected.selected_provider ?? undefined,
    native_compat: cloneProvider(nativeOs),
  };
}

async function runPhysicalInputAction(action, args = {}, options = {}) {
  const capabilities = await detectPhysicalInputCapabilities({
    ...options,
    action,
  });
  const providerId = capabilities.selected_provider?.provider_id;
  if (providerId === NATIVE_OS_PROVIDER_ID) {
    const result = await runNativeOsPhysicalInputAction(action, args);
    return {
      provider_selection: capabilities.provider_selection,
      provider: capabilities.selected_provider,
      result,
    };
  }
  if (providerId === LJQ_CTRL_PROVIDER_ID) {
    const result = await runLjqCtrlPhysicalInputAction(action, args, options?.ljq_ctrl ?? {});
    return {
      provider_selection: capabilities.provider_selection,
      provider: capabilities.selected_provider,
      result,
    };
  }
  return {
    provider_selection: capabilities.provider_selection,
    provider: capabilities.selected_provider,
    result: {
      status: "blocked",
      action,
      reason: "physical_input_provider_unavailable",
    },
  };
}

export {
  LJQ_CTRL_PROVIDER_ID,
  NATIVE_OS_PROVIDER_ID,
  detectPhysicalInputCapabilities,
  normalizePhysicalInputProviderId,
  runPhysicalInputAction,
  selectProviderForAction,
};
