import { randomUUID } from "node:crypto";

import { handleBrowserRunOps } from "../../run-lifecycle.mjs";
import { handleBrowserExecuteJs } from "./execute-js.mjs";

const JOB_SCHEMA_VERSION = "tmwd.browser.job.v1";
const MAX_RETAINED_JOBS = 200;
const jobs = new Map();

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

function serializableJob(job, { include_result = false } = {}) {
  return {
    schema_version: JOB_SCHEMA_VERSION,
    job_id: job.job_id,
    status: job.status,
    durable: false,
    abort_supported: false,
    cancel_requested: job.cancel_requested === true,
    workspace_key: job.workspace_key,
    task_id: job.task_id,
    run_id: job.run_id,
    title: job.title,
    created_at: job.created_at,
    started_at: job.started_at,
    updated_at: job.updated_at,
    finished_at: job.finished_at,
    error: job.error,
    result_available: job.result_available === true,
    result: include_result ? job.result : undefined,
  };
}

function pruneJobs() {
  if (jobs.size <= MAX_RETAINED_JOBS) {
    return;
  }
  const rows = Array.from(jobs.values())
    .sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at)));
  for (const row of rows.slice(0, Math.max(0, jobs.size - MAX_RETAINED_JOBS))) {
    if (row.status !== "running" && row.status !== "cancel_requested") {
      jobs.delete(row.job_id);
    }
  }
}

async function recordRunEvent(job, event, data = {}, status = "") {
  if (!job.run_id || (!job.workspace_key && !job.task_id)) {
    return;
  }
  try {
    await handleBrowserRunOps({
      action: "record_event",
      workspace_key: job.workspace_key,
      task_id: job.task_id,
      run_id: job.run_id,
      event,
      status,
      data: {
        job_id: job.job_id,
        ...data,
      },
    });
  } catch (error) {
    job.run_event_error = String(error?.message ?? error);
  }
}

async function maybePrepareRun(args, job) {
  if (String(args.run_id ?? "").trim()) {
    job.run_id = String(args.run_id).trim();
    return;
  }
  if (args.prepare_run === false || (!job.workspace_key && !job.task_id)) {
    return;
  }
  const prepared = await handleBrowserRunOps({
    action: "prepare",
    workspace_key: job.workspace_key,
    task_id: job.task_id,
    title: job.title || "browser job",
    data: {
      job_id: job.job_id,
      durable: false,
    },
  });
  if (prepared?.ok === true && prepared.run?.run_id) {
    job.run_id = prepared.run.run_id;
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
}

function startBackgroundJob(job, executeArgs) {
  job.promise = (async () => {
    job.status = "running";
    job.started_at = nowIso();
    job.updated_at = job.started_at;
    await recordRunEvent(job, "job_started", { durable: false }, "running");
    try {
      const result = await handleBrowserExecuteJs(executeArgs);
      const ok = result?.status === "success";
      finishJob(job, ok ? "completed" : "failed", result, ok ? undefined : result?.error);
      await recordRunEvent(
        job,
        "job_finished",
        {
          result_status: result?.status,
          cancel_requested: job.cancel_requested === true,
        },
        job.status,
      );
    } catch (error) {
      const message = String(error?.message ?? error);
      finishJob(job, "failed", { status: "failed", error: message }, message);
      await recordRunEvent(job, "job_failed", { error: job.error }, "failed");
    }
  })();
}

async function startJob(args = {}) {
  if (!String(args.code ?? args.script ?? "").trim()) {
    return {
      ok: false,
      action: "start",
      error: "browser_job_ops start requires code or script",
    };
  }
  const job = {
    schema_version: JOB_SCHEMA_VERSION,
    job_id: makeJobId(),
    status: "pending",
    durable: false,
    cancel_requested: false,
    workspace_key: String(args.workspace_key ?? ""),
    task_id: String(args.task_id ?? ""),
    run_id: "",
    title: String(args.title ?? ""),
    created_at: nowIso(),
    started_at: null,
    updated_at: nowIso(),
    finished_at: null,
    result_available: false,
    result: undefined,
    error: undefined,
  };
  await maybePrepareRun(args, job);
  jobs.set(job.job_id, job);
  pruneJobs();
  startBackgroundJob(job, executeArgsFrom(args));
  return {
    ok: true,
    action: "start",
    job: serializableJob(job),
  };
}

function getJob(jobId) {
  const normalized = String(jobId ?? "").trim();
  if (!normalized) {
    return null;
  }
  return jobs.get(normalized) ?? null;
}

function statusJob(args = {}) {
  const job = getJob(args.job_id);
  if (!job) {
    return { ok: false, action: "status", error: "job not found" };
  }
  return {
    ok: true,
    action: "status",
    job: serializableJob(job),
  };
}

function resultJob(args = {}) {
  const job = getJob(args.job_id);
  if (!job) {
    return { ok: false, action: "result", error: "job not found" };
  }
  return {
    ok: true,
    action: "result",
    result_available: job.result_available === true,
    job: serializableJob(job, { include_result: true }),
  };
}

async function cancelJob(args = {}) {
  const job = getJob(args.job_id);
  if (!job) {
    return { ok: false, action: "cancel", error: "job not found" };
  }
  job.cancel_requested = true;
  job.updated_at = nowIso();
  if (job.status === "pending" || job.status === "running") {
    job.status = "cancel_requested";
  }
  await recordRunEvent(job, "job_cancel_requested", { abort_supported: false }, job.status);
  return {
    ok: true,
    action: "cancel",
    abort_supported: false,
    note: "cancel marks intent only; in-flight browser execution cannot be preempted by this MCP wrapper yet",
    job: serializableJob(job),
  };
}

function listJobs(args = {}) {
  const maxItems = Math.max(1, Math.min(500, Number(args.max_items ?? 50)));
  const rows = Array.from(jobs.values())
    .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
    .slice(0, maxItems)
    .map((job) => serializableJob(job));
  return {
    ok: true,
    action: "list",
    durable: false,
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
};
