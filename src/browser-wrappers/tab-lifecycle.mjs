import {
  cdpRunCommand,
} from "../cdp-runtime.mjs";
import { createToolError } from "../errors.mjs";
import {
  markSessionSelected,
  sessionPointers,
} from "../session-registry.mjs";
import {
  deleteManagedTab,
  extractCreatedTabId,
  findReusableManagedTab,
  getManagedTab,
  managedTabFinalizeHint,
  managedTabPayload,
  planManagedTab,
  recordManagedTab,
  summarizeUnmanagedMatches,
  updateManagedTab,
} from "../tab-workspace.mjs";
import { resolvePreferredBrowserContext } from "../tmwd-runtime.mjs";
import {
  executeBrowserScript,
  executeTmwdCommandWithPreferred,
  liveTabMap,
  normalizeAction,
  resolveManagedRecordLiveness,
  waitForManagedTabVisible,
} from "./shared.mjs";
import {
  closeUnkeptManagedTabs,
  finalizeManagedTask,
  pruneStaleManagedTabs,
} from "./tab-lifecycle-close.mjs";
import { listManagedTabs } from "./tab-lifecycle-list.mjs";

async function createManagedTab(args, options = {}) {
  const url = String(args?.url ?? "").trim();
  if (!url) {
    throw createToolError(
      "INVALID_ARGUMENT",
      `url is required when action=${options.action ?? "create_managed"}`,
    );
  }
  const active = args?.active !== false;
  if (args?.dry_run === true) {
    const record = planManagedTab({
      ...args,
      url,
      title: "",
      keep: args?.keep === true,
      dry_run: true,
      status: "planned",
      source: options.source ?? "tmwd_browser",
    });
    return {
      status: "success",
      action: options.action ?? "create_managed",
      created: false,
      reused: false,
      would_create: true,
      owner: "tmwd",
      managed_tab: managedTabPayload(record),
      finalize_hint: managedTabFinalizeHint(record),
    };
  }
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  let tabId = "";
  let title = "";
  let transport = preferred.transport;
  let transportAttempts = Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [];
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    const commandResult = await executeTmwdCommandWithPreferred(args, preferred, {
      cmd: "tabs",
      method: "create",
      url,
      active,
    });
    tabId = extractCreatedTabId(commandResult);
    title = String(commandResult?.value?.title ?? commandResult?.value?.data?.title ?? "");
    transport = commandResult.transport;
    transportAttempts = commandResult.transport_attempts;
  } else {
    const cdp = await cdpRunCommand(args ?? {}, "Target.createTarget", { url });
    tabId = String(cdp.result.response?.targetId ?? "").trim();
    transport = "cdp";
  }
  if (!tabId) {
    throw createToolError("EXECUTION_ERROR", "managed tab create did not return tab id");
  }
  const visible = await waitForManagedTabVisible(args, preferred, tabId, { url, title });
  const visibleTab = visible.tab;
  const record = await recordManagedTab({
    ...args,
    tab_id: tabId,
    url: String(visibleTab?.url ?? "").trim() || url,
    title: String(visibleTab?.title ?? title ?? ""),
    keep: args?.keep === true,
    dry_run: false,
    status: "open",
    source: options.source ?? "tmwd_browser",
  });
  markSessionSelected(tabId, { make_default: false });
  return {
    status: "success",
    action: options.action ?? "create_managed",
    created: true,
    reused: false,
    owner: "tmwd",
    transport,
    transport_attempts: transportAttempts,
    ready: visible.ready,
    ready_after_ms: visible.ready_after_ms,
    wait_until: visible.wait_until,
    ready_warning: visible.ready_warning,
    managed_tab: managedTabPayload(record),
    finalize_hint: managedTabFinalizeHint(record),
    ...sessionPointers(),
  };
}

async function findLiveReusableManagedTab(args, preferred, url, liveTabs, liveById, attemptsLeft = 5) {
  const reusable = await findReusableManagedTab(args, url, liveTabs);
  if (!reusable.record || attemptsLeft <= 0) {
    return {
      reusable,
      reusable_liveness: undefined,
    };
  }
  const reusableLiveness = await resolveManagedRecordLiveness(args, preferred, reusable.record, liveById);
  if (reusableLiveness.live === true) {
    return {
      reusable,
      reusable_liveness: reusableLiveness,
    };
  }
  await deleteManagedTab(reusable.record.tab_id);
  return findLiveReusableManagedTab(args, preferred, url, liveTabs, liveById, attemptsLeft - 1);
}

