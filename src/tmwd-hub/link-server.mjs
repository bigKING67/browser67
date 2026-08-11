import { createServer } from "node:http";

import { extensionRuntimeInfo } from "./extension-identity.mjs";
import { relayExecToExtension } from "./relay.mjs";
import {
  clearDefaultBrowserInstance,
  findSessions,
  listActiveSessions,
  listBrowserInstances,
  pickSession,
  resolveBrowserInstance,
  setDefaultBrowserInstance,
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
    try {
      const browserInstanceId = resolveBrowserInstance(
        hub,
        payload.browser_instance_id ?? payload.browserInstanceId,
      );
      respondJson(res, 200, {
        r: listActiveSessions(hub, config.sessionTtlMs).filter((session) => (
          session.browser_instance_id === browserInstanceId
        )),
      });
    } catch (error) {
      respondJson(res, 200, {
        r: {
          error: toSerializableError(error).message,
          errorCode: error?.errorCode,
          details: error?.details,
        },
      });
    }
    return;
  }

  if (cmd === "get_runtime_info") {
    respondJson(res, 200, { r: extensionRuntimeInfo(hub) });
    return;
  }

  if (cmd === "find_session") {
    try {
      respondJson(res, 200, {
        r: findSessions(
          hub,
          config.sessionTtlMs,
          payload.url_pattern,
          payload.browser_instance_id ?? payload.browserInstanceId,
        ),
      });
    } catch (error) {
      respondJson(res, 200, {
        r: {
          error: toSerializableError(error).message,
          errorCode: error?.errorCode,
          details: error?.details,
        },
      });
    }
    return;
  }

  if (cmd === "browser_instance_ops") {
    const action = String(payload.action ?? "list").trim();
    if (action === "set_default") {
      setDefaultBrowserInstance(hub, payload.browser_instance_id);
    } else if (action === "clear_default") {
      clearDefaultBrowserInstance(hub);
    } else if (action !== "list") {
      respondJson(res, 200, { r: { ok: false, error: `unknown browser instance action: ${action}` } });
      return;
    }
    respondJson(res, 200, {
      r: {
        ok: true,
        default_browser_instance_id: hub.defaultBrowserInstanceId || null,
        browser_instances: listBrowserInstances(hub),
      },
    });
    return;
  }

  if (cmd === "execute_js") {
    await handleExecuteJs(hub, config, res, payload);
    return;
  }

  respondJson(res, 200, { r: { ok: false, error: `unknown cmd: ${cmd}` } });
}

async function handleExecuteJs(hub, config, res, payload) {
  let session;
  try {
    session = pickSession(
      hub,
      config.sessionTtlMs,
      payload.sessionId,
      payload.browser_instance_id ?? payload.browserInstanceId,
    );
  } catch (error) {
    respondJson(res, 200, {
      r: {
        error: toSerializableError(error).message,
        errorCode: error?.errorCode,
        details: error?.details,
      },
    });
    return;
  }
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
      browserInstanceId: session.browser_instance_id,
      sessionId: session.tab_id,
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
