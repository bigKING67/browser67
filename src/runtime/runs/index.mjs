import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { atomicWriteFile, atomicWriteJson } from "../storage/atomic-file.mjs";
import { appendPrivateFile, ensurePrivateDirectory } from "../storage/private-path.mjs";
import { directorySizeAndNewestMtime } from "../storage/directory-usage.mjs";
import { scanNdjsonBackwards } from "../storage/ndjson.mjs";
import {
  RUN_INDEX_META_SCHEMA_VERSION,
  RUN_INDEX_SCHEMA_VERSION,
  RUN_SCHEMA_VERSION,
  compactIndexRecord,
  indexRecord,
  readJsonIfExists,
  resolveRunGroup,
  safeSegment,
} from "./model.mjs";

const INDEX_COMPACT_MIN_ENTRIES = 128;
const INDEX_COMPACT_RATIO = 4;
const TERMINAL_RUN_STATUSES = new Set([
  "cancelled",
  "completed",
  "failed",
  "interrupted",
  "pass",
  "passed",
  "success",
]);

function normalizeRunStatus(status) {
  return String(status ?? "unknown").trim().toLowerCase().slice(0, 64) || "unknown";
}

function parsedRunUpdatedAt(run) {
  for (const value of [run?.updated_at, run?.checkpoint_at, run?.created_at]) {
    const timestamp = Date.parse(String(value ?? ""));
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

function incrementStatus(statusCounts, status) {
  statusCounts.set(status, Number(statusCounts.get(status) ?? 0) + 1);
}

function sortedStatusCounts(statusCounts) {
  return Object.fromEntries([...statusCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right)));
}

function isTerminalRunStatus(status) {
  return TERMINAL_RUN_STATUSES.has(status) || status.startsWith("completed_");
}

async function isRunLikeDirectory(runDir) {
  const entries = await readdir(runDir, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT" || error?.code === "EACCES") return [];
    throw error;
  });
  const names = new Set(entries.map((entry) => entry.name));
  return names.has("artifacts")
    || names.has("events.ndjson")
    || names.has("jobs")
    || names.has("logs");
}

function addStorageUsage(storage, usage, kind) {
  storage.bytes += usage.bytes;
  storage.entries += usage.entries;
  storage.files += usage.files;
  storage.directories += usage.directories;
  storage.unreadable_count += usage.unreadable_count;
  if (kind === "untracked") storage.untracked_run_bytes += usage.bytes;
  else storage.indexed_run_bytes += usage.bytes;
}

class RunIndex {
  constructor(options = {}) {
    this.root = path.resolve(options.root);
    this.clock = options.clock;
    this.latestRuns = options.latest_runs;
    this.withLock = options.with_lock;
  }

  groupDir(group) {
    return path.join(this.root, safeSegment(group));
  }

  runJsonPath(runDir) {
    return path.join(runDir, "run.json");
  }

  indexPath(group) {
    return path.join(this.groupDir(group), "index.ndjson");
  }

  indexMetaPath(group) {
    return path.join(this.groupDir(group), "index.meta.json");
  }

