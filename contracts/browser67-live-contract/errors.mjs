function toToolErrorSummary(payload) {
  if (!payload || typeof payload !== "object") {
    return "unknown payload";
  }
  const errorCode = String(payload.error_code ?? "");
  const error = String(payload.error ?? "");
  const transportAttempts = Array.isArray(payload.transport_attempts)
    ? payload.transport_attempts
    : [];
  return [
    `error_code=${errorCode || "<empty>"}`,
    `error=${error || "<empty>"}`,
    `transport_attempts=${JSON.stringify(transportAttempts)}`,
  ].join(" ");
}

function buildLivePrereqHint(cli) {
  return [
    `mode=${cli.tmwd_mode}`,
    `transport=${cli.tmwd_transport}`,
    `tmwd_ws=${cli.tmwd_ws_endpoint}`,
    `tmwd_link=${cli.tmwd_link_endpoint}`,
    `cdp=${cli.cdp_endpoint}`,
    "ensure tmwd-hub is running (`npm run hub:start`) and/or remote-debugging CDP is available.",
  ].join(" ");
}

export {
  buildLivePrereqHint,
  toToolErrorSummary,
};
