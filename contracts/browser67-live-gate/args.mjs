function buildCommonArgs(config) {
  return [
    "--timeout-ms", String(config.timeout_ms),
    "--tmwd-mode", config.tmwd_mode,
    "--tmwd-transport", config.tmwd_transport,
    "--tmwd-ws-endpoint", config.tmwd_ws_endpoint,
    "--tmwd-link-endpoint", config.tmwd_link_endpoint,
    "--cdp-endpoint", config.cdp_endpoint,
  ];
}

function buildDoctorArgs(config) {
  const args = [...buildCommonArgs(config)];
  if (config.allow_empty_tabs) {
    args.push("--allow-empty-tabs");
  }
  return args;
}

function buildLiveArgs(config) {
  const args = [...buildCommonArgs(config)];
  if (config.target_url_contains) {
    args.push("--target-url-contains", config.target_url_contains);
  }
  if (config.require_cookie) {
    args.push("--require-cookie");
  }
  return args;
}

export {
  buildCommonArgs,
  buildDoctorArgs,
  buildLiveArgs,
};
