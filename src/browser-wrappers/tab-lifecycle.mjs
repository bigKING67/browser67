import {
  cdpRunCommand,
} from "../cdp-runtime/index.mjs";
import { createToolError } from "../runtime/tool-errors.mjs";
import { defaultSessionRegistry } from "../runtime/sessions/registry.mjs";
import {
  deleteManagedTab,
  extractCreatedTabId,
  findReusableManagedTab,
  getManagedTab,
  managedWindowRecordFields,
  managedTabFinalizeHint,
  managedTabPayload,
  planManagedTab,
  recordManagedTab,
  summarizeUnmanagedMatches,
  updateManagedTab,
  resolveManagedPresentation,
} from "../tab-workspace/index.mjs";
import { resolvePreferredBrowserContext } from "../tmwd-runtime/index.mjs";
import {
  adoptExisting,
  closeAdopted,
  inspectAdoption,
  inspectCloseAdopted,
  releaseAdopted,
  releaseExpiredAdoptions,
} from "../tab-workspace/adoption.mjs";
import {
  applyManagedTabPolicy,
  normalizeManagementPolicy,
} from "../tab-workspace/policy-bridge.mjs";
import {
  authorizeManagedExecutionNavigation,
} from "../browser/execution/managed-context.mjs";
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
import {
  ensureAgentWindow,
  foregroundManagedTab,
  inspectReusableManagedTabPresentation,
  resolveCreatedTab,
} from "./presentation.mjs";

async function createManagedTab(args, options = {}, runtimeOptions = {}) {
  const sessionStore = runtimeOptions.runtime?.sessionStore ?? defaultSessionRegistry;
  const url = String(args?.url ?? "").trim();
  if (!url) {
    throw createToolError(
      "INVALID_ARGUMENT",
      `url is required when action=${options.action ?? "create_managed"}`,
    );
  }
  const dryRunPresentation = resolveManagedPresentation(args);
  if (args?.dry_run === true) {
    const record = planManagedTab({
      ...args,
      ...managedWindowRecordFields(dryRunPresentation),
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
      presentation: dryRunPresentation,
      managed_tab: managedTabPayload(record),
      finalize_hint: managedTabFinalizeHint(record),
    };
  }
  const preferred = options.preferred
    ?? await resolvePreferredBrowserContext({ ...args, refresh_sessions: true }, runtimeOptions);
  const browserInstanceId = String(preferred.context?.target?.browser_instance_id ?? args?.browser_instance_id ?? "").trim();
  const instanceArgs = browserInstanceId ? { ...args, browser_instance_id: browserInstanceId } : args;
  const presentation = options.presentation
    ?? resolveManagedPresentation(instanceArgs, { transport: preferred.transport });
  const runCommand = (command) => executeTmwdCommandWithPreferred(
    instanceArgs,
    preferred,
    command,
    runtimeOptions,
  );
  const agentWindow = options.agent_window
    ?? await ensureAgentWindow(presentation, runCommand);
  let tabId = "";
  let title = "";
  let createdTab = {};
  let transport = preferred.transport;
  let transportAttempts = Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [];
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    const commandResult = await runCommand({
      cmd: "tabs",
      method: "create",
      url,
      active: presentation.active,
      windowId: agentWindow.window_id,
    });
    createdTab = await resolveCreatedTab(commandResult, runCommand);
    tabId = createdTab.tab_id || extractCreatedTabId(commandResult);
    title = createdTab.title || String(commandResult?.value?.title ?? commandResult?.value?.data?.title ?? "");
    transport = commandResult.transport;
    transportAttempts = commandResult.transport_attempts;
  } else {
    const cdp = await cdpRunCommand(args ?? {}, "Target.createTarget", { url }, runtimeOptions);
    tabId = String(cdp.result.response?.targetId ?? "").trim();
    createdTab = { tab_id: tabId };
    transport = "cdp";
  }
  if (!tabId) {
    throw createToolError("EXECUTION_ERROR", "managed tab create did not return tab id");
  }
  const visible = await waitForManagedTabVisible(instanceArgs, preferred, tabId, { url, title }, runtimeOptions);
  const visibleTab = visible.tab;
  let record = await recordManagedTab({
    ...args,
    ...managedWindowRecordFields(presentation, agentWindow, createdTab),
    tab_id: tabId,
    browser_instance_id: browserInstanceId,
    url: String(visibleTab?.url ?? "").trim() || url,
    title: String(visibleTab?.title ?? title ?? ""),
    keep: args?.keep === true,
    dry_run: false,
    status: "open",
    source: options.source ?? "tmwd_browser",
    ownership_origin: "agent_created",
    close_on_finalize: true,
    management_policy: normalizeManagementPolicy(args?.policy),
  });
  let policyApplication;
  try {
    policyApplication = await applyManagedTabPolicy(instanceArgs, preferred, record, runtimeOptions);
    record = await updateManagedTab(record.tab_id, {
      management_policy_applied: policyApplication.applied === true,
      management_policy_status: policyApplication.status,
      touch: false,
    }, record.browser_instance_id) ?? record;
  } catch (error) {
    policyApplication = {
      status: "unavailable",
      applied: false,
      error: String(error?.message ?? error),
      next_step: "Install and reload the browser67 v0.3 extension overlay.",
    };
    record = await updateManagedTab(record.tab_id, {
      management_policy_applied: false,
      management_policy_status: "unavailable",
      touch: false,
    }, record.browser_instance_id) ?? record;
  }
  const focusTransition = await foregroundManagedTab(
    presentation,
    instanceArgs,
    record.tab_id,
    runCommand,
  );
  sessionStore.select(record.session_key || tabId, { make_default: false });
  return {
    status: "success",
    action: options.action ?? "create_managed",
    created: true,
    reused: false,
    owner: "tmwd",
    presentation,
    agent_window: agentWindow,
    focus_transition: focusTransition,
    transport,
    transport_attempts: transportAttempts,
    ready: visible.ready,
    ready_after_ms: visible.ready_after_ms,
    ready_source: visible.ready_source,
    wait_until: visible.wait_until,
    ready_warning: visible.ready_warning,
    managed_tab: managedTabPayload(record),
    policy_application: policyApplication,
    finalize_hint: managedTabFinalizeHint(record),
    ...sessionStore.sessionPointers(),
  };
}

