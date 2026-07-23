import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { atomicWriteFile, atomicWriteJson } from "../storage/atomic-file.mjs";
import { readNdjsonFile, scanNdjsonBackwards } from "../storage/ndjson.mjs";

const JOB_INDEX_SCHEMA_VERSION = "browser67.job-index.v1";
const JOB_ACTIVE_INDEX_SCHEMA_VERSION = "browser67.active-job-index.v1";
const JOB_INDEX_META_SCHEMA_VERSION = "browser67.job-index-meta.v1";
const ACTIVE_JOB_STATUSES = new Set(["pending", "running", "cancel_requested"]);

function resolveJobStoreRoot(runRoot, explicitRoot = "") {
  if (explicitRoot) return path.resolve(explicitRoot);
  if (process.env.BROWSER_STRUCTURED_JOB_ROOT) {
    return path.resolve(process.env.BROWSER_STRUCTURED_JOB_ROOT);
  }
  const resolvedRunRoot = path.resolve(runRoot);
  if (path.basename(resolvedRunRoot) === "runs") {
    return path.join(path.dirname(resolvedRunRoot), "jobs");
  }
  return path.join(path.dirname(resolvedRunRoot), `${path.basename(resolvedRunRoot)}-jobs`);
}

function jobReference(job, statePath) {
  const status = String(job.status ?? "unknown");
  return {
    schema_version: JOB_INDEX_SCHEMA_VERSION,
    job_id: String(job.job_id ?? ""),
    state_path: path.resolve(statePath),
    status,
    active: ACTIVE_JOB_STATUSES.has(status),
    updated_at: String(job.updated_at ?? ""),
    workspace_key: String(job.workspace_key ?? ""),
    task_id: String(job.task_id ?? ""),
    run_id: String(job.run_id ?? ""),
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

class JobStore {
  constructor(options = {}) {
    if (!options.run_root) throw new Error("JobStore requires run_root");
    this.runRoot = path.resolve(options.run_root);
    this.root = resolveJobStoreRoot(this.runRoot, options.root);
    this.catalogPath = path.join(this.root, "index.ndjson");
    this.catalogMetaPath = path.join(this.root, "index.meta.json");
    this.activeDir = path.join(this.root, "active");
    this.activeIndexPath = path.join(this.activeDir, "index.ndjson");
    this.activeJobs = null;
    this.locks = new Map();
    this.disposed = false;
  }

  assertActive() {
    if (this.disposed) throw new Error(`job store is disposed: ${this.root}`);
  }

  stats() {
    return {
      root: this.root,
      run_root: this.runRoot,
      disposed: this.disposed,
      active_job_count: this.activeJobs?.size ?? 0,
      active_index_loaded: this.activeJobs !== null,
      pending_lock_count: this.locks.size,
    };
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

  async ensureActiveLoaded() {
    this.assertActive();
    if (this.activeJobs) return this.activeJobs;
    const rows = await readNdjsonFile(this.activeIndexPath);
    this.activeJobs = new Map();
    for (const row of rows) {
      if (
        row?.schema_version === JOB_ACTIVE_INDEX_SCHEMA_VERSION
        && row.job_id
        && row.state_path
      ) {
        this.activeJobs.set(row.job_id, row);
      }
    }
    return this.activeJobs;
  }

  async writeActiveIndex() {
    const active = await this.ensureActiveLoaded();
    const rows = Array.from(active.values())
      .sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at)))
      .map((record) => JSON.stringify({
        ...record,
        schema_version: JOB_ACTIVE_INDEX_SCHEMA_VERSION,
        active: true,
      }));
    await atomicWriteFile(this.activeIndexPath, rows.length ? `${rows.join("\n")}\n` : "", "utf8");
  }

  async index(job, statePath) {
    this.assertActive();
    const reference = jobReference(job, statePath);
    if (!reference.job_id) throw new Error("job_id is required for job index");
    return this.withLock("catalog", async () => {
      await mkdir(this.root, { recursive: true });
      await appendFile(this.catalogPath, `${JSON.stringify(reference)}\n`, "utf8");
      const active = await this.ensureActiveLoaded();
      if (reference.active) {
        active.set(reference.job_id, {
          ...reference,
          schema_version: JOB_ACTIVE_INDEX_SCHEMA_VERSION,
        });
      } else {
        active.delete(reference.job_id);
      }
      await this.writeActiveIndex();
      const meta = await readJsonIfExists(this.catalogMetaPath) ?? {};
      await atomicWriteJson(this.catalogMetaPath, {
        schema_version: JOB_INDEX_META_SCHEMA_VERSION,
        entry_count: Number(meta.entry_count ?? 0) + 1,
        updated_at: reference.updated_at,
        active_count: active.size,
      });
      return reference;
    });
  }

  async activeReferences() {
    this.assertActive();
    const active = await this.ensureActiveLoaded();
    return Array.from(active.values());
  }

  async recentReferences(limit = 200) {
    this.assertActive();
    const normalizedLimit = Math.max(1, Number(limit ?? 200));
    const rows = new Map();
    await scanNdjsonBackwards(this.catalogPath, {
      max_scan_bytes: 64 * 1024 * 1024,
      on_record: (record) => {
        if (
          record?.schema_version === JOB_INDEX_SCHEMA_VERSION
          && record.job_id
          && !rows.has(record.job_id)
        ) {
          rows.set(record.job_id, record);
        }
        return rows.size < normalizedLimit;
      },
    });
    return Array.from(rows.values());
  }

  async findReference(jobId) {
    this.assertActive();
    const normalized = String(jobId ?? "").trim();
    if (!normalized) return null;
    let found = null;
    await scanNdjsonBackwards(this.catalogPath, {
      max_scan_bytes: 64 * 1024 * 1024,
      on_record: (record) => {
        if (record?.schema_version === JOB_INDEX_SCHEMA_VERSION && record.job_id === normalized) {
          found = record;
          return false;
        }
        return true;
      },
    });
    return found;
  }

  async rebuild() {
    this.assertActive();
    const references = [];
    const groups = await readdir(this.runRoot, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    for (const group of groups) {
      if (!group.isDirectory()) continue;
      const groupDir = path.join(this.runRoot, group.name);
      const runs = await readdir(groupDir, { withFileTypes: true }).catch(() => []);
      for (const run of runs) {
        if (!run.isDirectory()) continue;
        const jobsDir = path.join(groupDir, run.name, "jobs");
        const entries = await readdir(jobsDir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
          const statePath = path.join(jobsDir, entry.name);
          const payload = await readJsonIfExists(statePath);
          if (!payload?.job_id || payload.job_id !== path.basename(entry.name, ".json")) continue;
          references.push(jobReference(payload, statePath));
        }
      }
    }
    references.sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at)));
    await mkdir(this.root, { recursive: true });
    const lines = references.map((reference) => JSON.stringify(reference));
    await atomicWriteFile(this.catalogPath, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
    this.activeJobs = new Map(references
      .filter((reference) => reference.active)
      .map((reference) => [reference.job_id, {
        ...reference,
        schema_version: JOB_ACTIVE_INDEX_SCHEMA_VERSION,
      }]));
    await this.writeActiveIndex();
    await atomicWriteJson(this.catalogMetaPath, {
      schema_version: JOB_INDEX_META_SCHEMA_VERSION,
      entry_count: references.length,
      unique_count: references.length,
      active_count: this.activeJobs.size,
      updated_at: new Date().toISOString(),
      compacted_at: new Date().toISOString(),
    });
    return {
      root: this.root,
      indexed_count: references.length,
      active_count: this.activeJobs.size,
    };
  }

  async inspect() {
    this.assertActive();
    const meta = await readJsonIfExists(this.catalogMetaPath);
    const active = await this.ensureActiveLoaded();
    return {
      root: this.root,
      catalog_ready: meta?.schema_version === JOB_INDEX_META_SCHEMA_VERSION,
      entry_count: Number(meta?.entry_count ?? 0),
      active_count: active.size,
    };
  }

  async dispose() {
    if (this.disposed) return this.stats();
    await Promise.allSettled(Array.from(this.locks.values()));
    this.disposed = true;
    this.locks.clear();
    this.activeJobs?.clear();
    return this.stats();
  }
}

const defaultStores = new Map();

function getDefaultJobStore(runRoot) {
  const resolved = path.resolve(runRoot);
  if (!defaultStores.has(resolved)) defaultStores.set(resolved, new JobStore({ run_root: resolved }));
  return defaultStores.get(resolved);
}

function createJobStore(options = {}) {
  return new JobStore(options);
}

export {
  ACTIVE_JOB_STATUSES,
  JOB_ACTIVE_INDEX_SCHEMA_VERSION,
  JOB_INDEX_META_SCHEMA_VERSION,
  JOB_INDEX_SCHEMA_VERSION,
  JobStore,
  createJobStore,
  getDefaultJobStore,
  jobReference,
  resolveJobStoreRoot,
};
