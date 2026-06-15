#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertTextJsonContent,
  firstJsonContent,
} from "./browser-structured-mcp-contract/rpc-content.mjs";
import { assertOpenAiToolSchemaCompatibility } from "./browser-structured-mcp-contract/schema-compat.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const jsReverseServerPath = resolve(repoRoot, "src/js-reverse-server.mjs");

function parseArgs(argv) {
  const parsed = {
    timeout_ms: 8_000,
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

  const call = (method, params = {}, timeoutMs = 8_000) => {
    if (closed || !child.stdin) {
      return Promise.reject(new Error("js-reverse process is not available"));
    }
    const id = `js_reverse_contract_${String(nextId++)}`;
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

async function run() {
  const cli = parseArgs(process.argv.slice(2));
  const previousTabRegistryPath = process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
  const tmpTabRegistryPath = resolve(
    tmpdir(),
    `tmwd-js-reverse-tab-registry-contract-${process.pid}-${Date.now()}.json`,
  );
  process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = tmpTabRegistryPath;
  const rpc = createRpcClient();
  try {
    const init = await rpc.call(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "js-reverse-mcp-contract",
          version: "1.0.0",
        },
      },
      cli.timeout_ms,
    );
    assert.equal(init?.result?.serverInfo?.name, "js-reverse");
    assert.equal(init?.result?.capabilities?.tools && typeof init.result.capabilities.tools, "object");
    rpc.notify("notifications/initialized", {});

    const toolsList = await rpc.call("tools/list", {}, cli.timeout_ms);
    const tools = Array.isArray(toolsList?.result?.tools) ? toolsList.result.tools : [];
    assertOpenAiToolSchemaCompatibility(tools, "js-reverse");
    const names = tools
      .map((entry) => (typeof entry?.name === "string" ? entry.name : ""))
      .filter((name) => name.length > 0);
    for (const requiredName of [
      "check_browser_health",
      "analyze_target",
      "search_in_scripts",
      "list_network_requests",
      "create_hook",
      "inject_hook",
      "get_hook_data",
      "export_rebuild_bundle",
      "get_storage",
      "finalize_task",
    ]) {
      assert.equal(names.includes(requiredName), true, `missing tool ${requiredName}`);
    }
    const createHookTool = tools.find((entry) => entry?.name === "create_hook");
    assert.equal(createHookTool?.inputSchema?.type, "object");
    assert.equal(createHookTool?.inputSchema?.properties?.hook_id?.type, "string");
    const newPageTool = tools.find((entry) => entry?.name === "new_page");
    assert.equal(newPageTool?.inputSchema?.properties?.ownership_policy?.default, "tmwd_only");
    assert.equal(newPageTool?.inputSchema?.properties?.reuse_scope?.default, "origin_path");

    const newPageDryRunCall = await rpc.call(
      "tools/call",
      {
        name: "new_page",
        arguments: {
          url: "http://example.test/app/one",
          workspace_key: "js-reverse-contract",
          dry_run: true,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(newPageDryRunCall?.result?.isError, undefined);
    assertTextJsonContent(newPageDryRunCall.result, "js-reverse new_page dry-run result");
    const newPageDryRunPayload = firstJsonContent(newPageDryRunCall.result);
    assert.equal(newPageDryRunPayload?.ok, true);
    assert.equal(newPageDryRunPayload?.owner, "tmwd");
    assert.equal(newPageDryRunPayload?.created, false);
    assert.equal(newPageDryRunPayload?.reused, false);
    assert.equal(newPageDryRunPayload?.would_create, true);

    const newPageReuseDryRunCall = await rpc.call(
      "tools/call",
      {
        name: "new_page",
        arguments: {
          url: "http://example.test/app/two",
          workspace_key: "js-reverse-contract",
          dry_run: true,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(newPageReuseDryRunCall?.result?.isError, undefined);
    const newPageReuseDryRunPayload = firstJsonContent(newPageReuseDryRunCall.result);
    assert.equal(newPageReuseDryRunPayload?.ok, true);
    assert.equal(newPageReuseDryRunPayload?.created, false);
    assert.equal(newPageReuseDryRunPayload?.reused, false);
    assert.equal(newPageReuseDryRunPayload?.would_create, true);
    assert.equal(newPageReuseDryRunPayload?.finalize_hint?.required, false);
    assert.equal(newPageReuseDryRunPayload?.finalize_hint?.tool, "finalize_task");
    assert.equal(newPageReuseDryRunPayload?.finalize_hint?.workspace_key, "js-reverse-contract");
    assert.equal(newPageReuseDryRunPayload?.finalize_hint?.suggested_arguments?.action, undefined);

    const finalizeMissingScopeCall = await rpc.call(
      "tools/call",
      {
        name: "finalize_task",
        arguments: {
          dry_run: true,
          prune_stale: false,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(finalizeMissingScopeCall?.result?.isError, undefined);
    const finalizeMissingScopePayload = firstJsonContent(finalizeMissingScopeCall.result);
    assert.equal(finalizeMissingScopePayload?.ok, false);
    assert.match(finalizeMissingScopePayload?.error ?? "", /workspace_key or task_id/);

    const finalizeDryRunCall = await rpc.call(
      "tools/call",
      {
        name: "finalize_task",
        arguments: {
          workspace_key: "js-reverse-contract",
          dry_run: true,
          prune_stale: false,
        },
      },
      cli.timeout_ms,
    );
    assert.equal(finalizeDryRunCall?.result?.isError, undefined);
    const finalizeDryRunPayload = firstJsonContent(finalizeDryRunCall.result);
    assert.equal(finalizeDryRunPayload?.ok, true);
    assert.equal(finalizeDryRunPayload?.action, "finalize_task");
    assert.equal(finalizeDryRunPayload?.dry_run, true);
    assert.equal(finalizeDryRunPayload?.finalizer_policy?.closes_only_managed_tabs, true);
    assert.equal(finalizeDryRunPayload?.finalizer_policy?.preserves_keep_true, true);
    assert.equal(finalizeDryRunPayload?.remaining?.unkept_count, 0);

    const understandCall = await rpc.call(
      "tools/call",
      {
        name: "understand_code",
        arguments: {
          code: "function sign(input){ return crypto.subtle.digest('SHA-256', input); }",
        },
      },
      cli.timeout_ms,
    );
    assert.equal(understandCall?.result?.isError, undefined);
    assertTextJsonContent(understandCall.result, "js-reverse understand_code result");
    const understandPayload = firstJsonContent(understandCall.result);
    assert.equal(understandPayload?.ok, true);
    assert.equal(understandPayload?.suspicious_keywords?.includes("sign"), true);

    const cryptoCall = await rpc.call(
      "tools/call",
      {
        name: "detect_crypto",
        arguments: {
          code: "CryptoJS.MD5(payload); crypto.subtle.digest('SHA-256', bytes);",
        },
      },
      cli.timeout_ms,
    );
    const cryptoPayload = firstJsonContent(cryptoCall.result);
    assert.equal(cryptoPayload?.ok, true);
    assert.equal(cryptoPayload?.detected?.includes("md5"), true);
    assert.equal(cryptoPayload?.detected?.includes("sha"), true);

    const hookCall = await rpc.call(
      "tools/call",
      {
        name: "create_hook",
        arguments: {
          hook_id: "contract_fetch_hook",
          type: "fetch",
          pattern: "/api/",
        },
      },
      cli.timeout_ms,
    );
    const hookPayload = firstJsonContent(hookCall.result);
    assert.equal(hookPayload?.ok, true);
    assert.equal(hookPayload?.hook?.id, "contract_fetch_hook");

    const unsupportedCall = await rpc.call(
      "tools/call",
      {
        name: "set_breakpoint",
        arguments: {},
      },
      cli.timeout_ms,
    );
    const unsupportedPayload = firstJsonContent(unsupportedCall.result);
    assertTextJsonContent(unsupportedCall.result, "js-reverse unsupported debugger result");
    assert.equal(unsupportedPayload?.status, "not_supported");
    assert.equal(typeof unsupportedPayload?.fallback, "string");

    process.stdout.write(`${JSON.stringify({ ok: true, tools_count: names.length })}\n`);
  } finally {
    await rpc.close();
    if (previousTabRegistryPath === undefined) {
      delete process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
    } else {
      process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = previousTabRegistryPath;
    }
  }
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`js-reverse-mcp-contract failed: ${message}\n`);
  process.exitCode = 1;
}
