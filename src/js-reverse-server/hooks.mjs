import { randomUUID } from "node:crypto";

import { runtimeScript } from "./runtime-script.mjs";
import { serverHooks } from "./state.mjs";
import { pageEval } from "./tmwd-adapter.mjs";
import { asArray } from "./utils.mjs";

function createHookDefinition(args) {
  const id = String(args?.hook_id ?? `hook_${randomUUID().slice(0, 8)}`);
  const hook = {
    id,
    type: String(args?.type ?? "fetch").trim() || "fetch",
    target: String(args?.target ?? args?.pattern ?? "").trim(),
    created_at: new Date().toISOString(),
    enabled: false,
  };
  serverHooks.set(id, hook);
  return hook;
}

async function handleCreateHook(args) {
  return { ok: true, hook: createHookDefinition(args) };
}

async function handleInjectHook(args) {
  const hookId = String(args?.hook_id ?? "").trim();
  const hook = serverHooks.get(hookId) ?? createHookDefinition(args);
  const result = await pageEval(args, `
    ${runtimeScript()}
    const hook = input.hook;
    root.hooks[hook.id] = hook;
    if (hook.type === 'fetch') root.enableFetch();
    if (hook.type === 'xhr') root.enableXhr();
    if (hook.type === 'websocket') root.enableWebSocket();
    if (hook.type === 'eval') root.enableEval();
    if (hook.type === 'timer') root.enableTimer();
    if (hook.type === 'cookie') root.enableCookie();
    let functionHook = null;
    if (hook.type === 'function') functionHook = root.hookFunction(hook.id, hook.target);
    root.hooks[hook.id].enabled = true;
    return { ok: true, hook: root.hooks[hook.id], functionHook };
  `, { hook });
  hook.enabled = true;
  serverHooks.set(hook.id, hook);
  return { ok: true, transport: result.transport, page: result.page, result: result.value };
}

async function handleGetHookData(args) {
  const hookId = String(args?.hook_id ?? "").trim();
  const view = String(args?.view ?? "summary");
  const maxRecords = Math.max(1, Math.min(1000, Number(args?.max_records ?? 80)));
  const result = await pageEval(args, `
    ${runtimeScript()}
    let rows = root.records.slice();
    if (input.hookId) rows = rows.filter((record) => record.data && record.data.hookId === input.hookId);
    rows = rows.slice(-input.maxRecords);
    if (input.view !== 'raw') {
      rows = rows.map((record) => ({
        id: record.id,
        ts: record.ts,
        kind: record.kind,
        url: record.url,
        title: record.title,
        summary: {
          request_url: record.data?.request?.url || record.data?.url,
          method: record.data?.request?.method,
          status: record.data?.response?.status,
          event: record.data?.event,
          path: record.data?.path,
          has_stack: Boolean(record.data?.stack || record.data?.request?.stack)
        }
      }));
    }
    return rows;
  `, { hookId, view, maxRecords });
  return { ok: true, transport: result.transport, page: result.page, view, records: result.value };
}

async function handleRemoveHook(args) {
  const hookId = String(args?.hook_id ?? "").trim();
  const hook = serverHooks.get(hookId);
  if (hook) {
    hook.enabled = false;
    serverHooks.set(hookId, hook);
  }
  const result = await pageEval(args, `
    ${runtimeScript()}
    if (input.hookId && root.hooks[input.hookId]) root.hooks[input.hookId].enabled = false;
    return { ok: true, hooks: root.hooks };
  `, { hookId });
  return { ok: true, transport: result.transport, page: result.page, hook_id: hookId, page_hooks: result.value?.hooks };
}

function handleListHooks() {
  return { ok: true, hooks: Array.from(serverHooks.values()) };
}

async function handleHookFunction(args) {
  const hook = createHookDefinition({ ...args, type: "function", target: args?.target ?? args?.pattern });
  return handleInjectHook({ ...args, hook_id: hook.id });
}

