import { CAPABILITIES } from "../capabilities.mjs";
import { cdpRunCommand } from "../cdp-runtime.mjs";
import { createToolError } from "../errors.mjs";
import {
  sessionPointers,
} from "../session-registry.mjs";
import {
  deleteManagedTab,
  getManagedTab,
  listManagedTabRecords,
  managedTabPayload,
  updateManagedTab,
} from "../tab-workspace.mjs";
import { resolvePreferredBrowserContext } from "../tmwd-runtime.mjs";
import {
  executeTmwdCommandWithPreferred,
  liveTabMap,
  readBrowserTabById,
  resolveManagedRecordLiveness,
  sleep,
} from "./shared.mjs";
import {
  DEFAULT_LIST_MANAGED_MAX_ITEMS,
  limitedList,
  normalizeListManagedLimit,
} from "./tab-lifecycle-limits.mjs";
import {
  resolveCloseScope,
  scopedManagedRecords,
  summarizeFinalizeRemainder,
} from "./tab-lifecycle-scope.mjs";

function normalizeCloseVerifyTimeout(args = {}) {
  const raw = Number(args.close_verify_timeout_ms ?? args.closeVerifyTimeoutMs ?? 1_500);
  if (!Number.isFinite(raw)) {
    return 1_500;
  }
  return Math.max(0, Math.min(10_000, Math.floor(raw)));
}

function normalizeCloseVerifyPoll(args = {}) {
  const raw = Number(args.close_verify_poll_ms ?? args.closeVerifyPollMs ?? 100);
  if (!Number.isFinite(raw)) {
    return 100;
  }
  return Math.max(50, Math.min(1_000, Math.floor(raw)));
}

async function verifyTabClosed(args, preferred, tabId) {
  const timeoutMs = normalizeCloseVerifyTimeout(args);
  const pollMs = normalizeCloseVerifyPoll(args);
  const startedAt = Date.now();
  let polls = 0;
  let lastTab = null;
  do {
    polls += 1;
    lastTab = await readBrowserTabById(args, preferred, tabId);
    if (!lastTab) {
      return {
        verified: true,
        tab_id: tabId,
        method: preferred.transport === "cdp" ? "cdp_target_lookup" : "tmwd_tabs_get_or_list",
        timeout_ms: timeoutMs,
        poll_ms: pollMs,
        polls,
        elapsed_ms: Date.now() - startedAt,
      };
    }
    if (timeoutMs === 0 || Date.now() - startedAt >= timeoutMs) {
      break;
    }
    await sleep(Math.min(pollMs, Math.max(0, timeoutMs - (Date.now() - startedAt))));
  } while (Date.now() - startedAt <= timeoutMs);
  return {
    verified: false,
    tab_id: tabId,
    method: preferred.transport === "cdp" ? "cdp_target_lookup" : "tmwd_tabs_get_or_list",
    timeout_ms: timeoutMs,
    poll_ms: pollMs,
    polls,
    elapsed_ms: Date.now() - startedAt,
    still_visible_tab: lastTab
      ? {
          id: lastTab.id,
          url: lastTab.url,
          title: lastTab.title,
        }
      : null,
  };
}

async function closeOneManagedTab(args, record, preferred = null) {
  if (record.dry_run === true || args?.dry_run === true) {
    return {
      tab_id: record.tab_id,
      closed: false,
      dry_run: true,
      reason: "dry_run",
    };
  }
  const resolved = preferred ?? await resolvePreferredBrowserContext(args ?? {});
  if (resolved.transport === "tmwd_ws" || resolved.transport === "tmwd_link") {
    const result = await executeTmwdCommandWithPreferred(args, resolved, {
      cmd: "tabs",
      method: "close",
      tabId: record.tab_id,
    });
    if (result.value?.closed !== true) {
      throw createToolError(
        "EXECUTION_ERROR",
        "tabs.close did not confirm closed=true; reload the TMWD browser extension if it is still running old bridge code",
      );
    }
    const closeVerification = await verifyTabClosed(args, resolved, record.tab_id);
    if (closeVerification.verified !== true) {
      throw createToolError(
        "EXECUTION_ERROR",
        "tabs.close returned closed=true but the tab remained visible after close verification",
        {
          retryable: true,
          details: closeVerification,
        },
      );
    }
    return {
      tab_id: record.tab_id,
      closed: true,
      close_verified: true,
      close_verification: closeVerification,
      transport: result.transport,
      transport_attempts: result.transport_attempts,
    };
  }
  await cdpRunCommand({ ...args, switch_tab_id: record.tab_id }, "Target.closeTarget", {
    targetId: record.tab_id,
  });
  const closeVerification = await verifyTabClosed(args, resolved, record.tab_id);
  if (closeVerification.verified !== true) {
    throw createToolError(
      "EXECUTION_ERROR",
      "Target.closeTarget returned but the tab remained visible after close verification",
      {
        retryable: true,
        details: closeVerification,
      },
    );
  }
  return {
    tab_id: record.tab_id,
    closed: true,
    close_verified: true,
    close_verification: closeVerification,
    transport: "cdp",
  };
}

