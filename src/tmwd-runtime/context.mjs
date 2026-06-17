import {
  normalizeTimeoutMs,
  normalizeTmwdWsEndpoint,
  resolveTmwdMode,
  resolveTmwdTransport,
} from "../common.mjs";
import { resolveTarget } from "../cdp-runtime.mjs";
import { withTransportAttempts } from "../errors.mjs";
import {
  listSessionsSnapshot,
  markSessionSelected,
  normalizeIdToken,
  selectTargetFromCandidates,
  sessionPointers,
  syncSessionRegistry,
} from "../session-registry.mjs";
import { callTmwdLink } from "./link.mjs";
import { normalizeTmwdSessions } from "./session-normalization.mjs";
import { listTmwdWsSessions } from "./ws.mjs";

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

export {
  resolvePreferredBrowserContext,
  resolveTmwdContext,
  resolveTmwdContextViaLink,
  resolveTmwdContextViaWs,
  resolveTmwdContextWithTransport,
};
