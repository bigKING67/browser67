import { isRemoteCdpMode } from "../browser67-live-gate/modes.mjs";

function evaluateModeReadiness(cli, checks) {
  const allowEmpty = cli.allow_empty_tabs === true;
  const wsReady = checks.tmwd_ws_api.ok === true
    && checks.tmwd_ws_runtime.ok === true
    && (allowEmpty || Number(checks.tmwd_ws_api.tab_count ?? 0) > 0);
  const linkReady = checks.tmwd_link_http.ok === true
    && checks.tmwd_link_runtime.ok === true
    && (allowEmpty || Number(checks.tmwd_link_http.session_count ?? 0) > 0);
  const cdpReady = checks.cdp_http.ok === true
    && checks.cdp_targets.ok === true
    && (allowEmpty || Number(checks.cdp_targets.page_count ?? 0) > 0);
  const tmwdReady = cli.tmwd_transport === "ws"
    ? wsReady
    : (cli.tmwd_transport === "link" ? linkReady : (wsReady || linkReady));
  const wsTransportReady = checks.tmwd_ws_api.ok === true
    && (allowEmpty || Number(checks.tmwd_ws_api.tab_count ?? 0) > 0);
  const linkTransportReady = checks.tmwd_link_http.ok === true
    && (allowEmpty || Number(checks.tmwd_link_http.session_count ?? 0) > 0);
  const tmwdIdentityUnverified = (wsTransportReady && checks.tmwd_ws_runtime.ok !== true)
    || (linkTransportReady && checks.tmwd_link_runtime.ok !== true);

  if (cli.tmwd_mode === "tmwd") {
    return {
      ready: tmwdReady,
      reason: tmwdReady
        ? "tmwd_transport_ready"
        : (tmwdIdentityUnverified
          ? "tmwd_extension_identity_unverified"
          : (cli.tmwd_transport === "ws" ? "tmwd_ws_unavailable" : (cli.tmwd_transport === "link" ? "tmwd_link_unavailable" : "tmwd_no_route"))),
      path: cli.tmwd_transport === "auto"
        ? (wsReady ? "tmwd_ws" : (linkReady ? "tmwd_link" : "none"))
        : `tmwd_${cli.tmwd_transport}`,
    };
  }
  if (isRemoteCdpMode(cli.tmwd_mode)) {
    return {
      ready: cdpReady,
      reason: cdpReady ? "cdp_ready" : "cdp_unavailable",
      path: "cdp",
    };
  }
  return {
    ready: tmwdReady || cdpReady,
    reason: tmwdReady || cdpReady ? "auto_has_route" : "auto_no_route",
    path: tmwdReady ? (wsReady ? "tmwd_ws" : "tmwd_link") : (cdpReady ? "cdp" : "none"),
  };
}

export {
  evaluateModeReadiness,
};
