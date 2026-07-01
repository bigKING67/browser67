import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { normalizeEvidenceRecord } from "../evidence-schema.mjs";
import { runtimeRoot } from "./paths.mjs";
import { runtimeScript } from "./runtime-script.mjs";
import { serverEvidence, serverHooks } from "./state.mjs";
import { pageEval } from "./tmwd-adapter.mjs";

async function writeJsonFile(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function appendEvidence(args) {
  const taskId = String(args?.task_id ?? "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const channel = String(args?.channel ?? "runtime-evidence").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const evidenceInput = args?.evidence && typeof args.evidence === "object"
    ? args.evidence
    : { data: args?.data ?? {} };
  const payload = {
    ...normalizeEvidenceRecord(evidenceInput, {
      id: `evidence_${randomUUID()}`,
      source: args?.source ?? "tool",
      confidence: args?.confidence ?? "unknown",
    }),
    task_id: taskId,
    channel,
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
    writeFile(resolve(bundleDir, "polyfills.js"), "globalThis.window ||= globalThis;\nglobalThis.navigator ||= { userAgent: 'browser67-js-reverse-local' };\n", "utf8"),
    writeFile(resolve(bundleDir, "entry.js"), "import './polyfills.js';\nimport { browserEnv } from './env.js';\nimport capture from './capture.json' assert { type: 'json' };\nconsole.log(JSON.stringify({ ok: true, browserEnv, captureCount: capture.evidence.length }));\n", "utf8"),
  ]);
  return {
    ok: true,
    bundle_dir: bundleDir,
    files: ["entry.js", "env.js", "polyfills.js", "capture.json"].map((name) => resolve(bundleDir, name)),
  };
}

function storageAreaScript(area) {
  return area === "sessionStorage" ? "sessionStorage" : "localStorage";
}

async function handleGetStorageKey(args, area) {
  const key = String(args?.key ?? "").trim();
  if (!key) return { ok: false, error: "key is required" };
  const maxValueChars = Math.max(0, Math.min(Number(args?.max_value_chars ?? 4000), 20000));
  const result = await pageEval(args, `
    const storage = ${storageAreaScript(area)};
    const value = storage.getItem(input.key);
    return {
      url: location.href,
      storage_area: input.area,
      key: input.key,
      found: value !== null,
      value: value === null ? null : String(value).slice(0, input.maxValueChars),
      value_length: value === null ? 0 : String(value).length,
      truncated: value !== null && String(value).length > input.maxValueChars
    };
  `, { area, key, maxValueChars });
  return { ok: true, transport: result.transport, page: result.page, result: result.value };
}

async function handleGetLocalStorage(args) {
  return handleGetStorageKey(args, "localStorage");
}

async function handleGetSessionStorage(args) {
  return handleGetStorageKey(args, "sessionStorage");
}

async function handleSearchStorage(args) {
  const pattern = String(args?.pattern ?? "").trim();
  if (!pattern) return { ok: false, error: "pattern is required" };
  const storageArea = String(args?.storage_area ?? "both");
  const maxRecords = Math.max(1, Math.min(Number(args?.max_records ?? 50), 500));
  const maxValueChars = Math.max(0, Math.min(Number(args?.max_value_chars ?? 400), 20000));
  const includeValues = Boolean(args?.include_values);
  const result = await pageEval(args, `
    const makeMatcher = (pattern) => {
      try {
        const regex = new RegExp(pattern, 'i');
        return (value) => regex.test(value);
      } catch (_) {
        const needle = pattern.toLowerCase();
        return (value) => String(value).toLowerCase().includes(needle);
      }
    };
    const scan = (name, storage, matcher, maxRecords, maxValueChars, includeValues) => {
      const matches = [];
      for (let i = 0; i < storage.length && matches.length < maxRecords; i++) {
        const key = storage.key(i);
        const value = storage.getItem(key);
        const valueText = String(value ?? '');
        if (matcher(String(key)) || matcher(valueText)) {
          matches.push({
            storage_area: name,
            key,
            value_length: valueText.length,
            value_preview: valueText.slice(0, maxValueChars),
            value: includeValues ? valueText.slice(0, maxValueChars) : undefined,
            truncated: valueText.length > maxValueChars
          });
        }
      }
      return matches;
    };
    const matcher = makeMatcher(input.pattern);
    const areas = input.storageArea === 'localStorage'
      ? [['localStorage', localStorage]]
      : input.storageArea === 'sessionStorage'
        ? [['sessionStorage', sessionStorage]]
        : [['localStorage', localStorage], ['sessionStorage', sessionStorage]];
    const matches = areas.flatMap(([name, storage]) => scan(name, storage, matcher, input.maxRecords, input.maxValueChars, input.includeValues)).slice(0, input.maxRecords);
    return {
      url: location.href,
      pattern: input.pattern,
      storage_area: input.storageArea,
      count: matches.length,
      matches
    };
  `, { pattern, storageArea, maxRecords, maxValueChars, includeValues });
  return { ok: true, transport: result.transport, page: result.page, result: result.value };
}

async function handleWatchStorageChanges(args) {
  const watchId = String(args?.watch_id ?? `storage_${Date.now()}`).replace(/[^a-zA-Z0-9_.-]/g, "_");
  const storageArea = String(args?.storage_area ?? "both");
  const result = await pageEval(args, `
    ${runtimeScript()}
    root.storageWatchers[input.watchId] = {
      id: input.watchId,
      storage_area: input.storageArea,
      started_at: new Date().toISOString(),
      url: location.href
    };
    if (!root.originals.storageSetItem && typeof Storage !== 'undefined') {
      root.originals.storageSetItem = Storage.prototype.setItem;
      root.originals.storageRemoveItem = Storage.prototype.removeItem;
      root.originals.storageClear = Storage.prototype.clear;
      const areaName = (storage) => storage === localStorage ? 'localStorage' : storage === sessionStorage ? 'sessionStorage' : 'Storage';
      const allowed = (area) => Object.values(root.storageWatchers).some((watcher) => watcher.storage_area === 'both' || watcher.storage_area === area);
      Storage.prototype.setItem = function(key, value) {
        const area = areaName(this);
        const oldValue = this.getItem(key);
        const out = root.originals.storageSetItem.apply(this, arguments);
        if (allowed(area)) root.record('storage-change', { event: 'setItem', storage_area: area, key: String(key), old_value: oldValue, new_value: String(value), stack: new Error('storage setItem').stack });
        return out;
      };
      Storage.prototype.removeItem = function(key) {
        const area = areaName(this);
        const oldValue = this.getItem(key);
        const out = root.originals.storageRemoveItem.apply(this, arguments);
        if (allowed(area)) root.record('storage-change', { event: 'removeItem', storage_area: area, key: String(key), old_value: oldValue, stack: new Error('storage removeItem').stack });
        return out;
      };
      Storage.prototype.clear = function() {
        const area = areaName(this);
        const out = root.originals.storageClear.apply(this, arguments);
        if (allowed(area)) root.record('storage-change', { event: 'clear', storage_area: area, stack: new Error('storage clear').stack });
        return out;
      };
      window.addEventListener('storage', (event) => {
        if (allowed(event.storageArea === localStorage ? 'localStorage' : event.storageArea === sessionStorage ? 'sessionStorage' : 'Storage')) {
          root.record('storage-change', { event: 'storage-event', storage_area: event.storageArea === localStorage ? 'localStorage' : event.storageArea === sessionStorage ? 'sessionStorage' : 'Storage', key: event.key, old_value: event.oldValue, new_value: event.newValue, url: event.url });
        }
      });
    }
    return {
      ok: true,
      watcher: root.storageWatchers[input.watchId],
      retrieval: 'Use get_hook_data(view="summary" or "raw") and filter kind=storage-change.'
    };
  `, { watchId, storageArea });
  return { ok: true, transport: result.transport, page: result.page, result: result.value };
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

async function handleExportEvidenceBundle(args) {
  const taskId = String(args?.task_id ?? "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const selectedFrame = args?.frame_path ? String(args.frame_path) : "top";
  const bundleDir = resolve(runtimeRoot, "evidence-bundles", `${taskId}-${Date.now()}`);
  const evidence = serverEvidence.filter((entry) => entry.task_id === taskId || taskId === "default");
  const hooks = Array.from(serverHooks.values());
  const requestIds = [...new Set(evidence.flatMap((entry) => Array.isArray(entry.request_ids) ? entry.request_ids : []))];
  const scriptIds = [...new Set(evidence.flatMap((entry) => Array.isArray(entry.script_ids) ? entry.script_ids : []))];
  await Promise.all([
    mkdir(resolve(bundleDir, "scripts"), { recursive: true }),
    mkdir(resolve(bundleDir, "hooks"), { recursive: true }),
    mkdir(resolve(bundleDir, "replay"), { recursive: true }),
  ]);
  const summary = {
    schema_version: "js-reverse-evidence-bundle.v1",
    task_id: taskId,
    url: args?.url ?? null,
    timestamp: new Date().toISOString(),
    selected_frame: selectedFrame,
    script_hashes: Array.isArray(args?.script_hashes) ? args.script_hashes : [],
    request_ids: requestIds,
    script_ids: scriptIds,
    hook_count: hooks.length,
    evidence_count: evidence.length,
    redaction_policy: "storage and cookie values are redacted by default; keep secrets, cookies, tokens, and account identifiers out of bundle files",
    reproduction_steps: [
      "Open the target with browser67/js-reverse using the same workspace_key/task_id.",
      "Run check_browser_health, new_page/select_page, list_frames, analyze_target, hooks, and evidence capture in order.",
      "Use replay/README.md and env capture artifacts to reproduce local rebuild steps."
    ],
  };
  const networkRows = evidence
    .filter((entry) => /request|network|fetch|xhr/i.test(JSON.stringify(entry)))
    .map((entry) => JSON.stringify(entry));
  const storageRedacted = {
    schema_version: "storage-redacted.v1",
    task_id: taskId,
    note: "Values intentionally redacted. Use get_local_storage/get_session_storage/search_storage for scoped live retrieval when needed.",
    keys: Array.isArray(args?.storage_keys) ? args.storage_keys.map(String) : [],
  };
  await Promise.all([
    writeJsonFile(resolve(bundleDir, "summary.json"), summary),
    writeFile(resolve(bundleDir, "network.ndjson"), `${networkRows.join("\n")}${networkRows.length ? "\n" : ""}`, "utf8"),
    writeJsonFile(resolve(bundleDir, "hooks", "hooks.json"), hooks),
    writeJsonFile(resolve(bundleDir, "storage-redacted.json"), storageRedacted),
    writeFile(resolve(bundleDir, "replay", "README.md"), [
      "# js-reverse evidence replay",
      "",
      "1. Recreate the browser67/js-reverse task with the same target URL and selected frame.",
      "2. Reinstall hooks listed in `../hooks/hooks.json`.",
      "3. Replay only redacted, non-secret fixtures. Do not paste cookies, tokens, or account data into source.",
      "4. Export a rebuild bundle with `export_rebuild_bundle` when algorithm extraction is needed.",
      "",
    ].join("\n"), "utf8"),
    writeFile(resolve(bundleDir, "README.md"), [
      "# js-reverse evidence bundle",
      "",
      "This bundle is generated outside the source tree by browser67-backed js-reverse.",
      "It records summary metadata, network evidence rows, hook configuration, redacted storage metadata, and replay notes.",
      "",
    ].join("\n"), "utf8"),
  ]);
  return {
    ok: true,
    bundle_dir: bundleDir,
    files: [
      "summary.json",
      "network.ndjson",
      "hooks/hooks.json",
      "storage-redacted.json",
      "replay/README.md",
      "README.md",
    ].map((name) => resolve(bundleDir, name)),
    summary,
  };
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
  handleExportEvidenceBundle,
  handleExportRebuildBundle,
  handleExportSessionReport,
  handleGetLocalStorage,
  handleGetSessionStorage,
  handleGetStorage,
  handleRecordReverseEvidence,
  handleRestoreSessionState,
  handleSaveSessionState,
  handleSearchStorage,
  handleWatchStorageChanges,
  writeJsonFile,
};