async function findLiveReusableManagedTab(
  args,
  preferred,
  url,
  liveTabs,
  liveById,
  attemptsLeft = 5,
  runtimeOptions = {},
  presentationContext = {},
) {
  const reusable = await findReusableManagedTab(args, url, liveTabs, {
    window_policy: presentationContext.presentation?.window_policy,
  });
  if (!reusable.record) {
    return {
      reusable,
      reusable_liveness: undefined,
      reusable_presentation: undefined,
    };
  }
  if (attemptsLeft <= 0) {
    return {
      reusable: {
        ...reusable,
        record: null,
        selected_by: "none",
        reason: "validation_attempts_exhausted",
      },
      reusable_liveness: undefined,
      reusable_presentation: undefined,
    };
  }
  const reusableLiveness = await resolveManagedRecordLiveness(
    args,
    preferred,
    reusable.record,
    liveById,
    runtimeOptions,
  );
  if (reusableLiveness.live === true) {
    const reusablePresentation = await inspectReusableManagedTabPresentation(
      presentationContext.presentation,
      presentationContext.agent_window,
      reusable.record,
      presentationContext.run_command,
    );
    if (reusablePresentation.reusable !== true) {
      if (reusablePresentation.record_action === "delete") {
        await deleteManagedTab(reusable.record.tab_id, reusable.record.browser_instance_id);
      } else {
        await updateManagedTab(reusable.record.tab_id, {
          window_id: reusablePresentation.actual_window_id,
          window_ownership: "outside_agent_window",
          touch: false,
        }, reusable.record.browser_instance_id);
      }
      return findLiveReusableManagedTab(
        args,
        preferred,
        url,
        liveTabs,
        liveById,
        attemptsLeft - 1,
        runtimeOptions,
        presentationContext,
      );
    }
    return {
      reusable,
      reusable_liveness: reusableLiveness,
      reusable_presentation: reusablePresentation,
    };
  }
  await deleteManagedTab(reusable.record.tab_id, reusable.record.browser_instance_id);
  return findLiveReusableManagedTab(
    args,
    preferred,
    url,
    liveTabs,
    liveById,
    attemptsLeft - 1,
    runtimeOptions,
    presentationContext,
  );
}

