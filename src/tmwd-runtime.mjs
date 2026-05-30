import {
  appendTransportAttempt,
  normalizeTimeoutMs,
  normalizeTmwdLinkEndpoint,
  normalizeTmwdWsEndpoint,
  randomId,
  resolveTmwdMode,
  resolveTmwdTransport,
} from "./common.mjs";
import { resolveTarget } from "./cdp-runtime.mjs";
import {
  classifyBrowserErrorCode,
  shouldFallbackAcrossTmwdTransports,
  withTransportAttempts,
} from "./errors.mjs";
import {
  listSessionsSnapshot,
  markSessionSelected,
  normalizeIdToken,
  selectTargetFromCandidates,
  sessionPointers,
  syncSessionRegistry,
} from "./session-registry.mjs";

const tmwdWsRuntime = {
  endpoint: "",
  socket: null,
  state: "idle",
  connectPromise: null,
  pending: new Map(),
  lastTabs: [],
};

function normalizeTmwdTabsPayload(raw) {
  if (Array.isArray(raw)) {
    return normalizeTmwdSessions(raw);
  }
  if (raw && typeof raw === "object" && Array.isArray(raw.data)) {
    return normalizeTmwdSessions(raw.data);
  }
  return [];
}

function clearTmwdWsPending(errorMessage) {
  for (const [, pending] of tmwdWsRuntime.pending) {
    clearTimeout(pending.timer);
    pending.reject(new Error(errorMessage));
  }
  tmwdWsRuntime.pending.clear();
}

function closeTmwdWsConnection(reason) {
  if (tmwdWsRuntime.socket) {
    try {
      tmwdWsRuntime.socket.close();
    } catch {
      // no-op
    }
  }
  tmwdWsRuntime.socket = null;
  tmwdWsRuntime.state = "idle";
  tmwdWsRuntime.connectPromise = null;
  if (reason) {
    clearTmwdWsPending(reason);
  }
}

function onTmwdWsMessage(eventData) {
  let payload;
  try {
    payload = JSON.parse(String(eventData));
  } catch {
    return;
  }
  if (!payload || typeof payload !== "object") {
    return;
  }
  if (payload.type === "ext_ready" || payload.type === "tabs_update") {
    const tabs = normalizeTmwdTabsPayload(payload.tabs ?? payload.result ?? payload.data);
    if (tabs.length > 0) {
      tmwdWsRuntime.lastTabs = tabs;
      syncSessionRegistry(tabs);
    }
    return;
  }
  const responseId = String(payload.id ?? "").trim();
  if (!responseId) {
    return;
  }
  const pending = tmwdWsRuntime.pending.get(responseId);
  if (!pending) {
    return;
  }
  tmwdWsRuntime.pending.delete(responseId);
  clearTimeout(pending.timer);
  if (payload.type === "error") {
    pending.resolve({
      success: false,
      error: payload.error ?? "tmwd ws returned error",
      result: payload.result,
      newTabs: Array.isArray(payload.newTabs) ? payload.newTabs : [],
    });
    return;
  }
  pending.resolve({
    success: true,
    result: payload.result,
    error: payload.error,
    newTabs: Array.isArray(payload.newTabs) ? payload.newTabs : [],
  });
}

