import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { DEFAULT_EVENT_LOG_PATH } from "./paths.mjs";

function appendGateEvent(config, payload) {
  if (config.event_log_enabled !== true) {
    return {
      enabled: false,
    };
  }
  const logPath = String(config.event_log_path ?? "").trim() || DEFAULT_EVENT_LOG_PATH;
  const record = {
    ts: new Date().toISOString(),
    mode: config.tmwd_mode,
    transport: config.tmwd_transport,
    payload,
  };
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
    return {
      enabled: true,
      ok: true,
      path: logPath,
    };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      path: logPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function emitAndReturn(config, payload) {
  const eventLog = appendGateEvent(config, payload);
  const output = {
    ...payload,
    event_log: eventLog,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (payload.ok !== true) {
    process.exitCode = 1;
  }
}

export {
  appendGateEvent,
  emitAndReturn,
};
