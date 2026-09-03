import { normalizeTimeoutMs } from "../runtime/config/limits.mjs";
import { createOperationDeadline } from "../runtime/operation-deadline.mjs";
import { appendTransportAttempt } from "../runtime/transport-attempts.mjs";
import {
  classifyBrowserErrorCode,
  shouldFallbackAcrossTmwdTransports,
  withTransportAttempts,
} from "../runtime/tool-errors.mjs";
import { callTmwdLink } from "./link.mjs";
import { resolveTmwdContextWithTransport } from "./context.mjs";
import { defaultTmwdTransportHealthStore } from "./health.mjs";
import { defaultTmwdWsRuntime } from "./ws.mjs";

function runtimeServices(options = {}) {
  return {
    healthStore: options.runtime?.transportHealth ?? options.transportHealth ?? defaultTmwdTransportHealthStore,
    wsRuntime: options.runtime?.tmwdWsRuntime ?? options.tmwdWsRuntime ?? defaultTmwdWsRuntime,
  };
}

async function executeTmwdJs(args, tmwdContext, code, options = {}) {
  const timeoutMs = normalizeTimeoutMs(args?.timeout_ms);
  if (tmwdContext.tmwd_transport === "ws") {
    const targetTabId = tmwdContext.target.tab_id ?? tmwdContext.target.id;
    const numericTargetTabId = Number(targetTabId);
    const bridgeTabId = Number.isFinite(numericTargetTabId)
      ? numericTargetTabId
      : targetTabId;
    const codePayload = typeof code === "object" && code !== null
      ? { ...code, tabId: code.tabId ?? bridgeTabId }
      : String(code ?? "");
    const response = await runtimeServices(options).wsRuntime.send(
      {
        ...args,
        tmwd_ws_endpoint: tmwdContext.endpoint,
      },
      {
        browser_instance_id: tmwdContext.target.browser_instance_id,
        tabId: bridgeTabId,
        code: codePayload,
        monitorNewTabs: args?.no_monitor !== true,
      },
      timeoutMs,
    );
    const raw = response.success
      ? { ok: true, data: response.result, newTabs: response.newTabs }
      : {
        ok: false,
        error: response.error,
        errorCode: response.errorCode,
        details: response.details,
        result: response.result,
        newTabs: response.newTabs,
      };
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
  const remoteExecutionTimeoutMs = Math.max(100, timeoutMs - 250);
  const timeoutSecs = Number((remoteExecutionTimeoutMs / 1000).toFixed(2));
  const exec = await callTmwdLink(
    {
      ...args,
      tmwd_link_endpoint: tmwdContext.endpoint,
    },
    {
      cmd: "execute_js",
      sessionId: tmwdContext.target.tab_id ?? tmwdContext.target.id,
      browser_instance_id: tmwdContext.target.browser_instance_id,
      code,
      timeout: String(timeoutSecs),
      monitorNewTabs: args?.no_monitor !== true,
    },
    timeoutMs,
  );
  const raw = exec.value;
  if (raw && typeof raw === "object" && typeof raw.error === "string" && raw.error.length > 0) {
    throw Object.assign(new Error(raw.error), {
      errorCode: raw.errorCode,
      details: raw.details,
    });
  }
  return {
    raw,
    value: raw?.data ?? raw?.result ?? raw,
    newTabs: Array.isArray(raw?.newTabs) ? raw.newTabs : [],
  };
}

async function executeTmwdJsWithFallback(args, tmwdContext, codePayload, options = {}) {
  const { healthStore } = runtimeServices(options);
  const deadline = createOperationDeadline(args?.timeout_ms);
  const attempts = [];
  const initialTransport = tmwdContext.tmwd_transport === "ws" ? "ws" : "link";
  const runExecute = async (context, transport, reason) => {
    try {
      const executed = await executeTmwdJs(
        {
          ...deadline.argsFor(args, `${transport}_execute`),
          browser_instance_id: context.target.browser_instance_id ?? args?.browser_instance_id,
          session_id: context.target.tab_id ?? context.target.id,
        },
        context,
        codePayload,
        options,
      );
      healthStore.record(args, transport, true, { endpoint: context.endpoint });
      appendTransportAttempt(attempts, transport, "execute", "ok", { reason });
      return {
        executed,
        context,
      };
    } catch (error) {
      healthStore.record(args, transport, false, {
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
      fallbackContext = await resolveTmwdContextWithTransport(
        {
          ...deadline.argsFor(args, `${fallbackTransport}_resolve_context`),
          browser_instance_id: tmwdContext.target.browser_instance_id ?? args?.browser_instance_id,
        },
        fallbackTransport,
        tmwdContext.target.tab_id ?? tmwdContext.target.id,
        options,
      );
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
