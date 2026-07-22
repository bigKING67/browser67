import {
  markSessionSelected,
  sessionPointers,
} from "../session-registry.mjs";
import {
  extractCreatedTabId,
  findReusableManagedTab,
  managedTabFinalizeHint,
  managedTabPayload,
  planManagedTab,
  recordManagedTab,
  summarizeUnmanagedMatches,
  updateManagedTab,
} from "../tab-workspace.mjs";
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

async function handleCheckBrowserHealth(args) {
  try {
    const tabs = await bridgeCommand(args, { cmd: "tabs" });
    const rows = Array.isArray(tabs.value) ? tabs.value : [];
    return {
      ok: true,
      mode: "tmwd",
      transport: tabs.transport,
      readiness: {
        ready: rows.length > 0,
        reason: rows.length > 0 ? "tmwd_transport_ready" : "tmwd_no_pages",
      },
      pages_count: rows.length,
      pages: rows.slice(0, 40),
      transport_attempts: tabs.transport_attempts,
    };
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
  markSessionSelected(id, { make_default: false });
  return { ok: true, selected: id, ...sessionPointers() };
}

async function handleNewPage(args) {
  const url = String(args?.url ?? "about:blank").trim() || "about:blank";
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
      page: managedTabPayload(record),
      finalize_hint: managedTabFinalizeHint(record, {
        tool: "finalize_task",
        include_action: false,
      }),
    };
  }
  const tabs = await bridgeCommand(args, { cmd: "tabs" });
  const liveTabs = Array.isArray(tabs.value) ? tabs.value : [];
  const workspaceArgs = {
    ...args,
    workspace_key: args?.workspace_key ?? "js-reverse",
  };
  const reusable = await findReusableManagedTab(workspaceArgs, url, liveTabs);
  const unmanagedIgnored = await summarizeUnmanagedMatches(workspaceArgs, url, liveTabs);
  if (reusable.record) {
    let record = reusable.record;
    let navigation;
    if (reusable.policy.navigate_reused && record.url !== reusable.policy.target.normalized_url) {
      const navigationArgs = { ...args, session_id: record.tab_id, page_id: record.tab_id };
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
        url,
        title: String(nav.value?.title ?? record.title ?? ""),
      }) ?? record;
    } else {
      record = await updateManagedTab(record.tab_id, { touch: true }) ?? record;
    }
    markSessionSelected(record.tab_id, { make_default: false });
    return {
      ok: true,
      action: "new_page",
      created: false,
      reused: true,
      owner: "tmwd",
      selected_by: reusable.selected_by,
      reuse_policy: reusable.policy,
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
  const result = await bridgeCommand(args, {
    cmd: "tabs",
    method: "create",
    url,
    active: args?.active !== false,
  });
  const tabId = extractCreatedTabId(result);
  if (!tabId) {
    return {
      ok: false,
      action: "new_page",
      error: "new_page create did not return tab id",
      transport: result.transport,
      page: result.value,
    };
  }
  const record = await recordManagedTab({
    ...args,
    tab_id: tabId,
    workspace_key: args?.workspace_key ?? "js-reverse",
    url,
    title: String(result?.value?.title ?? result?.value?.data?.title ?? ""),
    source: "js-reverse",
    keep: args?.keep === true,
  });
  if (record.tab_id) {
    markSessionSelected(record.tab_id, { make_default: false });
  }
  return {
    ok: true,
    action: "new_page",
    transport: result.transport,
    created: true,
    reused: false,
    owner: "tmwd",
    selected_by: "created_new_tmwd_owned_tab",
    reuse_policy: reusable.policy,
    page: result.value,
    managed_page: managedTabPayload(record),
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
  handleCheckBrowserHealth,
  handleFinalizeTask,
  handleListPages,
  handleNavigatePage,
  handleNewPage,
  handleSelectPage,
};
