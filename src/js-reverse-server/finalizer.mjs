import { sessionPointers } from "../runtime/sessions/registry.mjs";
import {
  buildFinalizeCleanupSummary,
  deleteManagedTab,
  formatFinalizeDeliverySummary,
  listManagedTabRecords,
} from "../tab-workspace/index.mjs";
import { bridgeCommand } from "./tmwd-adapter.mjs";

function resolveFinalizeScope(args = {}) {
  const taskId = String(args.task_id ?? args.taskId ?? "").trim();
  const workspaceKey = String(args.workspace_key ?? args.workspaceKey ?? "").trim();
  const scope = String(args.scope ?? "").trim().toLowerCase();
  const all = scope === "all" || args.all === true || args.confirm_all === true;
  if (!taskId && !workspaceKey && !all) {
    return {
      ok: false,
      error: "workspace_key or task_id is required for finalize_task; use scope=\"all\" only after explicitly confirming cross-workspace cleanup",
    };
  }
  return {
    ok: true,
    taskId,
    workspaceKey,
    all,
    scope: all ? "all" : (workspaceKey ? "workspace" : "task"),
  };
}

async function recordsInScope(scope) {
  return listManagedTabRecords(scope.all
    ? {}
    : { task_id: scope.taskId, workspace_key: scope.workspaceKey });
}

function summarizeRecords(records) {
  const rows = Array.isArray(records) ? records : [];
  return {
    total_count: rows.length,
    kept_count: rows.filter((record) => record.keep === true).length,
    unkept_count: rows.filter((record) => record.keep !== true).length,
  };
}

async function pruneStaleRegistryRecords(args, scope) {
  const tabs = await bridgeCommand(args, { cmd: "tabs" });
  const liveIds = new Set((Array.isArray(tabs.value) ? tabs.value : [])
    .map((tab) => String(tab?.id ?? tab?.tab_id ?? tab?.tabId ?? "").trim())
    .filter(Boolean));
  const scoped = await recordsInScope(scope);
  const stale = scoped.filter((record) => !liveIds.has(String(record.tab_id)));
  if (args?.dry_run !== true) {
    await Promise.all(stale.map((record) => deleteManagedTab(record.tab_id)));
  }
  return {
    ok: true,
    action: "prune_stale",
    dry_run: args?.dry_run === true,
    checked_count: scoped.length,
    pruned_count: args?.dry_run === true ? 0 : stale.length,
    would_prune_count: stale.length,
    transport: tabs.transport,
    transport_attempts: tabs.transport_attempts,
  };
}

async function closeUnkeptScopedRecords(args, scope) {
  const candidates = (await recordsInScope(scope)).filter((record) => record.keep !== true);
  const outcomes = await Promise.all(candidates.map(async (record) => {
    if (args?.dry_run === true || record.dry_run === true) {
      return { closed: { tab_id: record.tab_id, closed: false, dry_run: true, reason: "dry_run" } };
    }
    try {
      const result = await bridgeCommand(args, {
        cmd: "tabs",
        method: "close",
        tabId: record.tab_id,
      });
      if (result.value?.closed !== true) {
        throw new Error("tabs.close did not confirm closed=true");
      }
      await deleteManagedTab(record.tab_id);
      return {
        closed: {
          tab_id: record.tab_id,
          closed: true,
          transport: result.transport,
          transport_attempts: result.transport_attempts,
        },
      };
    } catch (error) {
      return {
        error: {
          tab_id: record.tab_id,
          error: String(error?.message ?? error),
        },
      };
    }
  }));
  const closed = outcomes.map((item) => item.closed).filter(Boolean);
  const errors = outcomes.map((item) => item.error).filter(Boolean);
  return {
    ok: errors.length === 0,
    action: "close_unkept",
    closed,
    errors,
  };
}

async function handleFinalizeTask(args) {
  const scope = resolveFinalizeScope(args);
  if (scope.ok !== true) {
    return scope;
  }
  const dryRun = args?.dry_run === true;
  let pruneStale;
  if (args?.prune_stale !== false) {
    try {
      pruneStale = await pruneStaleRegistryRecords(args, scope);
    } catch (error) {
      pruneStale = {
        ok: false,
        action: "prune_stale",
        error: String(error?.message ?? error),
      };
    }
  }
  const closeUnkept = await closeUnkeptScopedRecords(args, scope);
  const remaining = summarizeRecords(await recordsInScope(scope));
  const cleanupSummary = buildFinalizeCleanupSummary({
    closeUnkept,
    dryRun,
    pruneStale,
    remaining,
    scope,
  });
  const ok = (pruneStale?.ok ?? true) === true && closeUnkept.ok === true;
  return {
    ok,
    action: "finalize_task",
    dry_run: dryRun,
    close_scope: {
      taskId: scope.taskId,
      workspaceKey: scope.workspaceKey,
      all: scope.all,
      scope: scope.scope,
    },
    finalizer_policy: {
      closes_only_managed_tabs: true,
      closes_keep_false: true,
      preserves_keep_true: true,
      ignores_unmanaged_user_tabs: true,
      prunes_stale_registry_records: args?.prune_stale !== false,
    },
    prune_stale: pruneStale,
    close_unkept: closeUnkept,
    remaining,
    cleanup_summary: cleanupSummary,
    delivery_summary: formatFinalizeDeliverySummary(cleanupSummary, {
      prefix: "js-reverse cleanup",
      include_close_verified: false,
    }),
    note: dryRun
      ? "dry_run only; no pages were closed"
      : "finalize_task completed; report this cleanup result with reverse evidence",
    ...sessionPointers(),
  };
}

export {
  handleFinalizeTask,
};
