#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { makeJsonTextContent, makeResult } from "./mcp-result.mjs";
import {
  executeTmwdJsWithFallback,
  resolvePreferredBrowserContext,
} from "./tmwd-runtime.mjs";
import {
  markSessionSelected,
  sessionPointers,
} from "./session-registry.mjs";
import {
  extractCreatedTabId,
  findReusableManagedTab,
  managedTabPayload,
  planManagedTab,
  recordManagedTab,
  summarizeUnmanagedMatches,
  updateManagedTab,
} from "./tab-workspace.mjs";

const VERSION = "0.1.0-tmwd-js-reverse";
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const runtimeRoot = resolve(repoRoot, "runtime/js-reverse");

const serverHooks = new Map();
const serverEvidence = [];

const COMMON_KEYWORDS = [
  "sign",
  "_signature",
  "token",
  "nonce",
  "encrypt",
  "hmac",
  "sha",
  "md5",
  "cookie",
  "h5st",
  "x-bogus",
  "msToken",
];

const TOOL_DEFINITIONS = {
  check_browser_health: "Verify TMWD-backed browser connectivity for JS reverse tasks.",
  navigate_page: "Navigate the selected page.",
  new_page: "Create a new browser page.",
  list_pages: "List TMWD-visible browser pages.",
  select_page: "Select a browser page by id.",
  list_scripts: "List script tags from the selected page.",
  get_script_source: "Read inline or external script source from the selected page.",
  search_in_scripts: "Search loaded scripts by keyword or regex.",
  find_in_script: "Find text in one script source.",
  list_network_requests: "List performance and hook-captured network requests.",
  get_network_request: "Get one captured network request by id.",
  list_websocket_connections: "List websocket activity captured by hooks or performance entries.",
  get_websocket_messages: "Get websocket messages captured by hooks.",
  get_request_initiator: "Return captured call stack for a request when hook data has it.",
  get_dom_structure: "Return a compact DOM tree snapshot.",
  create_hook: "Create a hook definition.",
  inject_hook: "Inject a hook definition into the selected page.",
  get_hook_data: "Read hook-captured runtime records.",
  remove_hook: "Disable a hook definition.",
  list_hooks: "List server-side hook definitions.",
  hook_function: "Shortcut for create_hook + inject_hook on a function path.",
  unhook_function: "Disable a function hook.",
  monitor_events: "Monitor DOM events in the selected page.",
  stop_monitor: "Stop DOM event monitoring.",
  trace_function: "Trace calls to a function path with hook records.",
  inject_preload_script: "Inject a runtime script now and record that early preload needs a reload-capable path.",
  set_breakpoint: "Breakpoint placeholder; hooks are preferred on this TMWD-backed server.",
  set_breakpoint_on_text: "Breakpoint placeholder by text search.",
  resume: "Debugger-control placeholder.",
  pause: "Debugger-control placeholder.",
  step_over: "Debugger-control placeholder.",
  step_into: "Debugger-control placeholder.",
  step_out: "Debugger-control placeholder.",
  evaluate_on_callframe: "Debugger callframe placeholder.",
  break_on_xhr: "Install fetch/xhr hooks for a URL pattern.",
  analyze_target: "One-shot reconnaissance over DOM, scripts, network, and hook records.",
  understand_code: "Local heuristic code analysis.",
  deobfuscate_code: "Lightweight local JavaScript beautification.",
  detect_crypto: "Detect common crypto/signing primitives in code.",
  summarize_code: "Summarize code shape with local heuristics.",
  risk_panel: "Score reverse-engineering risk and next-step confidence.",
  record_reverse_evidence: "Write reverse evidence to runtime artifacts.",
  export_session_report: "Export the current js-reverse session report.",
  export_rebuild_bundle: "Export a minimal Node rebuild bundle from captured evidence.",
  diff_env_requirements: "Heuristically diff browser/local environment requirements.",
  collect_code: "Collect script code snippets matching keywords.",
  collection_diff: "Diff two code collections by content hash.",
  inject_stealth: "Inject basic anti-detection overrides into the selected page.",
  set_user_agent: "Set User-Agent override through the TMWD CDP bridge.",
  save_session_state: "Save localStorage/sessionStorage/document cookie snapshot.",
  restore_session_state: "Restore localStorage/sessionStorage snapshot.",
  get_storage: "Read document cookie, localStorage, and sessionStorage.",
};

const TOOL_SCHEMAS = Object.fromEntries(
  Object.entries(TOOL_DEFINITIONS).map(([name, description]) => [
    name,
    {
      description,
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          session_id: { type: "string" },
          session_url_pattern: { type: "string" },
          url: { type: "string" },
          script_id: { type: "string" },
          source_url: { type: "string" },
          keywords: {
            type: "string",
            description: "Pipe-separated keywords, for example: sign|token|crypto.",
          },
          pattern: { type: "string" },
          request_id: { type: "string" },
          hook_id: { type: "string" },
          type: { type: "string" },
          target: { type: "string" },
          code: { type: "string" },
          events: { type: "array", items: { type: "string" } },
          view: { type: "string", enum: ["summary", "raw"] },
          max_records: { type: "number", minimum: 1, maximum: 1000 },
          channel: { type: "string" },
          task_id: { type: "string" },
          data: { type: "object" },
          before: { type: "object" },
          after: { type: "object" },
          user_agent: { type: "string" },
          active: { type: "boolean", default: true },
          keep: { type: "boolean", default: false },
          fresh: { type: "boolean", default: false },
          reuse: { type: "boolean", default: true },
          ownership_policy: { type: "string", enum: ["tmwd_only", "fresh"], default: "tmwd_only" },
          reuse_scope: { type: "string", enum: ["exact", "origin_path", "origin", "none"], default: "origin_path" },
          workspace_key: { type: "string" },
          reuse_key: { type: "string" },
          navigate_reused: { type: "boolean", default: true },
          dry_run: { type: "boolean", default: false },
          tmwd_mode: { type: "string", enum: ["tmwd"] },
          tmwd_transport: { type: "string", enum: ["auto", "ws", "link"] },
          tmwd_ws_endpoint: { type: "string" },
          tmwd_link_endpoint: { type: "string" },
          timeout_ms: { type: "number", minimum: 500, maximum: 120000 },
        },
      },
    },
  ]),
);

