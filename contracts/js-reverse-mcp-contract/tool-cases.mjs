import assert from "node:assert/strict";

import {
  assertTextJsonContent,
  firstJsonContent,
} from "../browser67-browser-mcp-contract/rpc-content.mjs";

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

  const evidenceCall = await rpc.call(
    "tools/call",
    {
      name: "record_reverse_evidence",
      arguments: {
        task_id: "contract",
        channel: "evidence-schema",
        evidence: {
          source: "hook",
          confidence: "exact",
          title: "contract hook evidence",
          data: { sample: true },
        },
      },
    },
    cli.timeout_ms,
  );
  const evidencePayload = firstJsonContent(evidenceCall.result);
  assert.equal(evidencePayload?.ok, true);
  assert.equal(typeof evidencePayload?.evidence_id, "string");

  const reportCall = await rpc.call(
    "tools/call",
    {
      name: "export_session_report",
      arguments: {
        task_id: "contract",
      },
    },
    cli.timeout_ms,
  );
  const reportPayload = firstJsonContent(reportCall.result);
  assert.equal(reportPayload?.ok, true);
  const foundEvidence = reportPayload?.evidence?.find((entry) => entry.channel === "evidence-schema");
  assert.equal(foundEvidence?.schema_version, "evidence.v1");
  assert.equal(foundEvidence?.source, "hook");
  assert.equal(foundEvidence?.confidence, "exact");

  const bundleCall = await rpc.call(
    "tools/call",
    {
      name: "export_evidence_bundle",
      arguments: {
        task_id: "contract",
        url: "https://example.invalid/contract",
        frame_path: "top",
        script_hashes: ["sha256:contract"],
        storage_keys: ["redacted-key"],
      },
    },
    cli.timeout_ms,
  );
  const bundlePayload = firstJsonContent(bundleCall.result);
  assert.equal(bundlePayload?.ok, true);
  assert.equal(bundlePayload?.summary?.schema_version, "js-reverse-evidence-bundle.v1");
  assert.equal(bundlePayload?.summary?.selected_frame, "top");
  assert.equal(Array.isArray(bundlePayload?.files), true);
}

export {
  runToolCases,
};
