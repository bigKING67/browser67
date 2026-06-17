import { promises as fs } from "node:fs";
import path from "node:path";

import {
  nowIso,
  normalizeTimeoutMs,
  randomId,
} from "../common.mjs";
import { cdpRunCommand } from "../cdp-runtime.mjs";
import { createToolError } from "../errors.mjs";
import { resolvePreferredBrowserContext } from "../tmwd-runtime.mjs";
import {
  executeTmwdCommand,
  normalizeAction,
  resolveDownloadDir,
  sleep,
} from "./shared.mjs";

const PARTIAL_DOWNLOAD_SUFFIXES = [".crdownload", ".download", ".part", ".tmp"];
const downloadSessions = new Map();

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
  const rows = (await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) {
      return null;
    }
    const filePath = path.join(downloadDir, entry.name);
    if (isPartialDownload(filePath)) {
      return null;
    }
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs < sinceMs) {
      return null;
    }
    return {
      path: filePath,
      name: entry.name,
      size: stat.size,
      mtime_ms: Math.floor(stat.mtimeMs),
      mtime: new Date(stat.mtimeMs).toISOString(),
    };
  }))).filter((row) => row !== null);
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
  const poll = async (previous = new Map()) => {
    if (Date.now() - started > timeoutMs) {
      throw createToolError("TIMEOUT", `download wait timeout after ${String(timeoutMs)}ms`, {
        retryable: true,
        details: {
          token: session.token,
          download_dir: session.download_dir,
          since_ms: session.since_ms,
        },
      });
    }
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
    await sleep(pollMs);
    return poll(new Map(files.map((file) => [file.path, file.size])));
  };
  return poll();
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

export { handleBrowserDownloadOps };
