import { appendFile, chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const TOOL_JOURNAL_SCHEMA_VERSION = "browser67.tool-event.v1";
const TOOL_JOURNAL_FILE = "tool-events.ndjson";
const DEFAULT_TOOL_JOURNAL_MAX_BYTES = 8 * 1024 * 1024;
const SAFE_RESULT_COUNT_KEYS = [
  "candidate_count",
  "closed_count",
  "created_count",
  "dropped_entries",
  "entry_count",
  "finished_count",
  "managed_count",
  "managed_total_count",
  "managed_returned_count",
  "pruned_count",
  "registry_count",
  "registry_remaining",
  "released_count",
  "remaining_total_count",
  "remaining_kept_count",
  "remaining_unkept_count",
  "returned_count",
  "stale_count",
  "stale_total_count",
  "stale_returned_count",
  "stale_pruned_count",
  "stale_would_prune_count",
  "terminalized_count",
  "total_chars",
  "would_close_count",
  "would_prune_count",
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

function numericField(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function safeScreenshotSummary(args = {}, result = {}, errorDetails = {}) {
  const isScreenshot = String(result?.tool ?? "") === "browser_screenshot_ops"
    || String(args?.action ?? "") === "capture"
    || args?.viewport !== undefined;
  if (!isScreenshot) return undefined;
  const requested = args?.viewport && typeof args.viewport === "object" ? args.viewport : {};
  const verification = result?.viewport_override?.verification?.page
    ?? errorDetails?.verification?.page
    ?? errorDetails?.probe;
  const actual = verification?.actual ?? verification?.viewport ?? result?.page?.viewport ?? {};
  const artifact = result?.artifact ?? {};
  const summary = {
    target: boundedText(args?.target ?? result?.target ?? "viewport", 32),
    clear_after: requested.clear_after !== false,
    artifact_written: Boolean(artifact?.width && artifact?.height && artifact?.bytes),
  };
  for (const [key, value] of [
    ["requested_width", requested.width],
    ["requested_height", requested.height],
    ["requested_dpr", requested.dpr ?? requested.device_scale_factor],
    ["actual_width", actual.inner_width ?? actual.width],
    ["actual_height", actual.inner_height ?? actual.height],
    ["actual_dpr", actual.device_pixel_ratio ?? actual.dpr],
    ["artifact_width", artifact.width],
    ["artifact_height", artifact.height],
    ["artifact_bytes", artifact.bytes],
  ]) {
    const number = numericField(value);
    if (number !== undefined) summary[key] = number;
  }
  return summary;
}

function safeResultSummary(result = {}, args = {}, errorDetails = {}) {
  const summary = {};
  const candidates = [
    result,
    result?.summary,
    result?.cleanup_summary,
    result?.run_finalize,
    result?.remaining,
    result?.live_filter,
  ].filter((candidate) => candidate && typeof candidate === "object");
  for (const key of ["created", "reused", "dry_run", "closed"]) {
    const candidate = candidates.find((value) => typeof value?.[key] === "boolean");
    if (candidate) summary[key] = candidate[key];
  }
  for (const key of SAFE_RESULT_COUNT_KEYS) {
    const candidate = candidates.find((value) => numericField(value?.[key]) !== undefined);
    if (candidate) summary[key] = numericField(candidate[key]);
  }
  const transportCandidate = candidates.find((value) => boundedText(value?.transport, 64));
  const transport = boundedText(transportCandidate?.transport, 64);
  if (transport) summary.transport = transport;
  const runTerminalized = result?.run?.terminalized ?? result?.run_terminalized;
  if (typeof runTerminalized === "boolean") summary.run_terminalized = runTerminalized;
  const screenshot = safeScreenshotSummary(args, result, errorDetails);
  if (screenshot) summary.screenshot = screenshot;
  return summary;
}

function normalizedToolEvent(entry = {}, clock = () => new Date()) {
  const args = entry.args && typeof entry.args === "object" ? entry.args : {};
  const result = entry.result && typeof entry.result === "object" ? entry.result : {};
  const action = boundedText(args.action ?? result.action, 80);
  const focusPolicy = boundedText(args.focus_policy ?? args.focusPolicy, 48);
  const windowPolicy = boundedText(args.window_policy ?? args.windowPolicy, 48);
  const errorCode = boundedText(entry.error_code, 80);
  const errorDetails = entry.error_details && typeof entry.error_details === "object"
    ? entry.error_details
    : {};
  const failedPhase = boundedText(errorDetails.failed_phase ?? entry.failed_phase, 80);
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
    ...(failedPhase ? { failed_phase: failedPhase } : {}),
    ...(typeof entry.retryable === "boolean" ? { retryable: entry.retryable } : {}),
    ...(finiteDuration(entry.duration_ms) !== undefined
      ? { duration_ms: finiteDuration(entry.duration_ms) }
      : {}),
    ...safeIdentity(args),
    ...(focusPolicy ? { focus_policy: focusPolicy } : {}),
    ...(windowPolicy ? { window_policy: windowPolicy } : {}),
    result: safeResultSummary(result, args, errorDetails),
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
      await mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
      await chmod(path.dirname(this.path), 0o700);
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
