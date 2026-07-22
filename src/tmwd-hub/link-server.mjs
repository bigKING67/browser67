import { createServer } from "node:http";

import { relayExecToExtension } from "./relay.mjs";
import {
  findSessions,
  listActiveSessions,
  pickSession,
} from "./sessions.mjs";
import { respondJson, toSerializableError } from "./socket-utils.mjs";
import { nowIso } from "./time.mjs";

function createLinkServer(hub, config) {
  return createServer((req, res) => {
    if (!req.url || !req.url.startsWith("/link")) {
      respondJson(res, 404, { error: "not found" });
      return;
    }

    if (req.method === "GET") {
      respondJson(res, 200, { ok: true, service: "tmwd-hub", at: nowIso() });
      return;
    }

    if (req.method !== "POST") {
      respondJson(res, 405, { error: "method not allowed" });
      return;
    }

    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", async () => {
      try {
        await handleLinkCommand(hub, config, res, chunks);
      } catch (error) {
        respondJson(res, 400, { error: toSerializableError(error) });
      }
    });
  });
}

async function handleLinkCommand(hub, config, res, chunks) {
  const raw = Buffer.concat(chunks).toString("utf8");
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const cmd = String(payload.cmd ?? "").trim();

  if (cmd === "get_all_sessions") {
    respondJson(res, 200, { r: listActiveSessions(hub, config.sessionTtlMs) });
    return;
  }

  if (cmd === "find_session") {
    respondJson(res, 200, { r: findSessions(hub, config.sessionTtlMs, payload.url_pattern) });
    return;
  }

  if (cmd === "execute_js") {
    await handleExecuteJs(hub, config, res, payload);
    return;
  }

  respondJson(res, 200, { r: { ok: false, error: `unknown cmd: ${cmd}` } });
}

async function handleExecuteJs(hub, config, res, payload) {
  const session = pickSession(hub, config.sessionTtlMs, payload.sessionId);
  if (!session) {
    respondJson(res, 200, { r: { error: "no active session available" } });
    return;
  }

  const timeoutSec = Number(payload.timeout ?? 10);
  const timeoutMs = Number.isFinite(timeoutSec)
    ? Math.max(500, Math.min(120_000, Math.floor(timeoutSec * 1000)))
    : config.requestTimeoutMs;

  let execResult;
  try {
    execResult = await relayExecToExtension(hub, {
      sessionId: session.id,
      code: payload.code,
      timeoutMs,
      monitorNewTabs: payload.monitorNewTabs !== false,
    });
  } catch (error) {
    respondJson(res, 200, { r: { error: toSerializableError(error).message } });
    return;
  }

  if (!execResult.ok) {
    respondJson(res, 200, {
      r: {
        error: execResult.error ?? "unknown extension error",
        newTabs: execResult.newTabs,
      },
    });
    return;
  }

  const resultPayload = {
    data: execResult.result,
  };
  if (Array.isArray(execResult.newTabs) && execResult.newTabs.length > 0) {
    resultPayload.newTabs = execResult.newTabs;
  }
  respondJson(res, 200, { r: resultPayload });
}

export {
  createLinkServer,
  handleExecuteJs,
  handleLinkCommand,
};
