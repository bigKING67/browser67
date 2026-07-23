import { normalizeTimeoutMs } from "../runtime/config/limits.mjs";
import { buildCdpScript } from "../browser/execution/page-script.mjs";
import { createCdpClient } from "./client.mjs";
import { resolveTarget } from "./target.mjs";

async function withTargetClient(args, operation, options = {}) {
  const timeoutMs = normalizeTimeoutMs(args?.timeout_ms);
  const resolved = await resolveTarget(args, options);
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

async function cdpEvaluateScript(args, script, options = {}) {
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
      ...resolved.pointers,
    };
  }, options);
}

async function cdpRunCommand(args, method, params, options = {}) {
  return withTargetClient(args, async (client, target, endpoint, timeoutMs, resolved) => {
    const response = await client.send(method, params ?? {}, timeoutMs);
    return {
      target_id: target.id,
      target_url: target.url,
      endpoint,
      response,
      selection: resolved.selection,
      sessions: resolved.sessions,
      ...resolved.pointers,
    };
  }, options);
}

export { cdpEvaluateScript, cdpRunCommand, withTargetClient };
