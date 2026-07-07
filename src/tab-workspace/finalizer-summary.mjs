function countRows(rows, predicate) {
  return Array.isArray(rows) ? rows.filter(predicate).length : 0;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeFinalizeScope(scope = {}) {
  const fallbackScope = scope.workspaceKey || scope.workspace_key
    ? "workspace"
    : (scope.taskId || scope.task_id ? "task" : "unknown");
  return {
    scope: String(scope.scope ?? "").trim() || fallbackScope,
    workspace_key: String(scope.workspace_key ?? scope.workspaceKey ?? "").trim() || undefined,
    task_id: String(scope.task_id ?? scope.taskId ?? "").trim() || undefined,
    all: scope.all === true,
  };
}

function closeErrorCount(closeUnkept = {}) {
  const errorRows = Array.isArray(closeUnkept?.errors) ? closeUnkept.errors : [];
  if (errorRows.length > 0) {
    return errorRows.length;
  }
  if (closeUnkept?.status === "error" || closeUnkept?.ok === false) {
    return 1;
  }
  return 0;
}

function buildFinalizeCleanupSummary({
  closeUnkept,
  dryRun = false,
  pruneStale,
  remaining,
  scope,
} = {}) {
  const normalizedScope = normalizeFinalizeScope(scope);
  const closedRows = Array.isArray(closeUnkept?.closed) ? closeUnkept.closed : [];
  return {
    scope: normalizedScope.scope,
    workspace_key: normalizedScope.workspace_key,
    task_id: normalizedScope.task_id,
    all: normalizedScope.all,
    dry_run: dryRun === true,
    closed_count: countRows(closedRows, (row) => row?.closed === true),
    would_close_count: countRows(closedRows, (row) => row?.dry_run === true),
    close_verified_count: countRows(closedRows, (row) => row?.close_verified === true),
    close_error_count: closeErrorCount(closeUnkept),
    stale_pruned_count: numberOrZero(pruneStale?.pruned_count),
    stale_would_prune_count: numberOrZero(pruneStale?.would_prune_count),
    remaining_total_count: numberOrZero(remaining?.total_count),
    remaining_kept_count: numberOrZero(remaining?.kept_count),
    remaining_unkept_count: numberOrZero(remaining?.unkept_count),
  };
}

function formatFinalizeDeliverySummary(summary, options = {}) {
  const prefix = String(options.prefix ?? "browser67 cleanup").trim() || "browser67 cleanup";
  const scopeParts = [];
  if (summary.workspace_key) {
    scopeParts.push(`workspace_key=${summary.workspace_key}`);
  }
  if (summary.task_id) {
    scopeParts.push(`task_id=${summary.task_id}`);
  }
  if (summary.all) {
    scopeParts.push("scope=all");
  }
  if (scopeParts.length === 0) {
    scopeParts.push(`scope=${summary.scope}`);
  }
  const fields = [
    `${prefix}:`,
    `finalize_task ${scopeParts.join(" ")}`,
    `closed=${summary.closed_count}`,
    `would_close=${summary.would_close_count}`,
    `stale_pruned=${summary.stale_pruned_count}`,
    `kept=${summary.remaining_kept_count}`,
    `remaining_unkept=${summary.remaining_unkept_count}`,
    `errors=${summary.close_error_count}`,
  ];
  if (options.include_close_verified !== false) {
    fields.splice(4, 0, `verified=${summary.close_verified_count}`);
  }
  return fields.join(" ");
}

export {
  buildFinalizeCleanupSummary,
  formatFinalizeDeliverySummary,
};
