import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { runtimeRoot } from "./paths.mjs";
import { serverEvidence, serverHooks } from "./state.mjs";
import { pageEval } from "./tmwd-adapter.mjs";

async function writeJsonFile(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function appendEvidence(args) {
  const taskId = String(args?.task_id ?? "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const channel = String(args?.channel ?? "runtime-evidence").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const payload = {
    id: `evidence_${randomUUID()}`,
    ts: new Date().toISOString(),
    task_id: taskId,
    channel,
    data: args?.data ?? {},
  };
  serverEvidence.push(payload);
  const path = resolve(runtimeRoot, "evidence", taskId, `${channel}-${payload.id}.json`);
  await writeJsonFile(path, payload);
  return { payload, path };
}

async function handleRecordReverseEvidence(args) {
  const written = await appendEvidence(args);
  return { ok: true, evidence_id: written.payload.id, path: written.path, channel: written.payload.channel };
}

async function handleExportSessionReport(args) {
  const taskId = String(args?.task_id ?? "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const payload = {
    ok: true,
    task_id: taskId,
    ts: new Date().toISOString(),
    hooks: Array.from(serverHooks.values()),
    evidence: serverEvidence.filter((entry) => entry.task_id === taskId || taskId === "default"),
  };
  const path = resolve(runtimeRoot, "reports", `${taskId}-${Date.now()}.json`);
  await writeJsonFile(path, payload);
  return { ...payload, path };
}

async function handleExportRebuildBundle(args) {
  const taskId = String(args?.task_id ?? "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const bundleDir = resolve(runtimeRoot, "bundles", `${taskId}-${Date.now()}`, "env");
  await mkdir(bundleDir, { recursive: true });
  const capture = {
    ts: new Date().toISOString(),
    task_id: taskId,
    evidence: serverEvidence.filter((entry) => entry.task_id === taskId || taskId === "default"),
    input: args?.data ?? {},
  };
  await writeJsonFile(resolve(bundleDir, "capture.json"), capture);
  await Promise.all([
    writeFile(resolve(bundleDir, "env.js"), "export const browserEnv = {};\n", "utf8"),
    writeFile(resolve(bundleDir, "polyfills.js"), "globalThis.window ||= globalThis;\nglobalThis.navigator ||= { userAgent: 'tmwd-js-reverse-local' };\n", "utf8"),
    writeFile(resolve(bundleDir, "entry.js"), "import './polyfills.js';\nimport { browserEnv } from './env.js';\nimport capture from './capture.json' assert { type: 'json' };\nconsole.log(JSON.stringify({ ok: true, browserEnv, captureCount: capture.evidence.length }));\n", "utf8"),
  ]);
  return {
    ok: true,
    bundle_dir: bundleDir,
    files: ["entry.js", "env.js", "polyfills.js", "capture.json"].map((name) => resolve(bundleDir, name)),
  };
}

async function handleGetStorage(args) {
  const result = await pageEval(args, `
    const dump = (storage) => {
      const out = {};
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        out[key] = storage.getItem(key);
      }
      return out;
    };
    return { url: location.href, cookie: document.cookie, localStorage: dump(localStorage), sessionStorage: dump(sessionStorage) };
  `);
  return { ok: true, transport: result.transport, page: result.page, storage: result.value };
}

async function handleSaveSessionState(args) {
  const state = await handleGetStorage(args);
  const taskId = String(args?.task_id ?? "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const path = resolve(runtimeRoot, "session-state", `${taskId}-${Date.now()}.json`);
  await writeJsonFile(path, state.storage);
  return { ok: true, path, state: state.storage };
}

async function handleRestoreSessionState(args) {
  let state = args?.data;
  if (!state && args?.path) {
    state = JSON.parse(await readFile(String(args.path), "utf8"));
  }
  if (!state || typeof state !== "object") return { ok: false, error: "data or path is required" };
  const result = await pageEval(args, `
    const apply = (storage, values) => {
      for (const [key, value] of Object.entries(values || {})) storage.setItem(key, String(value));
    };
    apply(localStorage, input.state.localStorage);
    apply(sessionStorage, input.state.sessionStorage);
    return { ok: true, localStorage: Object.keys(input.state.localStorage || {}).length, sessionStorage: Object.keys(input.state.sessionStorage || {}).length, cookie_warning: 'HttpOnly cookies cannot be restored from document context.' };
  `, { state });
  return { ok: true, transport: result.transport, page: result.page, result: result.value };
}

export {
  appendEvidence,
  handleExportRebuildBundle,
  handleExportSessionReport,
  handleGetStorage,
  handleRecordReverseEvidence,
  handleRestoreSessionState,
  handleSaveSessionState,
  writeJsonFile,
};
