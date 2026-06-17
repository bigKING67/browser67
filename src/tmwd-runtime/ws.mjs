import {
  normalizeTimeoutMs,
  normalizeTmwdWsEndpoint,
  randomId,
} from "../common.mjs";
import { syncSessionRegistry } from "../session-registry.mjs";
import { normalizeTmwdTabsPayload } from "./session-normalization.mjs";

const tmwdWsRuntime = {
  endpoint: "",
  socket: null,
  state: "idle",
  connectPromise: null,
  pending: new Map(),
  lastTabs: [],
};

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

function clampDisposeTimeoutMs(raw) {
  const parsed = Number(raw ?? 1_000);
  if (!Number.isFinite(parsed)) {
    return 1_000;
  }
  return Math.max(100, Math.min(10_000, Math.floor(parsed)));
}

async function waitForSocketClose(socket, timeoutMs) {
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    return "already_closed";
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (status) => {
      if (settled) {
        return;
      }
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

async function disposeTmwdRuntime(options = {}) {
  const socket = tmwdWsRuntime.socket;
  const timeoutMs = clampDisposeTimeoutMs(options.timeout_ms ?? options.timeoutMs);
  const snapshot = {
    endpoint: tmwdWsRuntime.endpoint,
    state: tmwdWsRuntime.state,
    pending_count: tmwdWsRuntime.pending.size,
    had_socket: Boolean(socket),
  };
  const waitClose = socket ? waitForSocketClose(socket, timeoutMs) : Promise.resolve("no_socket");
  closeTmwdWsConnection(String(options.reason ?? "tmwd runtime disposed"));
  const closeStatus = await waitClose;
  return {
    status: "success",
    action: "dispose_tmwd_runtime",
    close_status: closeStatus,
    timeout_ms: timeoutMs,
    before: snapshot,
    after: {
      endpoint: tmwdWsRuntime.endpoint,
      state: tmwdWsRuntime.state,
      pending_count: tmwdWsRuntime.pending.size,
      had_socket: Boolean(tmwdWsRuntime.socket),
    },
  };
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

export {
  disposeTmwdRuntime,
  listTmwdWsSessions,
  sendTmwdWsRequest,
};
