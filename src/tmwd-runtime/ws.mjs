import { WebSocket } from "ws";

import {
  normalizeTmwdWsEndpoint,
} from "../runtime/config/endpoints.mjs";
import { normalizeTimeoutMs } from "../runtime/config/limits.mjs";
import { randomId } from "../runtime/identity.mjs";
import { defaultSessionRegistry } from "../runtime/sessions/registry.mjs";
import { normalizeTmwdTabsPayload } from "./session-normalization.mjs";

const MAX_TMWD_PENDING_REQUESTS = 256;

function clampDisposeTimeoutMs(raw) {
  const parsed = Number(raw ?? 1_000);
  if (!Number.isFinite(parsed)) return 1_000;
  return Math.max(100, Math.min(10_000, Math.floor(parsed)));
}

function normalizeSessionCacheTtlMs(raw) {
  const value = Number(raw ?? process.env.BROWSER_STRUCTURED_TMWD_SESSION_CACHE_TTL_MS ?? 1_500);
  return Number.isFinite(value) ? Math.max(0, Math.min(10_000, Math.floor(value))) : 1_500;
}

function cachedTabsCanSatisfySelection(args, tabs) {
  const sessionId = String(args?.session_id ?? args?.sessionId ?? args?.switch_tab_id ?? "").trim();
  if (sessionId && !tabs.some((tab) => String(tab.id) === sessionId)) return false;
  const urlPattern = String(args?.session_url_pattern ?? args?.url_pattern ?? "").trim();
  if (!urlPattern) return true;
  try {
    const expression = new RegExp(urlPattern);
    return tabs.some((tab) => expression.test(String(tab.url ?? "")));
  } catch {
    return tabs.some((tab) => String(tab.url ?? "").includes(urlPattern));
  }
}

