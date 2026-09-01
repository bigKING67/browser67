import { CAPABILITIES } from "../tab-workspace/capabilities.mjs";
import { cdpRunCommand } from "../cdp-runtime/index.mjs";
import { createToolError } from "../runtime/tool-errors.mjs";
import { defaultSessionRegistry } from "../runtime/sessions/registry.mjs";
import {
  deleteManagedTab,
  getManagedTab,
  bridgeCommandData,
  listManagedTabRecords,
  managedTabPayload,
  updateManagedTab,
} from "../tab-workspace/index.mjs";
import { resolvePreferredBrowserContext } from "../tmwd-runtime/index.mjs";
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
  resolveBrowserInstanceScope,
  scopedManagedRecords,
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

function recordUsesIsolatedTarget(record, args = {}) {
  if (["remote_cdp", "cdp"].includes(String(args?.tmwd_mode ?? ""))) {
    return true;
  }
  return record?.window_policy === "isolated_target"
    && record?.window_ownership === "remote_cdp";
}

function createdAgentWindowCleanupCandidate(records = []) {
  const candidates = records.filter((record) => (
    record?.ownership_origin === "agent_created"
    && record?.window_ownership === "browser67_agent"
    && record?.agent_window_created === true
    && Number.isInteger(record?.window_id)
    && Number.isInteger(record?.agent_window_anchor_tab_id)
    && String(record?.agent_window_ownership_token ?? "").trim()
    && String(record?.browser_instance_id ?? "").trim()
  ));
  const identities = new Map();
  for (const record of candidates) {
    const key = [
      record.browser_instance_id,
      record.window_id,
      record.agent_window_anchor_tab_id,
      record.agent_window_ownership_token,
    ].join(":");
    if (!identities.has(key)) identities.set(key, record);
  }
  if (identities.size !== 1) {
    return {
      eligible: false,
      reason: identities.size === 0
        ? "no_task_created_agent_window_identity"
        : "ambiguous_task_created_agent_window_identity",
      identity_count: identities.size,
    };
  }
  const record = [...identities.values()][0];
  return {
    eligible: true,
    browser_instance_id: record.browser_instance_id,
    window_id: record.window_id,
    anchor_tab_id: record.agent_window_anchor_tab_id,
    ownership_token: record.agent_window_ownership_token,
  };
}

async function cleanupCreatedAgentWindow(args, candidate, options = {}) {
  if (args?.cleanup_created_agent_window !== true) {
    return { requested: false, status: "not_requested", closed: false };
  }
  if (candidate?.eligible !== true) {
    if (candidate?.reason === "no_task_created_agent_window_identity") {
      return { requested: true, status: "not_owned", closed: false, ...candidate };
    }
    return { requested: true, status: "preserved", closed: false, ...candidate };
  }
  const identity = {
    browser_instance_id: candidate.browser_instance_id,
    window_id: candidate.window_id,
    anchor_tab_id: candidate.anchor_tab_id,
  };
  if (args?.dry_run === true) {
    return {
      requested: true,
      status: "dry_run",
      closed: false,
      would_close_if_empty: true,
      eligible: true,
      ...identity,
    };
  }
  const readManagedTabRecords = options.list_managed_tab_records ?? listManagedTabRecords;
  const remainingInWindow = (await readManagedTabRecords()).filter((record) => (
    record.browser_instance_id === candidate.browser_instance_id
    && record.window_id === candidate.window_id
  ));
  if (remainingInWindow.length > 0) {
    return {
      requested: true,
      status: "preserved",
      closed: false,
      eligible: true,
      reason: "managed_records_remain_in_agent_window",
      remaining_managed_count: remainingInWindow.length,
      ...identity,
    };
  }
  const command = {
    cmd: "window",
    method: "retire_agent_window",
    windowId: candidate.window_id,
    anchorTabId: candidate.anchor_tab_id,
    ownershipToken: candidate.ownership_token,
  };
  let result;
  if (typeof options.run_agent_window_command === "function") {
    result = await options.run_agent_window_command(command, candidate);
  } else {
    const recordArgs = { ...args, browser_instance_id: candidate.browser_instance_id };
    const preferred = await resolvePreferredBrowserContext(
      { ...recordArgs, refresh_sessions: true },
      options,
    );
    if (preferred.transport !== "tmwd_ws" && preferred.transport !== "tmwd_link") {
      return {
        requested: true,
        status: "preserved",
        closed: false,
        eligible: true,
        reason: "agent_window_cleanup_requires_tmwd_extension_transport",
        transport: preferred.transport,
        ...identity,
      };
    }
    result = await executeTmwdCommandWithPreferred(recordArgs, preferred, command, options);
  }
  const data = bridgeCommandData(result);
  return {
    requested: true,
    eligible: true,
    status: String(data.status ?? "unknown"),
    closed: data.closed === true,
    close_verified: data.close_verified === true,
    reason: String(data.reason ?? ""),
    tab_count: Number.isInteger(data.tab_count) ? data.tab_count : undefined,
    user_content_preserved: data.user_content_preserved === true,
    internal_tab_removed: data.internal_tab_removed === true,
    recovered_orphan: data.recovered_orphan === true,
    ownership_record_removed: data.ownership_record_removed === true,
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    ...identity,
  };
}

