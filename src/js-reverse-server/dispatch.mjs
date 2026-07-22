import {
  handleAnalyzeTarget,
  handleCollectCode,
  handleCollectionDiff,
  handleDeobfuscateCode,
  handleDetectCrypto,
  handleDetectMicrofrontends,
  handleDiffEnvRequirements,
  handleInjectStealth,
  handleRiskPanel,
  handleSetUserAgent,
  handleSummarizeCode,
  handleUnderstandCode,
} from "./analysis.mjs";
import {
  handleExportEvidenceBundle,
  handleExportRebuildBundle,
  handleExportSessionReport,
  handleGetLocalStorage,
  handleGetSessionStorage,
  handleGetStorage,
  handleRecordReverseEvidence,
  handleRestoreSessionState,
  handleSaveSessionState,
  handleSearchStorage,
  handleWatchStorageChanges,
} from "./artifacts.mjs";
import { handleListFrames } from "./frames.mjs";
import {
  handleBreakOnXhr,
  handleCreateHook,
  handleGetHookData,
  handleHookFunction,
  handleInjectHook,
  handleInjectPreloadScript,
  handleListHooks,
  handleMonitorEvents,
  handleRemoveHook,
  handleStopMonitor,
  handleUnhookFunction,
  unsupportedDebugger,
} from "./hooks.mjs";
import {
  handleCheckBrowserHealth,
  handleFinalizeTask,
  handleListPages,
  handleNavigatePage,
  handleNewPage,
  handleSelectPage,
} from "./lifecycle.mjs";
import {
  handleGetDomStructure,
  handleGetNetworkRequest,
  handleGetRequestInitiator,
  handleGetWebSocketMessages,
  handleListNetworkRequests,
  handleWebSockets,
} from "./network.mjs";
import {
  handleFindInScript,
  handleGetScriptSource,
  handleListScripts,
  handleSearchInScripts,
} from "./scripts.mjs";

const JS_REVERSE_HANDLERS = {
  check_browser_health: handleCheckBrowserHealth,
  list_pages: handleListPages,
  select_page: handleSelectPage,
  new_page: handleNewPage,
  finalize_task: handleFinalizeTask,
  navigate_page: handleNavigatePage,
  list_scripts: handleListScripts,
  get_script_source: handleGetScriptSource,
  search_in_scripts: handleSearchInScripts,
  find_in_script: handleFindInScript,
  list_network_requests: handleListNetworkRequests,
  get_network_request: handleGetNetworkRequest,
  get_request_initiator: handleGetRequestInitiator,
  list_websocket_connections: handleWebSockets,
  get_websocket_messages: handleGetWebSocketMessages,
  get_dom_structure: handleGetDomStructure,
  list_frames: handleListFrames,
  detect_microfrontends: handleDetectMicrofrontends,
  create_hook: handleCreateHook,
  inject_hook: handleInjectHook,
  get_hook_data: handleGetHookData,
  remove_hook: handleRemoveHook,
  list_hooks: handleListHooks,
  hook_function: handleHookFunction,
  unhook_function: handleUnhookFunction,
  monitor_events: handleMonitorEvents,
  stop_monitor: handleStopMonitor,
  trace_function: handleHookFunction,
  inject_preload_script: handleInjectPreloadScript,
  break_on_xhr: handleBreakOnXhr,
  analyze_target: handleAnalyzeTarget,
  understand_code: handleUnderstandCode,
  deobfuscate_code: handleDeobfuscateCode,
  detect_crypto: handleDetectCrypto,
  summarize_code: handleSummarizeCode,
  risk_panel: handleRiskPanel,
  record_reverse_evidence: handleRecordReverseEvidence,
  export_session_report: handleExportSessionReport,
  export_evidence_bundle: handleExportEvidenceBundle,
  export_rebuild_bundle: handleExportRebuildBundle,
  diff_env_requirements: handleDiffEnvRequirements,
  collect_code: handleCollectCode,
  collection_diff: handleCollectionDiff,
  inject_stealth: handleInjectStealth,
  set_user_agent: handleSetUserAgent,
  save_session_state: handleSaveSessionState,
  restore_session_state: handleRestoreSessionState,
  get_storage: handleGetStorage,
  get_local_storage: handleGetLocalStorage,
  get_session_storage: handleGetSessionStorage,
  search_storage: handleSearchStorage,
  watch_storage_changes: handleWatchStorageChanges,
};

for (const name of [
  "set_breakpoint",
  "set_breakpoint_on_text",
  "resume",
  "pause",
  "step_over",
  "step_into",
  "step_out",
  "evaluate_on_callframe",
]) {
  JS_REVERSE_HANDLERS[name] = () => unsupportedDebugger(name);
}

async function handleJsReverseTool(name, args = {}) {
  const handler = JS_REVERSE_HANDLERS[name];
  if (typeof handler !== "function") throw new Error(`unknown tool: ${String(name)}`);
  return handler(args);
}

export {
  JS_REVERSE_HANDLERS,
  handleJsReverseTool,
};