function createTmwdWsRuntime(options = {}) {
  const WebSocketImpl = options.WebSocketImpl ?? WebSocket;
  const sessionStore = options.sessionStore ?? defaultSessionRegistry;
  const maxPending = Math.max(1, Number(options.max_pending ?? MAX_TMWD_PENDING_REQUESTS));
  const state = {
    endpoint: "",
    socket: null,
    status: "idle",
    connectPromise: null,
    pending: new Map(),
    lastTabs: [],
    lastTabsUpdatedAtMs: 0,
    lastTabsSource: "none",
    connectionGeneration: 0,
    disposed: false,
  };

  function assertActive() {
    if (state.disposed) throw new Error("tmwd ws runtime is disposed");
  }

  function resetSessionCache() {
    state.lastTabs = [];
    state.lastTabsUpdatedAtMs = 0;
    state.lastTabsSource = "none";
  }

  function updateSessionCache(tabs, source) {
    state.lastTabs = [...tabs];
    state.lastTabsUpdatedAtMs = Date.now();
    state.lastTabsSource = source;
    sessionStore.sync(tabs);
  }

  function clearPending(errorMessage) {
    for (const [, pending] of state.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(errorMessage));
    }
    state.pending.clear();
  }

  function closeConnection(reason) {
    if (state.socket) {
      try {
        state.socket.close();
      } catch {
        // Connection teardown is best effort; pending calls receive the decisive error below.
      }
    }
    state.socket = null;
    state.status = "idle";
    state.connectPromise = null;
    if (reason) clearPending(reason);
  }

  async function waitForSocketClose(socket, timeoutMs) {
    if (!socket || socket.readyState === WebSocketImpl.CLOSED) return "already_closed";
    return new Promise((resolve) => {
      let settled = false;
      const finish = (status) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(status);
      };
      const timer = setTimeout(() => finish("timeout"), timeoutMs);
      try {
        socket.addEventListener("close", () => finish("closed"), { once: true });
        socket.addEventListener("error", () => finish("error"), { once: true });
      } catch {
        finish("listener_unavailable");
      }
    });
  }

  function onMessage(eventData) {
    let payload;
    try {
      payload = JSON.parse(String(eventData));
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") return;
    if (payload.type === "ext_ready" || payload.type === "tabs_update") {
      const tabs = normalizeTmwdTabsPayload(payload.tabs ?? payload.result ?? payload.data);
      updateSessionCache(tabs, payload.type === "ext_ready" ? "push_ext_ready" : "push_tabs_update");
      return;
    }
    const responseId = String(payload.id ?? "").trim();
    if (!responseId) return;
    const pending = state.pending.get(responseId);
    if (!pending) return;
    state.pending.delete(responseId);
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

  async function connect(args, connectOptions = {}) {
    assertActive();
    const endpoint = normalizeTmwdWsEndpoint(args?.tmwd_ws_endpoint ?? process.env.BROWSER_STRUCTURED_TMWD_WS_ENDPOINT);
    const connectTimeoutMs = connectOptions.probe === true ? 1_500 : 5_000;
    if (
      state.socket
      && state.status === "open"
      && state.endpoint === endpoint
      && state.socket.readyState === WebSocketImpl.OPEN
    ) {
      return endpoint;
    }
    if (state.connectPromise && state.endpoint === endpoint) {
      await state.connectPromise;
      return endpoint;
    }
    if (state.endpoint && state.endpoint !== endpoint) closeConnection("tmwd ws endpoint changed");
    state.endpoint = endpoint;
    state.status = "connecting";
    const connectPromise = new Promise((resolve, reject) => {
      const socket = new WebSocketImpl(endpoint);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          socket.close();
        } catch {
          // The timeout error is sufficient if the underlying socket cannot close cleanly.
        }
        reject(new Error(`tmwd ws connect timeout after ${String(connectTimeoutMs)}ms`));
      }, connectTimeoutMs);
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(undefined);
      };
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      socket.addEventListener("open", () => {
        state.socket = socket;
        state.status = "open";
        state.connectionGeneration += 1;
        resetSessionCache();
        finishResolve();
      }, { once: true });
      socket.addEventListener("message", (event) => onMessage(event.data));
      socket.addEventListener("close", () => {
        const reason = "tmwd ws closed";
        if (state.socket === socket) closeConnection(reason);
        if (state.status === "connecting") finishReject(new Error(reason));
      });
      socket.addEventListener("error", (event) => {
        const detail = String(event?.message ?? "").trim();
        const reason = detail.length > 0
          ? `tmwd ws error: ${detail}`
          : `tmwd ws connection failed endpoint=${endpoint}`;
        if (state.socket === socket) closeConnection(reason);
        if (state.status === "connecting") finishReject(new Error(reason));
      });
    });
    state.connectPromise = connectPromise;
    try {
      await connectPromise;
      return endpoint;
    } finally {
      if (state.connectPromise === connectPromise) state.connectPromise = null;
      if (state.status === "connecting") state.status = "idle";
    }
  }

  async function send(args, payload, timeoutMs) {
    await connect(args, { probe: false });
    const socket = state.socket;
    if (!socket || socket.readyState !== WebSocketImpl.OPEN) {
      throw new Error("tmwd ws is not connected");
    }
    if (state.pending.size >= maxPending) {
      throw new Error(`tmwd ws pending request limit reached (${String(maxPending)})`);
    }
    const requestId = randomId("tmwd_ws");
    const requestTimeoutMs = Math.max(500, timeoutMs);
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(requestId);
        reject(new Error(`tmwd ws request timeout id=${requestId}`));
      }, requestTimeoutMs);
      state.pending.set(requestId, { resolve, reject, timer });
    });
    socket.send(JSON.stringify({
      id: requestId,
      tabId: payload.tabId,
      code: payload.code,
      monitorNewTabs: payload.monitorNewTabs !== false,
    }));
    return promise;
  }

  async function listSessionsWithMeta(args, listOptions = {}) {
    const timeoutMs = listOptions.probe === true
      ? 1_500
      : Math.min(10_000, normalizeTimeoutMs(args?.timeout_ms));
    await connect(args, { probe: listOptions.probe === true });
    const cacheTtlMs = normalizeSessionCacheTtlMs(listOptions.cache_ttl_ms ?? args?.session_cache_ttl_ms);
    const cacheAgeMs = state.lastTabsUpdatedAtMs > 0
      ? Date.now() - state.lastTabsUpdatedAtMs
      : Number.POSITIVE_INFINITY;
    if (
      listOptions.refresh !== true
      && args?.refresh_sessions !== true
      && cacheAgeMs <= cacheTtlMs
      && cachedTabsCanSatisfySelection(args, state.lastTabs)
    ) {
      return {
        tabs: [...state.lastTabs],
        cache: {
          hit: true,
          source: state.lastTabsSource,
          age_ms: cacheAgeMs,
          ttl_ms: cacheTtlMs,
          connection_generation: state.connectionGeneration,
        },
      };
    }
    const response = await send(args, { code: { cmd: "tabs" } }, timeoutMs);
    if (!response.success) throw new Error(String(response.error ?? "tmwd ws tabs failed"));
    const tabs = normalizeTmwdTabsPayload(response.result);
    updateSessionCache(tabs, "pull_tabs");
    return {
      tabs: [...tabs],
      cache: {
        hit: false,
        source: "pull_tabs",
        age_ms: 0,
        ttl_ms: cacheTtlMs,
        connection_generation: state.connectionGeneration,
      },
    };
  }

  async function listSessions(args, listOptions = {}) {
    return (await listSessionsWithMeta(args, listOptions)).tabs;
  }

  function stats() {
    return {
      endpoint: state.endpoint || null,
      state: state.status,
      disposed: state.disposed,
      pending_count: state.pending.size,
      max_pending: maxPending,
      cached_tab_count: state.lastTabs.length,
      connection_generation: state.connectionGeneration,
    };
  }

  async function dispose(disposeOptions = {}) {
    if (state.disposed) return { status: "success", action: "dispose_tmwd_runtime", already_disposed: true, after: stats() };
    const socket = state.socket;
    const timeoutMs = clampDisposeTimeoutMs(disposeOptions.timeout_ms ?? disposeOptions.timeoutMs);
    const before = { ...stats(), had_socket: Boolean(socket) };
    const waitClose = socket ? waitForSocketClose(socket, timeoutMs) : Promise.resolve("no_socket");
    closeConnection(String(disposeOptions.reason ?? "tmwd runtime disposed"));
    resetSessionCache();
    state.disposed = true;
    const closeStatus = await waitClose;
    return {
      status: "success",
      action: "dispose_tmwd_runtime",
      close_status: closeStatus,
      timeout_ms: timeoutMs,
      before,
      after: { ...stats(), had_socket: Boolean(state.socket) },
    };
  }

  return Object.freeze({ connect, dispose, listSessions, listSessionsWithMeta, send, stats });
}

const defaultTmwdWsRuntime = createTmwdWsRuntime();

const disposeTmwdRuntime = (...args) => defaultTmwdWsRuntime.dispose(...args);
const listTmwdWsSessions = (...args) => defaultTmwdWsRuntime.listSessions(...args);
const listTmwdWsSessionsWithMeta = (...args) => defaultTmwdWsRuntime.listSessionsWithMeta(...args);
const sendTmwdWsRequest = (...args) => defaultTmwdWsRuntime.send(...args);

export {
  cachedTabsCanSatisfySelection,
  MAX_TMWD_PENDING_REQUESTS,
  createTmwdWsRuntime,
  defaultTmwdWsRuntime,
  disposeTmwdRuntime,
  listTmwdWsSessions,
  listTmwdWsSessionsWithMeta,
  normalizeSessionCacheTtlMs,
  sendTmwdWsRequest,
};