async function verifyTabClosed(args, preferred, tabId, options = {}) {
  const timeoutMs = normalizeCloseVerifyTimeout(args);
  const pollMs = normalizeCloseVerifyPoll(args);
  const startedAt = Date.now();
  let polls = 0;
  let lastTab = null;
  do {
    polls += 1;
    lastTab = await readBrowserTabById(args, preferred, tabId, options);
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

async function closeOneManagedTab(args, record, preferred = null, options = {}) {
  if (record.dry_run === true || args?.dry_run === true) {
    return {
      tab_id: record.tab_id,
      closed: false,
      dry_run: true,
      reason: "dry_run",
    };
  }
  if (!record.browser_instance_id && !recordUsesIsolatedTarget(record, args)) {
    throw createToolError(
      "BROWSER_INSTANCE_UNRESOLVED",
      "legacy managed tab has no Browser Instance identity and cannot be closed automatically",
      { retryable: false, details: { tab_id: record.tab_id } },
    );
  }
  const recordArgs = record.browser_instance_id
    ? { ...args, browser_instance_id: record.browser_instance_id }
    : args;
  const preferredInstanceId = String(preferred?.context?.target?.browser_instance_id ?? "").trim();
  const resolved = preferred && preferredInstanceId === String(record.browser_instance_id ?? "").trim()
    ? preferred
    : await resolvePreferredBrowserContext(
    { ...recordArgs, refresh_sessions: true },
    options,
  );
  if (resolved.transport === "tmwd_ws" || resolved.transport === "tmwd_link") {
    const result = await executeTmwdCommandWithPreferred(recordArgs, resolved, {
      cmd: "tabs",
      method: "close",
      tabId: record.tab_id,
    }, options);
    if (result.value?.closed !== true) {
      throw createToolError(
        "EXECUTION_ERROR",
        "tabs.close did not confirm closed=true; reload the TMWD browser extension if it is still running old bridge code",
      );
    }
    const closeVerification = await verifyTabClosed(recordArgs, resolved, record.tab_id, options);
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
  await cdpRunCommand({ ...recordArgs, switch_tab_id: record.tab_id }, "Target.closeTarget", {
    targetId: record.tab_id,
  }, options);
  const closeVerification = await verifyTabClosed(recordArgs, resolved, record.tab_id, options);
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

async function closeUnkeptManagedTabs(args, options = {}, resolvedCloseScope = null) {
  const closeScope = resolvedCloseScope
    ?? await resolveBrowserInstanceScope(resolveCloseScope(args ?? {}));
  const unmanagedTabId = String(args?.tab_id ?? args?.session_id ?? "").trim();
  const unmanagedRecord = unmanagedTabId
    ? await getManagedTab(unmanagedTabId, args?.browser_instance_id)
    : null;
  const unmanagedIgnored = unmanagedTabId && !unmanagedRecord ? [unmanagedTabId] : [];
  const candidates = (await scopedManagedRecords(closeScope))
    .filter((record) => record.keep !== true && record.close_on_finalize === true);
  const closed = [];
  const errors = [];
  const outcomes = await Promise.all(candidates.map(async (record) => {
    try {
      const result = await closeOneManagedTab(args, record, null, options);
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
      }, record.browser_instance_id);
      if (result.closed) {
        await deleteManagedTab(record.tab_id, record.browser_instance_id);
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
    kept_tabs: (await scopedManagedRecords(closeScope))
      .filter((record) => record.keep === true)
      .map((record) => managedTabPayload(record)),
  };
}

async function pruneStaleManagedTabs(args = {}, options = {}) {
  const sessionStore = options.runtime?.sessionStore ?? defaultSessionRegistry;
  const summaryOnly = args?.summary_only === true;
  const maxItems = normalizeListManagedLimit(args?.max_items, DEFAULT_LIST_MANAGED_MAX_ITEMS);
  const records = options.closeScope
    ? await scopedManagedRecords(options.closeScope)
    : await listManagedTabRecords({
        ...(args?.workspace_key || args?.workspaceKey
          ? { workspace_key: String(args.workspace_key ?? args.workspaceKey).trim() }
          : {}),
        ...(args?.task_id || args?.taskId
          ? { task_id: String(args.task_id ?? args.taskId).trim() }
          : {}),
        ...(args?.browser_instance_id || args?.browserInstanceId
          ? { browser_instance_id: String(args.browser_instance_id ?? args.browserInstanceId).trim() }
          : {}),
      });
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
      ...sessionStore.sessionPointers(),
    };
  }
  const livenessRows = await Promise.all(records.map(async (record) => {
    if (!record.browser_instance_id && !recordUsesIsolatedTarget(record, args)) {
      return { record, liveness: { live: true, reason: "legacy_browser_instance_unresolved" } };
    }
    const recordArgs = record.browser_instance_id
      ? { ...args, browser_instance_id: record.browser_instance_id }
      : args;
    try {
      const preferred = await resolvePreferredBrowserContext({ ...recordArgs, refresh_sessions: true }, options);
      const liveTabs = Array.isArray(preferred.context?.targets) ? preferred.context.targets : [];
      return {
        record,
        liveness: await resolveManagedRecordLiveness(
          recordArgs,
          preferred,
          record,
          liveTabMap(liveTabs),
          options,
        ),
        transport: preferred.transport,
        transport_attempts: preferred.transport_attempts,
      };
    } catch (error) {
      return { record, liveness: { live: true, reason: "live_check_unavailable", error: String(error?.message ?? error) } };
    }
  }));
  const pruned = [];
  const kept = [];
  await Promise.all(livenessRows.map(async ({ record, liveness }) => {
    const payload = {
      tab_id: record.tab_id,
      browser_instance_id: record.browser_instance_id || undefined,
      session_key: record.session_key,
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
      await deleteManagedTab(record.tab_id, record.browser_instance_id);
    }
  }));
  const prunedLimit = limitedList(pruned, maxItems, summaryOnly);
  const keptLimit = limitedList(kept, maxItems, summaryOnly);
  return {
    status: "success",
    action: "prune_stale",
    dry_run: args?.dry_run === true,
    transport: "per_browser_instance",
    transport_attempts: livenessRows.flatMap((row) => Array.isArray(row.transport_attempts) ? row.transport_attempts : []),
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
    ...sessionStore.sessionPointers(),
  };
}

export {
  closeOneManagedTab,
  closeUnkeptManagedTabs,
  cleanupCreatedAgentWindow,
  createdAgentWindowCleanupCandidate,
  pruneStaleManagedTabs,
};
