#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { buildExtension } from "../scripts/build-extension.mjs";
import {
  extensionBatchReferenceSource,
  resolveBatchReferences,
} from "../src/browser/execution/batch-references.mjs";
import {
  buildCdpScript,
  extensionPageExecutionSource,
} from "../src/browser/execution/page-script.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(repoRoot, "extension");
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function run() {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "browser67-extension-build-"));
  const targetDir = resolve(tempRoot, "extension");
  const sourceBackgroundPath = resolve(sourceDir, "background.js");
  const sourceManifestPath = resolve(sourceDir, "manifest.json");
  const before = {
    background: hashFile(sourceBackgroundPath),
    manifest: hashFile(sourceManifestPath),
  };
  try {
    const result = buildExtension({ source_dir: sourceDir, target_dir: targetDir });
    const manifest = JSON.parse(readFileSync(resolve(targetDir, "manifest.json"), "utf8"));
    const background = readFileSync(resolve(targetDir, "background.js"), "utf8");
    const runtime = readFileSync(resolve(targetDir, "browser67/runtime.js"), "utf8");
    const buildIdentity = JSON.parse(readFileSync(resolve(targetDir, "browser67/build-identity.json"), "utf8"));
    const buildIdentityJavaScript = readFileSync(resolve(targetDir, "browser67/build-identity.js"), "utf8");
    assert.equal(result.schema, "browser67.extension-build.v1");
    assert.equal(manifest.name, "browser67 TMWD Bridge");
    assert.equal(manifest.version, packageJson.version);
    assert.deepEqual(manifest.content_scripts, []);
    assert.equal(manifest.permissions.includes("webRequest"), true);
    assert.equal(manifest.permissions.includes("storage"), true);
    assert.match(background, /importScripts\('browser67\/build-identity\.js', 'browser67\/runtime\.js'\)/);
    assert.match(background, /browser67HandleCommand/);
    assert.match(background, /extension_identity: globalThis\.__browser67BuildIdentity \?\? null/);
    assert.match(background, /const monitorNewTabs = data\.monitorNewTabs !== false/);
    assert.match(background, /monitorNewTabs && newTabIds\.size === 0/);
    assert.match(background, /if \(monitorNewTabs\) chrome\.tabs\.onCreated\.addListener/);
    assert.equal(background.includes(extensionPageExecutionSource()), true);
    assert.equal(background.includes(extensionBatchReferenceSource()), true);
    assert.match(background, /browser67ResolveBatchReferences\(rawCommand, R/);
    assert.doesNotMatch(background, /JSON\.parse\(JSON\.stringify\(params/);
    assert.doesNotMatch(background, /const resolve\$N/);
    assert.doesNotMatch(background, /id: 9999, priority: 1/);
    assert.match(runtime, /condition:\s*\{[\s\S]*tabIds:\s*\[tabId\]/);
    assert.match(runtime, /message\?\.cmd === "network"/);
    assert.match(runtime, /message\?\.cmd !== "policy"/);
    assert.match(runtime, /authorize_navigation/);
    assert.match(runtime, /last_navigation_actor/);
    assert.match(runtime, /data-browser67-node-id/);
    assert.equal(buildIdentity.schema, "browser67.extension-identity.v1");
    assert.equal(buildIdentity.product, "browser67");
    assert.equal(buildIdentity.extension_version, packageJson.version);
    assert.equal(buildIdentity.manifest_version, manifest.version);
    assert.equal(typeof buildIdentity.build_revision, "string");
    assert.equal(typeof buildIdentity.build_inputs_dirty, "boolean");
    assert.match(buildIdentity.source_digest, /^[a-f0-9]{64}$/);
    assert.equal(buildIdentity.protocol_revision, 1);
    assert.deepEqual(result.extension_identity, buildIdentity);
    assert.match(buildIdentityJavaScript, /globalThis\.__browser67BuildIdentity = Object\.freeze/);
    const batchContext = vm.createContext({});
    vm.runInContext(extensionBatchReferenceSource(), batchContext);
    const batchResults = [{ data: { nodes: [{ id: "node-1" }] } }];
    const batchCommand = {
      params: {
        nodeId: "$0.data.nodes.0.id",
        literal: "prefix-$0.data.nodes.0.id",
      },
    };
    batchContext.commandJson = JSON.stringify(batchCommand);
    batchContext.resultsJson = JSON.stringify(batchResults);
    vm.runInContext("globalThis.batchCommand = JSON.parse(commandJson); globalThis.batchResults = JSON.parse(resultsJson);", batchContext);
    const extensionResolved = vm.runInContext(
      "browser67ResolveBatchReferences(batchCommand, batchResults, { command_index: 1 })",
      batchContext,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(extensionResolved)), {
      params: { nodeId: "node-1", literal: "prefix-$0.data.nodes.0.id" },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(batchContext.batchCommand)), {
      params: { nodeId: "$0.data.nodes.0.id", literal: "prefix-$0.data.nodes.0.id" },
    });
    assert.deepEqual(
      JSON.parse(JSON.stringify(resolveBatchReferences(batchCommand, batchResults, { command_index: 1 }))),
      JSON.parse(JSON.stringify(extensionResolved)),
    );
    assert.throws(
      () => vm.runInContext(
        "browser67ResolveBatchReferences({ value: '$1.data' }, batchResults, { command_index: 1 })",
        batchContext,
      ),
      (error) => error?.code === "BATCH_REFERENCE_INDEX_UNAVAILABLE",
    );

    const pageContext = vm.createContext({
      console,
      document: {},
      HTMLCollection: class HTMLCollection {},
      NodeList: class NodeList {},
      Promise,
      window: null,
    });
    pageContext.window = pageContext;
    vm.runInContext(extensionPageExecutionSource(), pageContext);
    const generatedScript = pageContext.buildCdpScript("({0:{nodeType:1,outerHTML:'<button>A</button>'},length:1})");
    assert.equal(generatedScript, buildCdpScript("({0:{nodeType:1,outerHTML:'<button>A</button>'},length:1})"));
    const serialized = await vm.runInContext(generatedScript, pageContext);
    assert.deepEqual(JSON.parse(JSON.stringify(serialized)), {
      ok: true,
      data: ["<button>A</button>"],
    });
    assert.equal(hashFile(sourceBackgroundPath), before.background);
    assert.equal(hashFile(sourceManifestPath), before.manifest);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "extension-build-contract",
      ordinary_tab_policy: result.ordinary_tab_policy,
      generated_background_changed: result.generated_background_sha256 !== result.upstream_background_sha256,
      generated_manifest_changed: result.generated_manifest_sha256 !== result.upstream_manifest_sha256,
      tab_scoped_csp: true,
      managed_dialog_badge_marker: true,
      managed_network_observer: true,
      managed_navigation_observer: true,
      batch_reference_runtime_parity: true,
      page_execution_runtime_parity: true,
      extension_identity_generated: true,
      extension_identity_handshake_injected: true,
    })}\n`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
  }
}

run().catch((error) => {
  process.stderr.write(`extension-build-contract failed: ${error?.stack || String(error)}\n`);
  process.exitCode = 1;
});
