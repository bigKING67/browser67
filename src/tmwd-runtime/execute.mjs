import { normalizeTimeoutMs } from "../runtime/config/limits.mjs";
import { appendTransportAttempt } from "../runtime/transport-attempts.mjs";
import {
  classifyBrowserErrorCode,
  shouldFallbackAcrossTmwdTransports,
  withTransportAttempts,
} from "../errors.mjs";
import { callTmwdLink } from "./link.mjs";
import { resolveTmwdContextWithTransport } from "./context.mjs";
import { recordTmwdTransportResult } from "./health.mjs";
import { sendTmwdWsRequest } from "./ws.mjs";

async function executeTmwdJs(args, tmwdContext, code) {
  const timeoutMs = normalizeTimeoutMs(args?.timeout_ms);
  if (tmwdContext.tmwd_transport === "ws") {
    const numericTargetTabId = Number(tmwdContext.target.id);
    const bridgeTabId = Number.isFinite(numericTargetTabId)
      ? numericTargetTabId
      : tmwdContext.target.id;
    const codePayload = typeof code === "object" && code !== null
      ? { ...code, tabId: code.tabId ?? bridgeTabId }
      : String(code ?? "");
    const response = await sendTmwdWsRequest(
      {
        ...args,
        tmwd_ws_endpoint: tmwdContext.endpoint,
      },
      {
        tabId: bridgeTabId,
        code: codePayload,
        monitorNewTabs: args?.no_monitor !== true,
      },
      Math.max(500, timeoutMs + 2_000),
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
      monitorNewTabs: args?.no_monitor !== true,
    },
    Math.max(500, timeoutMs + 2_000),
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
      recordTmwdTransportResult(args, transport, true, { endpoint: context.endpoint });
      appendTransportAttempt(attempts, transport, "execute", "ok", { reason });
      return {
        executed,
        context,
      };
    } catch (error) {
      recordTmwdTransportResult(args, transport, false, {
        endpoint: context.endpoint,
        error: error?.message,
      });
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
};
