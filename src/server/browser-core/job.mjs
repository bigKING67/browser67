import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  handleBrowserRunOps,
  runDirFor,
  runRoot,
} from "../../runtime/runs/lifecycle.mjs";
import { defaultJobRuntimeState } from "../../runtime/jobs/state.mjs";
import { atomicWriteJson } from "../../runtime/storage/atomic-file.mjs";
import { handleBrowserExecuteJs } from "./execute-js.mjs";

const JOB_SCHEMA_VERSION = "browser67.browser-job.v3";
const MAX_RETAINED_JOBS = 200;

function jobRuntimeState(options = {}) {
  return options.runtime?.jobState ?? defaultJobRuntimeState;
}

const EXECUTE_ARG_KEYS = [
  "script",
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

async function persistJob(job, state = defaultJobRuntimeState, options = {}) {
  if (job.durable !== true) return false;
  const statePath = jobStatePath(job);
  if (!statePath) return false;
  const checkpointAt = nowIso();
  job.checkpoint_at = checkpointAt;
  await atomicWriteJson(statePath, persistedJob(job));
  await state.getStore(runRoot(options)).index(job, statePath);
  return true;
}

async function persistJobSafe(job, state = defaultJobRuntimeState, options = {}) {
  try {
    return await persistJob(job, state, options);
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

async function readIndexedJob(reference, options = {}) {
  const statePath = path.resolve(String(reference?.state_path ?? ""));
  if (!statePath) return null;
  const relative = path.relative(runRoot(options), statePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  let payload;
  try {
    payload = JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return null;
  }
  const stateJobId = path.basename(statePath, ".json");
  if (!/^job_[a-zA-Z0-9_]+$/.test(String(payload?.job_id ?? ""))) return null;
  if (payload.job_id !== stateJobId) return null;
  return restoredJob(payload, statePath);
}

async function recoverJobsFromDisk(state = defaultJobRuntimeState, options = {}) {
  const jobs = state.jobs;
  const recoveredAt = nowIso();
  const store = state.getStore(runRoot(options));
  const activeReferences = await store.activeReferences();
  for (const reference of activeReferences) {
    const job = await readIndexedJob(reference, options);
    if (!job || jobs.has(job.job_id)) continue;
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
      await persistJobSafe(job, state, options);
    }
    jobs.set(job.job_id, job);
  }
  const recentReferences = await store.recentReferences(MAX_RETAINED_JOBS);
  for (const reference of recentReferences) {
    if (jobs.has(reference.job_id) || reference.active === true) continue;
    const job = await readIndexedJob(reference, options);
    if (!job) continue;
    job.recovery_status = "recovered_terminal_checkpoint";
    jobs.set(job.job_id, job);
  }
  pruneJobs(state);
}

async function ensureRecovered(state = defaultJobRuntimeState, options = {}) {
  const currentRunRoot = runRoot(options);
  if (state.recoveryRunRoot !== currentRunRoot) {
    state.jobs.clear();
    state.recoveryPromise = null;
    state.recoveryRunRoot = currentRunRoot;
  }
  if (!state.recoveryPromise) state.recoveryPromise = recoverJobsFromDisk(state, options);
  await state.recoveryPromise;
}

function pruneJobs(state = defaultJobRuntimeState) {
  const jobs = state.jobs;
  if (jobs.size <= MAX_RETAINED_JOBS) return;
  const rows = Array.from(jobs.values())
    .sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at)));
  for (const row of rows.slice(0, Math.max(0, jobs.size - MAX_RETAINED_JOBS))) {
    if (!["running", "cancel_requested"].includes(row.status)) jobs.delete(row.job_id);
  }
}

async function recordRunEvent(job, event, data = {}, status = "", options = {}) {
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
    }, options);
  } catch (error) {
    job.run_event_error = String(error?.message ?? error);
  }
}

