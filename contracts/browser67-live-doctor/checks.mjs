import { probeCdpHttp, probeCdpTargets } from "./cdp-probes.mjs";
import { trimTrailingSlash } from "./endpoints.mjs";
import {
  compareExtensionRuntimeIdentity,
  loadExpectedExtensionIdentity,
} from "./extension-identity.mjs";
import { probeTcp } from "./tcp-probe.mjs";
import {
  probeTmwdLinkHttp,
  probeTmwdLinkRuntimeInfo,
  probeTmwdWsApi,
  probeTmwdWsRuntimeInfo,
} from "./tmwd-probes.mjs";

function skippedLinkHttp(endpoint) {
  return {
    endpoint,
    ok: false,
    status: null,
    latency_ms: 0,
    session_count: 0,
    detail: "skipped_tcp_unreachable",
  };
}

function skippedWsApi(endpoint) {
  return {
    endpoint,
    ok: false,
    latency_ms: 0,
    tab_count: 0,
    detail: "skipped_tcp_unreachable",
  };
}

function skippedRuntimeInfo(endpoint) {
  return {
    endpoint,
    ok: false,
    latency_ms: 0,
    runtime_info: null,
    detail: "skipped_tcp_unreachable",
  };
}

function skippedCdpHttp(cdpEndpoint) {
  return {
    endpoint: `${trimTrailingSlash(cdpEndpoint)}/json/version`,
    ok: false,
    status: null,
    latency_ms: 0,
    detail: "skipped_tcp_unreachable",
  };
}

function skippedCdpTargets(cdpEndpoint) {
  return {
    endpoint: `${trimTrailingSlash(cdpEndpoint)}/json/list`,
    ok: false,
    status: null,
    latency_ms: 0,
    page_count: 0,
    detail: "skipped_tcp_unreachable",
  };
}

async function collectTcpChecks(cli) {
  const [
    tmwdWsTcp,
    tmwdLinkTcp,
    cdpTcp,
  ] = await Promise.all([
    probeTcp(cli.tmwd_ws_endpoint, cli.timeout_ms),
    probeTcp(cli.tmwd_link_endpoint, cli.timeout_ms),
    probeTcp(cli.cdp_endpoint, cli.timeout_ms),
  ]);
  return {
    tmwd_ws_tcp: tmwdWsTcp,
    tmwd_link_tcp: tmwdLinkTcp,
    cdp_tcp: cdpTcp,
  };
}

async function collectApplicationChecks(cli, tcpChecks) {
  const expectedExtensionIdentity = loadExpectedExtensionIdentity();
  const [
    tmwdLinkHttp,
    tmwdLinkRuntimeRaw,
    tmwdWsApi,
    tmwdWsRuntimeRaw,
    cdpHttp,
    cdpTargets,
  ] = await Promise.all([
    tcpChecks.tmwd_link_tcp.reachable
      ? probeTmwdLinkHttp(cli.tmwd_link_endpoint, cli.timeout_ms)
      : skippedLinkHttp(cli.tmwd_link_endpoint),
    tcpChecks.tmwd_link_tcp.reachable
      ? probeTmwdLinkRuntimeInfo(cli.tmwd_link_endpoint, cli.timeout_ms)
      : skippedRuntimeInfo(cli.tmwd_link_endpoint),
    tcpChecks.tmwd_ws_tcp.reachable
      ? probeTmwdWsApi(cli.tmwd_ws_endpoint, cli.timeout_ms)
      : skippedWsApi(cli.tmwd_ws_endpoint),
    tcpChecks.tmwd_ws_tcp.reachable
      ? probeTmwdWsRuntimeInfo(cli.tmwd_ws_endpoint, cli.timeout_ms)
      : skippedRuntimeInfo(cli.tmwd_ws_endpoint),
    tcpChecks.cdp_tcp.reachable
      ? probeCdpHttp(cli.cdp_endpoint, cli.timeout_ms)
      : skippedCdpHttp(cli.cdp_endpoint),
    tcpChecks.cdp_tcp.reachable
      ? probeCdpTargets(cli.cdp_endpoint, cli.timeout_ms)
      : skippedCdpTargets(cli.cdp_endpoint),
  ]);
  return {
    tmwd_link_http: tmwdLinkHttp,
    tmwd_link_runtime: compareExtensionRuntimeIdentity(
      tmwdLinkRuntimeRaw,
      expectedExtensionIdentity,
    ),
    tmwd_ws_api: tmwdWsApi,
    tmwd_ws_runtime: compareExtensionRuntimeIdentity(
      tmwdWsRuntimeRaw,
      expectedExtensionIdentity,
    ),
    cdp_http: cdpHttp,
    cdp_targets: cdpTargets,
  };
}

async function collectDoctorChecks(cli) {
  const tcpChecks = await collectTcpChecks(cli);
  const applicationChecks = await collectApplicationChecks(cli, tcpChecks);
  return {
    ...tcpChecks,
    ...applicationChecks,
  };
}

export {
  collectDoctorChecks,
};
