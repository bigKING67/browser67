import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { resolveBrowser67HomePath } from "../paths/home.mjs";

const RUN_SCHEMA_VERSION = "browser67.run.v2";
const RUN_INDEX_SCHEMA_VERSION = "browser67.run-index.v1";
const RUN_INDEX_META_SCHEMA_VERSION = "browser67.run-index-meta.v1";
const DEFAULT_RUN_ROOT = path.join(resolveBrowser67HomePath(), "runtime", "runs");

function configuredRunRoot() {
  return path.resolve(process.env.BROWSER_STRUCTURED_RUN_ROOT || DEFAULT_RUN_ROOT);
}

function safeSegment(value, fallback = "default") {
  const normalized = String(value ?? "").trim().replace(/[^a-zA-Z0-9_.-]/g, "_");
  return normalized || fallback;
}

function resolveRunGroup(args = {}) {
  return safeSegment(args.workspace_key ?? args.task_id ?? args.group ?? "default");
}

function makeRunId(args = {}, now = new Date()) {
  const raw = String(args.run_id ?? "").trim();
  if (raw) return safeSegment(raw);
  const stamp = now.toISOString().replace(/[-:.]/g, "");
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function indexRecord(run, revision = 1) {
  return {
    schema_version: RUN_INDEX_SCHEMA_VERSION,
    revision,
    run_id: String(run.run_id ?? ""),
    group: String(run.group ?? ""),
    run_dir: String(run.run_dir ?? ""),
    status: String(run.status ?? "unknown"),
    created_at: String(run.created_at ?? ""),
    updated_at: String(run.updated_at ?? ""),
    finished_at: run.finished_at ?? null,
    title: String(run.title ?? ""),
  };
}

function compactIndexRecord(record) {
  return {
    run_id: record.run_id,
    run_dir: record.run_dir,
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
    finished_at: record.finished_at,
    title: record.title,
  };
}

async function directoryUpdatedAt(directory) {
  const info = await stat(directory).catch(() => null);
  return info?.mtime?.toISOString?.() ?? "";
}

export {
  DEFAULT_RUN_ROOT,
  RUN_INDEX_META_SCHEMA_VERSION,
  RUN_INDEX_SCHEMA_VERSION,
  RUN_SCHEMA_VERSION,
  compactIndexRecord,
  configuredRunRoot,
  directoryUpdatedAt,
  indexRecord,
  makeRunId,
  readJsonIfExists,
  resolveRunGroup,
  safeSegment,
};