async function selectOrCreateManagedTab(args) {
  const url = String(args?.url ?? "").trim();
  if (!url) {
    throw createToolError("INVALID_ARGUMENT", "url is required when action=select_or_create");
  }
  if (args?.dry_run === true) {
    const reusable = await findReusableManagedTab(args, url, []);
    if (reusable.record) {
      return {
        status: "success",
        action: "select_or_create",
        created: false,
        reused: true,
        dry_run: true,
        owner: "tmwd",
        selected_by: reusable.selected_by,
        reuse_policy: reusable.policy,
        managed_tab: managedTabPayload(reusable.record),
        finalize_hint: managedTabFinalizeHint(reusable.record),
        ...sessionPointers(),
      };
    }
    return createManagedTab(args, { action: "select_or_create" });
  }
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  const liveTabs = Array.isArray(preferred.context?.targets) ? preferred.context.targets : [];
  const liveById = liveTabMap(liveTabs);
  const { reusable, reusable_liveness: reusableLiveness } = await findLiveReusableManagedTab(
    args,
    preferred,
    url,
    liveTabs,
    liveById,
  );
  const unmanagedIgnored = await summarizeUnmanagedMatches(args, url, liveTabs);
  if (reusable.record) {
    let record = reusable.record;
    let navigation;
    if (reusable.policy.navigate_reused && record.url !== reusable.policy.target.normalized_url) {
      const nav = await executeBrowserScript(
        { ...args, session_id: record.tab_id, switch_tab_id: record.tab_id },
        "if (location.href !== input.url) location.href = input.url; return { url: location.href, title: document.title };",
        { url },
      );
      navigation = {
        requested_url: url,
        result: nav.value,
        transport: nav.transport,
      };
      record = await updateManagedTab(record.tab_id, {
        url,
        title: String(nav.value?.title ?? record.title ?? ""),
      }) ?? record;
    } else {
      record = await updateManagedTab(record.tab_id, { touch: true }) ?? record;
    }
    markSessionSelected(record.tab_id, { make_default: false });
    return {
      status: "success",
      action: "select_or_create",
      created: false,
      reused: true,
      owner: "tmwd",
      selected_by: reusable.selected_by,
      reuse_policy: reusable.policy,
      liveness: reusableLiveness,
      managed_tab: managedTabPayload(record),
      finalize_hint: managedTabFinalizeHint(record),
      unmanaged_tabs_ignored: unmanagedIgnored,
      navigation,
      ...sessionPointers(),
    };
  }
  const created = await createManagedTab(args, { action: "select_or_create" });
  return {
    ...created,
    reuse_policy: reusable.policy,
    selected_by: "created_new_tmwd_owned_tab",
    unmanaged_tabs_ignored: unmanagedIgnored,
  };
}

async function markManagedTabKeep(args) {
  const tabId = String(args?.tab_id ?? args?.session_id ?? "").trim();
  if (!tabId) {
    throw createToolError("INVALID_ARGUMENT", "tab_id or session_id is required when action=mark_keep");
  }
  const keep = args?.keep !== false;
  const record = await getManagedTab(tabId);
  if (!record) {
    return {
      status: "success",
      action: "mark_keep",
      managed: false,
      tab_id: tabId,
      kept: false,
      note: "tab is not managed by browser_tab_lifecycle; unmanaged user tabs are ignored",
    };
  }
  const updated = await updateManagedTab(tabId, { keep });
  const payloadRecord = updated ?? record;
  return {
    status: "success",
    action: "mark_keep",
    managed: true,
    managed_tab: managedTabPayload(payloadRecord),
    finalize_hint: managedTabFinalizeHint(payloadRecord),
  };
}

async function handleBrowserTabLifecycle(args) {
  const action = normalizeAction(args, [
    "create_managed",
    "select_or_create",
    "mark_keep",
    "list_managed",
    "prune_stale",
    "close_unkept",
    "finalize_task",
  ]);
  if (action === "select_or_create") {
    return selectOrCreateManagedTab(args);
  }
  if (action === "create_managed") {
    return createManagedTab(args);
  }
  if (action === "mark_keep") {
    return markManagedTabKeep(args);
  }
  if (action === "list_managed") {
    return listManagedTabs(args, { pruneStaleManagedTabs });
  }
  if (action === "prune_stale") {
    return pruneStaleManagedTabs(args);
  }
  if (action === "finalize_task") {
    return finalizeManagedTask(args);
  }
  return closeUnkeptManagedTabs(args);
}

export {
  handleBrowserTabLifecycle,
};
