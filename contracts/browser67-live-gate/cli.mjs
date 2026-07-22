import { DEFAULT_EVENT_LOG_PATH } from "./paths.mjs";
import { normalizeTmwdMode } from "./modes.mjs";

function parseArgs(argv) {
  const parsed = {
    timeout_ms: 12_000,
    tmwd_mode: "auto",
    tmwd_transport: "auto",
    tmwd_ws_endpoint: "ws://127.0.0.1:18765",
    tmwd_link_endpoint: "http://127.0.0.1:18766/link",
    cdp_endpoint: "http://127.0.0.1:9222",
    target_tab_id: "",
    target_url_contains: "",
    require_cookie: false,
    allow_empty_tabs: false,
    doctor_only: false,
    force_live: false,
    ensure_tmwd_hub: true,
    ensure_tmwd_hub_wait_ms: 4_000,
    session_ready_wait_ms: 6_000,
    event_log_enabled: String(process.env.BROWSER_LIVE_GATE_LOG_ENABLED ?? "1").trim() !== "0",
    event_log_path: String(process.env.BROWSER_LIVE_GATE_LOG_PATH ?? DEFAULT_EVENT_LOG_PATH).trim() || DEFAULT_EVENT_LOG_PATH,
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
      parsed.tmwd_mode = normalizeTmwdMode(argv[index + 1]);
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
    if (token === "--cdp-endpoint") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --cdp-endpoint value");
      }
      parsed.cdp_endpoint = value;
      index += 1;
      continue;
    }
    if (token === "--target-url-contains") {
      parsed.target_url_contains = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--target-tab-id") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --target-tab-id value");
      }
      parsed.target_tab_id = value;
      index += 1;
      continue;
    }
    if (token === "--require-cookie") {
      parsed.require_cookie = true;
      continue;
    }
    if (token === "--allow-empty-tabs") {
      parsed.allow_empty_tabs = true;
      continue;
    }
    if (token === "--doctor-only") {
      parsed.doctor_only = true;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--force-live") {
      parsed.force_live = true;
      continue;
    }
    if (token === "--no-ensure-tmwd-hub") {
      parsed.ensure_tmwd_hub = false;
      continue;
    }
    if (token === "--ensure-tmwd-hub-wait-ms") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("invalid --ensure-tmwd-hub-wait-ms value");
      }
      parsed.ensure_tmwd_hub_wait_ms = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--session-ready-wait-ms") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("invalid --session-ready-wait-ms value");
      }
      parsed.session_ready_wait_ms = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--disable-event-log") {
      parsed.event_log_enabled = false;
      continue;
    }
    if (token === "--event-log-path") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --event-log-path value");
      }
      parsed.event_log_path = value;
      index += 1;
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
