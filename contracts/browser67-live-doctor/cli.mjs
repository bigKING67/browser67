import { normalizeTmwdMode } from "../browser67-live-gate/modes.mjs";

function parsePositiveInteger(value, flag) {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid ${flag} value`);
  }
  return Math.floor(parsed);
}

function parseRequiredString(value, flag) {
  const parsed = String(value ?? "").trim();
  if (!parsed) {
    throw new Error(`invalid ${flag} value`);
  }
  return parsed;
}

function parseTmwdTransport(value) {
  const parsed = String(value ?? "").trim().toLowerCase();
  if (parsed !== "auto" && parsed !== "ws" && parsed !== "link") {
    throw new Error("invalid --tmwd-transport value");
  }
  return parsed;
}

function parseArgs(argv) {
  const parsed = {
    timeout_ms: 1_500,
    tmwd_mode: "auto",
    tmwd_transport: "auto",
    tmwd_ws_endpoint: "ws://127.0.0.1:18765",
    tmwd_link_endpoint: "http://127.0.0.1:18766/link",
    cdp_endpoint: "http://127.0.0.1:9222",
    allow_empty_tabs: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--timeout-ms") {
      parsed.timeout_ms = parsePositiveInteger(argv[index + 1], "--timeout-ms");
      index += 1;
      continue;
    }
    if (token === "--tmwd-mode") {
      parsed.tmwd_mode = normalizeTmwdMode(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--tmwd-transport") {
      parsed.tmwd_transport = parseTmwdTransport(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--tmwd-ws-endpoint") {
      parsed.tmwd_ws_endpoint = parseRequiredString(argv[index + 1], "--tmwd-ws-endpoint");
      index += 1;
      continue;
    }
    if (token === "--tmwd-link-endpoint") {
      parsed.tmwd_link_endpoint = parseRequiredString(argv[index + 1], "--tmwd-link-endpoint");
      index += 1;
      continue;
    }
    if (token === "--cdp-endpoint") {
      parsed.cdp_endpoint = parseRequiredString(argv[index + 1], "--cdp-endpoint");
      index += 1;
      continue;
    }
    if (token === "--allow-empty-tabs") {
      parsed.allow_empty_tabs = true;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

export {
  parseArgs,
};
