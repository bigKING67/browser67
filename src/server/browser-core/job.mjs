import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  handleBrowserRunOps,
  runDirFor,
  runRoot,
} from "../../run-lifecycle.mjs";
import { handleBrowserExecuteJs } from "./execute-js.mjs";

const JOB_SCHEMA_VERSION = "tmwd.browser.job.v2";
const MAX_RETAINED_JOBS = 200;
const MAX_RECOVERED_JOB_FILES = 1_000;
const jobs = new Map();
let recoveryPromise = null;

const EXECUTE_ARG_KEYS = [
  "script",
  "code",
  "tab_id",
  "switch_tab_id",
  "session_id",
  "session_url_pattern",
  "tmwd_mode",
  "tmwd_transport",
  "tmwd_ws_endpoint",
  "tmwd_link_endpoint",
  "no_monitor",
  "new_tab_wait_ms",
  "native_auto_fallback",
  "native_auto_fallback_policy",
  "native_auto_execute",
  "native_execute_action_scope",
  "native_fallback_action",
  "native_fallback_args",
  "native_fallback_timeout_ms",
  "timeout_ms",
  "output_mode",
  "max_return_chars",
  "cdp_endpoint",
  "target_url_contains",
];

function nowIso() {
  return new Date().toISOString();
}

function makeJobId() {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
  return `job_${stamp}_${randomUUID().slice(0, 8)}`;
}

function executeArgsFrom(args = {}) {
  const executeArgs = {};
  for (const key of EXECUTE_ARG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      executeArgs[key] = args[key];
    }
  }
  if (!Object.prototype.hasOwnProperty.call(executeArgs, "no_monitor")) {
    executeArgs.no_monitor = true;
  }
  return executeArgs;
}

function executionDeadline(args = {}) {
  const timeoutMs = Number(args.timeout_ms);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;
  return new Date(Date.now() + timeoutMs).toISOString();
}

function serializableJob(job, { include_result = false } = {}) {
  return {
    schema_version: JOB_SCHEMA_VERSION,
    job_id: job.job_id,
    status: job.status,
    durable: job.durable === true,
    durability_reason: job.durability_reason,
    abort_supported: false,
    cancel_requested: job.cancel_requested === true,
    cancel_outcome: job.cancel_outcome,
    workspace_key: job.workspace_key,
    task_id: job.task_id,
    run_id: job.run_id,
    title: job.title,
    created_at: job.created_at,
    started_at: job.started_at,
    updated_at: job.updated_at,
    finished_at: job.finished_at,
    checkpoint_at: job.checkpoint_at,
    execution_deadline_at: job.execution_deadline_at,
    recovery_status: job.recovery_status,
    interrupted_reason: job.interrupted_reason,
    persistence_error: job.persistence_error,
    error: job.error,
    result_available: job.result_available === true,
    result: include_result ? job.result : undefined,
  };
}

function persistedJob(job) {
  return {
    ...serializableJob(job, { include_result: true }),
    run_dir: job.run_dir,
  };
}

function jobStatePath(job) {
  if (!job.run_dir || !job.job_id) return "";
  return path.join(job.run_dir, "jobs", `${job.job_id}.json`);
}

async function persistJob(job) {
  if (job.durable !== true) return false;
  const statePath = jobStatePath(job);
  if (!statePath) return false;
  const checkpointAt = nowIso();
  job.checkpoint_at = checkpointAt;
  const tempPath = `${statePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(persistedJob(job), null, 2)}\n`, "utf8");
  await rename(tempPath, statePath);
  return true;
}

async function persistJobSafe(job) {
  try {
    return await persistJob(job);
  } catch (error) {
    job.persistence_error = String(error?.message ?? error);
    job.durable = false;
    job.durability_reason = "checkpoint_write_failed";
    return false;
  }
}

function restoredJob(payload, statePath) {
  const runDir = path.dirname(path.dirname(statePath));
  return {
    ...payload,
    schema_version: JOB_SCHEMA_VERSION,
    durable: true,
    durability_reason: "run_backed_checkpoint",
    run_dir: runDir,
    promise: undefined,
  };
}

async function jobStateFiles() {
  const root = runRoot();
  const files = [];
  const groups = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  for (const group of groups) {
    if (!group.isDirectory()) continue;
    const groupDir = path.join(root, group.name);
    const runs = await readdir(groupDir, { withFileTypes: true }).catch(() => []);
    for (const run of runs) {
      if (!run.isDirectory()) continue;
      const jobsDir = path.join(groupDir, run.name, "jobs");
      const entries = await readdir(jobsDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        files.push(path.join(jobsDir, entry.name));
        if (files.length >= MAX_RECOVERED_JOB_FILES) return files;
      }
    }
  }
  return files;
}

