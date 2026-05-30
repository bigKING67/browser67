#!/usr/bin/env node

import { createInterface } from "node:readline";

import {
  applyMainOnlyGuardrail,
  clipContent,
  hashText,
  mergeTransportAttempts,
  normalizeEndpoint,
  normalizeMaxChars,
  normalizeTmwdTransportLabel,
  parseBridgeCommand,
  resolveExecuteJsScriptInput,
} from "./common.mjs";
import {
  buildScanContentExpression,
  cdpEvaluateScript,
  cdpReadPageContent,
  fetchCdpTargets,
} from "./cdp-runtime.mjs";
import { runBridgeCommand } from "./bridge-commands.mjs";
import { extractActionableNodes } from "./content-extraction.mjs";
import {
  classifyBrowserErrorCode,
  isRetryableBrowserErrorCode,
  makeErrorPayload,
} from "./errors.mjs";
import { handleBrowserNativeInput } from "./native-input.mjs";
import {
  buildNativeInputSuggestion,
  maybeRunNativeFallbackForExecuteJs,
  resolveNativeAutoFallbackPolicy,
  resolveSuggestedNativeInputCapabilities,
} from "./native-fallback.mjs";
import {
  asShortTabs,
  getActiveTargetId,
  listSessionsSnapshot,
  markSessionSelected,
  normalizeIdToken,
  resolveSessionByPattern,
  sessionPointers,
  syncSessionRegistry,
} from "./session-registry.mjs";
import {
  executeTmwdJs,
  executeTmwdJsWithFallback,
  resolvePreferredBrowserContext,
  resolveTmwdContext,
} from "./tmwd-runtime.mjs";
import { makeResult } from "./mcp-result.mjs";
import { TOOL_SCHEMAS } from "./tool-schemas.mjs";

