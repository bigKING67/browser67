import { normalizeTimeoutMs } from "../common.mjs";
import { sessionPointers } from "../session-registry.mjs";
import { createCdpClient } from "./client.mjs";
import { resolveTarget } from "./target.mjs";

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

export { cdpEvaluateScript, cdpRunCommand, withTargetClient };
