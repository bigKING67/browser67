import assert from "node:assert/strict";

import {
  assertTextJsonContent,
  firstJsonContent,
} from "../browser-structured-mcp-contract/rpc-content.mjs";

async function runToolCases(rpc, cli) {
  const understandCall = await rpc.call(
    "tools/call",
    {
      name: "understand_code",
      arguments: {
        code: "function sign(input){ return crypto.subtle.digest('SHA-256', input); }",
      },
    },
    cli.timeout_ms,
  );
  assert.equal(understandCall?.result?.isError, undefined);
  assertTextJsonContent(understandCall.result, "js-reverse understand_code result");
  const understandPayload = firstJsonContent(understandCall.result);
  assert.equal(understandPayload?.ok, true);
  assert.equal(understandPayload?.suspicious_keywords?.includes("sign"), true);

  const cryptoCall = await rpc.call(
    "tools/call",
    {
      name: "detect_crypto",
      arguments: {
        code: "CryptoJS.MD5(payload); crypto.subtle.digest('SHA-256', bytes);",
      },
    },
    cli.timeout_ms,
  );
  const cryptoPayload = firstJsonContent(cryptoCall.result);
  assert.equal(cryptoPayload?.ok, true);
  assert.equal(cryptoPayload?.detected?.includes("md5"), true);
  assert.equal(cryptoPayload?.detected?.includes("sha"), true);

  const hookCall = await rpc.call(
    "tools/call",
    {
      name: "create_hook",
      arguments: {
        hook_id: "contract_fetch_hook",
        type: "fetch",
        pattern: "/api/",
      },
    },
    cli.timeout_ms,
  );
  const hookPayload = firstJsonContent(hookCall.result);
  assert.equal(hookPayload?.ok, true);
  assert.equal(hookPayload?.hook?.id, "contract_fetch_hook");

  const unsupportedCall = await rpc.call(
    "tools/call",
    {
      name: "set_breakpoint",
      arguments: {},
    },
    cli.timeout_ms,
  );
  const unsupportedPayload = firstJsonContent(unsupportedCall.result);
  assertTextJsonContent(unsupportedCall.result, "js-reverse unsupported debugger result");
  assert.equal(unsupportedPayload?.status, "not_supported");
  assert.equal(typeof unsupportedPayload?.fallback, "string");
}

export {
  runToolCases,
};
