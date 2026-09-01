import { appendFile, chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const TOOL_JOURNAL_SCHEMA_VERSION = "browser67.tool-event.v1";
const TOOL_JOURNAL_FILE = "tool-events.ndjson";
const DEFAULT_TOOL_JOURNAL_MAX_BYTES = 8 * 1024 * 1024;
const SAFE_RESULT_COUNT_KEYS = [
  "candidate_count",
  "closed_count",
  "created_count",
  "finished_count",
  "managed_count",
  "pruned_count",
  "returned_count",
  "stale_count",
];

function boundedText(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function finiteDuration(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Number(number.toFixed(2)) : undefined;
}

function safeIdentity(args = {}) {
  const browserInstanceId = boundedText(args.browser_instance_id ?? args.browserInstanceId);
  const tabId = boundedText(args.tab_id ?? args.switch_tab_id ?? args.session_id);
  const workspaceKey = boundedText(args.workspace_key ?? args.workspaceKey);
  const taskId = boundedText(args.task_id ?? args.taskId);
  const runId = boundedText(args.run_id ?? args.runId);
  return {
    ...(browserInstanceId ? { browser_instance_id: browserInstanceId } : {}),
    ...(tabId ? { tab_id: tabId } : {}),
    ...(workspaceKey ? { workspace_key: workspaceKey } : {}),
    ...(taskId ? { task_id: taskId } : {}),
    ...(runId ? { run_id: runId } : {}),
  };
}

function safeResultSummary(result = {}) {
  const summary = {};
  for (const key of ["created", "reused", "dry_run", "closed"]) {
    if (typeof result?.[key] === "boolean") summary[key] = result[key];
  }
  for (const key of SAFE_RESULT_COUNT_KEYS) {
    const number = Number(result?.[key]);
    if (Number.isFinite(number) && number >= 0) summary[key] = number;
  }
  const transport = boundedText(result?.transport, 64);
  if (transport) summary.transport = transport;
  return summary;
}

function normalizedToolEvent(entry = {}, clock = () => new Date()) {
  const args = entry.args && typeof entry.args === "object" ? entry.args : {};
  const result = entry.result && typeof entry.result === "object" ? entry.result : {};
  const action = boundedText(args.action ?? result.action, 80);
  const focusPolicy = boundedText(args.focus_policy ?? args.focusPolicy, 48);
  const windowPolicy = boundedText(args.window_policy ?? args.windowPolicy, 48);
  const errorCode = boundedText(entry.error_code, 80);
  return {
    schema_version: TOOL_JOURNAL_SCHEMA_VERSION,
    ts: clock().toISOString(),
    runtime_id: boundedText(entry.runtime_id, 120),
    request_id: boundedText(entry.request_id, 120),
    surface: boundedText(entry.surface || "browser", 48),
    tool: boundedText(entry.tool, 120),
    ...(action ? { action } : {}),
    status: entry.status === "success" ? "success" : "error",
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(typeof entry.retryable === "boolean" ? { retryable: entry.retryable } : {}),
    ...(finiteDuration(entry.duration_ms) !== undefined
      ? { duration_ms: finiteDuration(entry.duration_ms) }
      : {}),
    ...safeIdentity(args),
    ...(focusPolicy ? { focus_policy: focusPolicy } : {}),
    ...(windowPolicy ? { window_policy: windowPolicy } : {}),
    result: safeResultSummary(result),
  };
}

class ToolJournal {
  constructor(options = {}) {
    const runRoot = path.resolve(options.run_root || process.cwd());
    this.path = path.resolve(options.path || path.join(path.dirname(runRoot), TOOL_JOURNAL_FILE));
    this.enabled = options.enabled !== false;
    const requestedMaxBytes = Number(options.max_bytes ?? DEFAULT_TOOL_JOURNAL_MAX_BYTES);
    this.maxBytes = Number.isFinite(requestedMaxBytes) && requestedMaxBytes > 0
      ? Math.floor(requestedMaxBytes)
      : DEFAULT_TOOL_JOURNAL_MAX_BYTES;
    this.rotatedPath = `${this.path}.1`;
    this.clock = typeof options.clock === "function" ? options.clock : () => new Date();
    this.pending = Promise.resolve();
    this.writeCount = 0;
    this.rotationCount = 0;
    this.errorCount = 0;
    this.lastError = "";
    this.disposed = false;
  }

  async rotateIfNeeded() {
    const info = await stat(this.path).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!info || info.size < this.maxBytes) return;
    await rm(this.rotatedPath, { force: true });
    try {
      await rename(this.path, this.rotatedPath);
      await chmod(this.rotatedPath, 0o600);
      this.rotationCount += 1;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  async record(entry = {}) {
    if (!this.enabled || this.disposed) return { recorded: false, reason: "disabled" };
    const payload = normalizedToolEvent(entry, this.clock);
    this.pending = this.pending.then(async () => {
      await mkdir(path.dirname(this.path), { recursive: true });
      await this.rotateIfNeeded();
      await appendFile(this.path, `${JSON.stringify(payload)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(this.path, 0o600);
      this.writeCount += 1;
      this.lastError = "";
    }).catch((error) => {
      this.errorCount += 1;
      this.lastError = boundedText(error?.message ?? error, 240);
    });
    await this.pending;
    return { recorded: this.lastError === "", path: this.path };
  }

  stats() {
    return {
      path: this.path,
      rotated_path: this.rotatedPath,
      max_bytes: this.maxBytes,
      enabled: this.enabled,
      disposed: this.disposed,
      write_count: this.writeCount,
      rotation_count: this.rotationCount,
      error_count: this.errorCount,
      last_error: this.lastError || undefined,
    };
  }

  async dispose() {
    if (this.disposed) return this.stats();
    await this.pending;
    this.disposed = true;
    return this.stats();
  }
}

function createToolJournal(options = {}) {
  return new ToolJournal(options);
}

export {
  DEFAULT_TOOL_JOURNAL_MAX_BYTES,
  TOOL_JOURNAL_FILE,
  TOOL_JOURNAL_SCHEMA_VERSION,
  ToolJournal,
  createToolJournal,
  normalizedToolEvent,
};