async function connectTmwdWs(args, options = {}) {
  const endpoint = normalizeTmwdWsEndpoint(args?.tmwd_ws_endpoint ?? process.env.BROWSER_STRUCTURED_TMWD_WS_ENDPOINT);
  const connectTimeoutMs = options.probe === true ? 1_500 : 5_000;
  if (
    tmwdWsRuntime.socket
    && tmwdWsRuntime.state === "open"
    && tmwdWsRuntime.endpoint === endpoint
    && tmwdWsRuntime.socket.readyState === WebSocket.OPEN
  ) {
    return endpoint;
  }
  if (tmwdWsRuntime.connectPromise && tmwdWsRuntime.endpoint === endpoint) {
    await tmwdWsRuntime.connectPromise;
    return endpoint;
  }
  if (tmwdWsRuntime.endpoint && tmwdWsRuntime.endpoint !== endpoint) {
    closeTmwdWsConnection("tmwd ws endpoint changed");
  }
  tmwdWsRuntime.endpoint = endpoint;
  tmwdWsRuntime.state = "connecting";
  const connectPromise = new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.close();
      } catch {
        // no-op
      }
      reject(new Error(`tmwd ws connect timeout after ${String(connectTimeoutMs)}ms`));
    }, connectTimeoutMs);
    const finishResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(undefined);
    };
    const finishReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    socket.addEventListener("open", () => {
      tmwdWsRuntime.socket = socket;
      tmwdWsRuntime.state = "open";
      finishResolve();
    }, { once: true });
    socket.addEventListener("message", (event) => {
      onTmwdWsMessage(event.data);
    });
    socket.addEventListener("close", () => {
      const reason = "tmwd ws closed";
      if (tmwdWsRuntime.socket === socket) {
        closeTmwdWsConnection(reason);
      }
      if (tmwdWsRuntime.state === "connecting") {
        finishReject(new Error(reason));
      }
    });
    socket.addEventListener("error", (event) => {
      const detail = String(event?.message ?? "").trim();
      const reason = detail.length > 0
        ? `tmwd ws error: ${detail}`
        : `tmwd ws connection failed endpoint=${endpoint}`;
      if (tmwdWsRuntime.socket === socket) {
        closeTmwdWsConnection(reason);
      }
      if (tmwdWsRuntime.state === "connecting") {
        finishReject(new Error(reason));
      }
    });
  });
  tmwdWsRuntime.connectPromise = connectPromise;
  try {
    await connectPromise;
    return endpoint;
  } finally {
    if (tmwdWsRuntime.connectPromise === connectPromise) {
      tmwdWsRuntime.connectPromise = null;
    }
    if (tmwdWsRuntime.state === "connecting") {
      tmwdWsRuntime.state = "idle";
    }
  }
}

async function sendTmwdWsRequest(args, payload, timeoutMs) {
  await connectTmwdWs(args, { probe: false });
  const socket = tmwdWsRuntime.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("tmwd ws is not connected");
  }
  const requestId = randomId("tmwd_ws");
  const requestTimeoutMs = Math.max(500, timeoutMs);
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      tmwdWsRuntime.pending.delete(requestId);
      reject(new Error(`tmwd ws request timeout id=${requestId}`));
    }, requestTimeoutMs);
    tmwdWsRuntime.pending.set(requestId, {
      resolve,
      reject,
      timer,
    });
  });
  socket.send(JSON.stringify({
    id: requestId,
    tabId: payload.tabId,
    code: payload.code,
  }));
  return promise;
}

async function listTmwdWsSessions(args, options = {}) {
  const timeoutMs = options.probe === true ? 1_500 : Math.min(10_000, normalizeTimeoutMs(args?.timeout_ms));
  await connectTmwdWs(args, { probe: options.probe === true });
  const response = await sendTmwdWsRequest(args, {
    code: { cmd: "tabs" },
  }, timeoutMs);
  if (!response.success) {
    throw new Error(String(response.error ?? "tmwd ws tabs failed"));
  }
  const tabs = normalizeTmwdTabsPayload(response.result);
  if (tabs.length > 0) {
    tmwdWsRuntime.lastTabs = tabs;
    syncSessionRegistry(tabs);
  }
  return tabs.length > 0 ? tabs : [...tmwdWsRuntime.lastTabs];
}