async function maybePrepareRun(args, job, options = {}) {
  if (String(args.run_id ?? "").trim()) {
    job.run_id = String(args.run_id).trim();
    try {
      job.run_dir = runDirFor({
        workspace_key: job.workspace_key,
        task_id: job.task_id,
        run_id: job.run_id,
      }, options);
      const status = await handleBrowserRunOps({
        action: "status",
        workspace_key: job.workspace_key,
        task_id: job.task_id,
        run_id: job.run_id,
        summary_only: true,
      }, options);
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
  }, options);
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

function startBackgroundJob(job, executeArgs, state = defaultJobRuntimeState, options = {}) {
  job.promise = (async () => {
    job.status = "running";
    job.started_at = nowIso();
    job.updated_at = job.started_at;
    await persistJobSafe(job, state, options);
    await recordRunEvent(job, "job_started", { durable: job.durable === true }, "running", options);
    if (job.cancel_requested === true) {
      finishJob(job, "cancelled", { status: "cancelled" });
      job.cancel_outcome = "prevented_before_execution";
      await persistJobSafe(job, state, options);
      await recordRunEvent(job, "job_cancelled", { executed: false }, "cancelled", options);
      return;
    }
    try {
      const result = await handleBrowserExecuteJs(executeArgs, options);
      const ok = result?.status === "success";
      finishJob(job, ok ? "completed" : "failed", result, ok ? undefined : result?.error);
      await persistJobSafe(job, state, options);
      await recordRunEvent(job, "job_finished", {
        result_status: result?.status,
        cancel_requested: job.cancel_requested === true,
        cancel_outcome: job.cancel_outcome,
      }, job.status, options);
    } catch (error) {
      const message = String(error?.message ?? error);
      finishJob(job, "failed", { status: "failed", error: message }, message);
      await persistJobSafe(job, state, options);
      await recordRunEvent(job, "job_failed", { error: job.error }, "failed", options);
    }
  })();
}

async function startJob(args = {}, options = {}) {
  const state = jobRuntimeState(options);
  const jobs = state.jobs;
  await ensureRecovered(state, options);
  if (!String(args.script ?? "").trim()) {
    return { ok: false, action: "start", error: "browser_job_ops start requires script" };
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
  await maybePrepareRun(args, job, options);
  job.durable = Boolean(job.run_dir);
  job.durability_reason = job.durable ? "run_backed_checkpoint" : "no_valid_run_checkpoint";
  jobs.set(job.job_id, job);
  pruneJobs(state);
  await persistJobSafe(job, state, options);
  startBackgroundJob(job, executeArgsFrom(args), state, options);
  return { ok: true, action: "start", job: serializableJob(job) };
}

async function getJob(jobId, state = defaultJobRuntimeState, options = {}) {
  const jobs = state.jobs;
  const normalized = String(jobId ?? "").trim();
  if (!normalized) return null;
  if (jobs.has(normalized)) return jobs.get(normalized);
  const reference = await state.getStore(runRoot(options)).findReference(normalized);
  if (!reference) return null;
  const job = await readIndexedJob(reference, options);
  if (job) jobs.set(job.job_id, job);
  return job;
}

async function statusJob(args = {}, options = {}) {
  const state = jobRuntimeState(options);
  await ensureRecovered(state, options);
  const job = await getJob(args.job_id, state, options);
  if (!job) return { ok: false, action: "status", error: "job not found" };
  return { ok: true, action: "status", job: serializableJob(job) };
}

async function resultJob(args = {}, options = {}) {
  const state = jobRuntimeState(options);
  await ensureRecovered(state, options);
  const job = await getJob(args.job_id, state, options);
  if (!job) return { ok: false, action: "result", error: "job not found" };
  return {
    ok: true,
    action: "result",
    result_available: job.result_available === true,
    job: serializableJob(job, { include_result: true }),
  };
}

async function cancelJob(args = {}, options = {}) {
  const state = jobRuntimeState(options);
  await ensureRecovered(state, options);
  const job = await getJob(args.job_id, state, options);
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
  await persistJobSafe(job, state, options);
  await recordRunEvent(job, "job_cancel_requested", {
    abort_supported: false,
    previous_status: previousStatus,
    cancel_outcome: job.cancel_outcome,
  }, job.status, options);
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

async function listJobs(args = {}, options = {}) {
  const state = jobRuntimeState(options);
  const jobs = state.jobs;
  await ensureRecovered(state, options);
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

async function handleBrowserJobOps(args = {}, options = {}) {
  const action = String(args.action ?? "status");
  if (action === "start") return startJob(args, options);
  if (action === "status") return statusJob(args, options);
  if (action === "result") return resultJob(args, options);
  if (action === "cancel") return cancelJob(args, options);
  if (action === "list") return listJobs(args, options);
  return { ok: false, action, error: `unknown browser_job_ops action: ${action}` };
}

export {
  JOB_SCHEMA_VERSION,
  handleBrowserJobOps,
  recoverJobsFromDisk,
};
