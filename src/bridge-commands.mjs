import { normalizeEndpoint } from "./common.mjs";
import { cdpRunCommand, fetchCdpTargets, resolveTarget } from "./cdp-runtime.mjs";
import {
  asShortTabs,
  getActiveTargetId,
  listSessionsSnapshot,
  markSessionSelected,
  resolveSessionByPattern,
  sessionPointers,
  syncSessionRegistry,
} from "./session-registry.mjs";

function resolvePathValue(input, path) {
  if (!path) {
    return input;
  }
  let current = input;
  for (const token of path.split(".")) {
    if (current === null || current === undefined) {
      throw new Error(`batch reference unresolved at token=${token}`);
    }
    if (/^\d+$/.test(token)) {
      const index = Number.parseInt(token, 10);
      if (!Array.isArray(current)) {
        throw new Error(`batch reference expected array at token=${token}`);
      }
      if (index < 0 || index >= current.length) {
        throw new Error(`batch reference index out of range: ${token}`);
      }
      current = current[index];
      continue;
    }
    if (!(token in Object(current))) {
      throw new Error(`batch reference missing key: ${token}`);
    }
    current = current[token];
  }
  return current;
}

function replaceBatchRefs(value, results) {
  const encoded = JSON.stringify(value ?? {});
  const replaced = encoded.replace(/"\$(\d+)\.([^"]+)"/g, (_, idxRaw, path) => {
    const idx = Number.parseInt(idxRaw, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= results.length) {
      throw new Error(`batch reference index unavailable: $${String(idxRaw)}.${path}`);
    }
    const picked = resolvePathValue(results[idx], path);
    return JSON.stringify(picked);
  });
  return JSON.parse(replaced);
}

function replaceBatchScalarRef(value, results) {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!/^\$\d+\./.test(trimmed)) {
    return value;
  }
  return replaceBatchRefs({ value: trimmed }, results).value;
}

function applyBatchRefsToCommand(command, results) {
  const next = { ...command };
  next.tabId = replaceBatchScalarRef(next.tabId, results);
  next.tab_id = replaceBatchScalarRef(next.tab_id, results);
  next.sessionId = replaceBatchScalarRef(next.sessionId, results);
  next.session_id = replaceBatchScalarRef(next.session_id, results);
  next.url = replaceBatchScalarRef(next.url, results);
  next.method = replaceBatchScalarRef(next.method, results);
  if (next.params !== undefined) {
    next.params = replaceBatchRefs(next.params, results);
  }
  return next;
}

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

async function bridgeTabs(args) {
  const endpoint = normalizeEndpoint(args?.cdp_endpoint);
  const targets = await fetchCdpTargets(endpoint);
  syncSessionRegistry(targets);
  const tabId = String(args?.tabId ?? args?.tab_id ?? "").trim();
  const method = String(args?.method ?? "").trim().toLowerCase();
  if ((method === "switch" || method === "activate") && tabId) {
    const found = targets.find((item) => item.id === tabId);
    if (!found) {
      throw new Error(`tabs.switch target not found: ${tabId}`);
    }
    markSessionSelected(tabId, { make_default: false });
    return {
      ok: true,
      activeTab: tabId,
      ...sessionPointers(),
    };
  }
  if (method === "find_session") {
    const pattern = String(args?.url_pattern ?? args?.urlPattern ?? "").trim();
    const matched = resolveSessionByPattern(targets, pattern);
    return {
      ok: true,
      pattern,
      matched: asShortTabs(matched),
      ...sessionPointers(),
    };
  }
  if (method === "set_session") {
    const pattern = String(args?.url_pattern ?? args?.urlPattern ?? "").trim();
    const matched = resolveSessionByPattern(targets, pattern);
    if (matched.length === 0) {
      return {
        ok: false,
        error: `no session matched pattern: ${pattern}`,
        ...sessionPointers(),
      };
    }
    markSessionSelected(matched[0].id, { make_default: true });
    return {
      ok: true,
      selected: matched[0].id,
      matched: asShortTabs(matched),
      ...sessionPointers(),
    };
  }
  if (method === "current_session") {
    return {
      ok: true,
      ...sessionPointers(),
    };
  }
  return {
    ok: true,
    data: targets.map((item) => ({
      id: item.id,
      url: item.url,
      title: item.title,
      active: item.id === getActiveTargetId() || item.active,
    })),
    sessions: listSessionsSnapshot(),
    ...sessionPointers(),
  };
}

async function bridgeCookies(args) {
  const resolved = await resolveTarget({
    ...args,
    switch_tab_id: args?.tabId ?? args?.tab_id ?? args?.switch_tab_id,
  });
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
  );
  return {
    ok: true,
    data: command.result.response?.cookies ?? [],
    selection: command.selection,
    ...sessionPointers(),
  };
}

async function bridgeCdp(args) {
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
  );
  return {
    ok: true,
    data: run.result.response,
    tab_id: run.target.id,
    selection: run.selection,
    ...sessionPointers(),
  };
}

async function bridgeBatch(args) {
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
      const resolvedCommand = applyBatchRefsToCommand(commandWithInheritedTab, results);
      const cmd = String(resolvedCommand.cmd ?? "").trim().toLowerCase();
      if (cmd === "tabs") {
        results.push(await bridgeTabs(resolvedCommand));
        continue;
      }
      if (cmd === "cookies") {
        results.push(await bridgeCookies(resolvedCommand));
        continue;
      }
      if (cmd === "cdp") {
        results.push(await bridgeCdp(resolvedCommand));
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
      results,
    };
  }
}

async function runBridgeCommand(command, args) {
  const cmd = String(command?.cmd ?? "").trim().toLowerCase();
  if (cmd === "tabs") {
    return bridgeTabs({ ...args, ...command });
  }
  if (cmd === "cookies") {
    return bridgeCookies({ ...args, ...command });
  }
  if (cmd === "cdp") {
    return bridgeCdp({ ...args, ...command });
  }
  if (cmd === "batch") {
    return bridgeBatch({ ...args, ...command });
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