async function callTmwdLink(args, payload, timeoutMsOverride) {
  const endpoint = normalizeTmwdLinkEndpoint(args?.tmwd_link_endpoint ?? process.env.BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT);
  const timeoutMs = timeoutMsOverride ?? Math.min(15_000, normalizeTimeoutMs(args?.timeout_ms));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`tmwd link failed status=${String(response.status)}`);
    }
    const parsed = await response.json();
    if (typeof parsed !== "object" || parsed === null || !("r" in parsed)) {
      throw new Error("tmwd link returned invalid payload");
    }
    return {
      endpoint,
      value: parsed.r,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`tmwd link timeout after ${String(timeoutMs)}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTmwdSessions(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }
      const id = normalizeIdToken(item.id ?? item.sessionId);
      if (!id) {
        return null;
      }
      return {
        id,
        title: String(item.title ?? ""),
        url: String(item.url ?? ""),
        active: true,
        type: String(item.type ?? "ext_ws"),
      };
    })
    .filter((item) => item !== null);
}

async function resolveTmwdContextViaLink(args, options = {}) {
  const timeoutMs = options.probe === true
    ? Math.min(1_500, normalizeTimeoutMs(args?.timeout_ms))
    : undefined;
  const tmwd = await callTmwdLink(args, { cmd: "get_all_sessions" }, timeoutMs);
  const targets = normalizeTmwdSessions(tmwd.value);
  if (targets.length === 0) {
    throw new Error("tmwd get_all_sessions returned empty");
  }
  syncSessionRegistry(targets);
  const picked = selectTargetFromCandidates(targets, args);
  markSessionSelected(picked.target.id, { make_default: false });
  return {
    endpoint: tmwd.endpoint,
    tmwd_transport: "link",
    targets,
    target: picked.target,
    selection: picked.selection,
    sessions: listSessionsSnapshot(),
    ...sessionPointers(),
  };
}

async function resolveTmwdContextViaWs(args, options = {}) {
  const targets = await listTmwdWsSessions(args, { probe: options.probe === true });
  if (targets.length === 0) {
    throw new Error("tmwd ws tabs returned empty");
  }
  syncSessionRegistry(targets);
  const picked = selectTargetFromCandidates(targets, args);
  markSessionSelected(picked.target.id, { make_default: false });
  return {
    endpoint: normalizeTmwdWsEndpoint(args?.tmwd_ws_endpoint ?? process.env.BROWSER_STRUCTURED_TMWD_WS_ENDPOINT),
    tmwd_transport: "ws",
    targets,
    target: picked.target,
    selection: picked.selection,
    sessions: listSessionsSnapshot(),
    ...sessionPointers(),
  };
}

async function resolveTmwdContext(args, options = {}) {
  const transport = resolveTmwdTransport(args?.tmwd_transport);
  const attempts = [];
  if (transport !== "link") {
    try {
      const resolved = await resolveTmwdContextViaWs(args, options);
      return {
        ...resolved,
        transport_attempts: [
          ...attempts,
          { transport: "ws", status: "ok" },
        ],
      };
    } catch (error) {
      attempts.push({
        transport: "ws",
        status: "error",
        message: String(error?.message ?? error),
      });
      if (transport === "ws") {
        throw withTransportAttempts(error, attempts);
      }
    }
  }
  if (transport !== "ws") {
    try {
      const resolved = await resolveTmwdContextViaLink(args, options);
      return {
        ...resolved,
        transport_attempts: [
          ...attempts,
          { transport: "link", status: "ok" },
        ],
      };
    } catch (error) {
      attempts.push({
        transport: "link",
        status: "error",
        message: String(error?.message ?? error),
      });
      if (transport === "link") {
        throw withTransportAttempts(error, attempts);
      }
    }
  }
  const summary = attempts
    .filter((item) => item.status === "error")
    .map((item) => `${item.transport}=${item.message}`)
    .join("; ");
  const error = new Error(`tmwd context unavailable (${summary || "no transport succeeded"})`);
  withTransportAttempts(error, attempts);
  throw error;
}

async function resolvePreferredBrowserContext(args) {
  const mode = resolveTmwdMode(args?.tmwd_mode);
  if (mode === "cdp") {
    const context = await resolveTarget(args);
    return {
      transport: "cdp",
      context,
      transport_attempts: [
        { transport: "cdp", status: "ok", reason: "forced_mode" },
      ],
    };
  }
  try {
    const context = await resolveTmwdContext(args, { probe: mode === "auto" });
    return {
      transport: context.tmwd_transport === "ws" ? "tmwd_ws" : "tmwd_link",
      context,
      transport_attempts: Array.isArray(context.transport_attempts) ? context.transport_attempts : [],
    };
  } catch (error) {
    const attempts = Array.isArray(error?.transportAttempts)
      ? [...error.transportAttempts]
      : [];
    if (mode === "tmwd") {
      throw withTransportAttempts(error, attempts);
    }
    const context = await resolveTarget(args);
    return {
      transport: "cdp",
      context,
      transport_attempts: [
        ...attempts,
        { transport: "cdp", status: "ok", reason: "auto_fallback" },
      ],
    };
  }
}

async function executeTmwdJs(args, tmwdContext, code) {
  const timeoutMs = normalizeTimeoutMs(args?.timeout_ms);
  if (tmwdContext.tmwd_transport === "ws") {
    const codePayload = typeof code === "object" && code !== null
      ? { tabId: tmwdContext.target.id, ...code }
      : String(code ?? "");
    const response = await sendTmwdWsRequest(
      {
        ...args,
        tmwd_ws_endpoint: tmwdContext.endpoint,
      },
      {
        tabId: tmwdContext.target.id,
        code: codePayload,
      },
      Math.min(20_000, timeoutMs + 2_000),
    );
    const raw = response.success
      ? { ok: true, data: response.result, newTabs: response.newTabs }
      : { ok: false, error: response.error, result: response.result, newTabs: response.newTabs };
    if (!response.success) {
      return {
        raw,
        value: response.result,
        newTabs: Array.isArray(response.newTabs) ? response.newTabs : [],
      };
    }
    if (raw.data && typeof raw.data === "object" && raw.data !== null && "ok" in raw.data) {
      return {
        raw: raw.data,
        value: raw.data.data ?? raw.data.results ?? raw.data,
        newTabs: Array.isArray(response.newTabs) ? response.newTabs : [],
      };
    }
    return {
      raw,
      value: response.result,
      newTabs: Array.isArray(response.newTabs) ? response.newTabs : [],
    };
  }
  const timeoutSecs = Number((timeoutMs / 1000).toFixed(2));
  const exec = await callTmwdLink(
    {
      ...args,
      tmwd_link_endpoint: tmwdContext.endpoint,
    },
    {
      cmd: "execute_js",
      sessionId: tmwdContext.target.id,
      code,
      timeout: String(timeoutSecs),
    },
    Math.min(20_000, timeoutMs + 2_000),
  );
  const raw = exec.value;
  if (raw && typeof raw === "object" && typeof raw.error === "string" && raw.error.length > 0) {
    throw new Error(raw.error);
  }
  return {
    raw,
    value: raw?.data ?? raw?.result ?? raw,
    newTabs: Array.isArray(raw?.newTabs) ? raw.newTabs : [],
  };
}

async function resolveTmwdContextWithTransport(args, transport, sessionIdHint) {
  const contextArgs = {
    ...args,
    session_id: sessionIdHint || normalizeIdToken(args?.session_id ?? args?.sessionId),
    tmwd_transport: transport,
  };
  if (transport === "ws") {
    return resolveTmwdContextViaWs(contextArgs, { probe: false });
  }
  return resolveTmwdContextViaLink(contextArgs, { probe: false });
}

async function executeTmwdJsWithFallback(args, tmwdContext, codePayload) {
  const attempts = [];
  const initialTransport = tmwdContext.tmwd_transport === "ws" ? "ws" : "link";
  const runExecute = async (context, transport, reason) => {
    try {
      const executed = await executeTmwdJs(
        {
          ...args,
          session_id: context.target.id,
        },
        context,
        codePayload,
      );
      appendTransportAttempt(attempts, transport, "execute", "ok", { reason });
      return {
        executed,
        context,
      };
    } catch (error) {
      appendTransportAttempt(attempts, transport, "execute", "error", {
        reason,
        message: String(error?.message ?? error),
        error_code: classifyBrowserErrorCode(String(error?.message ?? error)),
      });
      throw error;
    }
  };

  try {
    const first = await runExecute(tmwdContext, initialTransport, "primary");
    return {
      ...first,
      transport_attempts: attempts,
    };
  } catch (primaryError) {
    if (!shouldFallbackAcrossTmwdTransports(args, primaryError)) {
      throw withTransportAttempts(primaryError, attempts);
    }
    const fallbackTransport = initialTransport === "ws" ? "link" : "ws";
    let fallbackContext;
    try {
      fallbackContext = await resolveTmwdContextWithTransport(args, fallbackTransport, tmwdContext.target.id);
      appendTransportAttempt(attempts, fallbackTransport, "resolve_context", "ok", {
        reason: "fallback_after_primary_error",
      });
    } catch (resolveError) {
      appendTransportAttempt(attempts, fallbackTransport, "resolve_context", "error", {
        reason: "fallback_after_primary_error",
        message: String(resolveError?.message ?? resolveError),
        error_code: classifyBrowserErrorCode(String(resolveError?.message ?? resolveError)),
      });
      throw withTransportAttempts(resolveError, attempts);
    }
    try {
      const retried = await runExecute(fallbackContext, fallbackTransport, "fallback_after_primary_error");
      return {
        ...retried,
        transport_attempts: attempts,
      };
    } catch (fallbackError) {
      throw withTransportAttempts(fallbackError, attempts);
    }
  }
}

export {
  executeTmwdJs,
  executeTmwdJsWithFallback,
  normalizeTmwdSessions,
  resolvePreferredBrowserContext,
  resolveTmwdContext,
};
