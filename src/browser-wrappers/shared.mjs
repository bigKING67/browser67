import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeEndpoint } from "../runtime/config/endpoints.mjs";
import {
  cdpEvaluateScript,
  fetchCdpTargets,
} from "../cdp-runtime/index.mjs";
import { createToolError } from "../runtime/tool-errors.mjs";
import { defaultSessionRegistry } from "../runtime/sessions/registry.mjs";
import {
  executeTmwdJsWithFallback,
  resolvePreferredBrowserContext,
} from "../tmwd-runtime/index.mjs";

function normalizeAction(args, supported) {
  const action = String(args?.action ?? "").trim().toLowerCase();
  if (!action) {
    throw createToolError("INVALID_ARGUMENT", "action is required", {
      details: { supported_actions: supported },
    });
  }
  if (!supported.includes(action)) {
    throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${action}`, {
      details: { supported_actions: supported },
    });
  }
  return action;
}

function expandUserPath(raw) {
  const value = String(raw ?? "").trim();
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function resolveDownloadDir(raw) {
  const value = expandUserPath(raw || path.join(os.homedir(), "Downloads"));
  return path.resolve(value);
}

function normalizeStringList(raw, field) {
  const rows = Array.isArray(raw) ? raw : [];
  const normalized = rows
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);
  if (normalized.length === 0) {
    throw createToolError("INVALID_ARGUMENT", `${field} must be a non-empty array`);
  }
  return normalized;
}

async function validateUploadFiles(rawFiles) {
  const files = normalizeStringList(rawFiles, "files");
  return Promise.all(files.map(async (file) => {
    const absolute = path.resolve(expandUserPath(file));
    if (!path.isAbsolute(absolute)) {
      throw createToolError("INVALID_ARGUMENT", "files must resolve to absolute local paths", {
        details: { file },
      });
    }
    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch {
      throw createToolError("INVALID_ARGUMENT", "upload file does not exist", {
        details: { file: absolute },
      });
    }
    if (!stat.isFile()) {
      throw createToolError("INVALID_ARGUMENT", "upload path is not a file", {
        details: { file: absolute },
      });
    }
    return absolute;
  }));
}

function wrapPageFunction(body, input) {
  return `return await (async (input) => {\n${body}\n})(${JSON.stringify(input ?? {})});`;
}

async function executeBrowserScript(args, body, input = {}, runtimeOptions = {}) {
  const script = wrapPageFunction(body, input);
  const preferred = runtimeOptions.preferred ?? await resolvePreferredBrowserContext(args ?? {}, runtimeOptions);
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    const result = await executeTmwdJsWithFallback(args ?? {}, preferred.context, script, runtimeOptions);
    return {
      transport: result.context.tmwd_transport === "ws" ? "tmwd_ws" : "tmwd_link",
      transport_attempts: result.transport_attempts,
      value: result.executed.value,
      raw: result.executed.raw,
      page: {
        id: result.context.target.id,
        url: result.context.target.url,
        title: result.context.target.title,
      },
    };
  }
  const result = await cdpEvaluateScript(args ?? {}, script, runtimeOptions);
  const cdpValue = result.result.value;
  if (cdpValue?.ok === false) {
    throw createToolError(
      "EXECUTION_ERROR",
      String(cdpValue.error?.message ?? cdpValue.error ?? "CDP page script failed"),
      {
        retryable: false,
        details: {
          name: cdpValue.error?.name,
          stack: cdpValue.error?.stack,
        },
      },
    );
  }
  return {
    transport: "cdp",
    transport_attempts: Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [],
    value: cdpValue?.ok === true && Object.prototype.hasOwnProperty.call(cdpValue, "data")
      ? cdpValue.data
      : cdpValue,
    raw: result.result,
    page: {
      id: result.target.id,
      url: result.target.url,
      title: result.target.title,
    },
  };
}

async function executeTmwdCommandWithPreferred(args, preferred, command, runtimeOptions = {}) {
  if (preferred.transport !== "tmwd_ws" && preferred.transport !== "tmwd_link") {
    throw createToolError(
      "TRANSPORT_UNAVAILABLE",
      `tmwd_browser wrapper requires TMWD transport, got ${preferred.transport}`,
      { retryable: true },
    );
  }
  const result = await executeTmwdJsWithFallback(args ?? {}, preferred.context, command, runtimeOptions);
  if (result.executed?.raw?.ok === false) {
    throw createToolError(
      "EXECUTION_ERROR",
      String(result.executed.raw.error ?? "TMWD command failed"),
    );
  }
  return {
    transport: result.context.tmwd_transport === "ws" ? "tmwd_ws" : "tmwd_link",
    transport_attempts: result.transport_attempts,
    value: result.executed.value,
    raw: result.executed.raw,
    page: {
      id: result.context.target.id,
      url: result.context.target.url,
      title: result.context.target.title,
    },
  };
}

async function executeTmwdCommand(args, command, runtimeOptions = {}) {
  const preferred = await resolvePreferredBrowserContext(args ?? {}, runtimeOptions);
  return executeTmwdCommandWithPreferred(args, preferred, command, runtimeOptions);
}

function extractBatchResults(commandResult) {
  const value = commandResult?.value;
  if (Array.isArray(value?.results)) {
    return value.results;
  }
  if (Array.isArray(value?.data?.results)) {
    return value.data.results;
  }
  if (Array.isArray(commandResult?.raw?.results)) {
    return commandResult.raw.results;
  }
  if (Array.isArray(commandResult?.raw?.data?.results)) {
    return commandResult.raw.data.results;
  }
  return [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInteger(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeWaitOptions(args = {}) {
  const waitUntilRaw = String(args.wait_until ?? args.waitUntil ?? "listed").trim().toLowerCase();
  const waitUntil = waitUntilRaw === "none" ? "none" : "listed";
  return {
    wait_until: waitUntil,
    wait_timeout_ms: clampInteger(args.wait_timeout_ms ?? args.waitTimeoutMs, 3_000, 0, 10_000),
    wait_poll_ms: clampInteger(args.wait_poll_ms ?? args.waitPollMs, 100, 50, 1_000),
  };
}

function normalizeTabSummary(raw) {
  const row = raw?.data && typeof raw.data === "object" ? raw.data : raw;
  if (!row || typeof row !== "object") {
    return null;
  }
  const id = String(row.id ?? row.tab_id ?? row.tabId ?? row.sessionId ?? "").trim();
  if (!id) {
    return null;
  }
  const url = String(row.url ?? "");
  return {
    id,
    url,
    title: String(row.title ?? ""),
    active: row.active === true,
    windowId: row.windowId,
    scriptable: row.scriptable === true || /^https?:/.test(url),
  };
}

function normalizeTabList(raw) {
  const rows = Array.isArray(raw)
    ? raw
    : (Array.isArray(raw?.data) ? raw.data : []);
  return rows.map((row) => normalizeTabSummary(row)).filter((row) => row !== null);
}

function liveTabMap(liveTabs = []) {
  return new Map(
    (Array.isArray(liveTabs) ? liveTabs : [])
      .map((item) => [String(item?.id ?? item?.tab_id ?? item?.tabId ?? "").trim(), item])
      .filter(([id]) => id.length > 0),
  );
}

async function readBrowserTabById(args, preferred, tabId, runtimeOptions = {}) {
  const normalizedTabId = String(tabId ?? "").trim();
  if (!normalizedTabId) {
    return null;
  }
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    try {
      const got = await executeTmwdCommandWithPreferred(args, preferred, {
        cmd: "tabs",
        method: "get",
        tabId: normalizedTabId,
      }, runtimeOptions);
      const summary = normalizeTabSummary(got.value);
      if (summary?.id === normalizedTabId) {
        return summary;
      }
    } catch {
      // Older extension builds may not have tabs.get; fall back to list.
    }
    try {
      const listed = await executeTmwdCommandWithPreferred(args, preferred, {
        cmd: "tabs",
        method: "list",
        includeUnscriptable: true,
      }, runtimeOptions);
      return normalizeTabList(listed.value).find((tab) => tab.id === normalizedTabId) ?? null;
    } catch {
      return null;
    }
  }
  try {
    const targets = await fetchCdpTargets(normalizeEndpoint(args?.cdp_endpoint));
    (runtimeOptions.runtime?.sessionStore ?? defaultSessionRegistry).sync(targets);
    const target = targets.find((item) => item.id === normalizedTabId);
    return target ? normalizeTabSummary(target) : null;
  } catch {
    return null;
  }
}

async function readRoutableBrowserTabById(args, tabId, runtimeOptions = {}) {
  const normalizedTabId = String(tabId ?? "").trim();
  if (!normalizedTabId) {
    return null;
  }
  try {
    const preferred = await resolvePreferredBrowserContext({
      ...args,
      tab_id: normalizedTabId,
      switch_tab_id: normalizedTabId,
      session_id: normalizedTabId,
      refresh_sessions: true,
    }, runtimeOptions);
    const target = preferred.context?.target;
    return String(target?.id ?? "").trim() === normalizedTabId
      ? normalizeTabSummary(target)
      : null;
  } catch {
    return null;
  }
}

async function waitForManagedTabVisible(args, preferred, tabId, fallback = {}, runtimeOptions = {}) {
  const waitOptions = normalizeWaitOptions(args ?? {});
  const startedAt = Date.now();
  if (waitOptions.wait_until === "none") {
    return {
      ...waitOptions,
      ready: false,
      ready_after_ms: 0,
      tab: null,
    };
  }
  const poll = async (latestTab = null) => {
    if (Date.now() - startedAt > waitOptions.wait_timeout_ms) {
      const readiness = latestTab ? "routable through the runtime session list" : "visible to the extension";
      return {
        ...waitOptions,
        ready: false,
        ready_after_ms: Date.now() - startedAt,
        tab: latestTab,
        ready_warning: `created tab was not ${readiness} before timeout (${String(waitOptions.wait_timeout_ms)}ms)`,
        fallback_url: fallback.url,
        fallback_title: fallback.title,
      };
    }
    const tab = await readBrowserTabById(args, preferred, tabId, runtimeOptions);
    if (tab) {
      if (String(tab.url ?? "").trim().length > 0) {
        const routableTab = await readRoutableBrowserTabById(args, tabId, runtimeOptions);
        if (routableTab) {
          return {
            ...waitOptions,
            ready: true,
            ready_after_ms: Date.now() - startedAt,
            ready_source: "runtime_session",
            tab: {
              ...tab,
              ...routableTab,
              url: routableTab.url || tab.url,
              title: routableTab.title || tab.title,
            },
          };
        }
      }
      latestTab = tab;
    }
    if (waitOptions.wait_timeout_ms === 0) {
      const readiness = latestTab ? "routable through the runtime session list" : "visible to the extension";
      return {
        ...waitOptions,
        ready: false,
        ready_after_ms: Date.now() - startedAt,
        tab: latestTab,
        ready_warning: `created tab was not ${readiness} before timeout (${String(waitOptions.wait_timeout_ms)}ms)`,
        fallback_url: fallback.url,
        fallback_title: fallback.title,
      };
    }
    await sleep(Math.min(waitOptions.wait_poll_ms, Math.max(0, waitOptions.wait_timeout_ms - (Date.now() - startedAt))));
    return poll(latestTab);
  };
  return poll();
}

async function resolveManagedRecordLiveness(args, preferred, record, liveById, runtimeOptions = {}) {
  if (record.dry_run === true) {
    return { live: true, reason: "dry_run" };
  }
  if (liveById?.has(record.tab_id)) {
    return { live: true, reason: "live_session_registry" };
  }
  const exactTab = await readBrowserTabById(args, preferred, record.tab_id, runtimeOptions);
  if (exactTab) {
    return {
      live: true,
      reason: "tabs_get",
      tab: exactTab,
    };
  }
  return { live: false, reason: "not_live" };
}

export {
  clampInteger,
  executeBrowserScript,
  executeTmwdCommand,
  executeTmwdCommandWithPreferred,
  extractBatchResults,
  expandUserPath,
  liveTabMap,
  normalizeAction,
  normalizeStringList,
  normalizeTabList,
  normalizeTabSummary,
  normalizeWaitOptions,
  readBrowserTabById,
  resolveDownloadDir,
  resolveManagedRecordLiveness,
  sleep,
  validateUploadFiles,
  waitForManagedTabVisible,
  wrapPageFunction,
};
