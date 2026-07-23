import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { normalizeEvidenceRecord } from "../evidence/schema.mjs";
import { atomicWriteJson } from "../storage/atomic-file.mjs";
import { readNdjsonTail } from "../storage/ndjson.mjs";
import { createRunIndex } from "./index.mjs";
import {
  DEFAULT_RUN_ROOT,
  RUN_INDEX_META_SCHEMA_VERSION,
  RUN_INDEX_SCHEMA_VERSION,
  RUN_SCHEMA_VERSION,
  configuredRunRoot,
  directoryUpdatedAt,
  makeRunId,
  readJsonIfExists,
  resolveRunGroup,
  safeSegment,
} from "./model.mjs";

const DEFAULT_CHECKPOINT_INTERVAL_MS = 1_000;
const MAX_CACHED_RUNS = 1_000;

class RunStore {
  constructor(options = {}) {
    this.root = path.resolve(options.root || configuredRunRoot());
    this.clock = typeof options.clock === "function" ? options.clock : () => new Date();
    this.checkpointIntervalMs = Math.max(
      0,
      Number(options.checkpoint_interval_ms
        ?? process.env.BROWSER67_RUN_CHECKPOINT_INTERVAL_MS
        ?? DEFAULT_CHECKPOINT_INTERVAL_MS),
    );
    this.maxCachedRuns = Math.max(1, Number(options.max_cached_runs ?? MAX_CACHED_RUNS));
    this.latestRuns = new Map();
    this.checkpointStates = new Map();
    this.locks = new Map();
    this.disposed = false;
    this.index = createRunIndex({
      root: this.root,
      clock: this.clock,
      latest_runs: this.latestRuns,
      with_lock: (key, operation) => this.withLock(key, operation),
    });
  }

  groupDir(group) {
    return path.join(this.root, safeSegment(group));
  }

  runDir(args = {}) {
    const runId = safeSegment(args.run_id, "");
    if (!runId) throw new Error("run_id is required");
    return path.join(this.root, resolveRunGroup(args), runId);
  }

  runJsonPath(runDir) {
    return path.join(runDir, "run.json");
  }

  eventsPath(runDir) {
    return path.join(runDir, "events.ndjson");
  }