async function recoverJobsFromDisk() {
  const recoveredAt = nowIso();
  for (const statePath of await jobStateFiles()) {
    let payload;
    try {
      payload = JSON.parse(await readFile(statePath, "utf8"));
    } catch {
      continue;
    }
    const stateJobId = path.basename(statePath, ".json");
    if (!/^job_[a-zA-Z0-9_]+$/.test(String(payload?.job_id ?? ""))) continue;
    if (payload.job_id !== stateJobId || jobs.has(payload.job_id)) continue;
    const job = restoredJob(payload, statePath);
    if (["pending", "running", "cancel_requested"].includes(job.status)) {
      job.status = "interrupted";
      job.recovery_status = "interrupted_after_restart";
      job.interrupted_reason = "browser67 MCP restarted before the in-process execution completed";
      job.error = job.interrupted_reason;
      job.result = { status: "interrupted", error: job.interrupted_reason };
      job.result_available = true;
      job.updated_at = recoveredAt;
      job.finished_at = recoveredAt;
      job.cancel_outcome = job.cancel_requested === true
        ? "interrupted_after_cancel_request"
        : "not_requested";
      await persistJobSafe(job);
    } else {
      job.recovery_status = "recovered_terminal_checkpoint";
    }
    jobs.set(job.job_id, job);
  }
  pruneJobs();
}

async function ensureRecovered() {
  if (!recoveryPromise) recoveryPromise = recoverJobsFromDisk();
  await recoveryPromise;
}

function pruneJobs() {
  if (jobs.size <= MAX_RETAINED_JOBS) return;
  const rows = Array.from(jobs.values())
    .sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at)));
  for (const row of rows.slice(0, Math.max(0, jobs.size - MAX_RETAINED_JOBS))) {
    if (!["running", "cancel_requested"].includes(row.status)) jobs.delete(row.job_id);
  }
}

async function recordRunEvent(job, event, data = {}, status = "") {
  if (!job.run_id || (!job.workspace_key && !job.task_id)) return;
  try {
    await handleBrowserRunOps({
      action: "record_event",
      workspace_key: job.workspace_key,
      task_id: job.task_id,
      run_id: job.run_id,
      event,
      status,
      data: { job_id: job.job_id, ...data },
    });
  } catch (error) {
    job.run_event_error = String(error?.message ?? error);
  }
}

async function maybePrepareRun(args, job) {
  if (String(args.run_id ?? "").trim()) {
    job.run_id = String(args.run_id).trim();
    try {
      job.run_dir = runDirFor({
        workspace_key: job.workspace_key,
        task_id: job.task_id,
        run_id: job.run_id,
      });
      const status = await handleBrowserRunOps({
        action: "status",
        workspace_key: job.workspace_key,
        task_id: job.task_id,
        run_id: job.run_id,
        summary_only: true,
      });
      if (status?.ok !== true) job.run_dir = "";
    } catch {
      job.run_dir = "";
    }
    return;
  }
  if (args.prepare_run === false || (!job.workspace_key && !job.task_id)) return;
  const prepared = await handleBrowserRunOps({
    action: "prepare",
    workspace_key: job.workspace_key,
    task_id: job.task_id,
    title: job.title || "browser job",
    data: { job_id: job.job_id, durable: true },
  });
  if (prepared?.ok === true && prepared.run?.run_id) {
    job.run_id = prepared.run.run_id;
    job.run_dir = prepared.run.run_dir;
  }
}

function finishJob(job, status, result, error) {
  const ts = nowIso();
  job.status = status;
  job.updated_at = ts;
  job.finished_at = ts;
  job.result = result;
  job.result_available = true;
  job.error = error ? String(error) : undefined;
  if (job.cancel_requested === true) {
    job.cancel_outcome = status === "completed"
      ? "completed_after_cancel_request"
      : "failed_after_cancel_request";
  }
}

function startBackgroundJob(job, executeArgs) {
  job.promise = (async () => {
    job.status = "running";
    job.started_at = nowIso();
    job.updated_at = job.started_at;
    await persistJobSafe(job);
    await recordRunEvent(job, "job_started", { durable: job.durable === true }, "running");
    if (job.cancel_requested === true) {
      finishJob(job, "cancelled", { status: "cancelled" });
      job.cancel_outcome = "prevented_before_execution";
      await persistJobSafe(job);
      await recordRunEvent(job, "job_cancelled", { executed: false }, "cancelled");
      return;
    }
    try {
      const result = await handleBrowserExecuteJs(executeArgs);
      const ok = result?.status === "success";
      finishJob(job, ok ? "completed" : "failed", result, ok ? undefined : result?.error);
      await persistJobSafe(job);
      await recordRunEvent(job, "job_finished", {
        result_status: result?.status,
        cancel_requested: job.cancel_requested === true,
        cancel_outcome: job.cancel_outcome,
      }, job.status);
    } catch (error) {
      const message = String(error?.message ?? error);
      finishJob(job, "failed", { status: "failed", error: message }, message);
      await persistJobSafe(job);
      await recordRunEvent(job, "job_failed", { error: job.error }, "failed");
    }
  })();
}

