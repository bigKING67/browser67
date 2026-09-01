import {
  authorizeManagedExecutionNavigation,
} from "../browser/execution/managed-context.mjs";
import { createToolError } from "../runtime/tool-errors.mjs";
import { resolvePreferredBrowserContext } from "../tmwd-runtime/index.mjs";
import { waitForManagedTabVisible } from "./shared.mjs";

function preferredTargetIdentity(preferred = {}) {
  return {
    tab_id: String(
      preferred?.context?.target?.tab_id ?? preferred?.context?.target?.id ?? "",
    ).trim(),
    browser_instance_id: String(
      preferred?.context?.target?.browser_instance_id ?? "",
    ).trim(),
  };
}

async function resolveExactAdoptedNavigationContext(args, record, runtimeOptions = {}) {
  const resolveContext = runtimeOptions.resolve_preferred_browser_context
    ?? resolvePreferredBrowserContext;
  const exactArgs = {
    ...args,
    browser_instance_id: record.browser_instance_id,
    tab_id: record.tab_id,
    session_id: record.tab_id,
    switch_tab_id: record.tab_id,
    refresh_sessions: true,
  };
  const preferred = await resolveContext(exactArgs, runtimeOptions);
  const identity = preferredTargetIdentity(preferred);
  if (
    identity.tab_id !== String(record.tab_id)
    || identity.browser_instance_id !== String(record.browser_instance_id)
  ) {
    throw createToolError(
      "NO_SESSION",
      "managed-tab reuse navigation did not resolve the exact adopted Browser Instance and tab",
      {
        retryable: true,
        details: {
          expected_browser_instance_id: record.browser_instance_id,
          expected_tab_id: record.tab_id,
          resolved_browser_instance_id: identity.browser_instance_id || undefined,
          resolved_tab_id: identity.tab_id || undefined,
        },
      },
    );
  }
  return { exactArgs, preferred };
}

async function navigateReusableManagedTab(args, preferred, record, url, runCommand, runtimeOptions = {}) {
  const navigationArgs = {
    ...args,
    browser_instance_id: record.browser_instance_id,
    tab_id: record.tab_id,
    session_id: record.tab_id,
    switch_tab_id: record.tab_id,
  };
  let navigationAuthorization = { status: "not_applicable", authorized: false };
  if (record.ownership_origin === "user_adopted") {
    const exact = await resolveExactAdoptedNavigationContext(
      navigationArgs,
      record,
      runtimeOptions,
    );
    navigationAuthorization = await authorizeManagedExecutionNavigation(
      exact.preferred,
      exact.exactArgs,
      "managed_tab_reuse_navigation",
      runtimeOptions,
    );
  }
  const commandResult = await runCommand({
    cmd: "cdp",
    method: "Page.navigate",
    tabId: record.tab_id,
    params: { url },
  });
  const waitForVisible = runtimeOptions.wait_for_managed_tab_visible
    ?? waitForManagedTabVisible;
  const visible = await waitForVisible(
    navigationArgs,
    preferred,
    record.tab_id,
    {
      expected_url: url,
      previous_url: String(record.observed_url ?? record.url ?? ""),
      url,
      title: record.title,
    },
    runtimeOptions,
  );
  const visibleTabId = String(visible?.tab?.tab_id ?? visible?.tab?.id ?? "").trim();
  const visibleBrowserInstanceId = String(visible?.tab?.browser_instance_id ?? "").trim();
  if (
    visible?.ready !== true
    || visibleTabId !== String(record.tab_id)
    || visibleBrowserInstanceId !== String(record.browser_instance_id)
  ) {
    throw createToolError(
      "NO_SESSION",
      "exact managed tab was not routable after reuse navigation; refusing default-session fallback",
      {
        retryable: true,
        details: {
          expected_browser_instance_id: record.browser_instance_id,
          expected_tab_id: record.tab_id,
          resolved_browser_instance_id: visibleBrowserInstanceId || undefined,
          resolved_tab_id: visibleTabId || undefined,
          ready: visible?.ready === true,
          ready_warning: visible?.ready_warning,
        },
      },
    );
  }
  return {
    navigation: {
      requested_url: url,
      result: {
        url: visible.tab.url,
        title: visible.tab.title,
      },
      transport: commandResult.transport,
      transport_attempts: commandResult.transport_attempts,
      ready: true,
      ready_source: visible.ready_source,
      ready_after_ms: visible.ready_after_ms,
      authorization: navigationAuthorization,
    },
    tab: visible.tab,
  };
}

export {
  navigateReusableManagedTab,
  resolveExactAdoptedNavigationContext,
};