  async ensure(group) {
    const meta = await readJsonIfExists(this.indexMetaPath(group));
    if (meta?.schema_version === RUN_INDEX_META_SCHEMA_VERSION) return meta;
    const groupInfo = await stat(this.groupDir(group)).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!groupInfo?.isDirectory()) {
      return {
        schema_version: RUN_INDEX_META_SCHEMA_VERSION,
        group: safeSegment(group),
        unique_count: 0,
        entry_count: 0,
        revision: 0,
        updated_at: null,
        compacted_at: null,
        ephemeral: true,
      };
    }
    return this.compactGroup(group);
  }

  async append(run, { is_new = false } = {}) {
    const group = safeSegment(run.group);
    return this.withLock(`index:${group}`, async () => {
      await ensurePrivateDirectory(this.root);
      await ensurePrivateDirectory(this.groupDir(group));
      let meta = await readJsonIfExists(this.indexMetaPath(group));
      let rebuilt = false;
      if (meta?.schema_version !== RUN_INDEX_META_SCHEMA_VERSION) {
        meta = await this.compactGroupUnlocked(group);
        rebuilt = true;
      }
      const revision = Number(meta.revision ?? 0) + 1;
      await appendPrivateFile(this.indexPath(group), `${JSON.stringify(indexRecord(run, revision))}\n`, "utf8");
      const nextMeta = {
        schema_version: RUN_INDEX_META_SCHEMA_VERSION,
        group,
        unique_count: Number(meta.unique_count ?? 0) + (is_new && !rebuilt ? 1 : 0),
        entry_count: Number(meta.entry_count ?? 0) + 1,
        revision,
        updated_at: this.clock().toISOString(),
        compacted_at: meta.compacted_at ?? null,
      };
      await atomicWriteJson(this.indexMetaPath(group), nextMeta);
      const compactThreshold = Math.max(
        INDEX_COMPACT_MIN_ENTRIES,
        Number(nextMeta.unique_count ?? 0) * INDEX_COMPACT_RATIO,
      );
      if (nextMeta.entry_count >= compactThreshold) {
        return this.compactGroupUnlocked(group);
      }
      return nextMeta;
    });
  }

  async latestRecords(group, limit) {
    const rows = new Map();
    await scanNdjsonBackwards(this.indexPath(group), {
      max_scan_bytes: 64 * 1024 * 1024,
      on_record: (record) => {
        if (
          record?.schema_version === RUN_INDEX_SCHEMA_VERSION
          && record.run_id
          && !rows.has(record.run_id)
        ) {
          rows.set(record.run_id, record);
        }
        return rows.size < limit;
      },
    });
    return Array.from(rows.values());
  }

  async list(args = {}) {
    const group = resolveRunGroup(args);
    const root = this.groupDir(group);
    const maxItems = Math.max(1, Math.min(500, Number(args.max_items ?? 50)));
    const meta = await this.ensure(group);
    const summaryOnly = args.summary_only === true;
    const records = summaryOnly ? [] : await this.latestRecords(group, maxItems);
    return {
      ok: true,
      action: "list",
      root,
      summary_only: summaryOnly,
      runs: records.map(compactIndexRecord),
      total: Number(meta.unique_count ?? records.length),
      returned_count: records.length,
      index: {
        schema_version: RUN_INDEX_SCHEMA_VERSION,
        entry_count: Number(meta.entry_count ?? 0),
        revision: Number(meta.revision ?? 0),
      },
    };
  }

  async compactGroupUnlocked(group) {
    const normalizedGroup = safeSegment(group);
    const groupDir = this.groupDir(normalizedGroup);
    const entries = await readdir(groupDir, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    const runs = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const runDir = path.join(groupDir, entry.name);
      const run = this.latestRuns.get(runDir) ?? await readJsonIfExists(this.runJsonPath(runDir));
      if (!run?.run_id) continue;
      runs.push({
        ...run,
        schema_version: RUN_SCHEMA_VERSION,
        group: normalizedGroup,
        run_dir: runDir,
      });
    }
    runs.sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at)));
    const now = this.clock().toISOString();
    const lines = runs.map((run, index) => JSON.stringify(indexRecord(run, index + 1)));
    await atomicWriteFile(this.indexPath(normalizedGroup), lines.length ? `${lines.join("\n")}\n` : "", "utf8");
    const meta = {
      schema_version: RUN_INDEX_META_SCHEMA_VERSION,
      group: normalizedGroup,
      unique_count: runs.length,
      entry_count: runs.length,
      revision: runs.length,
      updated_at: now,
      compacted_at: now,
    };
    await atomicWriteJson(this.indexMetaPath(normalizedGroup), meta);
    return meta;
  }

  async compactGroup(group) {
    const normalizedGroup = safeSegment(group);
    return this.withLock(`index:${normalizedGroup}`, () => this.compactGroupUnlocked(normalizedGroup));
  }

  async compactAll() {
    const entries = await readdir(this.root, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    const groups = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      await this.compactGroup(entry.name);
      groups.push(entry.name);
    }
    return { root: this.root, groups, compacted_count: groups.length };
  }

  async inspect(args = {}) {
    const summaryOnly = args.summary_only === true;
    const includeStorage = args.include_storage === true;
    const staleRunningAfterMinutes = Math.max(
      1,
      Math.min(10_080, Number(args.stale_running_after_minutes ?? 120)),
    );
    const staleRunningBeforeMs = this.clock().getTime() - staleRunningAfterMinutes * 60_000;
    const entries = await readdir(this.root, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    const groups = [];
    let runCount = 0;
    let runtimeDirectoryCount = 0;
    let untrackedRunDirectoryCount = 0;
    let ignoredDirectoryCount = 0;
    let legacyRunCount = 0;
    let terminalRunCount = 0;
    let runningRunCount = 0;
    let staleRunningCount = 0;
    let currentRunningRunCount = 0;
    let legacyRunningRunCount = 0;
    let currentStaleRunningCount = 0;
    let legacyStaleRunningCount = 0;
    let unknownUpdatedAtCount = 0;
    let emptyGroupCount = 0;
    let oldestUpdatedAtMs = null;
    let newestUpdatedAtMs = null;
    const statusCounts = new Map();
    const storage = {
      included: includeStorage,
      bytes: 0,
      mb: 0,
      entries: 0,
      files: 0,
      directories: 0,
      unreadable_count: 0,
      indexed_run_bytes: 0,
      untracked_run_bytes: 0,
    };
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const groupDir = this.groupDir(entry.name);
      const runEntries = await readdir(groupDir, { withFileTypes: true }).catch(() => []);
      let groupRuns = 0;
      let groupLegacy = 0;
      let groupUntrackedRuns = 0;
      let groupRunning = 0;
      let groupStaleRunning = 0;
      let groupStorageBytes = 0;
      const groupStatusCounts = new Map();
      for (const runEntry of runEntries) {
        if (!runEntry.isDirectory()) continue;
        const runDir = path.join(groupDir, runEntry.name);
        const payload = await readJsonIfExists(this.runJsonPath(runDir));
        if (!payload) {
          if (!(await isRunLikeDirectory(runDir))) {
            ignoredDirectoryCount += 1;
            continue;
          }
          runtimeDirectoryCount += 1;
          untrackedRunDirectoryCount += 1;
          groupUntrackedRuns += 1;
          if (includeStorage) {
            const usage = await directorySizeAndNewestMtime(runDir);
            addStorageUsage(storage, usage, "untracked");
            groupStorageBytes += usage.bytes;
          }
          continue;
        }
        runtimeDirectoryCount += 1;
        groupRuns += 1;
        const legacySchema = payload.schema_version !== RUN_SCHEMA_VERSION;
        if (legacySchema) groupLegacy += 1;
        const status = normalizeRunStatus(payload.status);
        incrementStatus(statusCounts, status);
        incrementStatus(groupStatusCounts, status);
        if (isTerminalRunStatus(status)) terminalRunCount += 1;
        if (status === "running") {
          runningRunCount += 1;
          groupRunning += 1;
          if (legacySchema) legacyRunningRunCount += 1;
          else currentRunningRunCount += 1;
        }
        const updatedAtMs = parsedRunUpdatedAt(payload);
        if (updatedAtMs === null) {
          unknownUpdatedAtCount += 1;
        } else {
          oldestUpdatedAtMs = oldestUpdatedAtMs === null
            ? updatedAtMs
            : Math.min(oldestUpdatedAtMs, updatedAtMs);
          newestUpdatedAtMs = newestUpdatedAtMs === null
            ? updatedAtMs
            : Math.max(newestUpdatedAtMs, updatedAtMs);
          if (status === "running" && updatedAtMs < staleRunningBeforeMs) {
            staleRunningCount += 1;
            groupStaleRunning += 1;
            if (legacySchema) legacyStaleRunningCount += 1;
            else currentStaleRunningCount += 1;
          }
        }
        if (includeStorage) {
          const usage = await directorySizeAndNewestMtime(runDir);
          addStorageUsage(storage, usage, "indexed");
          groupStorageBytes += usage.bytes;
        }
      }
      const meta = await readJsonIfExists(this.indexMetaPath(entry.name));
      if (groupRuns === 0 && groupUntrackedRuns === 0) emptyGroupCount += 1;
      groups.push({
        group: entry.name,
        run_count: groupRuns,
        legacy_run_count: groupLegacy,
        untracked_run_directory_count: groupUntrackedRuns,
        running_count: groupRunning,
        stale_running_count: groupStaleRunning,
        status_counts: sortedStatusCounts(groupStatusCounts),
        ...(includeStorage ? {
          storage_bytes: groupStorageBytes,
          storage_mb: Number((groupStorageBytes / (1024 * 1024)).toFixed(2)),
        } : {}),
        index_ready: meta?.schema_version === RUN_INDEX_META_SCHEMA_VERSION,
      });
      runCount += groupRuns;
      legacyRunCount += groupLegacy;
    }
    storage.mb = Number((storage.bytes / (1024 * 1024)).toFixed(2));
    return {
      root: this.root,
      summary_only: summaryOnly,
      include_storage: includeStorage,
      groups: summaryOnly ? [] : groups,
      group_count: groups.length,
      empty_group_count: emptyGroupCount,
      run_count: runCount,
      runtime_directory_count: runtimeDirectoryCount,
      untracked_run_directory_count: untrackedRunDirectoryCount,
      ignored_directory_count: ignoredDirectoryCount,
      legacy_run_count: legacyRunCount,
      terminal_run_count: terminalRunCount,
      nonterminal_run_count: runCount - terminalRunCount,
      running_run_count: runningRunCount,
      stale_running_count: staleRunningCount,
      current_running_run_count: currentRunningRunCount,
      legacy_running_run_count: legacyRunningRunCount,
      current_stale_running_count: currentStaleRunningCount,
      legacy_stale_running_count: legacyStaleRunningCount,
      stale_running_after_minutes: staleRunningAfterMinutes,
      unknown_updated_at_count: unknownUpdatedAtCount,
      oldest_updated_at: oldestUpdatedAtMs === null ? null : new Date(oldestUpdatedAtMs).toISOString(),
      newest_updated_at: newestUpdatedAtMs === null ? null : new Date(newestUpdatedAtMs).toISOString(),
      status_counts: sortedStatusCounts(statusCounts),
      storage,
    };
  }

  async staleRunning(args = {}) {
    const staleRunningAfterMinutes = Math.max(
      1,
      Math.min(525_600, Number(args.stale_running_after_minutes ?? 1_440)),
    );
    const cutoffMs = this.clock().getTime() - staleRunningAfterMinutes * 60_000;
    const groups = await readdir(this.root, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    const candidates = [];
    let unknownUpdatedAtCount = 0;
    for (const groupEntry of groups) {
      if (!groupEntry.isDirectory()) continue;
      const runEntries = await readdir(this.groupDir(groupEntry.name), { withFileTypes: true }).catch(() => []);
      for (const runEntry of runEntries) {
        if (!runEntry.isDirectory()) continue;
        const runDir = path.join(this.groupDir(groupEntry.name), runEntry.name);
        const run = await readJsonIfExists(this.runJsonPath(runDir));
        if (!run || normalizeRunStatus(run.status) !== "running") continue;
        const updatedAtMs = parsedRunUpdatedAt(run);
        if (updatedAtMs === null) {
          unknownUpdatedAtCount += 1;
          continue;
        }
        if (updatedAtMs >= cutoffMs) continue;
        candidates.push({
          group: safeSegment(run.group ?? groupEntry.name),
          run_id: String(run.run_id ?? runEntry.name),
          run_dir: runDir,
          previous_status: "running",
          updated_at: new Date(updatedAtMs).toISOString(),
          age_minutes: Math.floor((this.clock().getTime() - updatedAtMs) / 60_000),
          schema_version: String(run.schema_version ?? ""),
        });
      }
    }
    candidates.sort((left, right) => (
      String(left.updated_at).localeCompare(String(right.updated_at))
      || String(left.run_dir).localeCompare(String(right.run_dir))
    ));
    return {
      root: this.root,
      stale_running_after_minutes: staleRunningAfterMinutes,
      cutoff_at: new Date(cutoffMs).toISOString(),
      candidate_count: candidates.length,
      unknown_updated_at_count: unknownUpdatedAtCount,
      candidates,
    };
  }

  async migrate() {
    const inspection = await this.inspect();
    for (const group of inspection.groups) {
      const groupDir = this.groupDir(group.group);
      const entries = await readdir(groupDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const runDir = path.join(groupDir, entry.name);
        const run = await readJsonIfExists(this.runJsonPath(runDir));
        if (!run || run.schema_version === RUN_SCHEMA_VERSION) continue;
        await atomicWriteJson(this.runJsonPath(runDir), {
          ...run,
          schema_version: RUN_SCHEMA_VERSION,
          checkpoint_at: run.checkpoint_at ?? run.updated_at ?? this.clock().toISOString(),
          event_count: Number(run.event_count ?? 0),
        });
      }
      await this.compactGroup(group.group);
    }
    return { ...inspection, migrated: true, target_schema_version: RUN_SCHEMA_VERSION };
  }
}

function createRunIndex(options = {}) {
  return new RunIndex(options);
}

export { RunIndex, createRunIndex, isTerminalRunStatus };
