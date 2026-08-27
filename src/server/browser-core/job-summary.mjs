import { ACTIVE_JOB_STATUSES } from "../../runtime/jobs/store.mjs";

function summarizeJobs(jobs = []) {
  const statusCounts = new Map();
  let durableCount = 0;
  let activeCount = 0;
  let resultAvailableCount = 0;
  let autoFinishRunCount = 0;
  let callerOwnedRunCount = 0;
  let runTerminalizedCount = 0;

  for (const job of jobs) {
    const status = String(job.status ?? "unknown").trim().toLowerCase().slice(0, 64) || "unknown";
    statusCounts.set(status, Number(statusCounts.get(status) ?? 0) + 1);
    if (job.durable === true) durableCount += 1;
    if (ACTIVE_JOB_STATUSES.has(status)) activeCount += 1;
    if (job.result_available === true) resultAvailableCount += 1;
    if (job.run_ownership === "job") autoFinishRunCount += 1;
    if (job.run_ownership === "caller") callerOwnedRunCount += 1;
    if (job.run_terminalized === true) runTerminalizedCount += 1;
  }

  return {
    durable: durableCount === jobs.length,
    total: jobs.length,
    active_count: activeCount,
    terminal_count: jobs.length - activeCount,
    durable_count: durableCount,
    non_durable_count: jobs.length - durableCount,
    result_available_count: resultAvailableCount,
    auto_finish_run_count: autoFinishRunCount,
    caller_owned_run_count: callerOwnedRunCount,
    run_terminalized_count: runTerminalizedCount,
    status_counts: Object.fromEntries([...statusCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))),
  };
}

export { summarizeJobs };