  async withLock(key, operation) {
    this.assertActive();
    const previous = this.locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.locks.set(key, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }

  assertActive() {
    if (this.disposed) throw new Error(`run store is disposed: ${this.root}`);
  }

  stats() {
    return {
      root: this.root,
      disposed: this.disposed,
      cached_run_count: this.latestRuns.size,
      checkpoint_state_count: this.checkpointStates.size,
      pending_lock_count: this.locks.size,
      max_cached_runs: this.maxCachedRuns,
    };
  }

  cacheRun(runDir, run, checkpointMs) {
    this.latestRuns.delete(runDir);
    this.latestRuns.set(runDir, run);
    this.checkpointStates.delete(runDir);
    this.checkpointStates.set(runDir, checkpointMs);
    while (this.latestRuns.size > this.maxCachedRuns) {
      const oldest = this.latestRuns.keys().next().value;
      this.latestRuns.delete(oldest);
      this.checkpointStates.delete(oldest);
    }
    return run;
  }

  eventPayload(args = {}, eventName = "event") {
    return {
      schema_version: RUN_SCHEMA_VERSION,
      id: `event_${randomUUID()}`,
      ts: this.clock().toISOString(),
      event: String(args.event ?? eventName),
      status: String(args.status ?? ""),
      data: args.data && typeof args.data === "object" ? args.data : {},
      evidence: args.evidence && typeof args.evidence === "object"
        ? normalizeEvidenceRecord(args.evidence, { source: "tool" })
        : undefined,
    };
  }

  async appendEvent(runDir, event) {
    await mkdir(runDir, { recursive: true });
    await appendFile(this.eventsPath(runDir), `${JSON.stringify(event)}\n`, "utf8");
  }

  async readRecentEvents(runDir, limit = 20) {
    return readNdjsonTail(this.eventsPath(runDir), Math.max(0, Number(limit ?? 20)), {
      invalid_record: (raw) => ({
        schema_version: RUN_SCHEMA_VERSION,
        ts: "",
        event: "invalid_json",
        raw,
      }),
    });
  }

  async writeCheckpoint(runDir, run, options = {}) {
    const checkpointAt = this.clock().toISOString();
    const payload = {
      ...run,
      schema_version: RUN_SCHEMA_VERSION,
      checkpoint_at: checkpointAt,
    };
    await atomicWriteJson(this.runJsonPath(runDir), payload);
    this.cacheRun(runDir, payload, Date.parse(checkpointAt));
    await this.index.append(payload, options);
    return payload;
  }

  async readRun(runDir) {
    if (this.latestRuns.has(runDir)) return this.latestRuns.get(runDir);
    const run = await readJsonIfExists(this.runJsonPath(runDir));
    if (run) {
      const checkpointMs = Date.parse(String(run.checkpoint_at ?? run.updated_at ?? ""));
      this.cacheRun(runDir, run, Number.isFinite(checkpointMs) ? checkpointMs : 0);
    }
    return run;
  }

  async prepare(args = {}) {
    this.assertActive();
    const group = resolveRunGroup(args);
    const now = this.clock();
    const runId = makeRunId(args, now);
    const runDir = path.join(this.root, group, runId);
    const nowIso = now.toISOString();
    const payload = {
      schema_version: RUN_SCHEMA_VERSION,
      run_id: runId,
      group,
      task_id: String(args.task_id ?? ""),
      workspace_key: String(args.workspace_key ?? ""),
      title: String(args.title ?? ""),
      status: "running",
      created_at: nowIso,
      updated_at: nowIso,
      checkpoint_at: nowIso,
      finished_at: null,
      root: this.root,
      run_dir: runDir,
      artifacts_dir: path.join(runDir, "artifacts"),
      logs_dir: path.join(runDir, "logs"),
      event_count: 1,
      input: args.data && typeof args.data === "object" ? args.data : {},
    };
    await Promise.all([
      mkdir(payload.artifacts_dir, { recursive: true }),
      mkdir(payload.logs_dir, { recursive: true }),
    ]);
    await this.withLock(`run:${runDir}`, async () => {
      await this.writeCheckpoint(runDir, payload, { is_new: true });
      await this.appendEvent(runDir, this.eventPayload(args, "prepare"));
    });
    return { ok: true, action: "prepare", run: this.latestRuns.get(runDir) };
  }

  async status(args = {}) {
    this.assertActive();
    const runDir = this.runDir(args);
    const run = await this.readRun(runDir);
    if (!run) return { ok: false, action: "status", error: "run not found", run_dir: runDir };
    const recentEvents = args.summary_only === true
      ? []
      : await this.readRecentEvents(runDir, Number(args.max_items ?? 20));
    return { ok: true, action: "status", run, recent_events: recentEvents };
  }

  async recordEvent(args = {}) {
    this.assertActive();
    const runDir = this.runDir(args);
    return this.withLock(`run:${runDir}`, async () => {
      const run = await this.readRun(runDir);
      if (!run) {
        return { ok: false, action: "record_event", error: "run not found", run_dir: runDir };
      }
      const event = this.eventPayload(args, "event");
      await this.appendEvent(runDir, event);
      const nextStatus = args.status ? String(args.status) : run.status;
      let updated = {
        ...run,
        status: nextStatus,
        updated_at: event.ts,
        event_count: Number(run.event_count ?? 0) + 1,
      };
      this.cacheRun(runDir, updated, Number(this.checkpointStates.get(runDir) ?? 0));
      const checkpointMs = Number(this.checkpointStates.get(runDir) ?? 0);
      const statusChanged = nextStatus !== run.status;
      const checkpointDue = statusChanged
        || this.checkpointIntervalMs === 0
        || Date.parse(event.ts) - checkpointMs >= this.checkpointIntervalMs;
      if (checkpointDue) {
        updated = await this.writeCheckpoint(runDir, updated);
      }
      return {
        ok: true,
        action: "record_event",
        run: updated,
        event,
        checkpoint_written: checkpointDue,
      };
    });
  }

  async finish(args = {}) {
    this.assertActive();
    const runDir = this.runDir(args);
    return this.withLock(`run:${runDir}`, async () => {
      const run = await this.readRun(runDir);
      if (!run) return { ok: false, action: "finish", error: "run not found", run_dir: runDir };
      const now = this.clock().toISOString();
      const finalStatus = String(args.status ?? "success");
      const event = this.eventPayload({ ...args, status: finalStatus }, "finish");
      const updated = {
        ...run,
        status: finalStatus,
        updated_at: now,
        finished_at: now,
        event_count: Number(run.event_count ?? 0) + 1,
        summary: args.data && typeof args.data === "object" ? args.data : run.summary,
      };
      await this.appendEvent(runDir, event);
      const checkpoint = await this.writeCheckpoint(runDir, updated);
      return { ok: true, action: "finish", run: checkpoint, event, checkpoint_written: true };
    });
  }

  async list(args = {}) {
    this.assertActive();
    return this.index.list(args);
  }

  async compactGroupIndex(group) {
    this.assertActive();
    return this.index.compactGroup(group);
  }

  async compactAllIndexes() {
    this.assertActive();
    return this.index.compactAll();
  }

  async inspect() {
    this.assertActive();
    return this.index.inspect();
  }

  async migrate() {
    this.assertActive();
    return this.index.migrate();
  }

  async dispose() {
    if (this.disposed) return this.stats();
    await Promise.allSettled(Array.from(this.locks.values()));
    this.disposed = true;
    this.locks.clear();
    this.latestRuns.clear();
    this.checkpointStates.clear();
    return this.stats();
  }
}

const defaultStores = new Map();

function getDefaultRunStore() {
  const root = configuredRunRoot();
  if (!defaultStores.has(root)) defaultStores.set(root, new RunStore({ root }));
  return defaultStores.get(root);
}

function createRunStore(options = {}) {
  return new RunStore(options);
}

export {
  DEFAULT_RUN_ROOT,
  MAX_CACHED_RUNS,
  RUN_INDEX_META_SCHEMA_VERSION,
  RUN_INDEX_SCHEMA_VERSION,
  RUN_SCHEMA_VERSION,
  RunStore,
  configuredRunRoot,
  createRunStore,
  directoryUpdatedAt,
  getDefaultRunStore,
  makeRunId,
  readJsonIfExists,
  resolveRunGroup,
  safeSegment,
};
