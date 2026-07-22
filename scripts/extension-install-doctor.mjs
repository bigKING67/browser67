#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveBrowser67Home } from "../src/runtime/paths/home.mjs";
import { buildExtension } from "./build-extension.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const defaultSourceDir = path.resolve(repoRoot, "extension");
const homeResolution = resolveBrowser67Home();
const defaultTargetDir = path.resolve(homeResolution.path, "browser/tmwd_cdp_bridge");
const ignoredTargetFiles = new Set(["config.js"]);

function parseArgs(argv) {
  const parsed = {
    sourceDir: defaultSourceDir,
    targetDir: defaultTargetDir,
    json: false,
    check: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--source") {
      parsed.sourceDir = path.resolve(requiredValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--target") {
      parsed.targetDir = path.resolve(requiredValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--check") {
      parsed.check = true;
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

function requiredValue(argv, index, token) {
  const value = String(argv[index + 1] ?? "").trim();
  if (!value || value.startsWith("--")) {
    throw new Error(`missing ${token} value`);
  }
  return value;
}

function usage() {
  return [
    "Usage: node scripts/extension-install-doctor.mjs [--json] [--check]",
    "       node scripts/extension-install-doctor.mjs --source <dir> --target <dir> [--json] [--check]",
    "",
    "Compares repo extension/ with the installed unpacked browser extension.",
    "Default target: <browser67-home>/browser/tmwd_cdp_bridge.",
    "The install-local generated config.js is ignored in the target directory.",
    "--check exits non-zero when installed files drift from repo source.",
  ].join("\n");
}

function dirStatus(dir) {
  if (!existsSync(dir)) return "missing";
  return statSync(dir).isDirectory() ? "directory" : "not_directory";
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function shouldIgnoreFile(relativePath, { target }) {
  if (path.basename(relativePath) === ".DS_Store") return true;
  return target && ignoredTargetFiles.has(relativePath);
}

function listFiles(root, { target = false } = {}) {
  const status = dirStatus(root);
  const files = [];
  const ignored = [];
  if (status !== "directory") return { status, files, ignored };

  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.resolve(current, entry.name);
      const relativePath = path.relative(root, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (shouldIgnoreFile(relativePath, { target })) {
        ignored.push(relativePath);
        continue;
      }
      files.push(relativePath);
    }
  }

  walk(root);
  files.sort();
  ignored.sort();
  return { status, files, ignored };
}

function digestForFiles(root, files) {
  if (dirStatus(root) !== "directory") return null;
  const hash = createHash("sha256");
  for (const file of files) {
    const absolute = path.resolve(root, file);
    hash.update(file);
    hash.update("\0");
    hash.update(existsSync(absolute) ? sha256(absolute) : "missing");
    hash.update("\0");
  }
  return hash.digest("hex");
}

function buildReport(options) {
  const source = listFiles(options.sourceDir);
  if (source.status !== "directory") {
    throw new Error(`missing extension source directory: ${options.sourceDir}`);
  }
  const target = listFiles(options.targetDir, { target: true });
  const sourceSet = new Set(source.files);
  const targetSet = new Set(target.files);
  const missing = source.files.filter((file) => !targetSet.has(file));
  const extra = target.files.filter((file) => !sourceSet.has(file));
  const changed = source.files
    .filter((file) => targetSet.has(file))
    .map((file) => {
      const sourceSha = sha256(path.resolve(options.sourceDir, file));
      const targetSha = sha256(path.resolve(options.targetDir, file));
      return sourceSha === targetSha ? null : {
        file,
        source_sha256: sourceSha,
        target_sha256: targetSha,
      };
    })
    .filter(Boolean);
  const installedCurrent = target.status === "directory"
    && missing.length === 0
    && changed.length === 0
    && extra.length === 0;
  const needsSetup = !installedCurrent;
  const needsCleanSetup = extra.length > 0 || target.status === "not_directory";
  const needsBrowserExtensionReload = needsSetup;
  return {
    ok: installedCurrent,
    check: "extension-install-doctor",
    mode: options.check ? "check" : "doctor",
    source_dir: options.sourceDisplayDir ?? options.sourceDir,
    source_kind: options.sourceKind ?? "raw",
    target_dir: options.targetDir,
    active_home: homeResolution.path,
    active_home_source: homeResolution.source,
    target_status: target.status,
    installed_current: installedCurrent,
    needs_setup: needsSetup,
    needs_clean_setup: needsCleanSetup,
    needs_browser_extension_reload: needsBrowserExtensionReload,
    source_digest: digestForFiles(options.sourceDir, source.files),
    target_digest: digestForFiles(options.targetDir, source.files),
    missing,
    changed,
    extra,
    ignored_target_files: target.ignored,
    summary: {
      source_file_count: source.files.length,
      target_file_count: target.files.length,
      ignored_target_file_count: target.ignored.length,
      missing_count: missing.length,
      changed_count: changed.length,
      extra_count: extra.length,
    },
    next_steps: installedCurrent ? [
      "No installed extension file drift was detected.",
      "If Chrome/Edge still behaves like old bridge code, run npm run extension:reload-live and refresh target tabs.",
    ] : [
      "Run: npm run setup",
      "Run npm run extension:reload-live when the previous browser67 extension is still connected; otherwise reload it from the browser extension page.",
      "Refresh old target tabs so content scripts reinject.",
      needsCleanSetup
        ? "Inspect extra target files; setup copies current files but does not prune unknown files."
        : "Run npm run extension:doctor again after setup and reload.",
    ],
  };
}

function formatText(report) {
  const lines = [
    `extension_install=${report.installed_current ? "current" : "drift"} target=${report.target_dir}`,
    `source=${report.source_dir}`,
    `target_status=${report.target_status} source_files=${report.summary.source_file_count} target_files=${report.summary.target_file_count}`,
    `missing=${report.summary.missing_count} changed=${report.summary.changed_count} extra=${report.summary.extra_count} ignored=${report.summary.ignored_target_file_count}`,
    `needs_setup=${report.needs_setup} needs_clean_setup=${report.needs_clean_setup} needs_browser_extension_reload=${report.needs_browser_extension_reload}`,
  ];
  if (report.missing.length > 0) lines.push(`missing_files=${report.missing.join(", ")}`);
  if (report.changed.length > 0) lines.push(`changed_files=${report.changed.map((item) => item.file).join(", ")}`);
  if (report.extra.length > 0) lines.push(`extra_files=${report.extra.join(", ")}`);
  if (report.ignored_target_files.length > 0) lines.push(`ignored_target_files=${report.ignored_target_files.join(", ")}`);
  lines.push("next_steps:");
  for (const step of report.next_steps) {
    lines.push(`  - ${step}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  let generatedRoot = "";
  try {
    const overlaySource = existsSync(path.resolve(options.sourceDir, "browser67/runtime.js"))
      && existsSync(path.resolve(options.sourceDir, "browser67/managed-content.js"));
    const reportOptions = overlaySource
      ? (() => {
        generatedRoot = mkdtempSync(path.resolve(tmpdir(), "browser67-extension-doctor-"));
        const generatedSourceDir = path.resolve(generatedRoot, "extension");
        buildExtension({ source_dir: options.sourceDir, target_dir: generatedSourceDir });
        return {
          ...options,
          sourceDir: generatedSourceDir,
          sourceDisplayDir: options.sourceDir,
          sourceKind: "generated_overlay",
        };
      })()
      : options;
    const report = buildReport(reportOptions);
    process.stdout.write(options.json ? `${JSON.stringify(report)}\n` : formatText(report));
    return options.check && !report.installed_current ? 1 : 0;
  } finally {
    if (generatedRoot) {
      rmSync(generatedRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
    }
  }
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`extension-install-doctor failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
