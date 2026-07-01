function runtimeScript() {
  return `
    const root = window.__TMWD_JS_REVERSE__ ||= {
      hooks: {},
      records: [],
      monitors: {},
      originals: {},
      preloadScripts: [],
      storageWatchers: {},
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

export { runtimeScript };
