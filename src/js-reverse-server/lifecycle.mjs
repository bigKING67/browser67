import {
  markSessionSelected,
  sessionPointers,
} from "../runtime/sessions/registry.mjs";
import {
  extractCreatedTabId,
  deleteManagedTab,
  findReusableManagedTab,
  managedWindowRecordFields,
  managedTabFinalizeHint,
  managedTabPayload,
  planManagedTab,
  recordManagedTab,
  summarizeUnmanagedMatches,
  updateManagedTab,
  resolveManagedPresentation,
} from "../tab-workspace/index.mjs";
import {
  applyManagedTabPolicy,
  normalizeManagementPolicy,
} from "../tab-workspace/policy-bridge.mjs";
import {
  assertManagedExecutionContext,
  authorizeManagedExecutionNavigation,
} from "../browser/execution/managed-context.mjs";
import {
  bridgeCommand,
  browserArgs,
  pageEval,
  resolveTmwd,
} from "./tmwd-adapter.mjs";
import { handleFinalizeTask } from "./finalizer.mjs";
import { browserTabKey } from "../tab-workspace/identity.mjs";
import {
  ensureAgentWindow,
  foregroundManagedTab,
  inspectReusableManagedTabPresentation,
  resolveCreatedTab,
} from "../browser-wrappers/presentation.mjs";

function browserHealthPayload(tabs, args = {}) {
  const rows = Array.isArray(tabs?.value) ? tabs.value : [];
  const browserInstances = new Set(rows
    .map((row) => String(row?.browser_instance_id ?? "").trim())
    .filter(Boolean));
  return {
    ok: true,
    mode: "tmwd",
    transport: tabs?.transport,
    readiness: {
      ready: rows.length > 0,
      reason: rows.length > 0 ? "tmwd_transport_ready" : "tmwd_no_pages",
    },
    pages_count: rows.length,
    browser_instances_count: browserInstances.size,
    summary_only: args?.summary_only === true,
    ...(args?.summary_only === true ? {} : { pages: rows.slice(0, 40) }),
    transport_attempts: tabs?.transport_attempts,
  };
}

async function waitForTmwdTarget(args = {}) {
  const timeoutMs = Math.max(0, Math.min(10_000, Number(args.wait_timeout_ms ?? 5_000)));
  const pollMs = Math.max(50, Math.min(1_000, Number(args.wait_poll_ms ?? 100)));
  const startedAt = Date.now();
  let latestError;
  do {
    try {
      return {
        preferred: await resolveTmwd(args),
        ready: true,
        ready_after_ms: Date.now() - startedAt,
      };
    } catch (error) {
      latestError = error;
    }
    if (Date.now() - startedAt >= timeoutMs) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
  } while (true);
  throw new Error(
    `new_page target did not become routable within ${String(timeoutMs)}ms: ${String(latestError?.message ?? latestError)}`,
  );
}

async function findPresentationSafeReusablePage(args, url, liveTabs, presentation, agentWindow, runCommand) {
  let latest;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    latest = await findReusableManagedTab(args, url, liveTabs, {
      window_policy: presentation?.window_policy,
    });
    if (!latest.record) {
      return { reusable: latest, presentation_validation: undefined };
    }
    const validation = await inspectReusableManagedTabPresentation(
      presentation,
      agentWindow,
      latest.record,
      runCommand,
    );
    if (validation.reusable === true) {
      return { reusable: latest, presentation_validation: validation };
    }
    if (validation.record_action === "delete") {
      await deleteManagedTab(latest.record.tab_id, latest.record.browser_instance_id);
    } else {
      await updateManagedTab(latest.record.tab_id, {
        window_id: validation.actual_window_id,
        window_ownership: "outside_agent_window",
        touch: false,
      }, latest.record.browser_instance_id);
    }
  }
  return {
    reusable: {
      ...(latest ?? {}),
      record: null,
      selected_by: "none",
      reason: "presentation_validation_attempts_exhausted",
    },
    presentation_validation: undefined,
  };
}

async function handleCheckBrowserHealth(args) {
  try {
    const tabs = await bridgeCommand(args, { cmd: "tabs" });
    return browserHealthPayload(tabs, args);
  } catch (error) {
    return {
      ok: false,
      mode: "tmwd",
      readiness: {
        ready: false,
        reason: "tmwd_unavailable",
      },
      error: String(error?.message ?? error),
    };
  }
}

