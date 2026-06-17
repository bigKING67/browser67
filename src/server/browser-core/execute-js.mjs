import {
  mergeTransportAttempts,
  normalizeEndpoint,
  normalizeTmwdTransportLabel,
  parseBridgeCommand,
  resolveExecuteJsScriptInput,
} from "../../common.mjs";
import {
  cdpEvaluateScript,
  fetchCdpTargets,
} from "../../cdp-runtime.mjs";
import { runBridgeCommand } from "../../bridge-commands.mjs";
import {
  classifyBrowserErrorCode,
  createToolError,
  isRetryableBrowserErrorCode,
} from "../../errors.mjs";
import {
  buildNativeInputSuggestion,
  maybeRunNativeFallbackForExecuteJs,
  resolveNativeAutoFallbackPolicy,
  resolveSuggestedNativeInputCapabilities,
} from "../../native-fallback.mjs";
import {
  getActiveTargetId,
  listSessionsSnapshot,
  markSessionSelected,
  normalizeIdToken,
  sessionPointers,
  syncSessionRegistry,
} from "../../session-registry.mjs";
import {
  executeTmwdJsWithFallback,
  resolvePreferredBrowserContext,
  resolveTmwdContext,
} from "../../tmwd-runtime.mjs";

async function getTransientTexts(args) {
  try {
    const evalResult = await cdpEvaluateScript(args, `
      const nodes = Array.from(document.querySelectorAll('[role="alert"], [role="status"], [aria-live], .toast, .notification'))
        .map((n) => (n.innerText || '').trim())
        .filter(Boolean)
        .slice(0, 12);
      return nodes;
    `);
    const rows = Array.isArray(evalResult.result.value) ? evalResult.result.value : [];
    return rows.filter((item) => typeof item === "string");
  } catch {
    return [];
  }
}

