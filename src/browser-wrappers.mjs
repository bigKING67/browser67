import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  nowIso,
  normalizeEndpoint,
  normalizeTimeoutMs,
  randomId,
} from "./common.mjs";
import { CAPABILITIES } from "./capabilities.mjs";
import {
  cdpEvaluateScript,
  cdpRunCommand,
  fetchCdpTargets,
} from "./cdp-runtime.mjs";
import { createToolError } from "./errors.mjs";
import { handleBrowserNativeInput } from "./native-input.mjs";
import {
  asShortTabs,
  listSessionsSnapshot,
  markSessionSelected,
  sessionPointers,
  syncSessionRegistry,
} from "./session-registry.mjs";
import {
  deleteManagedTab,
  extractCreatedTabId,
  findReusableManagedTab,
  getManagedTab,
  isManagedTabWithinLiveGrace,
  listManagedTabRecords,
  managedTabGroups,
  managedTabPayload,
  planManagedTab,
  recordManagedTab,
  summarizeUnmanagedMatches,
  updateManagedTab,
} from "./tab-workspace.mjs";
import {
  executeTmwdJsWithFallback,
  resolvePreferredBrowserContext,
} from "./tmwd-runtime.mjs";

const PARTIAL_DOWNLOAD_SUFFIXES = [".crdownload", ".download", ".part", ".tmp"];
const downloadSessions = new Map();

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
  const checked = [];
  for (const file of files) {
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
    checked.push(absolute);
  }
  return checked;
}

function wrapPageFunction(body, input) {
  return `return await (async (input) => {\n${body}\n})(${JSON.stringify(input ?? {})});`;
}

async function executeBrowserScript(args, body, input = {}) {
  const script = wrapPageFunction(body, input);
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    const result = await executeTmwdJsWithFallback(args ?? {}, preferred.context, script);
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
  const result = await cdpEvaluateScript(args ?? {}, script);
  return {
    transport: "cdp",
    transport_attempts: Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [],
    value: result.result.value,
    raw: result.result,
    page: {
      id: result.target.id,
      url: result.target.url,
      title: result.target.title,
    },
  };
}

