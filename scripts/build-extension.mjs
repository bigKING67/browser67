#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extensionBatchReferenceSource } from "../src/browser/execution/batch-references.mjs";
import { extensionPageExecutionSource } from "../src/browser/execution/page-script.mjs";
import {
  createExtensionBuildIdentity,
  extensionBuildIdentityJavaScript,
  extensionBuildIdentityJson,
  listExtensionSourceFiles,
  normalizeManifestVersion,
} from "../src/extension/build-identity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const defaultSourceDir = resolve(repoRoot, "extension");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function patchWsNewTabMonitoring(source) {
  const listenerAnchor = [
    "  const newTabIds = new Set();",
    "  const onCreated = (tab) => { newTabIds.add(tab.id); };",
    "  chrome.tabs.onCreated.addListener(onCreated);",
  ].join("\n");
  const listenerReplacement = [
    "  const monitorNewTabs = data.monitorNewTabs !== false;",
    "  const newTabIds = new Set();",
    "  const onCreated = (tab) => { newTabIds.add(tab.id); };",
    "  if (monitorNewTabs) chrome.tabs.onCreated.addListener(onCreated);",
  ].join("\n");
  const graceAnchor = "    if (newTabIds.size === 0) await new Promise(r => setTimeout(r, 200));";
  const graceReplacement = "    if (monitorNewTabs && newTabIds.size === 0) await new Promise(r => setTimeout(r, 200));";
  if (!source.includes(listenerAnchor) || !source.includes(graceAnchor)) {
    throw new Error("upstream WS execution monitoring anchors changed; review the browser67 overlay transform");
  }
  return source
    .replace(listenerAnchor, listenerReplacement)
    .replace(graceAnchor, graceReplacement)
    .replaceAll(
      "chrome.tabs.onCreated.removeListener(onCreated);",
      "if (monitorNewTabs) chrome.tabs.onCreated.removeListener(onCreated);",
    );
}

function patchExtensionIdentityHandshake(source) {
  const readyAnchor = [
    "      type: 'ext_ready',",
    "      tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title }))",
  ].join("\n");
  const readyReplacement = [
    "      type: 'ext_ready',",
    "      extension_identity: globalThis.__browser67BuildIdentity ?? null,",
    "      tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title }))",
  ].join("\n");
  const updateAnchor = [
    "    type: 'tabs_update',",
    "    tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title }))",
  ].join("\n");
  const updateReplacement = [
    "    type: 'tabs_update',",
    "    extension_identity: globalThis.__browser67BuildIdentity ?? null,",
    "    tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title }))",
  ].join("\n");
  if (!source.includes(readyAnchor) || !source.includes(updateAnchor)) {
    throw new Error("upstream extension handshake anchors changed; review the browser67 overlay transform");
  }
  return source
    .replace(readyAnchor, readyReplacement)
    .replace(updateAnchor, updateReplacement);
}

function patchSharedExecutionRuntime(source) {
  const pageStart = source.indexOf("// --- Shared page/CDP script builder core ---");
  const pageEnd = source.indexOf("// --- WebSocket Client for TMWebDriver ---");
  if (pageStart < 0 || pageEnd < 0 || pageEnd <= pageStart) {
    throw new Error("upstream page execution anchors changed; review the browser67 overlay transform");
  }
  let next = [
    source.slice(0, pageStart),
    `${extensionPageExecutionSource()}\n\n`,
    source.slice(pageEnd),
  ].join("");

  const handleBatchAnchor = "async function handleBatch(msg, sender) {";
  const batchStart = next.indexOf(handleBatchAnchor);
  if (batchStart < 0) {
    throw new Error("upstream batch handler anchor changed; review the browser67 overlay transform");
  }
  next = [
    next.slice(0, batchStart),
    `${extensionBatchReferenceSource()}\n\n`,
    next.slice(batchStart),
  ].join("");
  const resolverStart = next.indexOf("  const resolve$N =", next.indexOf(handleBatchAnchor));
  const resolverEnd = next.indexOf("  try {", resolverStart);
  if (resolverStart < 0 || resolverEnd < 0) {
    throw new Error("upstream batch resolver anchors changed; review the browser67 overlay transform");
  }
  next = `${next.slice(0, resolverStart)}${next.slice(resolverEnd)}`;
  const loopAnchor = "    for (const c of msg.commands) {";
  const loopReplacement = [
    "    for (const rawCommand of msg.commands) {",
    "      const c = globalThis.browser67ResolveBatchReferences(rawCommand, R, { command_index: R.length });",
  ].join("\n");
  const commandAnchor = "chrome.debugger.sendCommand({ tabId }, c.method, resolve$N(c.params))";
  const errorAnchor = "return { ok: false, error: e.message, results: R };";
  if (!next.includes(loopAnchor) || !next.includes(commandAnchor) || !next.includes(errorAnchor)) {
    throw new Error("upstream batch execution anchors changed; review the browser67 overlay transform");
  }
  return next
    .replace(loopAnchor, loopReplacement)
    .replace(commandAnchor, "chrome.debugger.sendCommand({ tabId }, c.method, c.params || {})")
    .replace(errorAnchor, "return { ok: false, error: e.message, errorCode: e.code, errorDetails: e.details, results: R };");
}

