import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { normalizeEvidenceRecord } from "./evidence-schema.mjs";
import { resolveBrowser67HomePath } from "./runtime/paths/home.mjs";

const RUN_SCHEMA_VERSION = "tmwd.run.v1";
const DEFAULT_RUN_ROOT = path.join(resolveBrowser67HomePath(), "runtime", "runs");

function runRoot() {
  return path.resolve(process.env.BROWSER_STRUCTURED_RUN_ROOT || DEFAULT_RUN_ROOT);
}

function safeSegment(value, fallback = "default") {
  const normalized = String(value ?? "").trim().replace(/[^a-zA-Z0-9_.-]/g, "_");
  return normalized || fallback;
}

function runGroup(args = {}) {
  return safeSegment(args.workspace_key ?? args.task_id ?? args.group ?? "default");
}

function makeRunId(args = {}) {
  const raw = String(args.run_id ?? "").trim();
  if (raw) {
    return safeSegment(raw);
  }
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z");
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

function runDirFor(args = {}) {
  const group = runGroup(args);
  const runId = safeSegment(args.run_id, "");
  if (!runId) {
    throw new Error("run_id is required");
  }
  return path.join(runRoot(), group, runId);
}

function runJsonPath(runDir) {
  return path.join(runDir, "run.json");
}

function eventsPath(runDir) {
  return path.join(runDir, "events.ndjson");
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeRunJson(runDir, payload) {
  await mkdir(runDir, { recursive: true });
  await writeFile(runJsonPath(runDir), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function appendRunEvent(runDir, event) {
  await mkdir(runDir, { recursive: true });
  await appendFile(eventsPath(runDir), `${JSON.stringify(event)}\n`, "utf8");
}

async function readRecentEvents(runDir, limit = 20) {
  const raw = await readFile(eventsPath(runDir), "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  const rows = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { schema_version: RUN_SCHEMA_VERSION, ts: "", event: "invalid_json", raw: line };
      }
    });
  return rows.slice(Math.max(0, rows.length - limit));
}

function eventPayload(args = {}, eventName = "event") {
  return {
    schema_version: RUN_SCHEMA_VERSION,
    id: `event_${randomUUID()}`,
    ts: new Date().toISOString(),
    event: String(args.event ?? eventName),
    status: String(args.status ?? ""),
    data: args.data && typeof args.data === "object" ? args.data : {},
    evidence: args.evidence && typeof args.evidence === "object"
      ? normalizeEvidenceRecord(args.evidence, { source: "tool" })
      : undefined,
  };
}

async function prepareRun(args = {}) {
  const group = runGroup(args);
  const runId = makeRunId(args);
  const runDir = path.join(runRoot(), group, runId);
  const now = new Date().toISOString();
  const payload = {
    schema_version: RUN_SCHEMA_VERSION,
    run_id: runId,
    group,
    task_id: String(args.task_id ?? ""),
    workspace_key: String(args.workspace_key ?? ""),
    title: String(args.title ?? ""),
    status: "running",
    created_at: now,
    updated_at: now,
    finished_at: null,
    root: runRoot(),
    run_dir: runDir,
    artifacts_dir: path.join(runDir, "artifacts"),
    logs_dir: path.join(runDir, "logs"),
    input: args.data && typeof args.data === "object" ? args.data : {},
  };
  await Promise.all([
    mkdir(payload.artifacts_dir, { recursive: true }),
    mkdir(payload.logs_dir, { recursive: true }),
  ]);
  await writeRunJson(runDir, payload);
  await appendRunEvent(runDir, eventPayload(args, "prepare"));
  return {
    ok: true,
    action: "prepare",
    run: payload,
  };
}

async function statusRun(args = {}) {
  const runDir = runDirFor(args);
  const run = await readJsonIfExists(runJsonPath(runDir));
  if (!run) {
    return { ok: false, action: "status", error: "run not found", run_dir: runDir };
  }
  const recentEvents = args.summary_only === true ? [] : await readRecentEvents(runDir, Number(args.max_items ?? 20));
  return {
    ok: true,
    action: "status",
    run,
    recent_events: recentEvents,
  };
}

async function recordRunEvent(args = {}) {
  const runDir = runDirFor(args);
  const run = await readJsonIfExists(runJsonPath(runDir));
  if (!run) {
    return { ok: false, action: "record_event", error: "run not found", run_dir: runDir };
  }
  const event = eventPayload(args, "event");
  await appendRunEvent(runDir, event);
  const updated = {
    ...run,
    status: args.status ? String(args.status) : run.status,
    updated_at: event.ts,
  };
  await writeRunJson(runDir, updated);
  return {
    ok: true,
    action: "record_event",
    run: updated,
    event,
  };
}

async function finishRun(args = {}) {
  const runDir = runDirFor(args);
  const run = await readJsonIfExists(runJsonPath(runDir));
  if (!run) {
    return { ok: false, action: "finish", error: "run not found", run_dir: runDir };
  }
  const now = new Date().toISOString();
  const finalStatus = String(args.status ?? "success");
  const event = eventPayload({ ...args, status: finalStatus }, "finish");
  const updated = {
    ...run,
    status: finalStatus,
    updated_at: now,
    finished_at: now,
    summary: args.data && typeof args.data === "object" ? args.data : run.summary,
  };
  await appendRunEvent(runDir, event);
  await writeRunJson(runDir, updated);
  return {
    ok: true,
    action: "finish",
    run: updated,
    event,
  };
}

async function listRuns(args = {}) {
  const root = path.join(runRoot(), runGroup(args));
  const maxItems = Math.max(1, Math.min(500, Number(args.max_items ?? 50)));
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runDir = path.join(root, entry.name);
    const run = await readJsonIfExists(runJsonPath(runDir));
    const info = await stat(runDir).catch(() => null);
    rows.push({
      run_id: entry.name,
      run_dir: runDir,
      status: run?.status ?? "unknown",
      created_at: run?.created_at ?? info?.birthtime?.toISOString?.() ?? "",
      updated_at: run?.updated_at ?? info?.mtime?.toISOString?.() ?? "",
      title: run?.title ?? "",
    });
  }
  rows.sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));
  return {
    ok: true,
    action: "list",
    root,
    runs: rows.slice(0, maxItems),
    total: rows.length,
  };
}

async function handleBrowserRunOps(args = {}) {
  const action = String(args.action ?? "status");
  if (action === "prepare") return prepareRun(args);
  if (action === "status") return statusRun(args);
  if (action === "record_event") return recordRunEvent(args);
  if (action === "finish") return finishRun(args);
  if (action === "list") return listRuns(args);
  return { ok: false, action, error: `unknown browser_run_ops action: ${action}` };
}

export {
  DEFAULT_RUN_ROOT,
  RUN_SCHEMA_VERSION,
  handleBrowserRunOps,
  prepareRun,
  runDirFor,
  runRoot,
};