async function handleUnhookFunction(args) {
  const target = String(args?.target ?? args?.pattern ?? "").trim();
  const result = await pageEval(args, `
    ${runtimeScript()}
    return root.unhookFunction(input.target);
  `, { target });
  return { ok: result.value?.ok !== false, transport: result.transport, page: result.page, result: result.value };
}

async function handleMonitorEvents(args) {
  const events = asArray(args?.events).length > 0 ? asArray(args.events) : ["click", "input", "submit", "keydown"];
  const monitorId = String(args?.monitor_id ?? `mon_${randomUUID().slice(0, 8)}`);
  const result = await pageEval(args, `
    ${runtimeScript()}
    const monitorId = input.monitorId;
    const events = input.events;
    root.monitors[monitorId] = { id: monitorId, events, enabled: true };
    for (const eventName of events) {
      document.addEventListener(eventName, (event) => {
        if (!root.monitors[monitorId]?.enabled) return;
        root.record('dom-event', {
          monitorId,
          event: eventName,
          target: event.target ? { tag: event.target.tagName, id: event.target.id, className: event.target.className, text: String(event.target.innerText || event.target.value || '').slice(0, 300) } : null,
          stack: new Error('dom event').stack
        });
      }, true);
    }
    return root.monitors[monitorId];
  `, { monitorId, events });
  return { ok: true, transport: result.transport, page: result.page, monitor: result.value };
}

async function handleStopMonitor(args) {
  const monitorId = String(args?.monitor_id ?? args?.hook_id ?? "").trim();
  const result = await pageEval(args, `
    ${runtimeScript()}
    if (root.monitors[input.monitorId]) root.monitors[input.monitorId].enabled = false;
    return root.monitors[input.monitorId] || null;
  `, { monitorId });
  return { ok: true, transport: result.transport, page: result.page, monitor: result.value };
}

async function handleInjectPreloadScript(args) {
  const code = String(args?.code ?? "");
  const result = await pageEval(args, `
    ${runtimeScript()}
    root.preloadScripts.push({ ts: new Date().toISOString(), code: input.code.slice(0, 20000) });
    let evalResult = null;
    try { evalResult = eval(input.code); } catch (error) { evalResult = { ok: false, error: error.message || String(error) }; }
    return {
      ok: true,
      executed_now: true,
      evalResult,
      preload_semantics: {
        current_document_eval: true,
        next_navigation_preload: 'recorded_only',
        true_document_start: false,
        extension_level_content_script: false,
        remote_cdp_new_document_script: false,
        note: 'The script was evaluated in the current document and recorded for operator replay; it is not a true document_start preload.'
      },
      warning: 'browser67 injected the script into the current document. For true document_start semantics, use an extension-level content script or remote CDP Page.addScriptToEvaluateOnNewDocument path.'
    };
  `, { code });
  return { ok: true, transport: result.transport, page: result.page, result: result.value };
}

function unsupportedDebugger(tool) {
  return {
    ok: false,
    status: "not_supported",
    tool,
    reason: "This browser67-backed js-reverse MCP favors non-blocking hooks. Persistent Debugger pause/callframe state needs a dedicated remote CDP debug browser or a future persistent debugger bridge.",
    fallback: "Use create_hook/inject_hook/get_hook_data, break_on_xhr, or inject_preload_script.",
  };
}

async function handleBreakOnXhr(args) {
  const fetchHook = createHookDefinition({ ...args, type: "fetch", target: args?.pattern ?? args?.url });
  const xhrHook = createHookDefinition({ ...args, type: "xhr", target: args?.pattern ?? args?.url });
  await handleInjectHook({ ...args, hook_id: fetchHook.id });
  await handleInjectHook({ ...args, hook_id: xhrHook.id });
  return {
    ok: true,
    hooks: [fetchHook, xhrHook],
    note: "Installed fetch/xhr hooks instead of debugger breakpoints.",
  };
}

export {
  handleBreakOnXhr,
  handleCreateHook,
  handleGetHookData,
  handleHookFunction,
  handleInjectHook,
  handleInjectPreloadScript,
  handleListHooks,
  handleMonitorEvents,
  handleRemoveHook,
  handleStopMonitor,
  handleUnhookFunction,
  unsupportedDebugger,
};