function buildBackground(source) {
  const installStart = source.indexOf("chrome.runtime.onInstalled.addListener(() => {");
  const handlerStart = source.indexOf("async function handleExtMessage(msg, sender) {");
  if (installStart < 0 || handlerStart < 0 || handlerStart <= installStart) {
    throw new Error("upstream background anchors changed; review the browser67 overlay transform");
  }
  const withoutGlobalCsp = [
    source.slice(0, installStart),
    "importScripts('browser67/build-identity.js', 'browser67/runtime.js');\n\n",
    source.slice(handlerStart),
  ].join("");
  const handlerAnchor = "async function handleExtMessage(msg, sender) {\n";
  const handlerReplacement = [
    handlerAnchor,
    "  const browser67Response = await globalThis.browser67HandleCommand?.(msg, sender);\n",
    "  if (browser67Response !== undefined) return browser67Response;\n",
  ].join("");
  const routed = withoutGlobalCsp.replace(handlerAnchor, handlerReplacement);
  if (routed === withoutGlobalCsp) {
    throw new Error("failed to inject browser67 command routing into background.js");
  }
  return patchExtensionIdentityHandshake(
    patchWsNewTabMonitoring(patchSharedExecutionRuntime(routed)),
  );
}

function buildManifest(source, version) {
  const manifest = JSON.parse(source);
  const permissions = new Set(Array.isArray(manifest.permissions) ? manifest.permissions : []);
  permissions.add("storage");
  permissions.add("webRequest");
  manifest.name = "browser67 TMWD Bridge";
  manifest.version = normalizeManifestVersion(version);
  manifest.description = "browser67 managed-tab bridge with scoped page policies";
  manifest.permissions = [...permissions].sort();
  manifest.content_scripts = [];
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function buildExtension(options = {}) {
  const sourceDir = resolve(options.source_dir ?? defaultSourceDir);
  const targetDir = resolve(options.target_dir ?? "");
  if (!targetDir) throw new Error("target_dir is required");
  for (const required of [
    "background.js",
    "manifest.json",
    "browser67/runtime.js",
    "browser67/managed-content.js",
  ]) {
    if (!existsSync(resolve(sourceDir, required))) {
      throw new Error(`missing extension source file: ${required}`);
    }
  }
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true, force: true, errorOnExist: false });
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const bundleFiles = listExtensionSourceFiles(sourceDir);
  const upstreamBackground = readFileSync(resolve(sourceDir, "background.js"), "utf8");
  const upstreamManifest = readFileSync(resolve(sourceDir, "manifest.json"), "utf8");
  const background = buildBackground(upstreamBackground);
  const manifest = buildManifest(upstreamManifest, packageJson.version);
  writeFileSync(resolve(targetDir, "background.js"), background, "utf8");
  writeFileSync(resolve(targetDir, "manifest.json"), manifest, "utf8");
  const manifestVersion = JSON.parse(manifest).version;
  const extensionIdentity = createExtensionBuildIdentity({
    repoRoot,
    targetDir,
    bundleFiles,
    manifestVersion,
  });
  writeFileSync(
    resolve(targetDir, "browser67/build-identity.js"),
    extensionBuildIdentityJavaScript(extensionIdentity),
    "utf8",
  );
  writeFileSync(
    resolve(targetDir, "browser67/build-identity.json"),
    extensionBuildIdentityJson(extensionIdentity),
    "utf8",
  );
  return {
    ok: true,
    schema: "browser67.extension-build.v1",
    source_dir: sourceDir,
    target_dir: targetDir,
    upstream_background_sha256: sha256(upstreamBackground),
    generated_background_sha256: sha256(background),
    upstream_manifest_sha256: sha256(upstreamManifest),
    generated_manifest_sha256: sha256(manifest),
    extension_identity: extensionIdentity,
    build_identity_js: "browser67/build-identity.js",
    build_identity_json: "browser67/build-identity.json",
    ordinary_tab_policy: {
      csp_override: false,
      dialog_override: false,
      badge: false,
      marker: false,
    },
  };
}

function parseArgs(argv) {
  const parsed = { source_dir: defaultSourceDir, target_dir: "", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--source") {
      parsed.source_dir = resolve(String(argv[index + 1] ?? ""));
      index += 1;
      continue;
    }
    if (token === "--target") {
      parsed.target_dir = resolve(String(argv[index + 1] ?? ""));
      index += 1;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function runCli() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("Usage: node scripts/build-extension.mjs --target <dir> [--source <dir>] [--json]\n");
    return 0;
  }
  if (!args.target_dir) throw new Error("--target is required");
  const result = buildExtension(args);
  process.stdout.write(args.json
    ? `${JSON.stringify(result)}\n`
    : `browser67 extension built: ${result.target_dir}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(`build-extension failed: ${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  }
}

export {
  buildBackground,
  buildExtension,
  buildManifest,
  patchExtensionIdentityHandshake,
  patchSharedExecutionRuntime,
  patchWsNewTabMonitoring,
};
