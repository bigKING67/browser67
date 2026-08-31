import { sessionPointers } from "../runtime/sessions/registry.mjs";
import {
  buildFinalizeCleanupSummary,
  deleteManagedTab,
  formatFinalizeDeliverySummary,
  listManagedTabRecords,
} from "../tab-workspace/index.mjs";
import { bridgeCommand } from "./tmwd-adapter.mjs";
import { browserTabKey } from "../tab-workspace/identity.mjs";
import {
  cleanupCreatedAgentWindow,
  createdAgentWindowCleanupCandidate,
} from "../browser-wrappers/tab-lifecycle-close.mjs";

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

async function pruneStaleRegistryRecords(args, scope, dependencies = {}) {
  const readScopedRecords = dependencies.recordsInScope ?? recordsInScope;
  const runBridgeCommand = dependencies.bridgeCommand ?? bridgeCommand;
  const removeManagedTab = dependencies.deleteManagedTab ?? deleteManagedTab;
  const scoped = await readScopedRecords(scope);
  const legacy = scoped.filter((record) => record.browser_instance_identity !== "resolved");
  const recordsByInstance = new Map();
  for (const record of scoped) {
    if (record.browser_instance_identity !== "resolved") continue;
    const browserInstanceId = String(record.browser_instance_id ?? "").trim();
    if (!browserInstanceId) continue;
    const records = recordsByInstance.get(browserInstanceId) ?? [];
    records.push(record);
    recordsByInstance.set(browserInstanceId, records);
  }

  const instanceChecks = await Promise.all([...recordsByInstance.entries()].map(async ([browserInstanceId, records]) => {
    try {
      const tabs = await runBridgeCommand({
        ...args,
        browser_instance_id: browserInstanceId,
      }, { cmd: "tabs" });
      const liveIds = new Set((Array.isArray(tabs.value) ? tabs.value : [])
        .filter((tab) => String(tab?.browser_instance_id ?? "").trim() === browserInstanceId)
        .map((tab) => browserTabKey(tab))
        .filter(Boolean));
      const stale = records.filter((record) => !liveIds.has(browserTabKey(record)));
      const kept = records.filter((record) => liveIds.has(browserTabKey(record)));
      return {
        browser_instance_id: browserInstanceId,
        ok: true,
        checked_count: records.length,
        stale,
        kept,
        transport: tabs.transport,
        transport_attempts: tabs.transport_attempts,
      };
    } catch (error) {
      return {
        browser_instance_id: browserInstanceId,
        ok: false,
        checked_count: records.length,
        stale: [],
        kept: records,
        error: String(error?.message ?? error),
        error_code: String(error?.code ?? error?.errorCode ?? "") || undefined,
      };
    }
  }));
  const stale = instanceChecks.flatMap((check) => check.stale);
  if (args?.dry_run !== true) {
    await Promise.all(stale.map((record) => removeManagedTab(record.tab_id, record.browser_instance_id)));
  }
  return {
    ok: true,
    action: "prune_stale",
    dry_run: args?.dry_run === true,
    checked_count: scoped.length,
    pruned_count: args?.dry_run === true ? 0 : stale.length,
    would_prune_count: stale.length,
    preserved_count: scoped.length - stale.length,
    kept: [
      ...legacy.map((record) => ({
        tab_id: record.tab_id,
        browser_instance_id: record.browser_instance_id || undefined,
        session_key: record.session_key,
        reason: "legacy_browser_instance_unresolved",
      })),
      ...instanceChecks.flatMap((check) => check.kept.map((record) => ({
        tab_id: record.tab_id,
        browser_instance_id: record.browser_instance_id,
        session_key: record.session_key,
        reason: check.ok ? "live" : "live_check_unavailable",
        error: check.ok ? undefined : check.error,
        error_code: check.ok ? undefined : check.error_code,
      }))),
    ],
    pruned: stale.map((record) => ({
      tab_id: record.tab_id,
      browser_instance_id: record.browser_instance_id,
      session_key: record.session_key,
      reason: "not_live_in_browser_instance",
    })),
    instance_checks: instanceChecks.map((check) => ({
      browser_instance_id: check.browser_instance_id,
      ok: check.ok,
      checked_count: check.checked_count,
      would_prune_count: check.stale.length,
      preserved_count: check.kept.length,
      transport: check.transport,
      error: check.error,
      error_code: check.error_code,
    })),
    transport: "per_browser_instance",
    transport_attempts: instanceChecks.flatMap((check) => (
      Array.isArray(check.transport_attempts) ? check.transport_attempts : []
    )),
  };
}

async function closeUnkeptScopedRecords(args, scope) {
  const candidates = (await recordsInScope(scope)).filter((record) => record.keep !== true);
  const outcomes = await Promise.all(candidates.map(async (record) => {
    if (args?.dry_run === true || record.dry_run === true) {
      return { closed: { tab_id: record.tab_id, closed: false, dry_run: true, reason: "dry_run" } };
    }
    try {
      if (record.browser_instance_identity !== "resolved") {
        throw new Error("legacy managed tab has no Browser Instance identity");
      }
      const result = await bridgeCommand({
        ...args,
        browser_instance_id: record.browser_instance_id,
      }, {
        cmd: "tabs",
        method: "close",
        tabId: record.tab_id,
      });
      if (result.value?.closed !== true) {
        throw new Error("tabs.close did not confirm closed=true");
      }
      await deleteManagedTab(record.tab_id, record.browser_instance_id);
      return {
        closed: {
          tab_id: record.tab_id,
          browser_instance_id: record.browser_instance_id,
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
  const initialRecords = await recordsInScope(scope);
  const agentWindowCandidate = createdAgentWindowCleanupCandidate(initialRecords);
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
  let agentWindowCleanup;
  try {
    agentWindowCleanup = await cleanupCreatedAgentWindow(args, agentWindowCandidate, {
      run_agent_window_command: (command, candidate) => bridgeCommand({
        ...args,
        browser_instance_id: candidate.browser_instance_id,
      }, command),
    });
  } catch (error) {
    agentWindowCleanup = {
      requested: args?.cleanup_created_agent_window === true,
      status: "error",
      closed: false,
      error: String(error?.message ?? error),
    };
  }
  const remaining = summarizeRecords(await recordsInScope(scope));
  const cleanupSummary = buildFinalizeCleanupSummary({
    closeUnkept,
    dryRun,
    pruneStale,
    remaining,
    scope,
  });
  const agentWindowCleanupTerminal = ["closed", "already_closed"].includes(agentWindowCleanup.status)
    && agentWindowCleanup.close_verified === true
    && agentWindowCleanup.ownership_record_removed === true;
  const agentWindowCleanupOk = agentWindowCleanup.requested !== true
    || agentWindowCleanupTerminal
    || ["not_owned", "dry_run"].includes(agentWindowCleanup.status);
  const ok = (pruneStale?.ok ?? true) === true
    && closeUnkept.ok === true
    && agentWindowCleanupOk;
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
      cleans_up_created_agent_window_only_when_requested: true,
      preserves_nonempty_agent_window: true,
      recovers_exact_owned_orphan_new_tab: true,
      agent_window_orphan_recovery_policy: "same_browser_profile_epoch_exact_window_sole_browser_new_tab",
      prunes_stale_registry_records: args?.prune_stale !== false,
    },
    prune_stale: pruneStale,
    close_unkept: closeUnkept,
    agent_window_cleanup: agentWindowCleanup,
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
  pruneStaleRegistryRecords,
};
