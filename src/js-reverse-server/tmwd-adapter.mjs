import {
  executeTmwdJsWithFallback,
  resolvePreferredBrowserContext,
} from "../tmwd-runtime/index.mjs";
import { normalizeTransport } from "./utils.mjs";

function browserArgs(args = {}) {
  return {
    ...args,
    session_id: args.session_id ?? args.page_id,
    tmwd_mode: "tmwd",
    tmwd_transport: args.tmwd_transport ?? "auto",
  };
}

async function resolveTmwd(args = {}) {
  const preferred = await resolvePreferredBrowserContext(browserArgs(args));
  if (preferred.transport !== "tmwd_ws" && preferred.transport !== "tmwd_link") {
    throw new Error(`js-reverse server requires TMWD transport, got ${preferred.transport}`);
  }
  return preferred;
}

async function pageEval(args, body, input = {}, runtimeOptions = {}) {
  const callArgs = browserArgs(args);
  const preferred = runtimeOptions.preferred ?? await resolveTmwd(callArgs);
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

export {
  bridgeCommand,
  browserArgs,
  pageEval,
  resolveTmwd,
};
