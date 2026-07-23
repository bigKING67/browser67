import { cdpRunCommand, fetchCdpTargets, resolveTarget } from "../../cdp-runtime/index.mjs";
import { normalizeEndpoint } from "../../runtime/config/endpoints.mjs";
import { defaultSessionRegistry } from "../../runtime/sessions/registry.mjs";
import { resolveBatchReferences } from "./batch-references.mjs";

function resolveInheritedBatchTabId(args) {
  if (args?.tabId !== undefined) {
    return args.tabId;
  }
  if (args?.tab_id !== undefined) {
    return args.tab_id;
  }
  if (args?.switch_tab_id !== undefined) {
    return args.switch_tab_id;
  }
  return undefined;
}

function resolveInheritedBatchSessionId(args) {
  if (args?.sessionId !== undefined) {
    return args.sessionId;
  }
  if (args?.session_id !== undefined) {
    return args.session_id;
  }
  return undefined;
}

async function bridgeTabs(args, options = {}) {
  const sessionStore = options.runtime?.sessionStore ?? defaultSessionRegistry;
  const endpoint = normalizeEndpoint(args?.cdp_endpoint);
  const targets = await fetchCdpTargets(endpoint);
  sessionStore.sync(targets);
  const tabId = String(args?.tabId ?? args?.tab_id ?? "").trim();
  const method = String(args?.method ?? "").trim().toLowerCase();
  if ((method === "switch" || method === "activate") && tabId) {
    const found = targets.find((item) => item.id === tabId);
    if (!found) {
      throw new Error(`tabs.switch target not found: ${tabId}`);
    }
    sessionStore.select(tabId, { make_default: false });
    return {
      ok: true,
      activeTab: tabId,
      ...sessionStore.sessionPointers(),
    };
  }
  if (method === "find_session") {
    const pattern = String(args?.url_pattern ?? args?.urlPattern ?? "").trim();
    const matched = sessionStore.resolveByPattern(targets, pattern);
    return {
      ok: true,
      pattern,
      matched: sessionStore.asShortTabs(matched),
      ...sessionStore.sessionPointers(),
    };
  }
  if (method === "set_session") {
    const pattern = String(args?.url_pattern ?? args?.urlPattern ?? "").trim();
    const matched = sessionStore.resolveByPattern(targets, pattern);
    if (matched.length === 0) {
      return {
        ok: false,
        error: `no session matched pattern: ${pattern}`,
        ...sessionStore.sessionPointers(),
      };
    }
    sessionStore.select(matched[0].id, { make_default: true });
    return {
      ok: true,
      selected: matched[0].id,
      matched: sessionStore.asShortTabs(matched),
      ...sessionStore.sessionPointers(),
    };
  }
  if (method === "current_session") {
    return {
      ok: true,
      ...sessionStore.sessionPointers(),
    };
  }
  return {
    ok: true,
    data: targets.map((item) => ({
      id: item.id,
      url: item.url,
      title: item.title,
      active: item.id === sessionStore.getActiveTargetId() || item.active,
    })),
    sessions: sessionStore.list(),
    ...sessionStore.sessionPointers(),
  };
}

async function bridgeCookies(args, options = {}) {
  const resolved = await resolveTarget({
    ...args,
    switch_tab_id: args?.tabId ?? args?.tab_id ?? args?.switch_tab_id,
  }, options);
  const url = String(args?.url ?? resolved.target.url ?? "").trim();
  if (!url) {
    return {
      ok: true,
      data: [],
    };
  }
  const command = await cdpRunCommand(
    {
      ...args,
      switch_tab_id: resolved.target.id,
    },
    "Network.getCookies",
    { urls: [url] },
    options,
  );
  return {
    ok: true,
    data: command.result.response?.cookies ?? [],
    selection: command.selection,
    ...resolved.pointers,
  };
}

async function bridgeCdp(args, options = {}) {
  const method = String(args?.method ?? "").trim();
  if (!method) {
    throw new Error("cmd=cdp requires method");
  }
  const params = typeof args?.params === "object" && args.params !== null ? args.params : {};
  const run = await cdpRunCommand(
    {
      ...args,
      switch_tab_id: args?.tabId ?? args?.tab_id ?? args?.switch_tab_id,
    },
    method,
    params,
    options,
  );
  return {
    ok: true,
    data: run.result.response,
    tab_id: run.target.id,
    selection: run.selection,
    ...run.pointers,
  };
}

async function bridgeBatch(args, options = {}) {
  const commands = Array.isArray(args?.commands) ? args.commands : [];
  const results = [];
  try {
    const inheritedTabId = resolveInheritedBatchTabId(args);
    const inheritedSessionId = resolveInheritedBatchSessionId(args);
    for (const command of commands) {
      if (typeof command !== "object" || command === null) {
        results.push({ ok: false, error: "command must be object" });
        continue;
      }
      const commandWithInheritedTab = { ...command };
      if (commandWithInheritedTab.tabId === undefined && inheritedTabId !== undefined) {
        commandWithInheritedTab.tabId = inheritedTabId;
      }
      if (commandWithInheritedTab.tab_id === undefined && inheritedTabId !== undefined) {
        commandWithInheritedTab.tab_id = inheritedTabId;
      }
      if (commandWithInheritedTab.sessionId === undefined && inheritedSessionId !== undefined) {
        commandWithInheritedTab.sessionId = inheritedSessionId;
      }
      if (commandWithInheritedTab.session_id === undefined && inheritedSessionId !== undefined) {
        commandWithInheritedTab.session_id = inheritedSessionId;
      }
      const resolvedCommand = resolveBatchReferences(commandWithInheritedTab, results, {
        command_index: results.length,
      });
      const cmd = String(resolvedCommand.cmd ?? "").trim().toLowerCase();
      if (cmd === "tabs") {
        results.push(await bridgeTabs(resolvedCommand, options));
        continue;
      }
      if (cmd === "cookies") {
        results.push(await bridgeCookies(resolvedCommand, options));
        continue;
      }
      if (cmd === "cdp") {
        results.push(await bridgeCdp(resolvedCommand, options));
        continue;
      }
      results.push({ ok: false, error: `unknown cmd: ${cmd || "<empty>"}` });
    }
    return {
      ok: true,
      results,
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message ?? error),
      error_code: error?.code,
      error_details: error?.details,
      results,
    };
  }
}

async function runBridgeCommand(command, args, options = {}) {
  const cmd = String(command?.cmd ?? "").trim().toLowerCase();
  if (cmd === "tabs") {
    return bridgeTabs({ ...args, ...command }, options);
  }
  if (cmd === "cookies") {
    return bridgeCookies({ ...args, ...command }, options);
  }
  if (cmd === "cdp") {
    return bridgeCdp({ ...args, ...command }, options);
  }
  if (cmd === "batch") {
    return bridgeBatch({ ...args, ...command }, options);
  }
  if (cmd === "management") {
    return {
      ok: false,
      error: "management command is not supported in standalone CDP mode",
    };
  }
  return {
    ok: false,
    error: `unknown cmd: ${cmd || "<empty>"}`,
  };
}

export {
  runBridgeCommand,
};