function clip(value, max = 4000) {
  const text = String(value ?? "");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n...[truncated ${String(text.length - max)} chars]`;
}

function hashText(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return value.split("|").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function browserArgs(args = {}) {
  return {
    ...args,
    session_id: args.session_id ?? args.page_id,
    tmwd_mode: "tmwd",
    tmwd_transport: args.tmwd_transport ?? "auto",
  };
}

function normalizeTransport(transport) {
  if (transport === "tmwd_ws" || transport === "ws") {
    return "tmwd_ws";
  }
  if (transport === "tmwd_link" || transport === "link") {
    return "tmwd_link";
  }
  return String(transport ?? "tmwd");
}

async function resolveTmwd(args = {}) {
  const preferred = await resolvePreferredBrowserContext(browserArgs(args));
  if (preferred.transport !== "tmwd_ws" && preferred.transport !== "tmwd_link") {
    throw new Error(`js-reverse server requires TMWD transport, got ${preferred.transport}`);
  }
  return preferred;
}

async function pageEval(args, body, input = {}) {
  const callArgs = browserArgs(args);
  const preferred = await resolveTmwd(callArgs);
  const code = `return await (async (input) => {\n${body}\n})(${JSON.stringify(input)});`;
  const result = await executeTmwdJsWithFallback(callArgs, preferred.context, code);
  return {
    value: result.executed.value,
    raw: result.executed.raw,
    transport: normalizeTransport(result.context.tmwd_transport),
    transport_attempts: result.transport_attempts,
    page: {
      id: result.context.target.id,
      url: result.context.target.url,
      title: result.context.target.title,
    },
  };
}

async function bridgeCommand(args, command) {
  const callArgs = browserArgs(args);
  const preferred = await resolveTmwd(callArgs);
  const result = await executeTmwdJsWithFallback(callArgs, preferred.context, command);
  return {
    value: result.executed.value,
    raw: result.executed.raw,
    transport: normalizeTransport(result.context.tmwd_transport),
    transport_attempts: result.transport_attempts,
    page: {
      id: result.context.target.id,
      url: result.context.target.url,
      title: result.context.target.title,
    },
  };
}

function runtimeScript() {
  return `
    const root = window.__TMWD_JS_REVERSE__ ||= {
      hooks: {},
      records: [],
      monitors: {},
      originals: {},
      preloadScripts: [],
      maxRecords: 2000
    };
    const safe = (value, depth = 0) => {
      if (depth > 3) return '[MaxDepth]';
      if (value === null || value === undefined) return value;
      const t = typeof value;
      if (t === 'string') return value.length > 2000 ? value.slice(0, 2000) + '...[truncated]' : value;
      if (t === 'number' || t === 'boolean') return value;
      if (t === 'function') return '[Function ' + (value.name || 'anonymous') + ']';
      try {
        if (value instanceof Response) return { status: value.status, url: value.url, type: 'Response' };
        if (value instanceof Request) return { url: value.url, method: value.method, type: 'Request' };
        if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
        if (value instanceof Element) return { tag: value.tagName, id: value.id, className: value.className, text: (value.innerText || '').slice(0, 300) };
      } catch (_) {}
      if (Array.isArray(value)) return value.slice(0, 40).map((item) => safe(item, depth + 1));
      try {
        const out = {};
        for (const key of Object.keys(value).slice(0, 80)) out[key] = safe(value[key], depth + 1);
        return out;
      } catch (e) {
        return '[Unserializable: ' + (e.message || String(e)) + ']';
      }
    };
    root.record = root.record || function(kind, data) {
      const rec = {
        id: 'jr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        ts: new Date().toISOString(),
        kind,
        url: location.href,
        title: document.title,
        data: safe(data)
      };
      root.records.push(rec);
      if (root.records.length > root.maxRecords) root.records.splice(0, root.records.length - root.maxRecords);
      return rec.id;
    };
    root.enableFetch = root.enableFetch || function() {
      if (root.originals.fetch || typeof window.fetch !== 'function') return;
      root.originals.fetch = window.fetch;
      window.fetch = async function(input, init) {
        const startedAt = performance.now();
        const req = {
          input: safe(input),
          init: safe(init),
          url: typeof input === 'string' ? input : (input && input.url),
          method: (init && init.method) || (input && input.method) || 'GET',
          stack: new Error('fetch initiator').stack
        };
        try {
          const res = await root.originals.fetch.apply(this, arguments);
          let body = '';
          try {
            const ctype = res.headers && res.headers.get && (res.headers.get('content-type') || '');
            if (/json|text|javascript|xml|html/i.test(ctype)) body = await res.clone().text();
          } catch (_) {}
          root.record('fetch', { request: req, response: { url: res.url, status: res.status, ok: res.ok, body: body.slice(0, 4000) }, duration_ms: Math.round(performance.now() - startedAt) });
          return res;
        } catch (error) {
          root.record('fetch', { request: req, error: safe(error), duration_ms: Math.round(performance.now() - startedAt) });
          throw error;
        }
      };
    };
    root.enableXhr = root.enableXhr || function() {
      if (root.originals.xhrOpen || typeof XMLHttpRequest === 'undefined') return;
      root.originals.xhrOpen = XMLHttpRequest.prototype.open;
      root.originals.xhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        this.__tmwdJr = { method, url, stack: new Error('xhr initiator').stack };
        return root.originals.xhrOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(body) {
        const xhr = this;
        const startedAt = performance.now();
        const onDone = () => {
          try {
            if (xhr.readyState === 4) {
              root.record('xhr', {
                request: { ...(xhr.__tmwdJr || {}), body: safe(body) },
                response: { status: xhr.status, responseURL: xhr.responseURL, body: String(xhr.responseText || '').slice(0, 4000) },
                duration_ms: Math.round(performance.now() - startedAt)
              });
            }
          } catch (error) {
            root.record('xhr', { error: safe(error) });
          }
        };
        this.addEventListener('readystatechange', onDone);
        return root.originals.xhrSend.apply(this, arguments);
      };
    };
    root.enableWebSocket = root.enableWebSocket || function() {
      if (root.originals.WebSocket || typeof WebSocket === 'undefined') return;
      root.originals.WebSocket = WebSocket;
      window.WebSocket = function(url, protocols) {
        const ws = protocols === undefined ? new root.originals.WebSocket(url) : new root.originals.WebSocket(url, protocols);
        const stack = new Error('websocket initiator').stack;
        root.record('websocket', { event: 'open-init', url, protocols: safe(protocols), stack });
        ws.addEventListener('message', (event) => root.record('websocket', { event: 'message', url, data: safe(event.data) }));
        ws.addEventListener('close', (event) => root.record('websocket', { event: 'close', url, code: event.code, reason: event.reason }));
        const send = ws.send.bind(ws);
        ws.send = function(data) {
          root.record('websocket', { event: 'send', url, data: safe(data), stack: new Error('websocket send').stack });
          return send(data);
        };
        return ws;
      };
      window.WebSocket.prototype = root.originals.WebSocket.prototype;
    };
    root.enableEval = root.enableEval || function() {
      if (root.originals.eval) return;
      root.originals.eval = window.eval;
      window.eval = function(code) {
        root.record('eval', { code: String(code).slice(0, 4000), stack: new Error('eval initiator').stack });
        return root.originals.eval.call(this, code);
      };
    };
    root.enableTimer = root.enableTimer || function() {
      if (root.originals.setTimeout) return;
      root.originals.setTimeout = window.setTimeout;
      window.setTimeout = function(handler, timeout) {
        root.record('timer', { timeout, handler: typeof handler === 'function' ? ('[Function ' + (handler.name || 'anonymous') + ']') : String(handler).slice(0, 1000), stack: new Error('timer initiator').stack });
        return root.originals.setTimeout.apply(this, arguments);
      };
    };
    root.enableCookie = root.enableCookie || function() {
      if (root.originals.cookieDescriptor) return;
      try {
        const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
        if (!desc || !desc.configurable) return;
        root.originals.cookieDescriptor = desc;
        Object.defineProperty(document, 'cookie', {
          configurable: true,
          get() {
            const value = desc.get.call(document);
            root.record('cookie', { event: 'get', value, stack: new Error('cookie get').stack });
            return value;
          },
          set(value) {
            root.record('cookie', { event: 'set', value, stack: new Error('cookie set').stack });
            return desc.set.call(document, value);
          }
        });
      } catch (error) {
        root.record('cookie', { error: safe(error) });
      }
    };
    root.hookFunction = root.hookFunction || function(hookId, path) {
      const parts = String(path || '').split('.').filter(Boolean);
      let parent = window;
      for (let i = 0; i < parts.length - 1; i++) parent = parent && parent[parts[i]];
      const key = parts[parts.length - 1];
      if (!parent || !key || typeof parent[key] !== 'function') return { ok: false, error: 'function not found: ' + path };
      const originalKey = 'fn:' + path;
      if (root.originals[originalKey]) return { ok: true, already: true };
      const original = parent[key];
      root.originals[originalKey] = original;
      parent[key] = function() {
        const args = Array.from(arguments);
        root.record('function', { hookId, path, args: safe(args), stack: new Error('function initiator').stack });
        const out = original.apply(this, arguments);
        if (out && typeof out.then === 'function') {
          return out.then((value) => {
            root.record('function', { hookId, path, result: safe(value), async: true });
            return value;
          });
        }
        root.record('function', { hookId, path, result: safe(out) });
        return out;
      };
      return { ok: true };
    };
    root.unhookFunction = root.unhookFunction || function(path) {
      const parts = String(path || '').split('.').filter(Boolean);
      let parent = window;
      for (let i = 0; i < parts.length - 1; i++) parent = parent && parent[parts[i]];
      const key = parts[parts.length - 1];
      const originalKey = 'fn:' + path;
      if (parent && key && root.originals[originalKey]) {
        parent[key] = root.originals[originalKey];
        delete root.originals[originalKey];
        return { ok: true };
      }
      return { ok: false, error: 'hook not found: ' + path };
    };
    return root;
  `;
}

async function ensureRuntime(args) {
  return pageEval(args, `${runtimeScript()}\nreturn { ok: true, records: root.records.length, hooks: Object.keys(root.hooks).length };`);
}

async function handleCheckBrowserHealth(args) {
  try {
    const tabs = await bridgeCommand(args, { cmd: "tabs" });
    const rows = Array.isArray(tabs.value) ? tabs.value : [];
    return {
      ok: true,
      mode: "tmwd",
      transport: tabs.transport,
      readiness: {
        ready: rows.length > 0,
        reason: rows.length > 0 ? "tmwd_transport_ready" : "tmwd_no_pages",
      },
      pages_count: rows.length,
      pages: rows.slice(0, 40),
      transport_attempts: tabs.transport_attempts,
    };
  } catch (error) {
    return {
      ok: false,
      mode: "tmwd",
      readiness: {
        ready: false,
        reason: "tmwd_unavailable",
      },
      error: String(error?.message ?? error),
    };
  }
}

async function handleListPages(args) {
  const tabs = await bridgeCommand(args, { cmd: "tabs" });
  return {
    ok: true,
    transport: tabs.transport,
    pages: Array.isArray(tabs.value) ? tabs.value : [],
    ...sessionPointers(),
  };
}

async function handleSelectPage(args) {
  const id = String(args?.page_id ?? args?.session_id ?? "").trim();
  if (!id) {
    return { ok: false, error: "page_id or session_id is required" };
  }
  markSessionSelected(id, { make_default: false });
  return { ok: true, selected: id, ...sessionPointers() };
}

async function handleNewPage(args) {
  const url = String(args?.url ?? "about:blank").trim() || "about:blank";
  if (args?.dry_run === true) {
    const reusable = findReusableManagedTab(
      { ...args, workspace_key: args?.workspace_key ?? "js-reverse" },
      url,
      [],
    );
    if (reusable.record) {
      return {
        ok: true,
        action: "new_page",
        created: false,
        reused: true,
        dry_run: true,
        owner: "tmwd",
        selected_by: reusable.selected_by,
        page: managedTabPayload(reusable.record),
        ...sessionPointers(),
      };
    }
    const record = planManagedTab({
      ...args,
      workspace_key: args?.workspace_key ?? "js-reverse",
      url,
      source: "js-reverse",
      status: "planned",
      dry_run: true,
      keep: args?.keep === true,
    });
    return {
      ok: true,
      action: "new_page",
      created: false,
      reused: false,
      would_create: true,
      dry_run: true,
      owner: "tmwd",
      page: managedTabPayload(record),
    };
  }
  const tabs = await bridgeCommand(args, { cmd: "tabs" });
  const liveTabs = Array.isArray(tabs.value) ? tabs.value : [];
  const workspaceArgs = {
    ...args,
    workspace_key: args?.workspace_key ?? "js-reverse",
  };
  const reusable = findReusableManagedTab(workspaceArgs, url, liveTabs);
  const unmanagedIgnored = summarizeUnmanagedMatches(workspaceArgs, url, liveTabs);
  if (reusable.record) {
    let record = reusable.record;
    let navigation;
    if (reusable.policy.navigate_reused && record.url !== reusable.policy.target.normalized_url) {
      const nav = await pageEval(
        { ...args, session_id: record.tab_id, page_id: record.tab_id },
        "if (location.href !== input.url) location.href = input.url; return { url: location.href, title: document.title };",
        { url },
      );
      navigation = { requested_url: url, result: nav.value, transport: nav.transport };
      record = updateManagedTab(record.tab_id, {
        url,
        title: String(nav.value?.title ?? record.title ?? ""),
      }) ?? record;
    } else {
      record = updateManagedTab(record.tab_id, { touch: true }) ?? record;
    }
    markSessionSelected(record.tab_id, { make_default: false });
    return {
      ok: true,
      action: "new_page",
      created: false,
      reused: true,
      owner: "tmwd",
      selected_by: reusable.selected_by,
      reuse_policy: reusable.policy,
      page: managedTabPayload(record),
      unmanaged_tabs_ignored: unmanagedIgnored,
      navigation,
      ...sessionPointers(),
    };
  }
  const result = await bridgeCommand(args, {
    cmd: "tabs",
    method: "create",
    url,
    active: args?.active !== false,
  });
  const tabId = extractCreatedTabId(result);
  if (!tabId) {
    return {
      ok: false,
      action: "new_page",
      error: "new_page create did not return tab id",
      transport: result.transport,
      page: result.value,
    };
  }
  const record = recordManagedTab({
    ...args,
    tab_id: tabId,
    workspace_key: args?.workspace_key ?? "js-reverse",
    url,
    title: String(result?.value?.title ?? result?.value?.data?.title ?? ""),
    source: "js-reverse",
    keep: args?.keep === true,
  });
  if (record.tab_id) {
    markSessionSelected(record.tab_id, { make_default: false });
  }
  return {
    ok: true,
    action: "new_page",
    transport: result.transport,
    created: true,
    reused: false,
    owner: "tmwd",
    selected_by: "created_new_tmwd_owned_tab",
    reuse_policy: reusable.policy,
    page: result.value,
    managed_page: managedTabPayload(record),
    unmanaged_tabs_ignored: unmanagedIgnored,
    ...sessionPointers(),
  };
}

async function handleNavigatePage(args) {
  const url = String(args?.url ?? "").trim();
  if (!url) {
    return { ok: false, error: "url is required" };
  }
  const result = await pageEval(args, "location.href = input.url; return { url: location.href, title: document.title };", { url });
  return { ok: true, transport: result.transport, page: result.page, result: result.value };
}

async function handleListScripts(args) {
  const result = await pageEval(args, `
    return Array.from(document.scripts).map((script, index) => ({
      id: script.src ? 'src:' + index : 'inline:' + index,
      index,
      src: script.src || '',
      inline: !script.src,
      length: (script.textContent || '').length,
      preview: (script.textContent || '').slice(0, 240)
    }));
  `);
  return { ok: true, transport: result.transport, page: result.page, scripts: result.value };
}

async function handleGetScriptSource(args) {
  const scriptId = String(args?.script_id ?? "").trim();
  const sourceUrl = String(args?.source_url ?? "").trim();
  const result = await pageEval(args, `
    const scriptId = input.scriptId;
    const sourceUrl = input.sourceUrl;
    const scripts = Array.from(document.scripts);
    let script = null;
    if (sourceUrl) script = scripts.find((item) => item.src === sourceUrl);
    if (!script && scriptId) {
      const index = Number(String(scriptId).split(':').pop());
      if (Number.isFinite(index)) script = scripts[index];
    }
    if (!script) return { ok: false, error: 'script not found' };
    if (!script.src) return { ok: true, id: scriptId, source_url: '', source: script.textContent || '', inline: true };
    try {
      const res = await fetch(script.src, { credentials: 'include', cache: 'force-cache' });
      const text = await res.text();
      return { ok: true, id: scriptId, source_url: script.src, source: text, inline: false, status: res.status };
    } catch (error) {
      return { ok: false, id: scriptId, source_url: script.src, inline: false, error: error.message || String(error) };
    }
  `, { scriptId, sourceUrl });
  return { ok: result.value?.ok !== false, transport: result.transport, page: result.page, ...result.value };
}

async function scriptSources(args, limit = 80) {
  const result = await pageEval(args, `
    const scripts = Array.from(document.scripts).slice(0, input.limit);
    const rows = [];
    for (let index = 0; index < scripts.length; index++) {
      const script = scripts[index];
      if (!script.src) {
        rows.push({ id: 'inline:' + index, source_url: '', inline: true, source: script.textContent || '' });
        continue;
      }
      try {
        const res = await fetch(script.src, { credentials: 'include', cache: 'force-cache' });
        const text = await res.text();
        rows.push({ id: 'src:' + index, source_url: script.src, inline: false, source: text, status: res.status });
      } catch (error) {
        rows.push({ id: 'src:' + index, source_url: script.src, inline: false, source: '', error: error.message || String(error) });
      }
    }
    return rows;
  `, { limit });
  return {
    transport: result.transport,
    page: result.page,
    rows: Array.isArray(result.value) ? result.value : [],
  };
}

async function handleSearchInScripts(args) {
  const keywords = asArray(args?.keywords).length > 0 ? asArray(args.keywords) : COMMON_KEYWORDS;
  const pattern = String(args?.pattern ?? "").trim();
  const regex = pattern ? new RegExp(pattern, "i") : new RegExp(keywords.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
  const sources = await scriptSources(args, Number(args?.script_limit ?? 80));
  const matches = [];
  for (const row of sources.rows) {
    const lines = String(row.source ?? "").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (regex.test(lines[index])) {
        matches.push({
          script_id: row.id,
          source_url: row.source_url,
          line: index + 1,
          text: clip(lines[index].trim(), 500),
        });
        if (matches.length >= Number(args?.max_records ?? 200)) break;
      }
    }
    if (matches.length >= Number(args?.max_records ?? 200)) break;
  }
  return { ok: true, transport: sources.transport, page: sources.page, keywords, pattern, matches };
}

async function handleFindInScript(args) {
  const source = await handleGetScriptSource(args);
  const needle = String(args?.pattern ?? args?.keywords ?? "").trim();
  if (!source.ok || !needle) {
    return { ok: false, error: source.error ?? "pattern is required", source };
  }
  const lines = String(source.source ?? "").split(/\r?\n/);
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].includes(needle)) {
      matches.push({ line: index + 1, text: clip(lines[index].trim(), 500) });
    }
  }
  return { ok: true, script_id: source.id, source_url: source.source_url, matches };
}

async function handleListNetworkRequests(args) {
  const result = await pageEval(args, `
    ${runtimeScript()}
    const perf = performance.getEntriesByType('resource').map((entry, index) => ({
      id: 'perf:' + index,
      source: 'performance',
      name: entry.name,
      initiatorType: entry.initiatorType,
      startTime: Math.round(entry.startTime),
      duration: Math.round(entry.duration),
      transferSize: entry.transferSize || 0
    }));
    const hooks = root.records
      .filter((record) => ['fetch', 'xhr'].includes(record.kind))
      .map((record) => ({ id: record.id, source: 'hook', kind: record.kind, ts: record.ts, url: record.data?.request?.url || record.data?.response?.responseURL || record.url, data: record.data }));
    return { performance: perf, hooks, combined: [...hooks, ...perf] };
  `);
  return { ok: true, transport: result.transport, page: result.page, requests: result.value?.combined ?? [], performance: result.value?.performance ?? [], hooks: result.value?.hooks ?? [] };
}

async function handleGetNetworkRequest(args) {
  const requestId = String(args?.request_id ?? "").trim();
  const listed = await handleListNetworkRequests(args);
  const found = listed.requests.find((item) => item.id === requestId);
  return found ? { ok: true, request: found } : { ok: false, error: `request not found: ${requestId}` };
}

async function handleGetRequestInitiator(args) {
  const request = await handleGetNetworkRequest(args);
  if (!request.ok) return request;
  const stack = request.request?.data?.request?.stack;
  return {
    ok: Boolean(stack),
    request_id: args?.request_id,
    initiator: stack ? { stack } : null,
    note: stack ? "captured by runtime hook" : "performance entries do not include JavaScript initiator stack; inject fetch/xhr hooks before reproducing the request",
  };
}

async function handleWebSockets(args) {
  const result = await pageEval(args, `
    ${runtimeScript()}
    const perf = performance.getEntriesByType('resource').filter((entry) => /websocket/i.test(entry.initiatorType || '')).map((entry, index) => ({ id: 'wsperf:' + index, source: 'performance', name: entry.name }));
    const records = root.records.filter((record) => record.kind === 'websocket');
    return { performance: perf, records };
  `);
  return { ok: true, transport: result.transport, page: result.page, connections: result.value?.performance ?? [], messages: result.value?.records ?? [] };
}

async function handleGetWebSocketMessages(args) {
  const rows = await handleWebSockets(args);
  return { ok: true, messages: rows.messages };
}

async function handleGetDomStructure(args) {
  const result = await pageEval(args, `
    const walk = (node, depth = 0) => {
      if (!node || depth > 4) return null;
      const children = Array.from(node.children || []).slice(0, 12).map((child) => walk(child, depth + 1)).filter(Boolean);
      return {
        tag: node.tagName,
        id: node.id || '',
        className: String(node.className || '').slice(0, 120),
        text: String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
        children
      };
    };
    return { url: location.href, title: document.title, root: walk(document.body || document.documentElement) };
  `);
  return { ok: true, transport: result.transport, page: result.page, dom: result.value };
}

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
    return { ok: true, executed_now: true, evalResult, warning: 'This TMWD-backed server injected the script into the current document. For true document_start preload, reload with an extension-level content script or remote CDP preload path.' };
  `, { code });
  return { ok: true, transport: result.transport, page: result.page, result: result.value };
}