async function handleBrowserExecuteJs(args) {
  const scriptInput = resolveExecuteJsScriptInput(args ?? {});
  if (scriptInput.missing === true) {
    throw createToolError(
      "INVALID_ARGUMENT",
      "browser_execute_js requires either script or code",
      { details: { accepted_fields: ["script", "code"] } },
    );
  }
  let preferred = null;
  try {
    preferred = await resolvePreferredBrowserContext(args ?? {});
  } catch (contextError) {
    if (args?.native_auto_fallback !== true) {
      throw contextError;
    }
    const errorMessage = String(contextError?.message ?? contextError);
    const errorCode = classifyBrowserErrorCode(errorMessage);
    const nativeAutoFallbackPolicy = resolveNativeAutoFallbackPolicy(args ?? {});
    const nativeInputSuggestion = buildNativeInputSuggestion(errorCode, errorMessage, nativeAutoFallbackPolicy);
    const nativeAutoFallback = await maybeRunNativeFallbackForExecuteJs(
      args ?? {},
      errorCode,
      errorMessage,
      nativeAutoFallbackPolicy,
    );
    const nativeInputCapabilities = await resolveSuggestedNativeInputCapabilities(
      nativeAutoFallback,
      nativeInputSuggestion,
    );
    const status = nativeAutoFallback?.executed === true ? "fallback_executed" : "failed";
    const transportAttempts = Array.isArray(contextError?.transportAttempts)
      ? contextError.transportAttempts
      : [];
    return {
      status,
      transport: "unresolved",
      transport_attempts: transportAttempts,
      js_return: null,
      error: errorMessage,
      error_code: errorCode,
      retryable: isRetryableBrowserErrorCode(errorCode),
      native_input_suggested: nativeInputSuggestion.should_escalate === true,
      native_input_hint: nativeInputSuggestion.should_escalate === true ? nativeInputSuggestion : undefined,
      native_input_capabilities: nativeInputSuggestion.should_escalate === true ? nativeInputCapabilities : undefined,
      native_auto_fallback: nativeAutoFallback,
      tab_id: getActiveTargetId() || undefined,
      session_id: getActiveTargetId() || undefined,
      selection: undefined,
      selection_source: null,
      selection_warning: undefined,
      newTabs: [],
      reloaded: false,
      transients: [],
      diff: "context resolution failed before script execution",
      sessions: listSessionsSnapshot(),
      ...sessionPointers(),
      environment: {
        newTabs: [],
        reloaded: false,
      },
    };
  }
  const command = parseBridgeCommand(scriptInput.value);
  let jsReturn = null;
  let error = "";
  let responseTransport = preferred.transport;
  let executeTransportAttempts = [];
  let tabId = preferred.context.target.id;
  let selection = preferred.context.selection;
  const beforeTargets = preferred.context.targets;
  let afterTargets = preferred.context.targets;
  let newTabs = [];
  try {
    if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
      const codePayload = command ?? String(scriptInput.value ?? "");
      const tmwdExecution = await executeTmwdJsWithFallback(
        args ?? {},
        preferred.context,
        codePayload,
      );
      const executed = tmwdExecution.executed;
      preferred = {
        ...preferred,
        context: tmwdExecution.context,
      };
      responseTransport = normalizeTmwdTransportLabel(tmwdExecution.context.tmwd_transport);
      executeTransportAttempts = Array.isArray(tmwdExecution.transport_attempts)
        ? tmwdExecution.transport_attempts
        : [];
      jsReturn = executed.value;
      newTabs = executed.newTabs;
      selection = tmwdExecution.context.selection ?? selection;
      if (executed.raw && typeof executed.raw === "object") {
        if (executed.raw.ok === false) {
          error = String(executed.raw.error ?? "tmwd bridge command failed");
        }
        if (typeof executed.raw.tab_id === "string" && executed.raw.tab_id.trim().length > 0) {
          tabId = executed.raw.tab_id.trim();
        }
      }
      if (Array.isArray(newTabs) && newTabs.length > 0) {
        const normalizedNewTabs = newTabs.map((item) => ({
          id: normalizeIdToken(item?.id ?? item?.tabId),
          url: String(item?.url ?? ""),
          title: String(item?.title ?? ""),
          active: false,
        })).filter((item) => item.id.length > 0);
        if (normalizedNewTabs.length > 0) {
          syncSessionRegistry(normalizedNewTabs);
        }
      }
      try {
        const refreshed = await resolveTmwdContext(
          {
            ...args,
            tmwd_transport: tmwdExecution.context.tmwd_transport,
            session_id: tabId,
          },
          { probe: false },
        );
        afterTargets = refreshed.targets;
        selection = refreshed.selection;
      } catch {
        afterTargets = beforeTargets;
      }
    } else if (command) {
      const commandResult = await runBridgeCommand(command, args);
      jsReturn = commandResult;
      if (commandResult && typeof commandResult === "object") {
        if (commandResult.ok === false) {
          error = String(commandResult.error ?? "bridge command failed");
        }
        if (commandResult.selection && typeof commandResult.selection === "object") {
          selection = commandResult.selection;
        }
      }
      if (typeof command?.tabId === "string" && command.tabId.trim().length > 0) {
        tabId = command.tabId.trim();
      } else if (typeof command?.tab_id === "string" && command.tab_id.trim().length > 0) {
        tabId = command.tab_id.trim();
      } else if (typeof commandResult?.tab_id === "string" && commandResult.tab_id.trim().length > 0) {
        tabId = commandResult.tab_id.trim();
      } else if (typeof command?.sessionId === "string" && command.sessionId.trim().length > 0) {
        tabId = command.sessionId.trim();
      } else if (typeof command?.session_id === "string" && command.session_id.trim().length > 0) {
        tabId = command.session_id.trim();
      }
      afterTargets = await fetchCdpTargets(normalizeEndpoint(args?.cdp_endpoint));
      syncSessionRegistry(afterTargets);
    } else {
      const executed = await cdpEvaluateScript(args, String(scriptInput.value ?? ""));
      const cdpValue = executed.result.value;
      if (cdpValue && typeof cdpValue === "object" && Object.prototype.hasOwnProperty.call(cdpValue, "ok")) {
        if (cdpValue.ok === false) {
          error = String(cdpValue.error?.message ?? cdpValue.error ?? "cdp script failed");
        } else {
          jsReturn = cdpValue.data;
        }
      } else {
        jsReturn = cdpValue;
      }
      tabId = executed.target.id;
      selection = executed.result.selection;
      afterTargets = await fetchCdpTargets(normalizeEndpoint(args?.cdp_endpoint));
      syncSessionRegistry(afterTargets);
    }
  } catch (execError) {
    error = String(execError?.message ?? execError);
    if (Array.isArray(execError?.transportAttempts)) {
      executeTransportAttempts = execError.transportAttempts;
    }
  }
  if (tabId) {
    markSessionSelected(tabId, { make_default: false });
  }
  if (preferred.transport === "cdp") {
    const beforeIds = new Set(beforeTargets.map((item) => item.id));
    newTabs = afterTargets
      .filter((item) => !beforeIds.has(item.id))
      .map((item) => ({ id: item.id, url: item.url, title: item.title }));
  }
  const noMonitor = args?.no_monitor === true;
  const transients = noMonitor || preferred.transport !== "cdp" ? [] : await getTransientTexts(args);
  const diff = noMonitor
    ? "monitor skipped (no_monitor=true)"
    : (newTabs.length > 0 ? `DOM变化监控：检测到 ${String(newTabs.length)} 个新标签页` : "DOM变化监控：未检测到显著结构变化");
  const errorCode = error ? classifyBrowserErrorCode(error) : undefined;
  const nativeAutoFallbackPolicy = resolveNativeAutoFallbackPolicy(args ?? {});
  const nativeInputSuggestion = buildNativeInputSuggestion(errorCode, error, nativeAutoFallbackPolicy);
  const nativeAutoFallback = error
    ? await maybeRunNativeFallbackForExecuteJs(args ?? {}, errorCode, error, nativeAutoFallbackPolicy)
    : undefined;
  const nativeInputCapabilities = await resolveSuggestedNativeInputCapabilities(
    nativeAutoFallback,
    nativeInputSuggestion,
  );
  const status = error
    ? (nativeAutoFallback?.executed === true ? "fallback_executed" : "failed")
    : "success";
  return {
    status,
    transport: responseTransport,
    transport_attempts: mergeTransportAttempts(
      preferred.transport_attempts,
      executeTransportAttempts,
    ),
    js_return: jsReturn,
    error: error || undefined,
    error_code: errorCode,
    retryable: errorCode ? isRetryableBrowserErrorCode(errorCode) : undefined,
    native_input_suggested: nativeInputSuggestion.should_escalate === true,
    native_input_hint: nativeInputSuggestion.should_escalate === true ? nativeInputSuggestion : undefined,
    native_input_capabilities: nativeInputSuggestion.should_escalate === true ? nativeInputCapabilities : undefined,
    native_auto_fallback: nativeAutoFallback,
    tab_id: tabId || getActiveTargetId() || undefined,
    session_id: tabId || getActiveTargetId() || undefined,
    selection,
    selection_source: selection?.selected_by ?? null,
    selection_warning: selection?.warning ?? undefined,
    newTabs,
    reloaded: false,
    transients,
    diff,
    sessions: listSessionsSnapshot(),
    ...sessionPointers(),
    environment: {
      newTabs,
      reloaded: false,
    },
    script_source: scriptInput.source,
  };
}

export {
  handleBrowserExecuteJs,
};