async function executeTmwdCommandWithPreferred(args, preferred, command) {
  if (preferred.transport !== "tmwd_ws" && preferred.transport !== "tmwd_link") {
    throw createToolError(
      "TRANSPORT_UNAVAILABLE",
      `tmwd_browser wrapper requires TMWD transport, got ${preferred.transport}`,
      { retryable: true },
    );
  }
  const result = await executeTmwdJsWithFallback(args ?? {}, preferred.context, command);
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

async function executeTmwdCommand(args, command) {
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  return executeTmwdCommandWithPreferred(args, preferred, command);
}

function dispatchFileInputEventsExpression(selector) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, error: "input not found after setFileInputFiles" };
    for (const type of ["input", "change"]) {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    }
    return {
      ok: true,
      files_count: el.files ? el.files.length : 0,
      selector: ${JSON.stringify(selector)}
    };
  })()`;
}

async function setInputFilesViaCdp(args, selector, files) {
  const documentResult = await cdpRunCommand(args ?? {}, "DOM.getDocument", {
    depth: 1,
    pierce: true,
  });
  const rootNodeId = documentResult.result.response?.root?.nodeId;
  if (!Number.isInteger(rootNodeId)) {
    throw createToolError("EXECUTION_ERROR", "DOM.getDocument did not return root.nodeId");
  }
  const queryResult = await cdpRunCommand(args ?? {}, "DOM.querySelector", {
    nodeId: rootNodeId,
    selector,
  });
  const nodeId = queryResult.result.response?.nodeId;
  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    throw createToolError("NO_SESSION", `file input not found: ${selector}`);
  }
  const setResult = await cdpRunCommand(args ?? {}, "DOM.setFileInputFiles", {
    nodeId,
    files,
  });
  const dispatchResult = await cdpRunCommand(args ?? {}, "Runtime.evaluate", {
    expression: dispatchFileInputEventsExpression(selector),
    awaitPromise: true,
    returnByValue: true,
  });
  return {
    transport: "cdp",
    tab_id: setResult.target.id,
    target_url: setResult.target.url,
    selector,
    files_count: files.length,
    cdp: {
      node_id: nodeId,
      set_file_input_files: setResult.result.response ?? {},
      dispatch: dispatchResult.result.response?.result?.value ?? dispatchResult.result.response ?? {},
    },
  };
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

async function setInputFilesViaTmwd(args, selector, files) {
  const command = {
    cmd: "batch",
    commands: [
      {
        cmd: "cdp",
        method: "DOM.getDocument",
        params: { depth: 1, pierce: true },
      },
      {
        cmd: "cdp",
        method: "DOM.querySelector",
        params: { nodeId: "$0.data.root.nodeId", selector },
      },
      {
        cmd: "cdp",
        method: "DOM.setFileInputFiles",
        params: { nodeId: "$1.data.nodeId", files },
      },
      {
        cmd: "cdp",
        method: "Runtime.evaluate",
        params: {
          expression: dispatchFileInputEventsExpression(selector),
          awaitPromise: true,
          returnByValue: true,
        },
      },
    ],
  };
  const result = await executeTmwdCommand(args, command);
  const results = extractBatchResults(result);
  const failed = results.find((item) => item?.ok === false);
  if (failed) {
    throw createToolError("EXECUTION_ERROR", String(failed.error ?? "TMWD batch file upload failed"), {
      details: { results },
    });
  }
  return {
    status: "success",
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    page: result.page,
    selector,
    files_count: files.length,
    results,
  };
}

async function handleInspectInputs(args) {
  const selector = String(args?.selector ?? "input[type=file]").trim() || "input[type=file]";
  const result = await executeBrowserScript(args, `
    const selector = input.selector || 'input[type=file]';
    return Array.from(document.querySelectorAll(selector)).slice(0, 100).map((el, index) => {
      const rect = el.getBoundingClientRect();
      return {
        index,
        id: el.id || "",
        name: el.getAttribute("name") || "",
        accept: el.getAttribute("accept") || "",
        multiple: el.multiple === true,
        disabled: el.disabled === true,
        hidden: el.hidden === true || getComputedStyle(el).display === "none",
        visible: rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden",
        files_count: el.files ? el.files.length : 0,
        selector_hint: el.id ? "#" + CSS.escape(el.id) : selector
      };
    });
  `, { selector });
  return {
    status: "success",
    action: "inspect_inputs",
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    page: result.page,
    selector,
    inputs: Array.isArray(result.value) ? result.value : [],
  };
}

async function handleSetInputFiles(args) {
  const selector = String(args?.selector ?? "").trim();
  if (!selector) {
    throw createToolError("INVALID_ARGUMENT", "selector is required for action=set_input_files");
  }
  const files = await validateUploadFiles(args?.files);
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    return setInputFilesViaTmwd(args, selector, files);
  }
  return {
    status: "success",
    action: "set_input_files",
    ...(await setInputFilesViaCdp(args, selector, files)),
  };
}

async function handleUploadViaDataTransfer(args) {
  const selector = String(args?.selector ?? "").trim();
  if (!selector) {
    throw createToolError("INVALID_ARGUMENT", "selector is required for action=upload_via_data_transfer");
  }
  const fileName = String(args?.name ?? args?.filename ?? "").trim();
  if (!fileName) {
    throw createToolError("INVALID_ARGUMENT", "name is required for action=upload_via_data_transfer");
  }
  const hasBase64 = typeof args?.base64 === "string" && args.base64.length > 0;
  const hasContent = typeof args?.content === "string";
  if (!hasBase64 && !hasContent) {
    throw createToolError("INVALID_ARGUMENT", "content or base64 is required for action=upload_via_data_transfer");
  }
  const rawLength = hasBase64 ? String(args.base64).length : String(args.content ?? "").length;
  if (rawLength > 3_000_000) {
    throw createToolError("INVALID_ARGUMENT", "DataTransfer upload payload is too large; use set_input_files for local files");
  }
  const result = await executeBrowserScript(args, `
    const el = document.querySelector(input.selector);
    if (!el) return { ok: false, error: "file input not found: " + input.selector };
    if (el.type !== "file") return { ok: false, error: "selector does not target an input[type=file]" };
    let blobPart;
    if (input.base64) {
      const binary = atob(input.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      blobPart = bytes;
    } else {
      blobPart = String(input.content ?? "");
    }
    const file = new File([blobPart], input.name, { type: input.mime_type || "application/octet-stream" });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    for (const type of ["input", "change"]) {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    }
    return { ok: true, selector: input.selector, name: file.name, size: file.size, files_count: el.files.length };
  `, {
    selector,
    name: fileName,
    mime_type: String(args?.mime_type ?? args?.type ?? "application/octet-stream"),
    content: hasContent ? String(args.content ?? "") : undefined,
    base64: hasBase64 ? String(args.base64 ?? "") : undefined,
  });
  if (result.value?.ok === false) {
    throw createToolError("EXECUTION_ERROR", String(result.value.error ?? "DataTransfer upload failed"));
  }
  return {
    status: "success",
    action: "upload_via_data_transfer",
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    page: result.page,
    result: result.value,
  };
}

function handleNativeFileChooserPlan(args) {
  return {
    status: "success",
    action: "native_file_chooser_plan",
    executable: false,
    next_step: "Use Computer Use or browser_native_input only after explicit approval for native file chooser interaction.",
    selector: String(args?.selector ?? ""),
    files: Array.isArray(args?.files) ? args.files.map((item) => String(item)) : [],
    plan: [
      "Prefer browser_file_ops.set_input_files for real local files.",
      "If the site requires an isTrusted native chooser, focus/click the upload control.",
      "Use native input to type/paste the file path and confirm the chooser.",
      "Do not upload unrelated local files; keep file paths task-scoped.",
    ],
  };
}

async function handleBrowserFileOps(args) {
  const action = normalizeAction(args, [
    "inspect_inputs",
    "set_input_files",
    "upload_via_data_transfer",
    "native_file_chooser_plan",
  ]);
  if (action === "inspect_inputs") {
    return handleInspectInputs(args);
  }
  if (action === "set_input_files") {
    return handleSetInputFiles(args);
  }
  if (action === "upload_via_data_transfer") {
    return handleUploadViaDataTransfer(args);
  }
  return handleNativeFileChooserPlan(args);
}

async function ensureDownloadDir(downloadDir, createDir) {
  if (createDir === true) {
    await fs.mkdir(downloadDir, { recursive: true });
  }
  let stat;
  try {
    stat = await fs.stat(downloadDir);
  } catch {
    throw createToolError("INVALID_ARGUMENT", "download_dir does not exist", {
      details: { download_dir: downloadDir, create_dir_hint: true },
    });
  }
  if (!stat.isDirectory()) {
    throw createToolError("INVALID_ARGUMENT", "download_dir is not a directory", {
      details: { download_dir: downloadDir },
    });
  }
}

function isPartialDownload(filePath) {
  const lower = filePath.toLowerCase();
  return PARTIAL_DOWNLOAD_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

async function listDownloadFiles(downloadDir, sinceMs) {
  const entries = await fs.readdir(downloadDir, { withFileTypes: true });
  const rows = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const filePath = path.join(downloadDir, entry.name);
    if (isPartialDownload(filePath)) {
      continue;
    }
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs < sinceMs) {
      continue;
    }
    rows.push({
      path: filePath,
      name: entry.name,
      size: stat.size,
      mtime_ms: Math.floor(stat.mtimeMs),
      mtime: new Date(stat.mtimeMs).toISOString(),
    });
  }
  rows.sort((a, b) => b.mtime_ms - a.mtime_ms);
  return rows;
}

async function maybeSetDownloadBehavior(args, downloadDir) {
  if (args?.set_behavior !== true) {
    return {
      attempted: false,
      reason: "set_behavior_not_requested",
    };
  }
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  const params = {
    behavior: "allow",
    downloadPath: downloadDir,
  };
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    const commandResult = await executeTmwdCommand(args, {
      cmd: "cdp",
      method: "Page.setDownloadBehavior",
      params,
    });
    return {
      attempted: true,
      transport: commandResult.transport,
      transport_attempts: commandResult.transport_attempts,
      result: commandResult.value,
    };
  }
  const cdp = await cdpRunCommand(args ?? {}, "Page.setDownloadBehavior", params);
  return {
    attempted: true,
    transport: "cdp",
    result: cdp.result.response,
  };
}

async function handleDownloadPrepare(args) {
  const downloadDir = resolveDownloadDir(args?.download_dir);
  await ensureDownloadDir(downloadDir, args?.create_dir === true);
  const token = randomId("download");
  const sinceMs = Date.now();
  const behavior = await maybeSetDownloadBehavior(args, downloadDir);
  downloadSessions.set(token, {
    token,
    download_dir: downloadDir,
    since_ms: sinceMs,
    created_at: nowIso(),
  });
  return {
    status: "success",
    action: "prepare",
    token,
    download_dir: downloadDir,
    since_ms: sinceMs,
    since: new Date(sinceMs).toISOString(),
    browser_download_behavior: behavior,
  };
}

function resolveDownloadSession(args) {
  const token = String(args?.token ?? "").trim();
  if (token) {
    const session = downloadSessions.get(token);
    if (!session) {
      throw createToolError("INVALID_ARGUMENT", `download token not found: ${token}`);
    }
    return session;
  }
  const downloadDirRaw = args?.download_dir;
  if (!downloadDirRaw) {
    throw createToolError("INVALID_ARGUMENT", "token or download_dir is required");
  }
  return {
    token: "",
    download_dir: resolveDownloadDir(downloadDirRaw),
    since_ms: Number(args?.since_ms ?? Date.now()),
    created_at: "",
  };
}

async function handleDownloadListRecent(args) {
  const session = resolveDownloadSession(args);
  await ensureDownloadDir(session.download_dir, false);
  const files = await listDownloadFiles(session.download_dir, Number(session.since_ms ?? Date.now()));
  return {
    status: "success",
    action: "list_recent",
    token: session.token,
    download_dir: session.download_dir,
    since_ms: session.since_ms,
    files,
  };
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

async function readBrowserTabById(args, preferred, tabId) {
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
      });
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
      });
      return normalizeTabList(listed.value).find((tab) => tab.id === normalizedTabId) ?? null;
    } catch {
      return null;
    }
  }
  try {
    const targets = await fetchCdpTargets(normalizeEndpoint(args?.cdp_endpoint));
    syncSessionRegistry(targets);
    const target = targets.find((item) => item.id === normalizedTabId);
    return target ? normalizeTabSummary(target) : null;
  } catch {
    return null;
  }
}

async function waitForManagedTabVisible(args, preferred, tabId, fallback = {}) {
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
  let latestTab = null;
  while (Date.now() - startedAt <= waitOptions.wait_timeout_ms) {
    const tab = await readBrowserTabById(args, preferred, tabId);
    if (tab) {
      latestTab = tab;
      if (String(tab.url ?? "").trim().length > 0) {
        return {
          ...waitOptions,
          ready: true,
          ready_after_ms: Date.now() - startedAt,
          tab,
        };
      }
    }
    if (waitOptions.wait_timeout_ms === 0) {
      break;
    }
    await sleep(Math.min(waitOptions.wait_poll_ms, Math.max(0, waitOptions.wait_timeout_ms - (Date.now() - startedAt))));
  }
  return {
    ...waitOptions,
    ready: false,
    ready_after_ms: Date.now() - startedAt,
    tab: latestTab,
    ready_warning: `created tab was not visible before timeout (${String(waitOptions.wait_timeout_ms)}ms)`,
    fallback_url: fallback.url,
    fallback_title: fallback.title,
  };
}

async function resolveManagedRecordLiveness(args, preferred, record, liveById) {
  if (record.dry_run === true) {
    return { live: true, reason: "dry_run" };
  }
  if (liveById?.has(record.tab_id)) {
    return { live: true, reason: "live_session_registry" };
  }
  const exactTab = await readBrowserTabById(args, preferred, record.tab_id);
  if (exactTab) {
    return {
      live: true,
      reason: "tabs_get",
      tab: exactTab,
    };
  }
  if (isManagedTabWithinLiveGrace(record)) {
    return { live: true, reason: "recent_grace" };
  }
  return { live: false, reason: "not_live" };
}

async function waitForStableDownloads(session, args) {
  const timeoutMs = normalizeTimeoutMs(args?.timeout_ms ?? 20_000);
  const pollMsRaw = Number(args?.poll_ms ?? 300);
  const pollMs = Number.isFinite(pollMsRaw) ? Math.max(100, Math.min(2_000, Math.floor(pollMsRaw))) : 300;
  const stabilityMsRaw = Number(args?.stability_ms ?? 800);
  const stabilityMs = Number.isFinite(stabilityMsRaw)
    ? Math.max(200, Math.min(5_000, Math.floor(stabilityMsRaw)))
    : 800;
  const requireCountRaw = Number(args?.require_count ?? 1);
  const requireCount = Number.isFinite(requireCountRaw) ? Math.max(1, Math.floor(requireCountRaw)) : 1;
  const started = Date.now();
  let previous = new Map();
  while (Date.now() - started <= timeoutMs) {
    const files = await listDownloadFiles(session.download_dir, Number(session.since_ms ?? started));
    const now = Date.now();
    const stable = files.filter((file) => {
      const previousSize = previous.get(file.path);
      const sizeStable = previousSize === file.size;
      const mtimeStable = now - file.mtime_ms >= stabilityMs;
      return sizeStable && mtimeStable;
    });
    if (stable.length >= requireCount) {
      return {
        files,
        stable_files: stable,
      };
    }
    previous = new Map(files.map((file) => [file.path, file.size]));
    await sleep(pollMs);
  }
  throw createToolError("TIMEOUT", `download wait timeout after ${String(timeoutMs)}ms`, {
    retryable: true,
    details: {
      token: session.token,
      download_dir: session.download_dir,
      since_ms: session.since_ms,
    },
  });
}

async function handleDownloadWait(args) {
  const session = resolveDownloadSession(args);
  await ensureDownloadDir(session.download_dir, false);
  const waited = await waitForStableDownloads(session, args);
  return {
    status: "success",
    action: "wait",
    token: session.token,
    download_dir: session.download_dir,
    since_ms: session.since_ms,
    files: waited.files,
    stable_files: waited.stable_files,
  };
}

async function handleAllowAutomaticDownloads(args) {
  const pattern = String(args?.pattern ?? "https://*/*").trim() || "https://*/*";
  const setting = String(args?.setting ?? "allow").trim().toLowerCase() || "allow";
  if (!["allow", "block", "ask"].includes(setting)) {
    throw createToolError("INVALID_ARGUMENT", "setting must be allow, block, or ask");
  }
  if (args?.apply === false || args?.dry_run === true) {
    return {
      status: "success",
      action: "allow_automatic_downloads",
      applied: false,
      pattern,
      setting,
      next_step: "Call again without dry_run/apply=false to update Chrome contentSettings through TMWD.",
    };
  }
  const result = await executeTmwdCommand(args, {
    cmd: "contentSettings",
    type: "automaticDownloads",
    pattern,
    setting,
  });
  return {
    status: "success",
    action: "allow_automatic_downloads",
    applied: true,
    pattern,
    setting,
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    result: result.value,
  };
}

async function handleBrowserDownloadOps(args) {
  const action = normalizeAction(args, [
    "allow_automatic_downloads",
    "prepare",
    "wait",
    "list_recent",
  ]);
  if (action === "allow_automatic_downloads") {
    return handleAllowAutomaticDownloads(args);
  }
  if (action === "prepare") {
    return handleDownloadPrepare(args);
  }
  if (action === "wait") {
    return handleDownloadWait(args);
  }
  return handleDownloadListRecent(args);
}

async function createManagedTab(args, options = {}) {
  const url = String(args?.url ?? "").trim();
  if (!url) {
    throw createToolError(
      "INVALID_ARGUMENT",
      `url is required for action=${options.action ?? "create_managed"}`,
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
  const record = recordManagedTab({
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
    ...sessionPointers(),
  };
}

async function selectOrCreateManagedTab(args) {
  const url = String(args?.url ?? "").trim();
  if (!url) {
    throw createToolError("INVALID_ARGUMENT", "url is required for action=select_or_create");
  }
  if (args?.dry_run === true) {
    const reusable = findReusableManagedTab(args, url, []);
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
        ...sessionPointers(),
      };
    }
    return createManagedTab(args, { action: "select_or_create" });
  }
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  const liveTabs = Array.isArray(preferred.context?.targets) ? preferred.context.targets : [];
  const liveById = liveTabMap(liveTabs);
  let reusable = findReusableManagedTab(args, url, liveTabs);
  let reusableLiveness;
  for (let index = 0; reusable.record && index < 5; index += 1) {
    reusableLiveness = await resolveManagedRecordLiveness(args, preferred, reusable.record, liveById);
    if (reusableLiveness.live === true) {
      break;
    }
    deleteManagedTab(reusable.record.tab_id);
    reusable = findReusableManagedTab(args, url, liveTabs);
  }
  const unmanagedIgnored = summarizeUnmanagedMatches(args, url, liveTabs);
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
      record = updateManagedTab(record.tab_id, {
        url,
        title: String(nav.value?.title ?? record.title ?? ""),
      }) ?? record;
    } else {
      record = updateManagedTab(record.tab_id, { touch: true }) ?? record;
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

function markManagedTabKeep(args) {
  const tabId = String(args?.tab_id ?? args?.session_id ?? "").trim();
  if (!tabId) {
    throw createToolError("INVALID_ARGUMENT", "tab_id or session_id is required for action=mark_keep");
  }
  const keep = args?.keep !== false;
  const record = getManagedTab(tabId);
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
  const updated = updateManagedTab(tabId, { keep });
  return {
    status: "success",
    action: "mark_keep",
    managed: true,
    managed_tab: managedTabPayload(updated ?? record),
  };
}

async function listManagedTabs(args = {}) {
  const includeDisconnected = args?.include_disconnected === true || args?.history === true;
  const liveSessions = listSessionsSnapshot();
  const sessions = includeDisconnected
    ? listSessionsSnapshot({ include_disconnected: true })
    : liveSessions;
  const disconnectedSessions = includeDisconnected
    ? sessions.filter((session) => session.active !== true)
    : undefined;
  const pruneStale = args?.prune_stale === true
    ? await pruneStaleManagedTabs({ ...args, dry_run: args?.dry_run === true })
    : undefined;
  return {
    status: "success",
    action: "list_managed",
    capabilities: CAPABILITIES,
    managed_tabs: listManagedTabRecords({ include_closed: true }).map((record) => managedTabPayload(record)),
    groups: managedTabGroups(),
    live_sessions: liveSessions,
    disconnected_sessions: disconnectedSessions,
    sessions,
    prune_stale: pruneStale,
    ...sessionPointers(),
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
    return {
      tab_id: record.tab_id,
      closed: true,
      transport: result.transport,
      transport_attempts: result.transport_attempts,
    };
  }
  await cdpRunCommand({ ...args, switch_tab_id: record.tab_id }, "Target.closeTarget", {
    targetId: record.tab_id,
  });
  return {
    tab_id: record.tab_id,
    closed: true,
    transport: "cdp",
  };
}

function resolveCloseScope(args = {}) {
  const taskId = String(args.task_id ?? args.taskId ?? "").trim();
  const workspaceKey = String(args.workspace_key ?? args.workspaceKey ?? "").trim();
  const scope = String(args.scope ?? "").trim().toLowerCase();
  const all = scope === "all" || args.all === true || args.confirm_all === true;
  if (!taskId && !workspaceKey && !all) {
    throw createToolError(
      "INVALID_ARGUMENT",
      "workspace_key or task_id is required for action=close_unkept; use scope=\"all\" to close all unkept managed tabs",
    );
  }
  return { taskId, workspaceKey, all, scope: all ? "all" : (workspaceKey ? "workspace" : "task") };
}

async function closeUnkeptManagedTabs(args) {
  const closeScope = resolveCloseScope(args ?? {});
  const unmanagedTabId = String(args?.tab_id ?? args?.session_id ?? "").trim();
  const unmanagedIgnored = unmanagedTabId && !getManagedTab(unmanagedTabId) ? [unmanagedTabId] : [];
  const candidates = listManagedTabRecords(closeScope.all
    ? {}
    : { task_id: closeScope.taskId, workspace_key: closeScope.workspaceKey })
    .filter((record) => record.keep !== true);
  const closed = [];
  const errors = [];
  const preferred = args?.dry_run === true || candidates.length === 0
    ? null
    : await resolvePreferredBrowserContext(args ?? {});
  for (const record of candidates) {
    try {
      const result = await closeOneManagedTab(args, record, preferred);
      closed.push(result);
      if (args?.dry_run !== true && record.dry_run !== true) {
        updateManagedTab(record.tab_id, {
          status: result.closed ? "closed" : record.status,
          touch: false,
        });
        if (result.closed) {
          deleteManagedTab(record.tab_id);
        }
      }
    } catch (error) {
      errors.push({
        tab_id: record.tab_id,
        error: String(error?.message ?? error),
      });
    }
  }
  return {
    status: errors.length > 0 ? "partial" : "success",
    action: "close_unkept",
    close_scope: closeScope,
    closed,
    errors,
    unmanaged_tabs_ignored: unmanagedIgnored,
    kept_tabs: listManagedTabRecords()
      .filter((record) => record.keep === true)
      .map((record) => managedTabPayload(record)),
  };
}

async function pruneStaleManagedTabs(args = {}) {
  const records = listManagedTabRecords();
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
  const pruned = [];
  const kept = [];
  for (const record of records) {
    const liveness = await resolveManagedRecordLiveness(args, preferred, record, liveById);
    const payload = {
      tab_id: record.tab_id,
      workspace_key: record.workspace_key,
      url: record.url,
      reason: liveness.reason,
    };
    if (liveness.live === true) {
      kept.push(payload);
      continue;
    }
    pruned.push(payload);
    if (args?.dry_run !== true) {
      deleteManagedTab(record.tab_id);
    }
  }
  return {
    status: "success",
    action: "prune_stale",
    dry_run: args?.dry_run === true,
    transport: preferred.transport,
    transport_attempts: Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [],
    pruned_count: args?.dry_run === true ? 0 : pruned.length,
    would_prune_count: pruned.length,
    pruned,
    kept,
    capabilities: CAPABILITIES,
    ...sessionPointers(),
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
    return listManagedTabs(args);
  }
  if (action === "prune_stale") {
    return pruneStaleManagedTabs(args);
  }
  return closeUnkeptManagedTabs(args);
}

async function writeClipboardText(args) {
  const text = String(args?.text ?? "");
  if (!Object.prototype.hasOwnProperty.call(args ?? {}, "text")) {
    throw createToolError("INVALID_ARGUMENT", "text is required for action=write_text");
  }
  if (args?.dry_run === true) {
    return {
      status: "success",
      action: "write_text",
      dry_run: true,
      text_length: text.length,
      read_supported: false,
      next_step: "Call without dry_run to write text through navigator.clipboard in the active browser page.",
    };
  }
  const result = await executeBrowserScript(args, `
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      return { ok: false, error: "navigator.clipboard.writeText is unavailable" };
    }
    await navigator.clipboard.writeText(input.text);
    return { ok: true, text_length: input.text.length };
  `, { text });
  if (result.value?.ok === false) {
    throw createToolError("EXECUTION_ERROR", String(result.value.error ?? "clipboard write failed"));
  }
  return {
    status: "success",
    action: "write_text",
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    page: result.page,
    text_length: text.length,
    read_supported: false,
  };
}

async function pasteClipboardText(args) {
  const text = String(args?.text ?? "");
  if (!Object.prototype.hasOwnProperty.call(args ?? {}, "text")) {
    throw createToolError("INVALID_ARGUMENT", "text is required for action=paste_text");
  }
  const selector = String(args?.selector ?? "").trim();
  if (selector && args?.real_paste !== true) {
    const result = await executeBrowserScript(args, `
      const el = document.querySelector(input.selector);
      if (!el) return { ok: false, error: "target not found: " + input.selector };
      const previous = "value" in el ? String(el.value ?? "") : String(el.textContent ?? "");
      if ("value" in el) {
        el.value = input.text;
      } else {
        el.textContent = input.text;
      }
      for (const type of ["input", "change"]) {
        el.dispatchEvent(new Event(type, { bubbles: true }));
      }
      return { ok: true, selector: input.selector, previous_length: previous.length, text_length: input.text.length };
    `, { selector, text });
    if (result.value?.ok === false) {
      throw createToolError("EXECUTION_ERROR", String(result.value.error ?? "DOM paste failed"));
    }
    return {
      status: "success",
      action: "paste_text",
      method: "dom_value",
      transport: result.transport,
      transport_attempts: result.transport_attempts,
      page: result.page,
      result: result.value,
    };
  }
  const native = await handleBrowserNativeInput({
    ...args,
    action: "paste",
    text,
  });
  return {
    status: "success",
    action: "paste_text",
    method: "native_paste",
    native_result: native,
  };
}

async function handleBrowserClipboardOps(args) {
  const action = normalizeAction(args, [
    "write_text",
    "paste_text",
  ]);
  if (action === "write_text") {
    return writeClipboardText(args);
  }
  return pasteClipboardText(args);
}

async function refreshSessionRegistry(args) {
  const targets = await fetchCdpTargets(normalizeEndpoint(args?.cdp_endpoint));
  syncSessionRegistry(targets);
  return asShortTabs(targets);
}

export {
  handleBrowserClipboardOps,
  handleBrowserDownloadOps,
  handleBrowserFileOps,
  handleBrowserTabLifecycle,
  refreshSessionRegistry,
};