async function selectOrCreateManagedTab(args, runtimeOptions = {}) {
  const sessionStore = runtimeOptions.runtime?.sessionStore ?? defaultSessionRegistry;
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
        ...sessionStore.sessionPointers(),
      };
    }
    return createManagedTab(args, { action: "select_or_create" }, runtimeOptions);
  }
  const preferred = await resolvePreferredBrowserContext({ ...args, refresh_sessions: true }, runtimeOptions);
  const browserInstanceId = String(preferred.context?.target?.browser_instance_id ?? args?.browser_instance_id ?? "").trim();
  const initialInstanceArgs = browserInstanceId ? { ...args, browser_instance_id: browserInstanceId } : args;
  const presentation = resolveManagedPresentation(initialInstanceArgs, { transport: preferred.transport });
  const runCommand = (command) => executeTmwdCommandWithPreferred(
    initialInstanceArgs,
    preferred,
    command,
    runtimeOptions,
  );
  const agentWindow = await ensureAgentWindow(presentation, runCommand);
  const instanceArgs = {
    ...initialInstanceArgs,
    window_policy: presentation.requested_window_policy,
    window_id: agentWindow.window_id,
  };
  const liveTabs = Array.isArray(preferred.context?.targets) ? preferred.context.targets : [];
  const liveById = liveTabMap(liveTabs);
  const {
    reusable,
    reusable_liveness: reusableLiveness,
    reusable_presentation: reusablePresentation,
  } = await findLiveReusableManagedTab(
    instanceArgs,
    preferred,
    url,
    liveTabs,
    liveById,
    5,
    runtimeOptions,
    {
      presentation,
      agent_window: agentWindow,
      run_command: runCommand,
    },
  );
  const unmanagedIgnored = await summarizeUnmanagedMatches(instanceArgs, url, liveTabs);
  if (reusable.record) {
    let record = reusable.record;
    let navigation;
    if (reusable.policy.navigate_reused && record.url !== reusable.policy.target.normalized_url) {
      const navigationAuthorization = await authorizeManagedExecutionNavigation(
        preferred,
        {
          ...args,
          browser_instance_id: record.browser_instance_id,
          session_id: record.tab_id,
          switch_tab_id: record.tab_id,
        },
        "managed_tab_reuse_navigation",
        runtimeOptions,
      );
      const nav = await executeBrowserScript(
        {
          ...args,
          browser_instance_id: record.browser_instance_id,
          session_id: record.tab_id,
          switch_tab_id: record.tab_id,
        },
        "if (location.href !== input.url) location.href = input.url; return { url: location.href, title: document.title };",
        { url },
        { ...runtimeOptions, preferred },
      );
      navigation = {
        requested_url: url,
        result: nav.value,
        transport: nav.transport,
        authorization: navigationAuthorization,
      };
      record = await updateManagedTab(record.tab_id, {
        focus_policy: presentation.focus_policy,
        url,
        title: String(nav.value?.title ?? record.title ?? ""),
      }, record.browser_instance_id) ?? record;
    } else {
      record = await updateManagedTab(record.tab_id, {
        focus_policy: presentation.focus_policy,
        touch: true,
      }, record.browser_instance_id) ?? record;
    }
    const focusTransition = await foregroundManagedTab(
      presentation,
      instanceArgs,
      record.tab_id,
      runCommand,
    );
    sessionStore.select(record.session_key || record.tab_id, { make_default: false });
    return {
      status: "success",
      action: "select_or_create",
      created: false,
      reused: true,
      owner: "tmwd",
      presentation,
      agent_window: agentWindow,
      focus_transition: focusTransition,
      selected_by: reusable.selected_by,
      reuse_policy: reusable.policy,
      liveness: reusableLiveness,
      presentation_validation: reusablePresentation,
      managed_tab: managedTabPayload(record),
      finalize_hint: managedTabFinalizeHint(record),
      unmanaged_tabs_ignored: unmanagedIgnored,
      navigation,
      ...sessionStore.sessionPointers(),
    };
  }
  const created = await createManagedTab(instanceArgs, {
    action: "select_or_create",
    preferred,
    presentation,
    agent_window: agentWindow,
  }, runtimeOptions);
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
  const browserInstanceId = String(args?.browser_instance_id ?? "").trim();
  const record = await getManagedTab(tabId, browserInstanceId);
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
  const updated = await updateManagedTab(tabId, { keep }, record.browser_instance_id);
  const payloadRecord = updated ?? record;
  return {
    status: "success",
    action: "mark_keep",
    managed: true,
    managed_tab: managedTabPayload(payloadRecord),
    finalize_hint: managedTabFinalizeHint(payloadRecord),
  };
}

async function handleBrowserTabLifecycle(args, options = {}) {
  await releaseExpiredAdoptions(options);
  const action = normalizeAction(args, [
    "create_managed",
    "select_or_create",
    "mark_keep",
    "list_managed",
    "prune_stale",
    "close_unkept",
    "finalize_task",
    "inspect_adoption",
    "adopt_existing",
    "release_adopted",
    "inspect_close_adopted",
    "close_adopted",
  ]);
  if (action === "inspect_adoption") {
    return inspectAdoption(args, options);
  }
  if (action === "adopt_existing") {
    return adoptExisting(args, options);
  }
  if (action === "release_adopted") {
    return releaseAdopted(args, options);
  }
  if (action === "inspect_close_adopted") {
    return inspectCloseAdopted(args, options);
  }
  if (action === "close_adopted") {
    return closeAdopted(args, options);
  }
  if (action === "select_or_create") {
    return selectOrCreateManagedTab(args, options);
  }
  if (action === "create_managed") {
    return createManagedTab(args, {}, options);
  }
  if (action === "mark_keep") {
    return markManagedTabKeep(args);
  }
  if (action === "list_managed") {
    return listManagedTabs(args, { pruneStaleManagedTabs, ...options });
  }
  if (action === "prune_stale") {
    return pruneStaleManagedTabs(args, options);
  }
  if (action === "finalize_task") {
    return finalizeManagedTask(args, options);
  }
  return closeUnkeptManagedTabs(args, options);
}

export {
  handleBrowserTabLifecycle,
};
