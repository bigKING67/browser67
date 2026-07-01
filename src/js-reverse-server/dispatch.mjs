import { makeResult } from "../mcp-result.mjs";
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
import { handleListFrames } from "./frames.mjs";
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

async function dispatchToolCall(name, args = {}) {
  if (name === "check_browser_health") return makeResult(await handleCheckBrowserHealth(args));
  if (name === "list_pages") return makeResult(await handleListPages(args));
  if (name === "select_page") return makeResult(await handleSelectPage(args));
  if (name === "new_page") return makeResult(await handleNewPage(args));
  if (name === "finalize_task") return makeResult(await handleFinalizeTask(args));
  if (name === "navigate_page") return makeResult(await handleNavigatePage(args));
  if (name === "list_scripts") return makeResult(await handleListScripts(args));
  if (name === "get_script_source") return makeResult(await handleGetScriptSource(args));
  if (name === "search_in_scripts") return makeResult(await handleSearchInScripts(args));
  if (name === "find_in_script") return makeResult(await handleFindInScript(args));
  if (name === "list_network_requests") return makeResult(await handleListNetworkRequests(args));
  if (name === "get_network_request") return makeResult(await handleGetNetworkRequest(args));
  if (name === "get_request_initiator") return makeResult(await handleGetRequestInitiator(args));
  if (name === "list_websocket_connections") return makeResult(await handleWebSockets(args));
  if (name === "get_websocket_messages") return makeResult(await handleGetWebSocketMessages(args));
  if (name === "get_dom_structure") return makeResult(await handleGetDomStructure(args));
  if (name === "list_frames") return makeResult(await handleListFrames(args));
  if (name === "detect_microfrontends") return makeResult(await handleDetectMicrofrontends(args));
  if (name === "create_hook") return makeResult(await handleCreateHook(args));
  if (name === "inject_hook") return makeResult(await handleInjectHook(args));
  if (name === "get_hook_data") return makeResult(await handleGetHookData(args));
  if (name === "remove_hook") return makeResult(await handleRemoveHook(args));
  if (name === "list_hooks") return makeResult(handleListHooks(args));
  if (name === "hook_function") return makeResult(await handleHookFunction(args));
  if (name === "unhook_function") return makeResult(await handleUnhookFunction(args));
  if (name === "monitor_events") return makeResult(await handleMonitorEvents(args));
  if (name === "stop_monitor") return makeResult(await handleStopMonitor(args));
  if (name === "trace_function") return makeResult(await handleHookFunction(args));
  if (name === "inject_preload_script") return makeResult(await handleInjectPreloadScript(args));
  if (["set_breakpoint", "set_breakpoint_on_text", "resume", "pause", "step_over", "step_into", "step_out", "evaluate_on_callframe"].includes(name)) return makeResult(unsupportedDebugger(name));
  if (name === "break_on_xhr") return makeResult(await handleBreakOnXhr(args));
  if (name === "analyze_target") return makeResult(await handleAnalyzeTarget(args));
  if (name === "understand_code") return makeResult(handleUnderstandCode(args));
  if (name === "deobfuscate_code") return makeResult(handleDeobfuscateCode(args));
  if (name === "detect_crypto") return makeResult(handleDetectCrypto(args));
  if (name === "summarize_code") return makeResult(handleSummarizeCode(args));
  if (name === "risk_panel") return makeResult(handleRiskPanel(args));
  if (name === "record_reverse_evidence") return makeResult(await handleRecordReverseEvidence(args));
  if (name === "export_session_report") return makeResult(await handleExportSessionReport(args));
  if (name === "export_evidence_bundle") return makeResult(await handleExportEvidenceBundle(args));
  if (name === "export_rebuild_bundle") return makeResult(await handleExportRebuildBundle(args));
  if (name === "diff_env_requirements") return makeResult(handleDiffEnvRequirements(args));
  if (name === "collect_code") return makeResult(await handleCollectCode(args));
  if (name === "collection_diff") return makeResult(handleCollectionDiff(args));
  if (name === "inject_stealth") return makeResult(await handleInjectStealth(args));
  if (name === "set_user_agent") return makeResult(await handleSetUserAgent(args));
  if (name === "save_session_state") return makeResult(await handleSaveSessionState(args));
  if (name === "restore_session_state") return makeResult(await handleRestoreSessionState(args));
  if (name === "get_storage") return makeResult(await handleGetStorage(args));
  if (name === "get_local_storage") return makeResult(await handleGetLocalStorage(args));
  if (name === "get_session_storage") return makeResult(await handleGetSessionStorage(args));
  if (name === "search_storage") return makeResult(await handleSearchStorage(args));
  if (name === "watch_storage_changes") return makeResult(await handleWatchStorageChanges(args));
  return {
    isError: true,
    content: [{ type: "text", text: `unknown tool: ${String(name)}` }],
  };
}

export {
  dispatchToolCall,
};