async function closeUnkeptManagedTabs(args) {
  const closeScope = resolveCloseScope(args ?? {});
  const unmanagedTabId = String(args?.tab_id ?? args?.session_id ?? "").trim();
  const unmanagedRecord = unmanagedTabId ? await getManagedTab(unmanagedTabId) : null;
  const unmanagedIgnored = unmanagedTabId && !unmanagedRecord ? [unmanagedTabId] : [];
  const candidates = (await listManagedTabRecords(closeScope.all
    ? {}
    : { task_id: closeScope.taskId, workspace_key: closeScope.workspaceKey }))
    .filter((record) => record.keep !== true);
  const closed = [];
  const errors = [];
  const preferred = args?.dry_run === true || candidates.length === 0
    ? null
    : await resolvePreferredBrowserContext(args ?? {});
  const outcomes = await Promise.all(candidates.map(async (record) => {
    try {
      const result = await closeOneManagedTab(args, record, preferred);
      return { record, result };
    } catch (error) {
      return {
        record,
        error: {
          tab_id: record.tab_id,
          error: String(error?.message ?? error),
        },
      };
    }
  }));
  await Promise.all(outcomes.map(async ({ record, result, error }) => {
    if (error) {
      errors.push(error);
      return;
    }
    closed.push(result);
    if (args?.dry_run !== true && record.dry_run !== true) {
      await updateManagedTab(record.tab_id, {
        status: result.closed ? "closed" : record.status,
        touch: false,
      });
      if (result.closed) {
        await deleteManagedTab(record.tab_id);
      }
    }
  }));
  return {
    status: errors.length > 0 ? "partial" : "success",
    action: "close_unkept",
    close_scope: closeScope,
    closed,
    errors,
    unmanaged_tabs_ignored: unmanagedIgnored,
    kept_tabs: (await listManagedTabRecords())
      .filter((record) => record.keep === true)
      .map((record) => managedTabPayload(record)),
  };
}

async function finalizeManagedTask(args = {}) {
  const closeScope = resolveCloseScope(args);
  const dryRun = args?.dry_run === true;
  const shouldPruneStale = args?.prune_stale !== false;
  let pruneStale;
  if (shouldPruneStale) {
    try {
      pruneStale = await pruneStaleManagedTabs({
        ...args,
        dry_run: dryRun,
        summary_only: args?.summary_only ?? true,
      });
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
    closeUnkept = await closeUnkeptManagedTabs(args);
  } catch (error) {
    closeUnkept = {
      status: "error",
      action: "close_unkept",
      error: String(error?.message ?? error),
    };
  }
  const remainingRecords = await scopedManagedRecords(closeScope);
  const remaining = summarizeFinalizeRemainder(remainingRecords, args);
  const pruneOk = !pruneStale || pruneStale.status === "success";
  const closeOk = closeUnkept.status === "success";
  return {
    status: pruneOk && closeOk ? "success" : "partial",
    action: "finalize_task",
    dry_run: dryRun,
    finalizer_policy: {
      scope: closeScope.scope,
      closes_only_managed_tabs: true,
      closes_keep_false: true,
      preserves_keep_true: true,
      ignores_unmanaged_user_tabs: true,
      prunes_stale_registry_records: shouldPruneStale,
    },
    close_scope: closeScope,
    prune_stale: pruneStale,
    close_unkept: closeUnkept,
    remaining,
    next_step: dryRun
      ? "Call finalize_task without dry_run to close the listed keep=false managed tabs."
      : "Report the finalize_task result in the task handoff or final response.",
  };
}

async function pruneStaleManagedTabs(args = {}) {
  const summaryOnly = args?.summary_only === true;
  const maxItems = normalizeListManagedLimit(args?.max_items, DEFAULT_LIST_MANAGED_MAX_ITEMS);
  const records = await listManagedTabRecords();
  if (records.length === 0) {
    return {
      status: "success",
      action: "prune_stale",
      dry_run: args?.dry_run === true,
      pruned_count: 0,
      would_prune_count: 0,
      pruned: [],
      kept: [],
      capabilities: CAPABILITIES,
      ...sessionPointers(),
    };
  }
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  const liveTabs = Array.isArray(preferred.context?.targets) ? preferred.context.targets : [];
  const liveById = liveTabMap(liveTabs);
  const livenessRows = await Promise.all(records.map(async (record) => ({
    record,
    liveness: await resolveManagedRecordLiveness(args, preferred, record, liveById),
  })));
  const pruned = [];
  const kept = [];
  await Promise.all(livenessRows.map(async ({ record, liveness }) => {
    const payload = {
      tab_id: record.tab_id,
      workspace_key: record.workspace_key,
      url: record.url,
      reason: liveness.reason,
    };
    if (liveness.live === true) {
      kept.push(payload);
      return;
    }
    pruned.push(payload);
    if (args?.dry_run !== true) {
      await deleteManagedTab(record.tab_id);
    }
  }));
  const prunedLimit = limitedList(pruned, maxItems, summaryOnly);
  const keptLimit = limitedList(kept, maxItems, summaryOnly);
  return {
    status: "success",
    action: "prune_stale",
    dry_run: args?.dry_run === true,
    transport: preferred.transport,
    transport_attempts: Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [],
    pruned_count: args?.dry_run === true ? 0 : pruned.length,
    would_prune_count: pruned.length,
    pruned: prunedLimit.values,
    kept: keptLimit.values,
    result_limits: {
      max_items: maxItems,
      summary_only: summaryOnly,
      pruned_returned_count: prunedLimit.returned_count,
      kept_returned_count: keptLimit.returned_count,
      pruned_truncated: prunedLimit.truncated,
      kept_truncated: keptLimit.truncated,
    },
    capabilities: CAPABILITIES,
    ...sessionPointers(),
  };
}

export {
  closeUnkeptManagedTabs,
  finalizeManagedTask,
  pruneStaleManagedTabs,
};