const VERSION = "0.2.0-ga-cdp";
async function handleBrowserScan(args) {
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  const resolved = preferred.context;
  const targets = resolved.targets;
  const selected = resolved.target;
  markSessionSelected(selected.id, { make_default: false });
  const metadata = {
    transport: preferred.transport,
    transport_attempts: Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [],
    tabs_count: targets.length,
    tabs: asShortTabs(targets),
    active_tab: selected.id,
    cdp_endpoint: preferred.transport === "cdp" ? resolved.endpoint : undefined,
    tmwd_link_endpoint: preferred.transport === "tmwd_link" ? resolved.endpoint : undefined,
    tmwd_ws_endpoint: preferred.transport === "tmwd_ws" ? resolved.endpoint : undefined,
    selection: resolved.selection,
    selection_source: resolved.selection?.selected_by ?? null,
    selection_warning: resolved.selection?.warning ?? undefined,
    sessions: resolved.sessions,
    ...sessionPointers(),
  };
  if (args?.tabs_only === true) {
    return {
      status: "success",
      metadata,
    };
  }
  const textOnly = args?.text_only === true;
  const mainOnly = args?.main_only === true;
  const maxChars = normalizeMaxChars(args?.max_chars);
  let mainOnlyGuardrail;
  let content = "";
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    const readTmwdContent = async (readTextOnly, readMainOnly) => {
      const tmwdScript = `return ${buildScanContentExpression(readTextOnly, readMainOnly)};`;
      const tmwdExec = await executeTmwdJs(
        {
          ...args,
          session_id: selected.id,
        },
        resolved,
        tmwdScript,
      );
      return String(tmwdExec.value ?? "");
    };
    if (textOnly && mainOnly) {
      const mainContent = await readTmwdContent(true, true);
      const fullContent = await readTmwdContent(true, false);
      const guarded = applyMainOnlyGuardrail(mainContent, fullContent, args);
      content = guarded.content;
      mainOnlyGuardrail = guarded.metadata;
    } else {
      content = await readTmwdContent(textOnly, mainOnly);
    }
  } else {
    const readCdpContent = async (readTextOnly, readMainOnly) => {
      const contentResult = await cdpReadPageContent({
        ...args,
        switch_tab_id: selected.id,
      }, readTextOnly, readMainOnly);
      return String(contentResult.result.content ?? "");
    };
    if (textOnly && mainOnly) {
      const mainContent = await readCdpContent(true, true);
      const fullContent = await readCdpContent(true, false);
      const guarded = applyMainOnlyGuardrail(mainContent, fullContent, args);
      content = guarded.content;
      mainOnlyGuardrail = guarded.metadata;
    } else {
      content = await readCdpContent(textOnly, mainOnly);
    }
  }
  const clipped = clipContent(content, maxChars);
  return {
    status: "success",
    metadata: {
      ...metadata,
      text_only: textOnly,
      main_only: mainOnly,
      main_only_guardrail: textOnly && mainOnly ? mainOnlyGuardrail : undefined,
      truncated: clipped.truncated,
      original_length: clipped.original_length,
      max_chars: maxChars,
    },
    content: clipped.value,
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
  const scriptInput = resolveExecuteJsScriptInput(args ?? {});
  const command = parseBridgeCommand(scriptInput.value);
  let jsReturn = null;
  let error = "";
  let responseTransport = preferred.transport;
  let executeTransportAttempts = [];
  let tabId = preferred.context.target.id;
  let selection = preferred.context.selection;
  let beforeTargets = preferred.context.targets;
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
      jsReturn = executed.result.value;
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

async function handleBrowserExtract(args) {
  let html = "";
  let transport = "cdp";
  let tmwdLinkEndpoint;
  let tmwdWsEndpoint;
  let selection;
  let transportAttempts = [];
  if (typeof args?.html === "string" && args.html.length > 0) {
    html = args.html;
    } else {
      const preferred = await resolvePreferredBrowserContext(args ?? {});
      transport = preferred.transport;
      transportAttempts = Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [];
      tmwdLinkEndpoint = preferred.transport === "tmwd_link" ? preferred.context.endpoint : undefined;
      tmwdWsEndpoint = preferred.transport === "tmwd_ws" ? preferred.context.endpoint : undefined;
      selection = preferred.context.selection;
      if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
        const executed = await executeTmwdJs(
          {
          ...args,
          session_id: preferred.context.target.id,
        },
        preferred.context,
        "return (() => document.documentElement.outerHTML)();",
        );
        html = String(executed.value ?? "");
      } else {
        const page = await cdpReadPageContent(args ?? {}, false);
        html = page.result.content;
      }
  }
  const limitRaw = Number(args?.selector_limit ?? 120);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(300, Math.floor(limitRaw)))
    : 120;
  const nodes = extractActionableNodes(html, limit);
  return {
    transport,
    transport_attempts: transportAttempts,
    tmwd_link_endpoint: tmwdLinkEndpoint,
    tmwd_ws_endpoint: tmwdWsEndpoint,
    selection,
    selection_source: selection?.selected_by ?? null,
    selection_warning: selection?.warning ?? undefined,
    page_fingerprint: hashText(html),
    actionable_nodes: nodes,
    state_transients: [],
    evidence_snapshot_ref: `snapshot_${hashText(html).slice(0, 12)}`,
    fallback_used: "none",
    active_tab: getActiveTargetId() || null,
  };
}

function handleBrowserDiff(args) {
  const toLines = (value) => String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const beforeLines = new Set(toLines(args?.before ?? ""));
  const afterLines = new Set(toLines(args?.after ?? ""));
  const added = [];
  const removed = [];
  for (const line of afterLines) {
    if (!beforeLines.has(line)) {
      added.push(hashText(line).slice(0, 12));
    }
  }
  for (const line of beforeLines) {
    if (!afterLines.has(line)) {
      removed.push(hashText(line).slice(0, 12));
    }
  }
  return {
    added_signatures: added.slice(0, 200),
    removed_signatures: removed.slice(0, 200),
    before_fingerprint: hashText(String(args?.before ?? "")),
    after_fingerprint: hashText(String(args?.after ?? "")),
  };
}

