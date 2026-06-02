import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  nowIso,
  normalizeEndpoint,
  normalizeTimeoutMs,
  randomId,
} from "./common.mjs";
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
  executeTmwdJsWithFallback,
  resolvePreferredBrowserContext,
} from "./tmwd-runtime.mjs";

const PARTIAL_DOWNLOAD_SUFFIXES = [".crdownload", ".download", ".part", ".tmp"];
const downloadSessions = new Map();
const managedTabs = new Map();

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

async function executeTmwdCommand(args, command) {
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  if (preferred.transport !== "tmwd_ws" && preferred.transport !== "tmwd_link") {
    throw createToolError(
      "TRANSPORT_UNAVAILABLE",
      `tmwd_browser wrapper requires TMWD transport, got ${preferred.transport}`,
      { retryable: true },
    );
  }
  const result = await executeTmwdJsWithFallback(args ?? {}, preferred.context, command);
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

function managedTabPayload(record) {
  return {
    tab_id: record.tab_id,
    url: record.url,
    title: record.title,
    keep: record.keep === true,
    dry_run: record.dry_run === true,
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function extractCreatedTabId(result) {
  const candidates = [
    result?.value?.id,
    result?.value?.tabId,
    result?.value?.tab_id,
    result?.value?.data?.id,
    result?.value?.data?.tabId,
    result?.value?.data?.tab_id,
    result?.raw?.tab_id,
    result?.raw?.data?.id,
    result?.raw?.data?.tabId,
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

async function createManagedTab(args) {
  const url = String(args?.url ?? "").trim();
  if (!url) {
    throw createToolError("INVALID_ARGUMENT", "url is required for action=create_managed");
  }
  const active = args?.active !== false;
  if (args?.dry_run === true) {
    const tabId = randomId("dry_tab");
    const record = {
      tab_id: tabId,
      url,
      title: "",
      keep: false,
      dry_run: true,
      status: "planned",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    managedTabs.set(tabId, record);
    return {
      status: "success",
      action: "create_managed",
      created: false,
      managed_tab: managedTabPayload(record),
    };
  }
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  let tabId = "";
  let title = "";
  let transport = preferred.transport;
  let transportAttempts = Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [];
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    const commandResult = await executeTmwdCommand(args, {
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
  const record = {
    tab_id: tabId,
    url,
    title,
    keep: false,
    dry_run: false,
    status: "open",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  managedTabs.set(tabId, record);
  markSessionSelected(tabId, { make_default: false });
  return {
    status: "success",
    action: "create_managed",
    created: true,
    transport,
    transport_attempts: transportAttempts,
    managed_tab: managedTabPayload(record),
    ...sessionPointers(),
  };
}

function markManagedTabKeep(args) {
  const tabId = String(args?.tab_id ?? args?.session_id ?? "").trim();
  if (!tabId) {
    throw createToolError("INVALID_ARGUMENT", "tab_id or session_id is required for action=mark_keep");
  }
  const keep = args?.keep !== false;
  const record = managedTabs.get(tabId);
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
  record.keep = keep;
  record.updated_at = nowIso();
  managedTabs.set(tabId, record);
  return {
    status: "success",
    action: "mark_keep",
    managed: true,
    managed_tab: managedTabPayload(record),
  };
}

function listManagedTabs() {
  return {
    status: "success",
    action: "list_managed",
    managed_tabs: Array.from(managedTabs.values()).map((record) => managedTabPayload(record)),
    sessions: listSessionsSnapshot({ include_disconnected: true }),
    ...sessionPointers(),
  };
}

async function closeOneManagedTab(args, record) {
  if (record.dry_run === true || args?.dry_run === true) {
    return {
      tab_id: record.tab_id,
      closed: false,
      dry_run: true,
      reason: "dry_run",
    };
  }
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    const result = await executeTmwdCommand(args, {
      cmd: "tabs",
      method: "close",
      tabId: record.tab_id,
    });
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

async function closeUnkeptManagedTabs(args) {
  const unmanagedTabId = String(args?.tab_id ?? args?.session_id ?? "").trim();
  const unmanagedIgnored = unmanagedTabId && !managedTabs.has(unmanagedTabId) ? [unmanagedTabId] : [];
  const candidates = Array.from(managedTabs.values()).filter((record) => record.keep !== true);
  const closed = [];
  const errors = [];
  for (const record of candidates) {
    try {
      const result = await closeOneManagedTab(args, record);
      closed.push(result);
      record.status = result.closed ? "closed" : record.status;
      record.updated_at = nowIso();
      managedTabs.set(record.tab_id, record);
      if (result.closed) {
        managedTabs.delete(record.tab_id);
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
    closed,
    errors,
    unmanaged_tabs_ignored: unmanagedIgnored,
    kept_tabs: Array.from(managedTabs.values())
      .filter((record) => record.keep === true)
      .map((record) => managedTabPayload(record)),
  };
}

async function handleBrowserTabLifecycle(args) {
  const action = normalizeAction(args, [
    "create_managed",
    "mark_keep",
    "list_managed",
    "close_unkept",
  ]);
  if (action === "create_managed") {
    return createManagedTab(args);
  }
  if (action === "mark_keep") {
    return markManagedTabKeep(args);
  }
  if (action === "list_managed") {
    return listManagedTabs(args);
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
