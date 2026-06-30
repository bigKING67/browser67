import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  assertTextJsonContent,
  firstJsonContent,
} from "./rpc-content.mjs";

function screenshotPayload({ digest, title = "Evidence fixture", width = 1440, height = 900 } = {}) {
  return {
    ok: true,
    status: "success",
    tool: "browser_screenshot_ops",
    target: "viewport",
    tab_id: "101",
    session_id: "101",
    page: {
      url: "http://127.0.0.1:4173/example?token=redacted#section",
      title,
      viewport: {
        inner_width: width,
        inner_height: height,
        device_pixel_ratio: 1,
      },
    },
    layout_metrics: {
      horizontal_overflow: false,
      selectors: {
        main: {
          found: true,
          selector: "main",
        },
      },
    },
    capture: {
      method: "Page.captureScreenshot",
      format: "png",
      returns_base64: false,
    },
    artifact: {
      path: `/tmp/${title.toLowerCase().replace(/\s+/g, "-")}.png`,
      sha256: digest,
      mime_type: "image/png",
      bytes: 1234,
      width,
      height,
      fullscreen: false,
    },
    run: {
      run_id: "evidence-fixture-run",
      group: "evidence-fixture",
    },
  };
}

async function assertEvidenceBundleOpsContract({ rpc, timeoutMs }) {
  const beforeDigest = "a".repeat(64);
  const afterDigest = "b".repeat(64);
  const buildCall = await rpc.call(
    "tools/call",
    {
      name: "browser_evidence_bundle_ops",
      arguments: {
        action: "build_design_craft_l4_manifest",
        case_id: "generic-evidence-fixture",
        entries: [
          {
            phase: "before",
            key: "desktop",
            screenshot: screenshotPayload({ digest: beforeDigest, title: "Before fixture" }),
          },
          {
            phase: "after",
            key: "desktop",
            screenshot: screenshotPayload({ digest: afterDigest, title: "After fixture" }),
          },
        ],
        transport_health: {
          status: "healthy",
          preferred_transport: "ws",
        },
        finalize_summary: {
          status: "success",
          unmanaged_tabs_ignored: true,
        },
      },
    },
    timeoutMs,
  );
  assert.equal(buildCall?.result?.isError, undefined);
  assertTextJsonContent(buildCall.result, "browser_evidence_bundle_ops build result");
  const buildPayload = firstJsonContent(buildCall.result);
  assert.equal(buildPayload?.ok, true);
  assert.equal(buildPayload?.schema, "design-craft.l4-screenshots.v1");
  assert.equal(buildPayload?.manifest?.artifacts?.before?.desktop?.artifact_sha256, beforeDigest);
  assert.equal(buildPayload?.manifest?.artifacts?.after?.desktop?.artifact_sha256, afterDigest);
  assert.deepEqual(buildPayload?.validation?.shared_artifact_keys, ["desktop"]);
  assert.equal(buildPayload?.manifest?.artifacts?.before?.desktop?.dimensions?.[0], 1440);
  assert.equal(buildPayload?.manifest?.artifacts?.before?.desktop?.viewport?.width, 1440);
  assert.equal(buildPayload?.manifest?.artifacts?.before?.desktop?.url, "http://127.0.0.1:4173/example");
  assert.equal(buildPayload?.manifest?.artifacts?.before?.desktop?.layout_metrics?.horizontal_overflow, false);
  assert.equal(buildPayload?.manifest?.evidence_bundle?.transport_health?.status, "healthy");

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-design-craft-manifest-"));
  try {
    const outputPath = path.join(tmpDir, "screenshots.json");
    const writeCall = await rpc.call(
      "tools/call",
      {
        name: "browser_evidence_bundle_ops",
        arguments: {
          action: "build_design_craft_l4_manifest",
          case_id: "generic-evidence-fixture",
          entries: [
            {
              phase: "before",
              key: "desktop",
              screenshot: screenshotPayload({ digest: beforeDigest, title: "Before fixture" }),
            },
            {
              phase: "after",
              key: "desktop",
              screenshot: screenshotPayload({ digest: afterDigest, title: "After fixture" }),
            },
          ],
          write: true,
          confirm_write: true,
          output_path: outputPath,
        },
      },
      timeoutMs,
    );
    assert.equal(writeCall?.result?.isError, undefined);
    const writePayload = firstJsonContent(writeCall.result);
    assert.equal(writePayload?.written, true);
    assert.equal(writePayload?.output_path, outputPath);
    const written = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(written.schema, "design-craft.l4-screenshots.v1");
    assert.equal(written.case_id, "generic-evidence-fixture");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  const unsafeWriteCall = await rpc.call(
    "tools/call",
    {
      name: "browser_evidence_bundle_ops",
      arguments: {
        action: "build_design_craft_l4_manifest",
        case_id: "generic-evidence-fixture",
        entries: [
          {
            phase: "before",
            key: "desktop",
            screenshot: screenshotPayload({ digest: beforeDigest, title: "Before fixture" }),
          },
          {
            phase: "after",
            key: "desktop",
            screenshot: screenshotPayload({ digest: afterDigest, title: "After fixture" }),
          },
        ],
        write: true,
        output_path: "/tmp/screenshots.json",
      },
    },
    timeoutMs,
  );
  assert.equal(unsafeWriteCall?.result?.isError, true);
  const unsafePayload = firstJsonContent(unsafeWriteCall.result);
  assert.equal(unsafePayload?.error_code, "INVALID_ARGUMENT");

  const missingSharedKeyCall = await rpc.call(
    "tools/call",
    {
      name: "browser_evidence_bundle_ops",
      arguments: {
        action: "build_design_craft_l4_manifest",
        case_id: "generic-evidence-fixture",
        entries: [
          {
            phase: "before",
            key: "desktop",
            screenshot: screenshotPayload({ digest: beforeDigest, title: "Before fixture" }),
          },
          {
            phase: "after",
            key: "mobile",
            screenshot: screenshotPayload({ digest: afterDigest, title: "After fixture", width: 390, height: 844 }),
          },
        ],
      },
    },
    timeoutMs,
  );
  assert.equal(missingSharedKeyCall?.result?.isError, true);
  const missingSharedKeyPayload = firstJsonContent(missingSharedKeyCall.result);
  assert.equal(missingSharedKeyPayload?.error_code, "INVALID_ARGUMENT");

  return {
    schema: buildPayload.schema,
    shared_artifact_keys: buildPayload.validation.shared_artifact_keys,
    written_contract_ok: true,
  };
}

export {
  assertEvidenceBundleOpsContract,
};
