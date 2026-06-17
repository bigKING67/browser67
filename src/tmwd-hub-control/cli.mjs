import {
  DEFAULT_TMWD_LINK_ENDPOINT,
  DEFAULT_TMWD_WS_ENDPOINT,
  defaultStatePath,
} from "./paths.mjs";

function readPositiveIntegerOption(argv, index, optionName) {
  const value = Number(argv[index + 1] ?? "");
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`invalid ${optionName} value`);
  }
  return Math.floor(value);
}

function readNonEmptyStringOption(argv, index, optionName) {
  const value = String(argv[index + 1] ?? "").trim();
  if (!value) {
    throw new Error(`invalid ${optionName} value`);
  }
  return value;
}

function parseArgs(argv) {
  const command = String(argv[0] ?? "").trim().toLowerCase();
  const parsed = {
    command,
    json: false,
    wait_ms: 4_000,
    timeout_ms: 800,
    tmwd_ws_endpoint: DEFAULT_TMWD_WS_ENDPOINT,
    tmwd_link_endpoint: DEFAULT_TMWD_LINK_ENDPOINT,
    state_file: defaultStatePath,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--wait-ms") {
      parsed.wait_ms = readPositiveIntegerOption(argv, index, "--wait-ms");
      index += 1;
      continue;
    }
    if (token === "--timeout-ms") {
      parsed.timeout_ms = readPositiveIntegerOption(argv, index, "--timeout-ms");
      index += 1;
      continue;
    }
    if (token === "--tmwd-ws-endpoint") {
      parsed.tmwd_ws_endpoint = readNonEmptyStringOption(argv, index, "--tmwd-ws-endpoint");
      index += 1;
      continue;
    }
    if (token === "--tmwd-link-endpoint") {
      parsed.tmwd_link_endpoint = readNonEmptyStringOption(argv, index, "--tmwd-link-endpoint");
      index += 1;
      continue;
    }
    if (token === "--state-file") {
      parsed.state_file = readNonEmptyStringOption(argv, index, "--state-file");
      index += 1;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!["start", "stop", "status"].includes(parsed.command)) {
    throw new Error("usage: tmwd-hub-control.mjs <start|stop|status> [options]");
  }
  return parsed;
}

export {
  parseArgs,
};