async function startJob(args = {}) {
  await ensureRecovered();
  if (!String(args.code ?? args.script ?? "").trim()) {
    return { ok: false, action: "start", error: "browser_job_ops start requires code or script" };
  }
  const createdAt = nowIso();
  const job = {
    schema_version: JOB_SCHEMA_VERSION,
    job_id: makeJobId(),
    status: "pending",
    durable: false,
    durability_reason: "no_run_checkpoint",
    cancel_requested: false,
    cancel_outcome: "not_requested",
    workspace_key: String(args.workspace_key ?? ""),
    task_id: String(args.task_id ?? ""),
    run_id: "",
    run_dir: "",
    title: String(args.title ?? ""),
    created_at: createdAt,
    started_at: null,
    updated_at: createdAt,
    finished_at: null,
    checkpoint_at: null,
    execution_deadline_at: executionDeadline(args),
    recovery_status: "not_needed",
    interrupted_reason: null,
    result_available: false,
    result: undefined,
    error: undefined,
  };
  await maybePrepareRun(args, job);
  job.durable = Boolean(job.run_dir);
  job.durability_reason = job.durable ? "run_backed_checkpoint" : "no_valid_run_checkpoint";
  jobs.set(job.job_id, job);
  pruneJobs();
  await persistJobSafe(job);
  startBackgroundJob(job, executeArgsFrom(args));
  return { ok: true, action: "start", job: serializableJob(job) };
}

function getJob(jobId) {
  const normalized = String(jobId ?? "").trim();
  return normalized ? jobs.get(normalized) ?? null : null;
}

async function statusJob(args = {}) {
  await ensureRecovered();
  const job = getJob(args.job_id);
  if (!job) return { ok: false, action: "status", error: "job not found" };
  return { ok: true, action: "status", job: serializableJob(job) };
}

async function resultJob(args = {}) {
  await ensureRecovered();
  const job = getJob(args.job_id);
  if (!job) return { ok: false, action: "result", error: "job not found" };
  return {
    ok: true,
    action: "result",
    result_available: job.result_available === true,
    job: serializableJob(job, { include_result: true }),
  };
}

async function cancelJob(args = {}) {
  await ensureRecovered();
  const job = getJob(args.job_id);
  if (!job) return { ok: false, action: "cancel", error: "job not found" };
  const previousStatus = job.status;
  job.cancel_requested = true;
  job.updated_at = nowIso();
  if (job.status === "pending") {
    job.status = "cancel_requested";
    job.cancel_outcome = "prevent_before_execution_requested";
  } else if (job.status === "running") {
    job.status = "cancel_requested";
    job.cancel_outcome = "intent_only_in_flight";
  } else {
    job.cancel_outcome = "already_finished";
  }
  await persistJobSafe(job);
  await recordRunEvent(job, "job_cancel_requested", {
    abort_supported: false,
    previous_status: previousStatus,
    cancel_outcome: job.cancel_outcome,
  }, job.status);
  return {
    ok: true,
    action: "cancel",
    abort_supported: false,
    cancel_outcome: job.cancel_outcome,
    note: job.cancel_outcome === "intent_only_in_flight"
      ? "cancel intent was recorded, but the in-flight Runtime.evaluate call cannot be preempted"
      : "cancel state recorded",
    job: serializableJob(job),
  };
}

async function listJobs(args = {}) {
  await ensureRecovered();
  const maxItems = Math.max(1, Math.min(500, Number(args.max_items ?? 50)));
  const rows = Array.from(jobs.values())
    .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
    .slice(0, maxItems)
    .map((job) => serializableJob(job));
  return {
    ok: true,
    action: "list",
    durable: rows.every((job) => job.durable === true),
    durable_jobs_supported: true,
    abort_supported: false,
    recovery_supported: true,
    jobs: rows,
    total: jobs.size,
  };
}

async function handleBrowserJobOps(args = {}) {
  const action = String(args.action ?? "status");
  if (action === "start") return startJob(args);
  if (action === "status") return statusJob(args);
  if (action === "result") return resultJob(args);
  if (action === "cancel") return cancelJob(args);
  if (action === "list") return listJobs(args);
  return { ok: false, action, error: `unknown browser_job_ops action: ${action}` };
}

export {
  JOB_SCHEMA_VERSION,
  handleBrowserJobOps,
  recoverJobsFromDisk,
};
