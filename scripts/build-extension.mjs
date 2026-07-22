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

function buildBackground(source) {
  const installStart = source.indexOf("chrome.runtime.onInstalled.addListener(() => {");
  const handlerStart = source.indexOf("async function handleExtMessage(msg, sender) {");
  if (installStart < 0 || handlerStart < 0 || handlerStart <= installStart) {
    throw new Error("upstream background anchors changed; review the browser67 overlay transform");
  }
  const withoutGlobalCsp = [
    source.slice(0, installStart),
    "importScripts('browser67/runtime.js');\n\n",
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
  return patchWsNewTabMonitoring(routed);
}

function buildManifest(source) {
  const manifest = JSON.parse(source);
  const permissions = new Set(Array.isArray(manifest.permissions) ? manifest.permissions : []);
  permissions.add("storage");
  permissions.add("webRequest");
  manifest.name = "browser67 TMWD Bridge";
  manifest.version = "3.0.0";
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
  const upstreamBackground = readFileSync(resolve(sourceDir, "background.js"), "utf8");
  const upstreamManifest = readFileSync(resolve(sourceDir, "manifest.json"), "utf8");
  const background = buildBackground(upstreamBackground);
  const manifest = buildManifest(upstreamManifest);
  writeFileSync(resolve(targetDir, "background.js"), background, "utf8");
  writeFileSync(resolve(targetDir, "manifest.json"), manifest, "utf8");
  return {
    ok: true,
    schema: "browser67.extension-build.v1",
    source_dir: sourceDir,
    target_dir: targetDir,
    upstream_background_sha256: sha256(upstreamBackground),
    generated_background_sha256: sha256(background),
    upstream_manifest_sha256: sha256(upstreamManifest),
    generated_manifest_sha256: sha256(manifest),
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
  patchWsNewTabMonitoring,
};