async function handleBrowserTabOps(args) {
  const op = String(args?.op ?? "").trim().toLowerCase();
  if (op === "current" || op === "current_session") {
    return {
      status: "ok",
      active_tab: getActiveTargetId() || null,
      ...sessionPointers(),
    };
  }
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  const tabs = preferred.context.targets;
  const transportAttempts = Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [];
  if (op === "set_session") {
    const pattern = String(args?.url_pattern ?? "").trim();
    if (!pattern) {
      return {
        status: "error",
        msg: "url_pattern is required for op=set_session",
      };
    }
    const matched = resolveSessionByPattern(tabs, pattern);
    if (matched.length === 0) {
      return {
        status: "error",
        msg: `no session matched pattern: ${pattern}`,
        ...sessionPointers(),
      };
    }
    markSessionSelected(matched[0].id, { make_default: true });
    return {
      status: "ok",
      selected: matched[0].id,
      matched: asShortTabs(matched),
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      selection_source: "url_pattern",
      ...sessionPointers(),
    };
  }
  if (op === "find_session") {
    const pattern = String(args?.url_pattern ?? "").trim();
    return {
      status: "ok",
      pattern,
      matched: asShortTabs(resolveSessionByPattern(tabs, pattern)),
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      ...sessionPointers(),
    };
  }
  if (op === "list_sessions") {
    return {
      status: "ok",
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      sessions: listSessionsSnapshot({
        include_disconnected: args?.include_disconnected === true,
      }),
      ...sessionPointers(),
    };
  }
  if (op === "switch") {
    const tabId = String(args?.tab_id ?? args?.session_id ?? "").trim();
    if (!tabId) {
      return {
        status: "error",
        msg: "tab_id or session_id is required for op=switch",
      };
    }
    if (!tabs.some((item) => item.id === tabId)) {
      return {
        status: "error",
        msg: `tab not found: ${tabId}`,
      };
    }
    markSessionSelected(tabId, { make_default: false });
    return {
      status: "ok",
      active_tab: tabId,
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      selection_source: "session_id",
      ...sessionPointers(),
    };
  }
  if (op === "list") {
    return {
      status: "ok",
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      tabs_count: tabs.length,
      tabs: asShortTabs(tabs),
      active_tab: getActiveTargetId() || null,
      sessions: listSessionsSnapshot(),
      ...sessionPointers(),
    };
  }
  return {
    status: "error",
    msg: `unsupported op: ${op}`,
  };
}

async function dispatchToolCall(name, args) {
  try {
    if (name === "browser_scan") {
      return makeResult(await handleBrowserScan(args));
    }
    if (name === "browser_execute_js") {
      return makeResult(await handleBrowserExecuteJs(args));
    }
    if (name === "browser_extract") {
      return makeResult(await handleBrowserExtract(args));
    }
    if (name === "browser_diff") {
      return makeResult(handleBrowserDiff(args));
    }
    if (name === "browser_tab_ops") {
      return makeResult(await handleBrowserTabOps(args));
    }
    if (name === "browser_native_input") {
      return makeResult(await handleBrowserNativeInput(args));
    }
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `unknown tool: ${String(name)}`,
        },
      ],
    };
  } catch (error) {
    return makeErrorPayload(name, error);
  }
}

function sendResponse(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function handleRequest(request) {
  const { id, method, params } = request;
  if (!method || typeof method !== "string") {
    sendError(id ?? null, -32600, "invalid request: missing method");
    return;
  }
  if (method === "initialize") {
    sendResponse(id, {
      protocolVersion: "2024-11-05",
      serverInfo: {
        name: "browser-structured-mcp",
        version: VERSION,
      },
      capabilities: {
        tools: {},
      },
    });
    return;
  }
  if (method === "tools/list") {
    const tools = Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
      name,
      description: schema.description,
      inputSchema: schema.inputSchema,
    }));
    sendResponse(id, { tools });
    return;
  }
  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments ?? {};
    if (typeof toolName !== "string") {
      sendError(id ?? null, -32602, "tools/call requires string params.name");
      return;
    }
    dispatchToolCall(toolName, args)
      .then((result) => {
        sendResponse(id, result);
      })
      .catch((error) => {
        sendError(id ?? null, -32000, `tool execution failed: ${String(error)}`);
      });
    return;
  }
  if (method === "notifications/initialized") {
    return;
  }
  sendError(id ?? null, -32601, `method not found: ${method}`);
}

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  const raw = line.trim();
  if (!raw) {
    return;
  }
  try {
    const request = JSON.parse(raw);
    handleRequest(request);
  } catch (error) {
    sendError(null, -32700, `parse error: ${String(error)}`);
  }
});
