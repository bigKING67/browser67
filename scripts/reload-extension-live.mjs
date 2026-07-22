#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";

import { normalizeTmwdWsEndpoint } from "../src/runtime/config/endpoints.mjs";

function parseArgs(argv) {
  const parsed = {
    endpoint: normalizeTmwdWsEndpoint(process.env.BROWSER_STRUCTURED_TMWD_WS_ENDPOINT),
    timeoutMs: 5_000,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--ws-endpoint") {
      parsed.endpoint = normalizeTmwdWsEndpoint(requiredValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--timeout-ms") {
      parsed.timeoutMs = normalizeTimeoutMs(requiredValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function requiredValue(argv, index, token) {
  const value = String(argv[index + 1] ?? "").trim();
  if (!value || value.startsWith("--")) {
    throw new Error(`missing ${token} value`);
  }
  return value;
}

function normalizeTimeoutMs(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 500 || value > 30_000) {
    throw new Error("--timeout-ms must be between 500 and 30000");
  }
  return Math.floor(value);
}

function usage() {
  return [
    "Usage: node scripts/reload-extension-live.mjs [--ws-endpoint <url>] [--timeout-ms <ms>] [--json]",
    "",
    "Schedules a self-reload of the currently connected browser67 extension.",
    "Run npm run setup first so the unpacked extension directory contains current files.",
  ].join("\n");
}

function toErrorMessage(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value) {
    return String(value.message);
  }
  return JSON.stringify(value ?? "unknown extension reload error");
}

function reloadBrowser67Extension(options = {}) {
  const endpoint = normalizeTmwdWsEndpoint(
    options.endpoint ?? process.env.BROWSER_STRUCTURED_TMWD_WS_ENDPOINT,
  );
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs ?? 5_000);
  const requestId = `browser67_reload_${randomUUID()}`;

  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(endpoint);
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`extension reload timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      try {
        socket.close();
      } catch {
        // The socket may already be closed by the extension reload.
      }
      if (error) {
        rejectPromise(error);
      } else {
        resolvePromise(value);
      }
    }

    socket.once("open", () => {
      socket.send(JSON.stringify({
        id: requestId,
        tabId: 1,
        code: { cmd: "management", method: "reload" },
      }));
    });
    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (String(message?.id ?? "") !== requestId || message?.type === "ack") {
        return;
      }
      if (message?.type !== "result" || message?.result?.ok !== true) {
        finish(new Error(toErrorMessage(message?.error ?? message?.result)));
        return;
      }
      finish(null, {
        ok: true,
        status: "reload_scheduled",
        endpoint,
        request_id: requestId,
        next_steps: [
          "Wait for the extension to reconnect to the browser67 Hub.",
          "Refresh existing target tabs when content-script changes must be reinjected.",
          "Run: npm run check:live:doctor",
        ],
      });
    });
    socket.once("error", (error) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
    socket.once("close", () => {
      if (!settled) {
        finish(new Error("extension reload connection closed before confirmation"));
      }
    });
  });
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const result = await reloadBrowser67Extension({
    endpoint: args.endpoint,
    timeoutMs: args.timeoutMs,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }
  process.stdout.write(`browser67 extension reload scheduled through ${result.endpoint}\n`);
  for (const step of result.next_steps) {
    process.stdout.write(`  - ${step}\n`);
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("reload-extension-live.mjs")) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`reload-extension-live failed: ${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  }
}

export {
  main,
  parseArgs,
  reloadBrowser67Extension,
};
