#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const browserStructuredServerPath = resolve(
  repoRoot,
  "src/server.mjs",
);

function normalizeTmwdMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "auto" || normalized === "tmwd" || normalized === "remote_cdp" || normalized === "cdp") {
    return normalized;
  }
  throw new Error("invalid --tmwd-mode value (expected auto|tmwd|remote_cdp|cdp)");
}

function parseArgs(argv) {
  const parsed = {
    timeout_ms: 12_000,
    tmwd_mode: "auto",
    tmwd_transport: "auto",
    tmwd_ws_endpoint: "ws://127.0.0.1:18765",
    tmwd_link_endpoint: "http://127.0.0.1:18766/link",
    cdp_endpoint: "http://127.0.0.1:9222",
    target_url_contains: "",
    require_cookie: false,
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
    if (token === "--require-cookie") {
      parsed.require_cookie = true;
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
  const child = spawn("node", [browserStructuredServerPath], {
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
    rejectAll(`browser-structured-mcp process error: ${String(error)}`);
  });

  child.on("close", (code, signal) => {
    closed = true;
    rejectAll(
      `browser-structured-mcp exited code=${String(code)} signal=${String(signal)} stderr=${stderrBuffer}`,
    );
  });

  const call = (method, params = {}, timeoutMs = 12_000) => {
    if (closed || !child.stdin) {
      return Promise.reject(new Error("browser-structured-mcp process is not available"));
    }
    const id = `live_contract_${String(nextId++)}`;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    return new Promise((resolvePromise, rejectPromise) => {
      const timeoutHandle = setTimeout(() => {
        pending.delete(id);
        rejectPromise(new Error(`rpc timeout method=${method} id=${id} timeout_ms=${String(timeoutMs)}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timeoutHandle,
      });
      child.stdin.write(`${JSON.stringify(request)}\n`);
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
    rejectAll("browser-structured-mcp closing");
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

function firstJsonContent(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  for (const item of content) {
    if (item?.type === "json" && typeof item.json === "object" && item.json !== null) {
      return item.json;
    }
    if (item?.type === "text" && typeof item.text === "string") {
      try {
        const parsed = JSON.parse(item.text);
        if (typeof parsed === "object" && parsed !== null) {
          return parsed;
        }
      } catch {
        // Ignore non-JSON text content.
      }
    }
  }
  return null;
}

function toToolErrorSummary(payload) {
  if (!payload || typeof payload !== "object") {
    return "unknown payload";
  }
  const errorCode = String(payload.error_code ?? "");
  const error = String(payload.error ?? "");
  const transportAttempts = Array.isArray(payload.transport_attempts)
    ? payload.transport_attempts
    : [];
  return [
    `error_code=${errorCode || "<empty>"}`,
    `error=${error || "<empty>"}`,
    `transport_attempts=${JSON.stringify(transportAttempts)}`,
  ].join(" ");
}

function buildLivePrereqHint(cli) {
  return [
    `mode=${cli.tmwd_mode}`,
    `transport=${cli.tmwd_transport}`,
    `tmwd_ws=${cli.tmwd_ws_endpoint}`,
    `tmwd_link=${cli.tmwd_link_endpoint}`,
    `cdp=${cli.cdp_endpoint}`,
    "ensure tmwd-hub is running (`npm run hub:start`) and/or remote-debugging CDP is available.",
  ].join(" ");
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
          name: "browser-structured-mcp-live-contract",
          version: "1.0.0",
        },
      },
      cli.timeout_ms,
    );
    assert.equal(init?.result?.serverInfo?.name, "browser-structured-mcp");
    rpc.notify("notifications/initialized", {});

    const toolsList = await rpc.call("tools/list", {}, cli.timeout_ms);
    const tools = Array.isArray(toolsList?.result?.tools) ? toolsList.result.tools : [];
    const names = tools
      .map((entry) => (typeof entry?.name === "string" ? entry.name : ""))
      .filter((name) => name.length > 0);
    assert.equal(names.includes("browser_scan"), true);
    assert.equal(names.includes("browser_execute_js"), true);
    assert.equal(names.includes("browser_tab_ops"), true);
    assert.equal(names.includes("browser_file_ops"), true);
    assert.equal(names.includes("browser_download_ops"), true);
    assert.equal(names.includes("browser_tab_lifecycle"), true);
    assert.equal(names.includes("browser_clipboard_ops"), true);

    const commonArgs = {
      tmwd_mode: cli.tmwd_mode,
      tmwd_transport: cli.tmwd_transport,
      tmwd_ws_endpoint: cli.tmwd_ws_endpoint,
      tmwd_link_endpoint: cli.tmwd_link_endpoint,
      cdp_endpoint: cli.cdp_endpoint,
    };

    const scanCall = await rpc.call(
      "tools/call",
      {
        name: "browser_scan",
        arguments: {
          ...commonArgs,
          tabs_only: true,
          ...(cli.target_url_contains
            ? { session_url_pattern: cli.target_url_contains }
            : {}),
        },
      },
      cli.timeout_ms,
    );
    if (scanCall?.result?.isError === true) {
      const errorPayload = firstJsonContent(scanCall.result);
      throw new Error(`live browser_scan failed: ${toToolErrorSummary(errorPayload)} ${buildLivePrereqHint(cli)}`);
    }
    const scanPayload = firstJsonContent(scanCall.result);
    assert.equal(scanPayload?.status, "success");
    const tabsCount = Number(scanPayload?.metadata?.tabs_count ?? 0);
    if (!cli.allow_empty_tabs) {
      assert.equal(Number.isFinite(tabsCount) && tabsCount > 0, true);
    }

    const executeCall = await rpc.call(
      "tools/call",
      {
        name: "browser_execute_js",
        arguments: {
          ...commonArgs,
          no_monitor: true,
          native_auto_fallback: true,
          native_auto_fallback_policy: "balanced",
          script: "let cookie = ''; try { cookie = document.cookie; } catch {} return ({ title: document.title, href: location.href, cookie });",
          ...(cli.target_url_contains
            ? { target_url_contains: cli.target_url_contains }
            : {}),
        },
      },
      cli.timeout_ms,
    );
    if (executeCall?.result?.isError === true) {
      const errorPayload = firstJsonContent(executeCall.result);
      throw new Error(`live browser_execute_js failed: ${toToolErrorSummary(errorPayload)} ${buildLivePrereqHint(cli)}`);
    }
    const executePayload = firstJsonContent(executeCall.result);
    if (executePayload?.status !== "success") {
      throw new Error(`live browser_execute_js returned non-success: ${toToolErrorSummary(executePayload)} ${buildLivePrereqHint(cli)}`);
    }
    assert.equal(typeof executePayload?.js_return?.title, "string");
    assert.equal(typeof executePayload?.js_return?.href, "string");
    assert.equal(typeof executePayload?.js_return?.cookie, "string");
    if (cli.require_cookie) {
      assert.equal(executePayload.js_return.cookie.length > 0, true);
    }

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        transport: executePayload.transport,
        transport_attempts: executePayload.transport_attempts,
        tabs_count: tabsCount,
        active_tab: scanPayload?.metadata?.active_tab,
        title: executePayload?.js_return?.title,
        href: executePayload?.js_return?.href,
        cookie_length: executePayload?.js_return?.cookie?.length ?? 0,
        require_cookie: cli.require_cookie,
        tmwd_mode: cli.tmwd_mode,
        tmwd_transport: cli.tmwd_transport,
        tmwd_ws_endpoint: cli.tmwd_ws_endpoint,
        tmwd_link_endpoint: cli.tmwd_link_endpoint,
        cdp_endpoint: cli.cdp_endpoint,
      })}\n`,
    );
  } finally {
    await rpc.close();
  }
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser-structured-mcp-live-contract failed: ${message}\n`);
  process.exitCode = 1;
}
