import { getManagedTab, managedTabPayload } from "../../tab-workspace/index.mjs";
import {
  executeTmwdJsWithFallback,
  resolvePreferredBrowserContext,
} from "../../tmwd-runtime/index.mjs";
import {
  acquireManagedFocusLease,
  releaseManagedFocusLease,
} from "../../browser-wrappers/presentation.mjs";
import { executeBrowserScript } from "../login-detect.mjs";
import { MANUAL_CHALLENGE_DETECTOR_JS } from "../manual-challenge.mjs";
import { buildCaptchaAssistInspectorJs } from "../captcha/targets.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeExplicitTabId(args = {}) {
  return String(args.tab_id ?? args.switch_tab_id ?? args.session_id ?? args.sessionId ?? "").trim();
}

async function getManagedTabContext(args = {}) {
  const tabId = normalizeExplicitTabId(args);
  const record = tabId ? await getManagedTab(tabId) : null;
  return {
    tab_id: tabId || undefined,
    managed: Boolean(record && record.owner === "tmwd" && record.status !== "closed"),
    managed_tab: record ? managedTabPayload(record) : undefined,
  };
}

function inferPhysicalAction(pageState = {}, args = {}) {
  const requested = String(args?.assist_target ?? "auto").trim().toLowerCase();
  const effective = requested !== "auto" ? requested : String(pageState.target?.role ?? "auto");
  return effective === "slider" ? "drag" : "click";
}

function resolveManagedTabNativeWindowTitle(plan = {}, activation = {}, managedTab = {}) {
  const candidates = [
    plan.title,
    activation.tab?.title,
    activation.tab?.data?.title,
    managedTab.title,
  ];
  for (const candidate of candidates) {
    const title = String(candidate ?? "").trim();
    if (title) {
      return title;
    }
  }
  return "";
}

function resolveManagedTabNativeWindowUrl(plan = {}, activation = {}, managedTab = {}) {
  const candidates = [
    plan.url,
    activation.tab?.url,
    activation.tab?.data?.url,
    managedTab.url,
  ];
  for (const candidate of candidates) {
    const raw = String(candidate ?? "").trim();
    if (!raw) {
      continue;
    }
    try {
      const parsed = new URL(raw);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      // Ignore non-URL bridge metadata.
    }
  }
  return "";
}

function isSupportedWindowsBrowserProcess(raw) {
  const processName = String(raw ?? "").trim().toLowerCase();
  return processName === "chrome" || processName === "msedge";
}

async function inspectCaptchaAssistPage(args, options = {}) {
  const result = await executeBrowserScript(
    args,
    buildCaptchaAssistInspectorJs(MANUAL_CHALLENGE_DETECTOR_JS),
    {},
    options,
  );
  return {
    ...result.value,
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    page: result.page,
  };
}

async function activateManagedTabForPhysicalInput(args = {}, tabId = "", options = {}) {
  const normalizedTabId = String(tabId || normalizeExplicitTabId(args)).trim();
  if (!normalizedTabId) {
    throw new Error("managed tab id is required before TMWD activation");
  }
  const activationArgs = {
    ...args,
    tab_id: normalizedTabId,
    switch_tab_id: normalizedTabId,
    session_id: normalizedTabId,
  };
  const preferred = await resolvePreferredBrowserContext(activationArgs, options);
  if (preferred.transport !== "tmwd_ws" && preferred.transport !== "tmwd_link") {
    throw new Error(`TMWD activation requires TMWD transport, got ${preferred.transport}`);
  }
  const runCommand = async (command) => {
    const result = await executeTmwdJsWithFallback(
      activationArgs,
      preferred.context,
      command,
      options,
    );
    if (result.executed?.raw?.ok === false) {
      const error = new Error(String(result.executed.raw.error ?? "TMWD command failed"));
      error.code = result.executed.raw.errorCode;
      throw error;
    }
    return {
      value: result.executed?.value,
      raw: result.executed?.raw,
      transport: result.context.tmwd_transport === "ws" ? "tmwd_ws" : "tmwd_link",
      transport_attempts: result.transport_attempts,
    };
  };
  const focusLease = await acquireManagedFocusLease(
    activationArgs,
    normalizedTabId,
    runCommand,
  );
  return {
    status: "foregrounded",
    method: "tmwd_focus_lease",
    tab_id: normalizedTabId,
    transport: preferred.transport,
    transport_attempts: preferred.transport_attempts,
    focus_lease: focusLease,
  };
}

async function releaseManagedTabAfterPhysicalInput(args = {}, activation = {}, options = {}) {
  const leaseId = String(activation?.focus_lease?.lease_id ?? "").trim();
  if (!leaseId) return { status: "not_active", restored: false };
  const tabId = String(activation.tab_id ?? normalizeExplicitTabId(args)).trim();
  const releaseArgs = {
    ...args,
    tab_id: tabId,
    switch_tab_id: tabId,
    session_id: tabId,
  };
  try {
    const preferred = await resolvePreferredBrowserContext(releaseArgs, options);
    const runCommand = async (command) => {
      const result = await executeTmwdJsWithFallback(
        releaseArgs,
        preferred.context,
        command,
        options,
      );
      if (result.executed?.raw?.ok === false) {
        throw new Error(String(result.executed.raw.error ?? "TMWD focus release failed"));
      }
      return { value: result.executed?.value, raw: result.executed?.raw };
    };
    return releaseManagedFocusLease(activation.focus_lease, runCommand, "physical_input_complete");
  } catch (error) {
    return {
      status: "release_failed",
      restored: false,
      error: String(error?.message ?? error),
    };
  }
}

export {
  activateManagedTabForPhysicalInput,
  getManagedTabContext,
  inferPhysicalAction,
  isSupportedWindowsBrowserProcess,
  inspectCaptchaAssistPage,
  normalizeExplicitTabId,
  resolveManagedTabNativeWindowTitle,
  resolveManagedTabNativeWindowUrl,
  releaseManagedTabAfterPhysicalInput,
  sleep,
};