async function handleListPages(args) {
  const tabs = await bridgeCommand(args, { cmd: "tabs" });
  return {
    ok: true,
    transport: tabs.transport,
    pages: Array.isArray(tabs.value) ? tabs.value : [],
    ...sessionPointers(),
  };
}

async function handleSelectPage(args) {
  const id = String(args?.page_id ?? args?.session_id ?? "").trim();
  if (!id) {
    return { ok: false, error: "page_id or session_id is required" };
  }
  const selected = args?.browser_instance_id
    ? browserTabKey({ browser_instance_id: args.browser_instance_id, tab_id: id })
    : id;
  markSessionSelected(selected, { make_default: false });
  return { ok: true, selected, ...sessionPointers() };
}

async function handleNewPage(args) {
  const url = String(args?.url ?? "about:blank").trim() || "about:blank";
  const dryRunPresentation = resolveManagedPresentation(args);
  if (args?.dry_run === true) {
    const reusable = await findReusableManagedTab(
      { ...args, workspace_key: args?.workspace_key ?? "js-reverse" },
      url,
      [],
    );
    if (reusable.record) {
      return {
        ok: true,
        action: "new_page",
        created: false,
        reused: true,
        dry_run: true,
        owner: "tmwd",
        selected_by: reusable.selected_by,
        page: managedTabPayload(reusable.record),
        finalize_hint: managedTabFinalizeHint(reusable.record, {
          tool: "finalize_task",
          include_action: false,
        }),
        ...sessionPointers(),
      };
    }
    const record = planManagedTab({
      ...args,
      ...managedWindowRecordFields(dryRunPresentation),
      workspace_key: args?.workspace_key ?? "js-reverse",
      url,
      source: "js-reverse",
      status: "planned",
      dry_run: true,
      keep: args?.keep === true,
    });
    return {
      ok: true,
      action: "new_page",
      created: false,
      reused: false,
      would_create: true,
      dry_run: true,
      owner: "tmwd",
      presentation: dryRunPresentation,
      page: managedTabPayload(record),
      finalize_hint: managedTabFinalizeHint(record, {
        tool: "finalize_task",
        include_action: false,
      }),
    };
  }
  const tabs = await bridgeCommand(args, { cmd: "tabs" });
  const liveTabs = Array.isArray(tabs.value) ? tabs.value : [];
  const browserInstanceId = String(tabs.page?.browser_instance_id ?? args?.browser_instance_id ?? "").trim();
  const workspaceArgs = {
    ...args,
    browser_instance_id: browserInstanceId,
    workspace_key: args?.workspace_key ?? "js-reverse",
  };
  const presentation = resolveManagedPresentation(workspaceArgs, { transport: tabs.transport });
  const initialRunCommand = (command) => bridgeCommand(workspaceArgs, command);
  const agentWindow = await ensureAgentWindow(presentation, initialRunCommand);
  const presentationArgs = {
    ...workspaceArgs,
    window_policy: presentation.requested_window_policy,
    window_id: agentWindow.window_id,
  };
  const runCommand = (command) => bridgeCommand(presentationArgs, command);
  const {
    reusable,
    presentation_validation: reusablePresentation,
  } = await findPresentationSafeReusablePage(
    presentationArgs,
    url,
    liveTabs,
    presentation,
    agentWindow,
    runCommand,
  );
  const unmanagedIgnored = await summarizeUnmanagedMatches(presentationArgs, url, liveTabs);
  if (reusable.record) {
    let record = reusable.record;
    let navigation;
    if (reusable.policy.navigate_reused && record.url !== reusable.policy.target.normalized_url) {
      const navigationArgs = {
        ...args,
        browser_instance_id: record.browser_instance_id,
        session_id: record.tab_id,
        page_id: record.tab_id,
      };
      const preferred = await resolveTmwd(navigationArgs);
      await assertManagedExecutionContext(preferred, browserArgs(navigationArgs));
      const authorization = await authorizeManagedExecutionNavigation(
        preferred,
        browserArgs(navigationArgs),
        "js_reverse_reuse_navigation",
      );
      const nav = await pageEval(
        navigationArgs,
        "if (location.href !== input.url) location.href = input.url; return { url: location.href, title: document.title };",
        { url },
        { preferred },
      );
      navigation = {
        requested_url: url,
        result: nav.value,
        transport: nav.transport,
        authorization,
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
      presentationArgs,
      record.tab_id,
      runCommand,
      { agent_window: agentWindow },
    );
    markSessionSelected(record.session_key || record.tab_id, { make_default: false });
    return {
      ok: true,
      action: "new_page",
      created: false,
      reused: true,
      owner: "tmwd",
      presentation,
      agent_window: agentWindow,
      focus_transition: focusTransition,
      selected_by: reusable.selected_by,
      reuse_policy: reusable.policy,
      presentation_validation: reusablePresentation,
      page: managedTabPayload(record),
      finalize_hint: managedTabFinalizeHint(record, {
        tool: "finalize_task",
        include_action: false,
      }),
      unmanaged_tabs_ignored: unmanagedIgnored,
      navigation,
      ...sessionPointers(),
    };
  }
  const result = await runCommand({
    cmd: "tabs",
    method: "create",
    url,
    active: presentation.active,
    windowId: agentWindow.window_id,
  });
  const createdTab = await resolveCreatedTab(result, runCommand);
  const tabId = createdTab.tab_id || extractCreatedTabId(result);
  if (!tabId) {
    return {
      ok: false,
      action: "new_page",
      error: "new_page create did not return tab id",
      transport: result.transport,
      page: result.value,
    };
  }
  let record = await recordManagedTab({
    ...args,
    ...managedWindowRecordFields(presentation, agentWindow, createdTab),
    tab_id: tabId,
    browser_instance_id: String(result.page?.browser_instance_id ?? args?.browser_instance_id ?? "").trim(),
    workspace_key: args?.workspace_key ?? "js-reverse",
    url,
    title: createdTab.title || String(result?.value?.title ?? result?.value?.data?.title ?? ""),
    source: "js-reverse",
    keep: args?.keep === true,
    ownership_origin: "agent_created",
    close_on_finalize: true,
    management_policy: normalizeManagementPolicy(),
  });
  const targetArgs = {
    ...presentationArgs,
    session_id: tabId,
    page_id: tabId,
  };
  const targetReadiness = await waitForTmwdTarget(targetArgs);
  const targetPreferred = targetReadiness.preferred;
  const policyApplication = await applyManagedTabPolicy(
    browserArgs(targetArgs),
    targetPreferred,
    record,
  );
  record = await updateManagedTab(record.tab_id, {
    management_policy_applied: policyApplication.applied === true,
    management_policy_status: policyApplication.status,
    touch: false,
  }, record.browser_instance_id) ?? record;
  const focusTransition = await foregroundManagedTab(
    presentation,
    targetArgs,
    record.tab_id,
    runCommand,
    { agent_window: agentWindow },
  );
  if (record.tab_id) {
    markSessionSelected(record.session_key || record.tab_id, { make_default: false });
  }
  return {
    ok: true,
    action: "new_page",
    transport: result.transport,
    created: true,
    reused: false,
    owner: "tmwd",
    presentation,
    agent_window: agentWindow,
    focus_transition: focusTransition,
    selected_by: "created_new_tmwd_owned_tab",
    reuse_policy: reusable.policy,
    page: result.value,
    managed_page: managedTabPayload(record),
    policy_application: policyApplication,
    ready: targetReadiness.ready,
    ready_after_ms: targetReadiness.ready_after_ms,
    finalize_hint: managedTabFinalizeHint(record, {
      tool: "finalize_task",
      include_action: false,
    }),
    unmanaged_tabs_ignored: unmanagedIgnored,
    ...sessionPointers(),
  };
}

async function handleNavigatePage(args) {
  const url = String(args?.url ?? "").trim();
  if (!url) {
    return { ok: false, error: "url is required" };
  }
  const preferred = await resolveTmwd(args);
  const callArgs = browserArgs(args);
  const management = await assertManagedExecutionContext(preferred, callArgs);
  const authorization = await authorizeManagedExecutionNavigation(
    preferred,
    callArgs,
    "js_reverse_navigate_page",
  );
  const result = await pageEval(
    args,
    "location.href = input.url; return { url: location.href, title: document.title };",
    { url },
    { preferred },
  );
  return {
    ok: true,
    transport: result.transport,
    page: result.page,
    result: result.value,
    management,
    navigation_authorization: authorization,
  };
}

export {
  browserHealthPayload,
  handleCheckBrowserHealth,
  handleFinalizeTask,
  handleListPages,
  handleNavigatePage,
  handleNewPage,
  handleSelectPage,
};
