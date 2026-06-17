function parsePositiveInteger(value, flag) {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid ${flag} value`);
  }
  return Math.floor(parsed);
}

function parseArgs(argv) {
  const parsed = {
    timeout_ms: 15_000,
    tmwd_mode: "tmwd",
    tmwd_transport: "auto",
    tmwd_ws_endpoint: "ws://127.0.0.1:18765",
    tmwd_link_endpoint: "http://127.0.0.1:18766/link",
    cdp_endpoint: "http://127.0.0.1:9222",
    require_tabs_get: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--timeout-ms") {
      parsed.timeout_ms = parsePositiveInteger(argv[index + 1], "--timeout-ms");
      index += 1;
      continue;
    }
    if (token === "--tmwd-mode") {
      parsed.tmwd_mode = String(argv[index + 1] ?? "").trim() || "tmwd";
      index += 1;
      continue;
    }
    if (token === "--tmwd-transport") {
      parsed.tmwd_transport = String(argv[index + 1] ?? "").trim() || "auto";
      index += 1;
      continue;
    }
    if (token === "--tmwd-ws-endpoint") {
      parsed.tmwd_ws_endpoint = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--tmwd-link-endpoint") {
      parsed.tmwd_link_endpoint = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--cdp-endpoint") {
      parsed.cdp_endpoint = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--require-tabs-get") {
      parsed.require_tabs_get = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function commonArgs(cli) {
  return {
    tmwd_mode: cli.tmwd_mode,
    tmwd_transport: cli.tmwd_transport,
    tmwd_ws_endpoint: cli.tmwd_ws_endpoint,
    tmwd_link_endpoint: cli.tmwd_link_endpoint,
    cdp_endpoint: cli.cdp_endpoint,
    timeout_ms: cli.timeout_ms,
  };
}

export {
  commonArgs,
  parseArgs,
};
