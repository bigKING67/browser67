import { clipContent } from "../../browser/content/output-limits.mjs";
import { parseBridgeCommand } from "../../browser/execution/bridge-command.mjs";
import {
  assertManagedExecutionContext,
  authorizeManagedExecutionNavigation,
  executionMayNavigate,
} from "../../browser/execution/managed-context.mjs";
import {
  beginExecutionNetworkObservation,
  finishExecutionNetworkObservation,
} from "../../browser/network/execution-observation.mjs";
import { resolveExecuteJsScriptInput } from "../../browser/execution/script-input.mjs";
import { normalizeEndpoint } from "../../runtime/config/endpoints.mjs";
import {
  mergeTransportAttempts,
  normalizeTmwdTransportLabel,
} from "../../runtime/transport-attempts.mjs";
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
import { executeStructuredNodeOperation } from "../../browser/execution/structured-operation.mjs";

const DEFAULT_INTERACTION_NEW_TAB_WAIT_MS = 1_500;
const MAX_NEW_TAB_WAIT_MS = 5_000;
const NEW_TAB_POLL_MS = 125;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeNewTab(item) {
  const id = normalizeIdToken(item?.id ?? item?.tabId ?? item?.tab_id);
  if (!id) return null;
  return {
    id,
    url: String(item?.url ?? ""),
    title: String(item?.title ?? ""),
  };
}

function mergeNewTabs(...groups) {
  const merged = new Map();
  for (const item of groups.flat()) {
    const normalized = normalizeNewTab(item);
    if (!normalized) continue;
    const prior = merged.get(normalized.id);
    merged.set(normalized.id, {
      id: normalized.id,
      url: normalized.url || prior?.url || "",
      title: normalized.title || prior?.title || "",
    });
  }
  return [...merged.values()];
}

function targetDiff(beforeTargets, afterTargets) {
  const beforeIds = new Set(
    (Array.isArray(beforeTargets) ? beforeTargets : [])
      .map((item) => normalizeIdToken(item?.id))
      .filter(Boolean),
  );
  return (Array.isArray(afterTargets) ? afterTargets : [])
    .filter((item) => {
      const id = normalizeIdToken(item?.id);
      return id && !beforeIds.has(id);
    });
}

