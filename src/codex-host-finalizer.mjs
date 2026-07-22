import {
  collectFinalizeHintsFromToolResult,
  isRecord,
} from "./codex-host-finalizer/payloads.mjs";

function normalizeServerName(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^mcp__/, "")
    .replace(/-/g, "_")
    .toLowerCase();
  if (normalized.includes("js_reverse") || normalized.includes("js-reverse")) {
    return "js_reverse";
  }
  if (normalized.includes("tmwd_browser") || normalized.includes("tmwd-browser")) {
    return "tmwd_browser";
  }
  if (normalized.includes("browser")) {
    return "tmwd_browser";
  }
  return normalized || "";
}

function sourceParts(context = {}) {
  const rawTool = String(context.source_tool ?? context.tool ?? "").trim();
  if (!rawTool) {
    return {
      server: normalizeServerName(context.source_server ?? context.server),
      tool: "",
    };
  }
  const compact = rawTool.replace(/^mcp__/, "");
  const [serverPart, ...toolParts] = compact.split(/[.:]/g);
  const server = normalizeServerName(context.source_server ?? context.server ?? serverPart);
  const tool = toolParts.join(".") || rawTool.split(".").pop() || rawTool.split("__").pop() || "";
  return { server, tool };
}

function inferFinalizeTarget(hint = {}, context = {}) {
  const source = sourceParts(context);
  const hintedTool = String(hint.tool ?? "").trim();
  const sourceTool = String(source.tool ?? "").trim();
  const hintedServer = normalizeServerName(hint.server ?? hint.mcp_server);
  const sourceServer = normalizeServerName(source.server);
  const server = hintedServer
    || (hintedTool === "browser_tab_lifecycle" ? "tmwd_browser" : "")
    || (hintedTool === "finalize_task" ? "js_reverse" : "")
    || sourceServer
    || (sourceTool === "browser_tab_lifecycle" ? "tmwd_browser" : "")
    || (sourceTool === "new_page" || sourceTool === "finalize_task" ? "js_reverse" : "");
  const tool = server === "tmwd_browser"
    ? "browser_tab_lifecycle"
    : (server === "js_reverse" ? "finalize_task" : (hintedTool || sourceTool));
  return { server, tool };
}

function scopeFromHint(hint = {}) {
  const args = isRecord(hint.suggested_arguments) ? hint.suggested_arguments : {};
  const workspaceKey = String(
    args.workspace_key
      ?? args.workspaceKey
      ?? hint.workspace_key
      ?? hint.workspaceKey
      ?? "",
  ).trim();
  const taskId = String(
    args.task_id
      ?? args.taskId
      ?? hint.task_id
      ?? hint.taskId
      ?? "",
  ).trim();
  const scope = String(args.scope ?? hint.cleanup_scope ?? hint.scope ?? "").trim().toLowerCase();
  const all = scope === "all" || args.all === true || args.confirm_all === true || hint.all === true || hint.confirm_all === true;
  return {
    workspace_key: workspaceKey,
    task_id: taskId,
    all,
    scope: all ? "all" : (workspaceKey ? "workspace" : (taskId ? "task" : "unknown")),
  };
}

function cleanupArguments(hint = {}, context = {}, target = {}) {
  const suggested = isRecord(hint.suggested_arguments) ? hint.suggested_arguments : {};
  const defaults = isRecord(context.default_arguments) ? context.default_arguments : {};
  const scope = scopeFromHint(hint);
  const args = {
    ...defaults,
    ...suggested,
    prune_stale: suggested.prune_stale !== false,
  };
  delete args.workspaceKey;
  delete args.taskId;
  delete args.all;
  delete args.confirm_all;
  delete args.scope;
  if (scope.workspace_key) {
    args.workspace_key = scope.workspace_key;
  } else {
    delete args.workspace_key;
  }
  if (scope.task_id) {
    args.task_id = scope.task_id;
  } else {
    delete args.task_id;
  }
  if (target.tool === "browser_tab_lifecycle") {
    args.action = "finalize_task";
  } else {
    delete args.action;
  }
  return args;
}

function planKey(target, scope) {
  const scopeKey = [
    scope.workspace_key ? `workspace:${scope.workspace_key}` : "",
    scope.task_id ? `task:${scope.task_id}` : "",
  ].filter(Boolean).join("|") || "scope:unknown";
  return `${target.server}/${target.tool}/${scopeKey}`;
}

