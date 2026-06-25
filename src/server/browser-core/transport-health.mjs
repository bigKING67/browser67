import { performance } from "node:perf_hooks";

import {
  normalizeTmwdLinkEndpoint,
  normalizeTmwdWsEndpoint,
} from "../../common.mjs";
import { classifyBrowserErrorCode } from "../../errors.mjs";
import { resolveTmwdContextWithTransport } from "../../tmwd-runtime.mjs";

async function probeTransport(args, transport) {
  const started = performance.now();
  try {
    const context = await resolveTmwdContextWithTransport(
      {
        ...args,
        tmwd_mode: "tmwd",
        tmwd_transport: transport,
        timeout_ms: Math.min(Number(args.timeout_ms ?? 1_500), 3_000),
      },
      transport,
      args.session_id,
    );
    return {
      transport,
      status: "ok",
      latency_ms: Math.round(performance.now() - started),
      endpoint: context.endpoint,
      pages_count: Array.isArray(context.targets) ? context.targets.length : 0,
      selected_tab_id: context.target?.id,
      selected_url: context.target?.url,
    };
  } catch (error) {
    const message = String(error?.message ?? error);
    return {
      transport,
      status: "error",
      latency_ms: Math.round(performance.now() - started),
      endpoint: transport === "ws"
        ? normalizeTmwdWsEndpoint(args.tmwd_ws_endpoint)
        : normalizeTmwdLinkEndpoint(args.tmwd_link_endpoint),
      error: message,
      error_code: classifyBrowserErrorCode(message),
    };
  }
}

function healthFromResults(results) {
  const okCount = results.filter((item) => item.status === "ok").length;
  if (okCount === results.length && okCount > 0) return "healthy";
  if (okCount > 0) return "degraded";
  return "broken";
}

function suggestionFromHealth(health, results) {
  if (health === "healthy") {
    return "transport_ready";
  }
  if (health === "degraded") {
    return "prefer_available_transport_and_check_extension_or_hub_for_failed_path";
  }
  const codes = results.map((item) => item.error_code).filter(Boolean);
  if (codes.includes("TIMEOUT")) {
    return "check_tmwd_hub_extension_and_ws_link_endpoint_timeouts";
  }
  return "start_or_reconnect_tmwd_hub_reload_extension_then_retry";
}

async function handleBrowserTransportHealth(args = {}) {
  const transport = String(args.tmwd_transport ?? "auto");
  const transports = transport === "ws" || transport === "link" ? [transport] : ["ws", "link"];
  const results = [];
  for (const item of transports) {
    results.push(await probeTransport(args, item));
  }
  const health = healthFromResults(results);
  return {
    ok: health !== "broken",
    status: health,
    checked_at: new Date().toISOString(),
    mode: "tmwd",
    transports: results,
    preferred_transport: results.find((item) => item.status === "ok")?.transport ?? null,
    suggestion: suggestionFromHealth(health, results),
  };
}

export {
  handleBrowserTransportHealth,
};