function newTabWaitBudget(args, scriptInput) {
  if (args?.no_monitor === true) return 0;
  if (Object.prototype.hasOwnProperty.call(args ?? {}, "new_tab_wait_ms")) {
    const explicit = Number(args?.new_tab_wait_ms);
    return Number.isFinite(explicit)
      ? Math.max(0, Math.min(MAX_NEW_TAB_WAIT_MS, Math.round(explicit)))
      : 0;
  }
  const value = scriptInput?.value;
  const source = typeof value === "string"
    ? value
    : (() => {
      try {
        return JSON.stringify(value ?? "");
      } catch {
        return String(value ?? "");
      }
    })();
  return /\.click\s*\(|Input\.dispatchMouseEvent|window\.open\s*\(/i.test(source)
    ? DEFAULT_INTERACTION_NEW_TAB_WAIT_MS
    : 0;
}

function compactJsReturn(value, maxChars) {
  const type = Array.isArray(value) ? "array" : typeof value;
  if (value === null || value === undefined) {
    return { type, value, truncated: false, original_length: 0 };
  }
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const clipped = clipContent(serialized, maxChars);
  return {
    type,
    preview: clipped.value,
    truncated: clipped.truncated,
    original_length: clipped.original_length,
  };
}

function applyOutputMode(payload, args) {
  if (String(args?.output_mode ?? "full") !== "compact") {
    return payload;
  }
  const maxChars = Math.max(200, Math.min(300_000, Number(args?.max_return_chars ?? 4_000)));
  return {
    ...payload,
    js_return: compactJsReturn(payload.js_return, maxChars),
    output_mode: "compact",
    max_return_chars: maxChars,
  };
}

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
  if (typeof args?.operation === "string" && args.operation.trim()) {
    if (typeof args.script === "string") {
      throw createToolError(
        "INVALID_ARGUMENT",
        "structured operation cannot be combined with script",
        { retryable: false },
      );
    }
    return executeStructuredNodeOperation(args);
  }
  const scriptInput = resolveExecuteJsScriptInput(args ?? {});
  if (scriptInput.missing === true) {
    throw createToolError(
      "INVALID_ARGUMENT",
      "browser_execute_js requires script or a structured operation",
      { details: { accepted_fields: ["script", "operation"] } },
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
    return applyOutputMode({
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
    }, args ?? {});
  }
  const management = await assertManagedExecutionContext(preferred, args ?? {});
  const command = parseBridgeCommand(scriptInput.value);
  if (
    typeof scriptInput.value === "string"
    && scriptInput.value.trim().startsWith("{")
    && !command
  ) {
    throw createToolError(
      "INVALID_ARGUMENT",
      "bridge commands must be strict JSON objects with a non-empty cmd field",
      { retryable: false },
    );
  }
  const navigationAuthorization = executionMayNavigate(command ?? scriptInput.value)
    ? await authorizeManagedExecutionNavigation(preferred, args ?? {}, "raw_browser_execution")
    : { status: "not_required", authorized: false };
  const executionObservation = await beginExecutionNetworkObservation(args ?? {}, preferred);
  let jsReturn = null;
  let error = "";
  let responseTransport = preferred.transport;
  let executeTransportAttempts = [];
  let tabId = preferred.context.target.id;
  let selection = preferred.context.selection;
  const beforeTargets = preferred.context.targets;
  let afterTargets = preferred.context.targets;
  let newTabs = [];
  const newTabWaitMs = newTabWaitBudget(args ?? {}, scriptInput);
  let newTabWaitedMs = 0;
  let observationResult;
  try {
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
        newTabs = mergeNewTabs(executed.newTabs);
        selection = tmwdExecution.context.selection ?? selection;
        if (executed.raw && typeof executed.raw === "object") {
          if (executed.raw.ok === false) {
            error = String(executed.raw.error ?? "tmwd bridge command failed");
          }
          if (typeof executed.raw.tab_id === "string" && executed.raw.tab_id.trim().length > 0) {
            tabId = executed.raw.tab_id.trim();
          }
        }
        if (newTabs.length > 0) {
          syncSessionRegistry(newTabs.map((item) => ({ ...item, active: false })));
        }
        try {
          const refreshed = await resolveTmwdContext(
            {
              ...args,
              tmwd_transport: tmwdExecution.context.tmwd_transport,
              session_id: tabId,
            },
            { probe: false, refresh: newTabWaitMs > 0 },
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
        const executed = await cdpEvaluateScript({
          ...args,
          switch_tab_id: preferred.context.target.id,
        }, String(scriptInput.value ?? ""));
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
    newTabs = mergeNewTabs(newTabs, targetDiff(beforeTargets, afterTargets));
    if (!error && newTabs.length === 0 && newTabWaitMs > 0) {
      const waitStarted = Date.now();
      while (Date.now() - waitStarted < newTabWaitMs && newTabs.length === 0) {
        const remaining = newTabWaitMs - (Date.now() - waitStarted);
        await sleep(Math.min(NEW_TAB_POLL_MS, Math.max(1, remaining)));
        try {
          if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
            const refreshed = await resolveTmwdContext(
              {
                ...args,
                tmwd_transport: preferred.context.tmwd_transport,
                session_id: tabId,
              },
              { probe: false, refresh: true },
            );
            afterTargets = refreshed.targets;
            selection = refreshed.selection;
          } else {
            afterTargets = await fetchCdpTargets(normalizeEndpoint(args?.cdp_endpoint));
            syncSessionRegistry(afterTargets);
          }
        } catch {
          // A target refresh can race navigation; retry within the bounded window.
        }
        newTabs = mergeNewTabs(newTabs, targetDiff(beforeTargets, afterTargets));
      }
      newTabWaitedMs = Date.now() - waitStarted;
    }
  } finally {
    observationResult = await finishExecutionNetworkObservation(executionObservation);
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
  return applyOutputMode({
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
    new_tab_wait_ms: newTabWaitMs,
    new_tab_waited_ms: newTabWaitedMs,
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
    management,
    navigation_authorization: navigationAuthorization,
    network_observation_id: observationResult?.network_observation_id,
    network_observation: observationResult?.summary,
  }, args ?? {});
}

export {
  handleBrowserExecuteJs,
};