function cleanupGroupKey(scope) {
  return [
    scope.workspace_key ? `workspace:${scope.workspace_key}` : "",
    scope.task_id ? `task:${scope.task_id}` : "",
  ].filter(Boolean).join("|") || "scope:unknown";
}

function ignore(reason, hint, context, extra = {}) {
  return {
    ok: false,
    ignored: true,
    reason,
    source_server: normalizeServerName(context.source_server ?? context.server),
    source_tool: context.source_tool ?? context.tool,
    cleanup_scope: hint?.cleanup_scope,
    workspace_key: hint?.workspace_key,
    task_id: hint?.task_id,
    ...extra,
  };
}

function normalizeCodexFinalizeHint(hint, context = {}) {
  if (!isRecord(hint)) {
    return ignore("invalid_hint", {}, context);
  }
  if (hint.required !== true) {
    return ignore("not_required", hint, context);
  }
  const scope = scopeFromHint(hint);
  if (scope.all) {
    return ignore("auto_scope_all_blocked", hint, context, { scope });
  }
  if (!scope.workspace_key && !scope.task_id) {
    return ignore("missing_scope", hint, context, { scope });
  }
  const target = inferFinalizeTarget(hint, context);
  if (!target.server || !target.tool) {
    return ignore("unknown_finalize_tool", hint, context, { scope, target });
  }
  const argumentsPayload = cleanupArguments(hint, context, target);
  return {
    ok: true,
    ignored: false,
    key: planKey(target, scope),
    cleanup_group_key: cleanupGroupKey(scope),
    server: target.server,
    tool: target.tool,
    arguments: argumentsPayload,
    cleanup_scope: scope.scope,
    workspace_key: scope.workspace_key || undefined,
    task_id: scope.task_id || undefined,
    reason: String(hint.reason ?? "finalize_hint.required=true"),
    source_server: normalizeServerName(context.source_server ?? context.server),
    source_tool: context.source_tool ?? context.tool,
    closes_only_managed_tabs: hint.closes_only_managed_tabs === true,
    preserves_keep_true: hint.preserves_keep_true === true,
    ignores_unmanaged_user_tabs: hint.ignores_unmanaged_user_tabs === true,
  };
}

function normalizeToolResultEntry(entry = {}) {
  return {
    source_server: entry.source_server ?? entry.server,
    source_tool: entry.source_tool ?? entry.tool ?? entry.name,
    default_arguments: entry.default_arguments,
  };
}

function planCodexHardFinally(input = {}) {
  const entries = Array.isArray(input.tool_results) ? input.tool_results : [];
  const callsByKey = new Map();
  const ignored = [];
  for (const entry of entries) {
    const context = {
      ...normalizeToolResultEntry(entry),
      default_arguments: isRecord(entry.default_arguments)
        ? entry.default_arguments
        : (isRecord(input.default_arguments) ? input.default_arguments : {}),
    };
    for (const { hint } of collectFinalizeHintsFromToolResult(entry.result ?? entry.payload ?? entry, context)) {
      const normalized = normalizeCodexFinalizeHint(hint, context);
      if (normalized.ok === true) {
        if (!callsByKey.has(normalized.key)) {
          callsByKey.set(normalized.key, normalized);
        }
      } else {
        ignored.push(normalized);
      }
    }
  }
  const calls = Array.from(callsByKey.values()).sort((left, right) => left.key.localeCompare(right.key));
  const scopeAllBlocked = ignored.filter((entry) => entry.reason === "auto_scope_all_blocked").length;
  return {
    ok: true,
    policy: {
      hard_finally: true,
      source: "finalize_hint",
      auto_scope_all: false,
      closes_only_managed_tabs: true,
      preserves_keep_true: true,
      ignores_unmanaged_user_tabs: true,
    },
    pending_count: calls.length,
    ignored_count: ignored.length,
    scope_all_blocked_count: scopeAllBlocked,
    calls,
    ignored,
  };
}

function createCodexFinalizerTracker(options = {}) {
  const toolResults = [];
  return {
    addToolResult(entry = {}) {
      toolResults.push(entry);
      return planCodexHardFinally({
        ...options,
        tool_results: toolResults,
      });
    },
    plan(extra = {}) {
      return planCodexHardFinally({
        ...options,
        ...extra,
        tool_results: toolResults,
      });
    },
    reset() {
      toolResults.length = 0;
    },
  };
}

export {
  collectFinalizeHintsFromToolResult,
  createCodexFinalizerTracker,
  normalizeCodexFinalizeHint,
  planCodexHardFinally,
};
