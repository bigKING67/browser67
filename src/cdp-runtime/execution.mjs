import { buildCdpScript } from "../browser/execution/page-script.mjs";
import { createOperationDeadline } from "../runtime/operation-deadline.mjs";
import { createCdpClient } from "./client.mjs";
import { resolveTarget } from "./target.mjs";

async function withTargetClient(args, operation, options = {}) {
  const deadline = createOperationDeadline(args?.timeout_ms);
  let phase = "resolve_target";
  let resolved;
  try {
    resolved = await resolveTarget(deadline.argsFor(args, phase), options);
  } catch (error) {
    throw deadline.annotate(error, phase);
  }
  const client = createCdpClient(resolved.target.webSocketDebuggerUrl);
  phase = "connect_cdp";
  try {
    await client.connect(Math.min(deadline.remaining(phase), 10_000));
  } catch (error) {
    throw deadline.annotate(error, phase);
  }
  try {
    phase = "cdp_operation";
    const result = await operation(
      client,
      resolved.target,
      resolved.endpoint,
      deadline.remaining(phase),
      resolved,
      deadline,
    );
    return {
      ...resolved,
      result,
    };
  } catch (error) {
    throw deadline.annotate(error, error?.details?.failed_phase ?? phase);
  } finally {
    client.close();
  }
}

async function cdpEvaluateScript(args, script, options = {}) {
  return withTargetClient(args, async (client, target, endpoint, _timeoutMs, resolved, deadline) => {
    await client.send("Runtime.enable", {}, Math.min(deadline.remaining("runtime_enable"), 10_000));
    const wrappedCode = buildCdpScript(script);
    const evalResult = await client.send("Runtime.evaluate", {
      expression: wrappedCode,
      awaitPromise: true,
      returnByValue: true,
    }, deadline.remaining("runtime_evaluate"));
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
  return withTargetClient(args, async (client, target, endpoint, _timeoutMs, resolved, deadline) => {
    const response = await client.send(method, params ?? {}, deadline.remaining("cdp_command"));
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