function unsupportedDebugger(tool) {
  return {
    ok: false,
    status: "not_supported",
    tool,
    reason: "This TMWD-backed js-reverse MCP favors non-blocking hooks. Persistent Debugger pause/callframe state needs a dedicated remote CDP debug browser or a future persistent debugger bridge.",
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

async function handleAnalyzeTarget(args) {
  const [scripts, network, dom, search] = await Promise.all([
    handleListScripts(args),
    handleListNetworkRequests(args),
    handleGetDomStructure(args),
    handleSearchInScripts({ ...args, keywords: args?.keywords ?? COMMON_KEYWORDS, max_records: 80 }),
  ]);
  const priorityTargets = network.requests
    .filter((item) => /sign|token|nonce|h5st|x-bogus|msToken|signature/i.test(JSON.stringify(item)))
    .slice(0, 20);
  return {
    ok: true,
    page: dom.page,
    requestFingerprints: {
      requests_count: network.requests.length,
      priority_count: priorityTargets.length,
      priorityTargets,
    },
    scripts: {
      count: Array.isArray(scripts.scripts) ? scripts.scripts.length : 0,
      keyword_matches: search.matches,
    },
    dom: dom.dom,
    signatureChain: search.matches.slice(0, 20),
    actionPlan: [
      "Install fetch/xhr hooks with create_hook + inject_hook.",
      "Reproduce the target action.",
      "Read get_hook_data(view=summary), then raw records with initiator stacks.",
      "Only then export_rebuild_bundle or patch local environment.",
    ],
  };
}

function handleUnderstandCode(args) {
  const code = String(args?.code ?? "");
  return {
    ok: true,
    fingerprint: hashText(code),
    length: code.length,
    functions: Array.from(code.matchAll(/(?:function\s+([\w$]+)|(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?\(?[^=]*=>)/g)).slice(0, 80).map((match) => match[1] || match[2]),
    suspicious_keywords: COMMON_KEYWORDS.filter((keyword) => new RegExp(keyword, "i").test(code)),
    notes: [
      /eval|Function\(/.test(code) ? "dynamic evaluation detected" : null,
      /atob|btoa|TextEncoder|crypto/.test(code) ? "encoding/crypto APIs detected" : null,
    ].filter(Boolean),
  };
}

function handleDeobfuscateCode(args) {
  const code = String(args?.code ?? "");
  const pretty = code
    .replace(/;/g, ";\n")
    .replace(/\{/g, "{\n")
    .replace(/\}/g, "\n}\n")
    .replace(/,(?=[A-Za-z_$])/g, ",\n")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return {
    ok: true,
    warning: "lightweight formatter only; use AST tooling for production deobfuscation",
    source_hash: hashText(code),
    code: pretty,
  };
}

function handleDetectCrypto(args) {
  const code = String(args?.code ?? "");
  const patterns = {
    md5: /md5/i,
    sha: /sha(?:1|256|512)?/i,
    hmac: /hmac/i,
    aes: /\bAES\b|CryptoJS\.AES/i,
    rsa: /\bRSA\b|JSEncrypt/i,
    base64: /atob|btoa|base64/i,
    webcrypto: /crypto\.subtle|SubtleCrypto/i,
    x_bogus: /x-bogus|xbogus/i,
    h5st: /h5st/i,
  };
  return {
    ok: true,
    detected: Object.entries(patterns).filter(([, regex]) => regex.test(code)).map(([name]) => name),
    source_hash: hashText(code),
  };
}

function handleSummarizeCode(args) {
  const code = String(args?.code ?? "");
  return {
    ok: true,
    source_hash: hashText(code),
    lines: code.split(/\r?\n/).length,
    bytes: Buffer.byteLength(code),
    summary: `Code has ${String(code.length)} characters, ${String((code.match(/function|=>/g) || []).length)} function-like constructs, and ${String(COMMON_KEYWORDS.filter((keyword) => new RegExp(keyword, "i").test(code)).length)} reverse-keyword hits.`,
  };
}

function handleRiskPanel(args) {
  const code = String(args?.code ?? JSON.stringify(args?.data ?? {}));
  const hits = handleDetectCrypto({ code }).detected;
  const dynamic = /eval|Function\(|debugger|setInterval|setTimeout/.test(code);
  const score = Math.min(100, hits.length * 12 + (dynamic ? 20 : 0) + (/webdriver|bot|captcha/i.test(code) ? 20 : 0));
  return {
    ok: true,
    score,
    level: score >= 60 ? "high" : score >= 30 ? "medium" : "low",
    signals: { crypto: hits, dynamic_execution: dynamic },
  };
}

function writeJsonFile(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function appendEvidence(args) {
  const taskId = String(args?.task_id ?? "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const channel = String(args?.channel ?? "runtime-evidence").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const payload = {
    id: `evidence_${randomUUID()}`,
    ts: new Date().toISOString(),
    task_id: taskId,
    channel,
    data: args?.data ?? {},
  };
  serverEvidence.push(payload);
  const path = resolve(runtimeRoot, "evidence", taskId, `${channel}-${payload.id}.json`);
  writeJsonFile(path, payload);
  return { payload, path };
}

function handleRecordReverseEvidence(args) {
  const written = appendEvidence(args);
  return { ok: true, evidence_id: written.payload.id, path: written.path, channel: written.payload.channel };
}

function handleExportSessionReport(args) {
  const taskId = String(args?.task_id ?? "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const payload = {
    ok: true,
    task_id: taskId,
    ts: new Date().toISOString(),
    hooks: Array.from(serverHooks.values()),
    evidence: serverEvidence.filter((entry) => entry.task_id === taskId || taskId === "default"),
  };
  const path = resolve(runtimeRoot, "reports", `${taskId}-${Date.now()}.json`);
  writeJsonFile(path, payload);
  return { ...payload, path };
}

function handleExportRebuildBundle(args) {
  const taskId = String(args?.task_id ?? "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const bundleDir = resolve(runtimeRoot, "bundles", `${taskId}-${Date.now()}`, "env");
  mkdirSync(bundleDir, { recursive: true });
  const capture = {
    ts: new Date().toISOString(),
    task_id: taskId,
    evidence: serverEvidence.filter((entry) => entry.task_id === taskId || taskId === "default"),
    input: args?.data ?? {},
  };
  writeJsonFile(resolve(bundleDir, "capture.json"), capture);
  writeFileSync(resolve(bundleDir, "env.js"), "export const browserEnv = {};\n", "utf8");
  writeFileSync(resolve(bundleDir, "polyfills.js"), "globalThis.window ||= globalThis;\nglobalThis.navigator ||= { userAgent: 'tmwd-js-reverse-local' };\n", "utf8");
  writeFileSync(resolve(bundleDir, "entry.js"), "import './polyfills.js';\nimport { browserEnv } from './env.js';\nimport capture from './capture.json' assert { type: 'json' };\nconsole.log(JSON.stringify({ ok: true, browserEnv, captureCount: capture.evidence.length }));\n", "utf8");
  return {
    ok: true,
    bundle_dir: bundleDir,
    files: ["entry.js", "env.js", "polyfills.js", "capture.json"].map((name) => resolve(bundleDir, name)),
  };
}

function handleDiffEnvRequirements(args) {
  const text = JSON.stringify(args?.data ?? args ?? {});
  const candidates = ["window", "document", "navigator", "location", "localStorage", "sessionStorage", "crypto", "TextEncoder", "atob", "btoa", "fetch", "XMLHttpRequest"];
  return {
    ok: true,
    likely_requirements: candidates.filter((name) => new RegExp(name, "i").test(text)),
    recommendation: "Patch the first missing API shown in the local proxy/env log, then rerun. Do not batch-patch multiple environment gaps.",
  };
}

async function handleCollectCode(args) {
  const search = await handleSearchInScripts(args);
  const collection = {
    id: `collection_${randomUUID().slice(0, 8)}`,
    ts: new Date().toISOString(),
    matches: search.matches,
    hash: hashText(JSON.stringify(search.matches)),
  };
  return { ok: true, collection };
}

function handleCollectionDiff(args) {
  const before = args?.before ?? {};
  const after = args?.after ?? {};
  const beforeSet = new Set((before.matches ?? []).map((item) => hashText(JSON.stringify(item))));
  const afterSet = new Set((after.matches ?? []).map((item) => hashText(JSON.stringify(item))));
  return {
    ok: true,
    added: [...afterSet].filter((item) => !beforeSet.has(item)),
    removed: [...beforeSet].filter((item) => !afterSet.has(item)),
  };
}

async function handleInjectStealth(args) {
  const result = await pageEval(args, `
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
    window.chrome ||= { runtime: {} };
    return { ok: true, webdriver: navigator.webdriver === false };
  `);
  return { ok: true, transport: result.transport, page: result.page, result: result.value };
}

async function handleSetUserAgent(args) {
  const userAgent = String(args?.user_agent ?? "").trim();
  if (!userAgent) return { ok: false, error: "user_agent is required" };
  const result = await bridgeCommand(args, {
    cmd: "cdp",
    method: "Network.setUserAgentOverride",
    params: { userAgent },
  });
  return { ok: true, transport: result.transport, page: result.page, result: result.value };
}

async function handleGetStorage(args) {
  const result = await pageEval(args, `
    const dump = (storage) => {
      const out = {};
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        out[key] = storage.getItem(key);
      }
      return out;
    };
    return { url: location.href, cookie: document.cookie, localStorage: dump(localStorage), sessionStorage: dump(sessionStorage) };
  `);
  return { ok: true, transport: result.transport, page: result.page, storage: result.value };
}

async function handleSaveSessionState(args) {
  const state = await handleGetStorage(args);
  const taskId = String(args?.task_id ?? "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const path = resolve(runtimeRoot, "session-state", `${taskId}-${Date.now()}.json`);
  writeJsonFile(path, state.storage);
  return { ok: true, path, state: state.storage };
}

async function handleRestoreSessionState(args) {
  let state = args?.data;
  if (!state && args?.path) {
    state = JSON.parse(readFileSync(String(args.path), "utf8"));
  }
  if (!state || typeof state !== "object") return { ok: false, error: "data or path is required" };
  const result = await pageEval(args, `
    const apply = (storage, values) => {
      for (const [key, value] of Object.entries(values || {})) storage.setItem(key, String(value));
    };
    apply(localStorage, input.state.localStorage);
    apply(sessionStorage, input.state.sessionStorage);
    return { ok: true, localStorage: Object.keys(input.state.localStorage || {}).length, sessionStorage: Object.keys(input.state.sessionStorage || {}).length, cookie_warning: 'HttpOnly cookies cannot be restored from document context.' };
  `, { state });
  return { ok: true, transport: result.transport, page: result.page, result: result.value };
}

async function dispatchToolCall(name, args = {}) {
  if (name === "check_browser_health") return makeResult(await handleCheckBrowserHealth(args));
  if (name === "list_pages") return makeResult(await handleListPages(args));
  if (name === "select_page") return makeResult(await handleSelectPage(args));
  if (name === "new_page") return makeResult(await handleNewPage(args));
  if (name === "navigate_page") return makeResult(await handleNavigatePage(args));
  if (name === "list_scripts") return makeResult(await handleListScripts(args));
  if (name === "get_script_source") return makeResult(await handleGetScriptSource(args));
  if (name === "search_in_scripts") return makeResult(await handleSearchInScripts(args));
  if (name === "find_in_script") return makeResult(await handleFindInScript(args));
  if (name === "list_network_requests") return makeResult(await handleListNetworkRequests(args));
  if (name === "get_network_request") return makeResult(await handleGetNetworkRequest(args));
  if (name === "get_request_initiator") return makeResult(await handleGetRequestInitiator(args));
  if (name === "list_websocket_connections") return makeResult(await handleWebSockets(args));
  if (name === "get_websocket_messages") return makeResult(await handleGetWebSocketMessages(args));
  if (name === "get_dom_structure") return makeResult(await handleGetDomStructure(args));
  if (name === "create_hook") return makeResult(await handleCreateHook(args));
  if (name === "inject_hook") return makeResult(await handleInjectHook(args));
  if (name === "get_hook_data") return makeResult(await handleGetHookData(args));
  if (name === "remove_hook") return makeResult(await handleRemoveHook(args));
  if (name === "list_hooks") return makeResult(handleListHooks(args));
  if (name === "hook_function") return makeResult(await handleHookFunction(args));
  if (name === "unhook_function") return makeResult(await handleUnhookFunction(args));
  if (name === "monitor_events") return makeResult(await handleMonitorEvents(args));
  if (name === "stop_monitor") return makeResult(await handleStopMonitor(args));
  if (name === "trace_function") return makeResult(await handleHookFunction(args));
  if (name === "inject_preload_script") return makeResult(await handleInjectPreloadScript(args));
  if (["set_breakpoint", "set_breakpoint_on_text", "resume", "pause", "step_over", "step_into", "step_out", "evaluate_on_callframe"].includes(name)) return makeResult(unsupportedDebugger(name));
  if (name === "break_on_xhr") return makeResult(await handleBreakOnXhr(args));
  if (name === "analyze_target") return makeResult(await handleAnalyzeTarget(args));
  if (name === "understand_code") return makeResult(handleUnderstandCode(args));
  if (name === "deobfuscate_code") return makeResult(handleDeobfuscateCode(args));
  if (name === "detect_crypto") return makeResult(handleDetectCrypto(args));
  if (name === "summarize_code") return makeResult(handleSummarizeCode(args));
  if (name === "risk_panel") return makeResult(handleRiskPanel(args));
  if (name === "record_reverse_evidence") return makeResult(handleRecordReverseEvidence(args));
  if (name === "export_session_report") return makeResult(handleExportSessionReport(args));
  if (name === "export_rebuild_bundle") return makeResult(handleExportRebuildBundle(args));
  if (name === "diff_env_requirements") return makeResult(handleDiffEnvRequirements(args));
  if (name === "collect_code") return makeResult(await handleCollectCode(args));
  if (name === "collection_diff") return makeResult(handleCollectionDiff(args));
  if (name === "inject_stealth") return makeResult(await handleInjectStealth(args));
  if (name === "set_user_agent") return makeResult(await handleSetUserAgent(args));
  if (name === "save_session_state") return makeResult(await handleSaveSessionState(args));
  if (name === "restore_session_state") return makeResult(await handleRestoreSessionState(args));
  if (name === "get_storage") return makeResult(await handleGetStorage(args));
  return {
    isError: true,
    content: [{ type: "text", text: `unknown tool: ${String(name)}` }],
  };
}

function sendResponse(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function handleRequest(request) {
  const { id, method, params } = request;
  if (!method || typeof method !== "string") {
    sendError(id ?? null, -32600, "invalid request: missing method");
    return;
  }
  if (method === "initialize") {
    sendResponse(id, {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "js-reverse", version: VERSION },
      capabilities: { tools: {} },
    });
    return;
  }
  if (method === "tools/list") {
    const tools = Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
      name,
      description: schema.description,
      inputSchema: schema.inputSchema,
    }));
    sendResponse(id, { tools });
    return;
  }
  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments ?? {};
    if (typeof toolName !== "string") {
      sendError(id ?? null, -32602, "tools/call requires string params.name");
      return;
    }
    dispatchToolCall(toolName, args)
      .then((result) => sendResponse(id, result))
      .catch((error) => {
        sendResponse(id, {
          isError: true,
          content: [
            makeJsonTextContent({
              ok: false,
              tool: toolName,
              error: String(error?.message ?? error),
            }),
          ],
        });
      });
    return;
  }
  if (method === "notifications/initialized") return;
  sendError(id ?? null, -32601, `method not found: ${method}`);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const raw = line.trim();
  if (!raw) return;
  try {
    handleRequest(JSON.parse(raw));
  } catch (error) {
    sendError(null, -32700, `parse error: ${String(error)}`);
  }
});
