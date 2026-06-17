function parseArgs(argv) {
  const parsed = {
    timeout_ms: 12_000,
    tmwd_transport: "auto",
    tmwd_ws_endpoint: "ws://127.0.0.1:18765",
    tmwd_link_endpoint: "http://127.0.0.1:18766/link",
    allow_empty_tabs: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--timeout-ms") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("invalid --timeout-ms value");
      }
      parsed.timeout_ms = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--tmwd-mode") {
      const mode = String(argv[index + 1] ?? "").trim().toLowerCase();
      if (mode !== "tmwd") {
        throw new Error("js-reverse live gate requires --tmwd-mode tmwd");
      }
      index += 1;
      continue;
    }
    if (token === "--tmwd-transport") {
      const value = String(argv[index + 1] ?? "").trim().toLowerCase();
      if (value !== "auto" && value !== "ws" && value !== "link") {
        throw new Error("invalid --tmwd-transport value");
      }
      parsed.tmwd_transport = value;
      index += 1;
      continue;
    }
    if (token === "--tmwd-ws-endpoint") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --tmwd-ws-endpoint value");
      }
      parsed.tmwd_ws_endpoint = value;
      index += 1;
      continue;
    }
    if (token === "--tmwd-link-endpoint") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --tmwd-link-endpoint value");
      }
      parsed.tmwd_link_endpoint = value;
      index += 1;
      continue;
    }
    if (token === "--allow-empty-tabs") {
      parsed.allow_empty_tabs = true;
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
