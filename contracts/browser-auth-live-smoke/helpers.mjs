import assert from "node:assert/strict";
import { firstJsonContent } from "../browser-structured-mcp-contract/rpc-content.mjs";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERNAME,
} from "./fixture.mjs";

export function parseArgs(argv) {
  const parsed = {
    timeout_ms: 15_000,
    tmwd_mode: "tmwd",
    tmwd_transport: "auto",
    tmwd_ws_endpoint: "ws://127.0.0.1:18765",
    tmwd_link_endpoint: "http://127.0.0.1:18766/link",
    cdp_endpoint: "http://127.0.0.1:9222",
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
      parsed.tmwd_mode = String(argv[index + 1] ?? "").trim() || "tmwd";
      index += 1;
      continue;
    }
    if (token === "--tmwd-transport") {
      parsed.tmwd_transport = String(argv[index + 1] ?? "").trim() || "auto";
      index += 1;
      continue;
    }
    if (token === "--tmwd-ws-endpoint") {
      parsed.tmwd_ws_endpoint = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--tmwd-link-endpoint") {
      parsed.tmwd_link_endpoint = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--cdp-endpoint") {
      parsed.cdp_endpoint = String(argv[index + 1] ?? "").trim();
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

export function commonArgs(cli) {
  return {
    tmwd_mode: cli.tmwd_mode,
    tmwd_transport: cli.tmwd_transport,
    tmwd_ws_endpoint: cli.tmwd_ws_endpoint,
    tmwd_link_endpoint: cli.tmwd_link_endpoint,
    cdp_endpoint: cli.cdp_endpoint,
    timeout_ms: cli.timeout_ms,
  };
}

export function createToolCaller({ rpc, cli }) {
  return async function callTool(name, args) {
    const response = await rpc.call("tools/call", { name, arguments: args }, cli.timeout_ms);
    if (response?.result?.isError === true) {
      const payload = firstJsonContent(response.result);
      throw new Error(`${name} failed: ${String(payload?.error ?? payload?.message ?? "tool error")}`);
    }
    return firstJsonContent(response.result);
  };
}

export async function waitFor(condition, timeoutMs, pollMs = 150) {
  const startedAt = Date.now();
  const poll = async (latest) => {
    if (Date.now() - startedAt > timeoutMs) {
      return latest ?? { ok: false, reason: "timeout" };
    }
    const current = await condition();
    if (current?.ok === true) {
      return current;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
    return poll(current);
  };
  return poll();
}

export function assertNoSecretLeak(payload, label) {
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes(FIXTURE_USERNAME), false, `${label} leaked username`);
  assert.equal(serialized.includes(FIXTURE_PASSWORD), false, `${label} leaked password`);
}
