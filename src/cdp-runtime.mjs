import { normalizeEndpoint, normalizeTimeoutMs } from "./common.mjs";
import {
  listSessionsSnapshot,
  markSessionSelected,
  selectTargetFromCandidates,
  sessionPointers,
  syncSessionRegistry,
} from "./session-registry.mjs";

async function fetchCdpTargets(endpoint) {
  const response = await fetch(`${endpoint}/json/list`);
  if (!response.ok) {
    throw new Error(`cdp /json/list failed status=${String(response.status)}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("cdp /json/list returned invalid payload");
  }
  return data
    .filter((item) => item?.type === "page" && typeof item?.webSocketDebuggerUrl === "string")
    .map((item) => ({
      id: String(item.id ?? ""),
      title: String(item.title ?? ""),
      url: String(item.url ?? ""),
      webSocketDebuggerUrl: String(item.webSocketDebuggerUrl),
      active: item.active === true,
    }))
    .filter((item) => item.id.length > 0 && item.webSocketDebuggerUrl.length > 0);
}

async function resolveTarget(args) {
  const endpoint = normalizeEndpoint(args?.cdp_endpoint);
  const targets = await fetchCdpTargets(endpoint);
  if (targets.length === 0) {
    throw new Error("no CDP page targets found");
  }
  syncSessionRegistry(targets);
  const picked = selectTargetFromCandidates(targets, args);
  const selected = picked.target;
  markSessionSelected(selected.id, { make_default: false });
  return {
    endpoint,
    targets,
    target: selected,
    selection: picked.selection,
    sessions: listSessionsSnapshot(),
    pointers: sessionPointers(),
  };
}

function waitForWebSocketOpen(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`cdp websocket open timeout after ${String(timeoutMs)}ms`));
    }, timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(new Error(String(event?.message || "websocket error")));
    }, { once: true });
  });
}

function createCdpClient(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 1;

  const rejectAllPending = (error) => {
    for (const [, deferred] of pending) {
      deferred.reject(error);
    }
    pending.clear();
  };

  socket.addEventListener("message", (event) => {
    let payload;
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") {
      return;
    }
    const id = payload.id;
    if (typeof id !== "number") {
      return;
    }
    const deferred = pending.get(id);
    if (!deferred) {
      return;
    }
    pending.delete(id);
    if (payload.error) {
      deferred.reject(new Error(String(payload.error.message ?? "cdp command failed")));
      return;
    }
    deferred.resolve(payload.result ?? {});
  });

  socket.addEventListener("close", () => {
    rejectAllPending(new Error("cdp websocket closed"));
  });

  socket.addEventListener("error", () => {
    rejectAllPending(new Error("cdp websocket error"));
  });

  return {
    async connect(timeoutMs) {
      await waitForWebSocketOpen(socket, timeoutMs);
    },
    send(method, params = {}, timeoutMs = 10_000) {
      const id = seq;
      seq += 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`cdp command timeout method=${method}`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      try {
        socket.close();
      } catch {
        // no-op
      }
    },
  };
}

function buildExecScript(code, errorHandler) {
  return `(async () => {
  function smartProcessResult(result) {
    if (result === null || result === undefined || typeof result !== 'object') return result;
    try { if (result.window === result && result.document) return '[Window: ' + (result.location?.href || 'about:blank') + ']'; } catch(_) {}
    if (result instanceof NodeList || result instanceof HTMLCollection) {
      const elements = [];
      for (let i = 0; i < result.length; i += 1) {
        if (result[i] && result[i].nodeType === 1) elements.push(result[i].outerHTML);
      }
      return elements;
    }
    if (result.nodeType === 1) return result.outerHTML;
    try {
      return JSON.parse(JSON.stringify(result, function(_, value) {
        if (typeof value === 'object' && value !== null) {
          if (value.nodeType === 1) return value.outerHTML;
          if (value === window || value === document) return '[Object]';
          try { if (value.window === value && value.document) return '[Window]'; } catch(_) {}
        }
        return value;
      }));
    } catch (e) {
      return '[无法序列化: ' + e.message + ']';
    }
  }
  try {
    const jsCode = ${JSON.stringify(code)}.trim();
    const lines = jsCode.split(/\\r?\\n/).filter((l) => l.trim());
    const lastLine = lines.length > 0 ? lines[lines.length - 1].trim() : '';
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    let r;
    function _air(c) {
      const ls = c.split(/\\r?\\n/);
      let i = ls.length - 1;
      while (i >= 0 && !ls[i].trim()) i -= 1;
      if (i < 0) return c;
      const t = ls[i].trim();
      if (/^(return |return;|return$|let |const |var |if |if\\(|for |for\\(|while |while\\(|switch|try |throw |class |function |async |import |export |\\/\\/|})/.test(t)) return c;
      ls[i] = ls[i].match(/^(\\s*)/)[1] + 'return ' + t;
      return ls.join('\\n');
    }
    if (lastLine.startsWith('return')) {
      r = await (new AsyncFunction(jsCode))();
    } else {
      try {
        r = eval(jsCode);
        if (r instanceof Promise) r = await r;
      } catch (e) {
        if (e instanceof SyntaxError && (/return/i.test(e.message) || /await/i.test(e.message))) {
          r = await (new AsyncFunction(_air(jsCode)))();
        } else {
          throw e;
        }
      }
    }
    return { ok: true, data: smartProcessResult(r) };
  } catch (e) {
${errorHandler}
  }
})()`;
}

function buildCdpScript(code) {
  return buildExecScript(code, `    return { ok: false, error: { name: e.name || 'Error', message: e.message || String(e), stack: e.stack || '' } };`);
}

async function withTargetClient(args, operation) {
  const timeoutMs = normalizeTimeoutMs(args?.timeout_ms);
  const resolved = await resolveTarget(args);
  const client = createCdpClient(resolved.target.webSocketDebuggerUrl);
  await client.connect(Math.min(timeoutMs, 10_000));
  try {
    const result = await operation(client, resolved.target, resolved.endpoint, timeoutMs, resolved);
    return {
      ...resolved,
      result,
    };
  } finally {
    client.close();
  }
}

async function cdpEvaluateScript(args, script) {
  return withTargetClient(args, async (client, target, endpoint, timeoutMs, resolved) => {
    await client.send("Runtime.enable", {}, Math.min(timeoutMs, 10_000));
    const wrappedCode = buildCdpScript(script);
    const evalResult = await client.send("Runtime.evaluate", {
      expression: wrappedCode,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs);
    if (evalResult?.exceptionDetails) {
      const description = evalResult.exceptionDetails?.exception?.description
        || evalResult.exceptionDetails?.text
        || "CDP Runtime.evaluate failed";
      throw new Error(String(description));
    }
      return {
        target_id: target.id,
        target_url: target.url,
        endpoint,
        value: evalResult?.result?.value,
        type: evalResult?.result?.type ?? typeof evalResult?.result?.value,
        selection: resolved.selection,
        sessions: resolved.sessions,
        ...sessionPointers(),
      };
    });
  }

function buildScanContentExpression(textOnly, mainOnly) {
  if (textOnly && mainOnly) {
    return `(() => {
      const selectors = 'main, article, [role="main"], #main, .main-content, .content, .mdx-content, .markdown-body, .prose, [data-doc-main]';
      const direct = document.querySelector(selectors);
      if (direct) {
        const text = (direct.innerText || '').trim();
        if (text.length >= 200) {
          return text;
        }
      }
      const clone = document.body ? document.body.cloneNode(true) : null;
      if (!clone) {
        return document.documentElement ? (document.documentElement.innerText || '') : '';
      }
      clone.querySelectorAll('nav, header, footer, aside, script, style, noscript, form, [role="navigation"], [data-testid*="nav"], [class*="sidebar"], [class*="toc"], [class*="breadcrumb"]').forEach((node) => node.remove());
      const stripped = (clone.innerText || '').trim();
      if (stripped.length >= 200) {
        return stripped;
      }
      const root = document.body || document.documentElement;
      return root ? (root.innerText || '') : '';
    })()`;
  }
  if (textOnly) {
    return `(() => document.body ? document.body.innerText : document.documentElement.innerText)()`;
  }
  if (mainOnly) {
    return `(() => {
      const selectors = 'main, article, [role="main"], #main, .main-content, .content, .mdx-content, .markdown-body, .prose, [data-doc-main]';
      const direct = document.querySelector(selectors);
      if (direct) {
        return direct.outerHTML || '';
      }
      const clone = document.body ? document.body.cloneNode(true) : null;
      if (!clone) {
        return document.documentElement ? (document.documentElement.outerHTML || '') : '';
      }
      clone.querySelectorAll('nav, header, footer, aside, script, style, noscript, form, [role="navigation"], [data-testid*="nav"], [class*="sidebar"], [class*="toc"], [class*="breadcrumb"]').forEach((node) => node.remove());
      return clone.outerHTML || (document.documentElement ? (document.documentElement.outerHTML || '') : '');
    })()`;
  }
  return `(() => document.documentElement.outerHTML)()`;
}

async function cdpReadPageContent(args, textOnly, mainOnly = false) {
  const expression = buildScanContentExpression(textOnly, mainOnly);
  return withTargetClient(args, async (client, target, endpoint, timeoutMs, resolved) => {
    await client.send("Runtime.enable", {}, Math.min(timeoutMs, 10_000));
    const evalResult = await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs);
    if (evalResult?.exceptionDetails) {
      const description = evalResult.exceptionDetails?.exception?.description
        || evalResult.exceptionDetails?.text
        || "CDP page content evaluate failed";
      throw new Error(String(description));
    }
      return {
        target_id: target.id,
        target_url: target.url,
        endpoint,
        content: String(evalResult?.result?.value ?? ""),
        selection: resolved.selection,
        sessions: resolved.sessions,
        ...sessionPointers(),
      };
    });
  }

async function cdpRunCommand(args, method, params) {
  return withTargetClient(args, async (client, target, endpoint, timeoutMs, resolved) => {
    const response = await client.send(method, params ?? {}, timeoutMs);
      return {
        target_id: target.id,
        target_url: target.url,
        endpoint,
        response,
        selection: resolved.selection,
        sessions: resolved.sessions,
        ...sessionPointers(),
      };
    });
  }

export {
  buildScanContentExpression,
  cdpEvaluateScript,
  cdpReadPageContent,
  cdpRunCommand,
  fetchCdpTargets,
  resolveTarget,
};
