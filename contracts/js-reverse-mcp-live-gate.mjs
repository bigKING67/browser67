#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { firstJsonContent } from "./browser-structured-mcp-contract/rpc-content.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const jsReverseServerPath = resolve(repoRoot, "src/js-reverse-server.mjs");

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

function createRpcClient() {
  const child = spawn("node", [jsReverseServerPath], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let nextId = 1;
  const pending = new Map();
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let closed = false;

  const rejectAll = (message) => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timeoutHandle);
      entry.reject(new Error(message));
    }
    pending.clear();
  };

  if (child.stdout) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      while (true) {
        const newlineIndex = stdoutBuffer.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const id = parsed?.id;
        if (!pending.has(id)) {
          continue;
        }
        const entry = pending.get(id);
        pending.delete(id);
        clearTimeout(entry.timeoutHandle);
        entry.resolve(parsed);
      }
    });
  }

  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk;
    });
  }

  child.on("error", (error) => {
    rejectAll(`js-reverse process error: ${String(error)}`);
  });

  child.on("close", (code, signal) => {
    closed = true;
    rejectAll(
      `js-reverse exited code=${String(code)} signal=${String(signal)} stderr=${stderrBuffer}`,
    );
  });

  const call = (method, params = {}, timeoutMs = 12_000) => {
    if (closed || !child.stdin) {
      return Promise.reject(new Error("js-reverse process is not available"));
    }
    const id = `js_reverse_live_${String(nextId++)}`;
    return new Promise((resolvePromise, rejectPromise) => {
      const timeoutHandle = setTimeout(() => {
        pending.delete(id);
        rejectPromise(
          new Error(`rpc timeout method=${method} id=${id} timeout_ms=${String(timeoutMs)}`),
        );
      }, timeoutMs);
      pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timeoutHandle,
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };

  const notify = (method, params = {}) => {
    if (closed || !child.stdin) {
      return;
    }
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  };

  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    rejectAll("js-reverse closing");
    child.kill("SIGTERM");
    await new Promise((resolveClose) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 1_000);
      child.once("close", () => {
        clearTimeout(timer);
        resolveClose();
      });
    });
  };

  return { call, notify, close };
}

function summarizeToolError(name, response) {
  const payload = firstJsonContent(response?.result);
  return `${name} failed ok=${String(payload?.ok)} readiness=${String(payload?.readiness?.reason ?? "")} error=${String(payload?.error ?? "")}`;
}

async function callTool(rpc, name, args, timeoutMs) {
  const response = await rpc.call(
    "tools/call",
    {
      name,
      arguments: args,
    },
    timeoutMs,
  );
  if (response?.result?.isError === true) {
    throw new Error(summarizeToolError(name, response));
  }
  const payload = firstJsonContent(response.result);
  if (!payload || typeof payload !== "object") {
    throw new Error(`${name} returned no json payload`);
  }
  return payload;
}

async function run() {
  const cli = parseArgs(process.argv.slice(2));
  const rpc = createRpcClient();
  try {
    const init = await rpc.call(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "js-reverse-mcp-live-gate",
          version: "1.0.0",
        },
      },
      cli.timeout_ms,
    );
    assert.equal(init?.result?.serverInfo?.name, "js-reverse");
    rpc.notify("notifications/initialized", {});

    const commonArgs = {
      tmwd_mode: "tmwd",
      tmwd_transport: cli.tmwd_transport,
      tmwd_ws_endpoint: cli.tmwd_ws_endpoint,
      tmwd_link_endpoint: cli.tmwd_link_endpoint,
      timeout_ms: cli.timeout_ms,
    };

    const health = await callTool(rpc, "check_browser_health", commonArgs, cli.timeout_ms);
    assert.equal(health?.ok, true);
    if (!cli.allow_empty_tabs) {
      assert.equal(health?.readiness?.ready, true);
    }

    const pagesPayload = await callTool(rpc, "list_pages", commonArgs, cli.timeout_ms);
    const pages = Array.isArray(pagesPayload?.pages) ? pagesPayload.pages : [];
    if (!cli.allow_empty_tabs) {
      assert.equal(pages.length > 0, true);
    }

    const scriptsPayload = pages.length > 0
      ? await callTool(rpc, "list_scripts", commonArgs, cli.timeout_ms)
      : { scripts: [] };
    const scripts = Array.isArray(scriptsPayload?.scripts) ? scriptsPayload.scripts : [];

    const networkPayload = pages.length > 0
      ? await callTool(rpc, "list_network_requests", commonArgs, cli.timeout_ms)
      : { requests: [] };
    const requests = Array.isArray(networkPayload?.requests) ? networkPayload.requests : [];

    process.stdout.write(`${JSON.stringify({
      ok: true,
      stage: "js_reverse_live_passed",
      transport: health.transport,
      readiness_reason: health.readiness?.reason,
      pages_count: pages.length,
      scripts_count: scripts.length,
      requests_count: requests.length,
      tmwd_transport: cli.tmwd_transport,
      tmwd_ws_endpoint: cli.tmwd_ws_endpoint,
      tmwd_link_endpoint: cli.tmwd_link_endpoint,
    })}\n`);
  } finally {
    await rpc.close();
  }
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`js-reverse-mcp-live-gate failed: ${message}\n`);
  process.exitCode = 1;
}
