import {
  buildFinalizeCleanupSummary,
  formatFinalizeDeliverySummary,
} from "../tab-workspace/index.mjs";
import { releaseAdopted } from "../tab-workspace/adoption.mjs";
import {
  cleanupCreatedAgentWindow,
  closeUnkeptManagedTabs,
  createdAgentWindowCleanupCandidate,
  pruneStaleManagedTabs,
} from "./tab-lifecycle-close.mjs";
import {
  resolveBrowserInstanceScope,
  resolveCloseScope,
  scopedManagedRecords,
  summarizeFinalizeRemainder,
} from "./tab-lifecycle-scope.mjs";

async function finalizeManagedTask(args = {}, options = {}) {
  const closeScope = await resolveBrowserInstanceScope(resolveCloseScope(args));
  const dryRun = args?.dry_run === true;
  const initialRecords = await scopedManagedRecords(closeScope);
  const agentWindowCandidate = createdAgentWindowCleanupCandidate(initialRecords);
  const shouldPruneStale = args?.prune_stale !== false;
  let pruneStale;
  if (shouldPruneStale) {
    try {
      pruneStale = await pruneStaleManagedTabs({
        ...args,
        ...(closeScope.browser_instance_id
          ? { browser_instance_id: closeScope.browser_instance_id }
          : {}),
        dry_run: dryRun,
        summary_only: args?.summary_only ?? true,
      }, { ...options, closeScope });
    } catch (error) {
      pruneStale = {
        status: "error",
        action: "prune_stale",
        error: String(error?.message ?? error),
      };
    }
  }
  let closeUnkept;
  try {
    closeUnkept = await closeUnkeptManagedTabs(args, options, closeScope);
  } catch (error) {
    closeUnkept = {
      status: "error",
      action: "close_unkept",
      error: String(error?.message ?? error),
    };
  }
  const adoptedRecords = (await scopedManagedRecords(closeScope))
    .filter((record) => record.ownership_origin === "user_adopted");
  const releasedAdopted = [];
  for (const record of adoptedRecords) {
    if (dryRun) {
      releasedAdopted.push({
        status: "success",
        action: "release_adopted",
        released: false,
        would_release: true,
        closed: false,
        tab_id: record.tab_id,
      });
    } else {
      releasedAdopted.push(await releaseAdopted({
        tab_id: record.tab_id,
        browser_instance_id: record.browser_instance_id,
        workspace_key: record.workspace_key,
        task_id: record.task_id,
      }, {
        ...options,
        scope: { workspace_key: record.workspace_key, task_id: record.task_id },
        ignore_lease: true,
      }));
    }
  }
  const remainingRecords = await scopedManagedRecords(closeScope);
  let agentWindowCleanup;
  try {
    agentWindowCleanup = await cleanupCreatedAgentWindow(args, agentWindowCandidate, options);
  } catch (error) {
    agentWindowCleanup = {
      requested: args?.cleanup_created_agent_window === true,
      status: "error",
      closed: false,
      error: String(error?.message ?? error),
    };
  }
  const remaining = summarizeFinalizeRemainder(remainingRecords, args);
  let runFinalize;
  if (closeScope.all) {
    runFinalize = {
      ok: true,
      action: "finish_scope",
      skipped: true,
      reason: "global_run_finalization_requires_exact_workspace_or_task_scope",
    };
  } else {
    try {
      runFinalize = await options.runtime?.runStore?.finishScope?.({
        workspace_key: closeScope.workspaceKey,
        task_id: closeScope.taskId,
        dry_run: dryRun,
        summary_only: args?.summary_only ?? true,
        terminalized_by: "browser_tab_lifecycle.finalize_task",
        reason: "managed_task_finalized",
      }) ?? {
        ok: true,
        action: "finish_scope",
        skipped: true,
        reason: "run_store_unavailable",
      };
    } catch (error) {
      runFinalize = {
        ok: false,
        action: "finish_scope",
        error: String(error?.message ?? error),
      };
    }
  }
  const cleanupSummary = buildFinalizeCleanupSummary({
    scope: closeScope,
    closeUnkept,
    dryRun,
    pruneStale,
    remaining,
  });
  const pruneOk = !pruneStale || pruneStale.status === "success";
  const closeOk = closeUnkept.status === "success";
  const agentWindowCleanupTerminal = ["closed", "already_closed"].includes(agentWindowCleanup.status)
    && agentWindowCleanup.close_verified === true
    && agentWindowCleanup.ownership_record_removed === true;
  const agentWindowUserContentPreserved = agentWindowCleanup.status === "preserved"
    && agentWindowCleanup.user_content_preserved === true
    && agentWindowCleanup.internal_tab_removed === true
    && agentWindowCleanup.ownership_record_removed === true;
  const agentWindowCleanupOk = agentWindowCleanup.requested !== true
    || agentWindowCleanupTerminal
    || agentWindowUserContentPreserved
    || agentWindowCleanup.status === "not_owned"
    || agentWindowCleanup.status === "dry_run";
  const runFinalizeOk = runFinalize.ok === true;
  return {
    status: pruneOk && closeOk && agentWindowCleanupOk && runFinalizeOk ? "success" : "partial",
    action: "finalize_task",
    dry_run: dryRun,
    finalizer_policy: {
      scope: closeScope.scope,
      browser_instance_scope: closeScope.browser_instance_scope,
      closes_only_managed_tabs: true,
      closes_keep_false: true,
      preserves_keep_true: true,
      ignores_unmanaged_user_tabs: true,
      releases_user_adopted_tabs: true,
      closes_user_adopted_tabs: false,
      cleans_up_created_agent_window_only_when_requested: true,
      preserves_nonempty_agent_window: true,
      preserves_concurrent_user_content: true,
      recovers_exact_owned_orphan_new_tab: true,
      agent_window_orphan_recovery_policy: "same_browser_profile_epoch_exact_window_sole_browser_new_tab",
      prunes_stale_registry_records: shouldPruneStale,
      terminalizes_nonterminal_runs_in_exact_task_scope: !closeScope.all,
    },
    close_scope: closeScope,
    prune_stale: pruneStale,
    close_unkept: closeUnkept,
    release_adopted: releasedAdopted,
    agent_window_cleanup: agentWindowCleanup,
    run_finalize: runFinalize,
    remaining,
    cleanup_summary: cleanupSummary,
    delivery_summary: formatFinalizeDeliverySummary(cleanupSummary, {
      prefix: "browser67 cleanup",
    }),
    next_step: dryRun
      ? "Call finalize_task without dry_run to close the listed keep=false managed tabs."
      : "Report the finalize_task result in the task handoff or final response.",
  };
}

export { finalizeManagedTask };
