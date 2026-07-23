import {
  normalizeTmwdWsEndpoint,
  resolveTmwdMode,
  resolveTmwdTransport,
} from "../runtime/config/endpoints.mjs";
import { normalizeTimeoutMs } from "../runtime/config/limits.mjs";
import { resolveTarget } from "../cdp-runtime/index.mjs";
import { withTransportAttempts } from "../runtime/tool-errors.mjs";
import { defaultSessionRegistry, normalizeIdToken } from "../runtime/sessions/registry.mjs";
import { callTmwdLink } from "./link.mjs";
import { defaultTmwdTransportHealthStore } from "./health.mjs";
import { normalizeTmwdSessions } from "./session-normalization.mjs";
import { defaultTmwdWsRuntime } from "./ws.mjs";

function runtimeServices(options = {}) {
  return {
    healthStore: options.runtime?.transportHealth ?? options.transportHealth ?? defaultTmwdTransportHealthStore,
    sessionStore: options.runtime?.sessionStore ?? options.sessionStore ?? defaultSessionRegistry,
    wsRuntime: options.runtime?.tmwdWsRuntime ?? options.tmwdWsRuntime ?? defaultTmwdWsRuntime,
  };
}

async function resolveTmwdContextViaLink(args, options = {}) {
  const { sessionStore } = runtimeServices(options);
  const timeoutMs = options.probe === true
    ? Math.min(1_500, normalizeTimeoutMs(args?.timeout_ms))
    : undefined;
  const tmwd = await callTmwdLink(args, { cmd: "get_all_sessions" }, timeoutMs);
  const targets = normalizeTmwdSessions(tmwd.value);
  if (targets.length === 0) {
    throw new Error("tmwd get_all_sessions returned empty");
  }
  sessionStore.sync(targets);
  const picked = sessionStore.selectTarget(targets, args);
  sessionStore.select(picked.target.id, { make_default: false });
  return {
    endpoint: tmwd.endpoint,
    tmwd_transport: "link",
    targets,
    target: picked.target,
    selection: picked.selection,
    sessions: sessionStore.list(),
    ...sessionStore.sessionPointers(),
  };
}

async function resolveTmwdContextViaWs(args, options = {}) {
  const { sessionStore, wsRuntime } = runtimeServices(options);
  const sessionResult = await wsRuntime.listSessionsWithMeta(args, {
    probe: options.probe === true,
    refresh: options.refresh === true,
  });
  const targets = sessionResult.tabs;
  if (targets.length === 0) {
    throw new Error("tmwd ws tabs returned empty");
  }
  sessionStore.sync(targets);
  const picked = sessionStore.selectTarget(targets, args);
  sessionStore.select(picked.target.id, { make_default: false });
  return {
    endpoint: normalizeTmwdWsEndpoint(args?.tmwd_ws_endpoint ?? process.env.BROWSER_STRUCTURED_TMWD_WS_ENDPOINT),
    tmwd_transport: "ws",
    targets,
    target: picked.target,
    selection: picked.selection,
    sessions: sessionStore.list(),
    session_cache: sessionResult.cache,
    connection_generation: sessionResult.cache.connection_generation,
    ...sessionStore.sessionPointers(),
  };
}

async function resolveTmwdContext(args, options = {}) {
  const { healthStore } = runtimeServices(options);
  const transport = resolveTmwdTransport(args?.tmwd_transport);
  const attempts = [];
  const order = transport === "auto"
    ? healthStore.preferredOrder(args)
    : [{ transport, reason: "forced_transport" }];
  for (const candidate of order) {
    try {
      const resolved = candidate.transport === "ws"
        ? await resolveTmwdContextViaWs(args, options)
        : await resolveTmwdContextViaLink(args, options);
      healthStore.record(args, candidate.transport, true, { endpoint: resolved.endpoint });
      return {
        ...resolved,
        transport_attempts: [
          ...attempts,
          {
            transport: candidate.transport,
            status: "ok",
            reason: candidate.reason,
            health: candidate.health,
          },
        ],
      };
    } catch (error) {
      healthStore.record(args, candidate.transport, false, { error: error?.message });
      attempts.push({
        transport: candidate.transport,
        status: "error",
        reason: candidate.reason,
        health: candidate.health,
        message: String(error?.message ?? error),
      });
      if (transport !== "auto") {
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

async function resolvePreferredBrowserContext(args, options = {}) {
  const mode = resolveTmwdMode(args?.tmwd_mode);
  if (mode === "cdp") {
    const context = await resolveTarget(args, options);
    return {
      transport: "cdp",
      context,
      transport_attempts: [
        { transport: "cdp", status: "ok", reason: "forced_mode" },
      ],
    };
  }
  try {
    const context = await resolveTmwdContext(args, { ...options, probe: mode === "auto" });
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
    const context = await resolveTarget(args, options);
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

async function resolveTmwdContextWithTransport(args, transport, sessionIdHint, options = {}) {
  const contextArgs = {
    ...args,
    session_id: sessionIdHint || normalizeIdToken(args?.session_id ?? args?.sessionId),
    tmwd_transport: transport,
  };
  if (transport === "ws") {
    return resolveTmwdContextViaWs(contextArgs, { ...options, probe: false });
  }
  return resolveTmwdContextViaLink(contextArgs, { ...options, probe: false });
}

export {
  resolvePreferredBrowserContext,
  resolveTmwdContext,
  resolveTmwdContextViaLink,
  resolveTmwdContextViaWs,
  resolveTmwdContextWithTransport,
};
