import { appendFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { atomicWriteFile, atomicWriteJson } from "../storage/atomic-file.mjs";
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
    return this.compactGroup(group);
  }

  async append(run, { is_new = false } = {}) {
    const group = safeSegment(run.group);
    return this.withLock(`index:${group}`, async () => {
      await mkdir(this.groupDir(group), { recursive: true });
      let meta = await readJsonIfExists(this.indexMetaPath(group));
      let rebuilt = false;
      if (meta?.schema_version !== RUN_INDEX_META_SCHEMA_VERSION) {
        meta = await this.compactGroupUnlocked(group);
        rebuilt = true;
      }
      const revision = Number(meta.revision ?? 0) + 1;
      await appendFile(this.indexPath(group), `${JSON.stringify(indexRecord(run, revision))}\n`, "utf8");
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
    const records = await this.latestRecords(group, maxItems);
    return {
      ok: true,
      action: "list",
      root,
      runs: records.map(compactIndexRecord),
      total: Number(meta.unique_count ?? records.length),
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

  async inspect() {
    const entries = await readdir(this.root, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    const groups = [];
    let runCount = 0;
    let legacyRunCount = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const groupDir = this.groupDir(entry.name);
      const runEntries = await readdir(groupDir, { withFileTypes: true }).catch(() => []);
      let groupRuns = 0;
      let groupLegacy = 0;
      for (const runEntry of runEntries) {
        if (!runEntry.isDirectory()) continue;
        const payload = await readJsonIfExists(this.runJsonPath(path.join(groupDir, runEntry.name)));
        if (!payload) continue;
        groupRuns += 1;
        if (payload.schema_version !== RUN_SCHEMA_VERSION) groupLegacy += 1;
      }
      const meta = await readJsonIfExists(this.indexMetaPath(entry.name));
      groups.push({
        group: entry.name,
        run_count: groupRuns,
        legacy_run_count: groupLegacy,
        index_ready: meta?.schema_version === RUN_INDEX_META_SCHEMA_VERSION,
      });
      runCount += groupRuns;
      legacyRunCount += groupLegacy;
    }
    return { root: this.root, groups, run_count: runCount, legacy_run_count: legacyRunCount };
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

export { RunIndex, createRunIndex };
