#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveTier } from "./verification/manifest.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

const REQUIRED_DIRECTORIES = [
  "agents",
  "bin",
  "contracts",
  "docs",
  "extension",
  "scripts",
  "skills",
  "src",
  "templates",
];

const REQUIRED_FILES = [
  "AGENTS.md",
  "README.md",
  "docs/project-structure.md",
  "docs/maintenance-quality-model.md",
  "package.json",
  "scripts/project-structure-audit.mjs",
  "src/mcp/browser/server.mjs",
  "src/mcp/js-reverse/server.mjs",
  "src/runtime/paths/home.mjs",
];

const FORBIDDEN_TOP_LEVEL_DIRECTORIES = [
  "experimental",
  "helpers",
  "misc",
  "new",
  "temp",
  "tmp",
  "utils",
];

const FORBIDDEN_TRACKED_PREFIXES = [
  ".tmwd-browser-mcp/",
  "runtime/",
  "temp/",
  "tmp/",
];

const ALLOWED_SRC_ROOT_MODULES = new Set([
  "src/bridge-commands.mjs",
  "src/browser-auth.mjs",
  "src/browser-wrappers.mjs",
  "src/capabilities.mjs",
  "src/cdp-runtime.mjs",
  "src/codex-host-finalizer.mjs",
  "src/common.mjs",
  "src/content-extraction.mjs",
  "src/errors.mjs",
  "src/evidence-schema.mjs",
  "src/js-reverse-server.mjs",
  "src/mcp-result.mjs",
  "src/native-capabilities.mjs",
  "src/native-core.mjs",
  "src/native-deps-setup.mjs",
  "src/native-fallback.mjs",
  "src/native-input.mjs",
  "src/native-linux.mjs",
  "src/native-macos.mjs",
  "src/native-windows.mjs",
  "src/run-lifecycle.mjs",
  "src/server.mjs",
  "src/session-registry.mjs",
  "src/tab-workspace.mjs",
  "src/tmwd-hub-control.mjs",
  "src/tmwd-hub.mjs",
  "src/tmwd-runtime.mjs",
  "src/tool-schemas.mjs",
]);
const SRC_ROOT_MODULE_BUDGET = 28;

function runGit(gitArgs) {
  const result = spawnSync("git", gitArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${gitArgs.join(" ")} failed: ${String(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  return result.stdout;
}

function trackedPaths() {
  return runGit(["ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .sort();
}

function readText(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function pathExists(relativePath) {
  return existsSync(resolve(repoRoot, relativePath));
}

function textIncludesAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function isForbiddenLocalArtifact(path) {
  return (
    /(^|\/)\.DS_Store$/.test(path)
    || /^\.env(?:\.|$)/.test(path)
    || /^extension\/config\.js$/.test(path)
    || /^npm-debug\.log/.test(path)
    || /\.(?:har|pcap|pcapng)$/i.test(path)
  );
}

function createCheck(id, ok, detail, next = null) {
  return {
    id,
    ok: Boolean(ok),
    detail,
    next,
  };
}

function buildAudit() {
  const tracked = trackedPaths();
  const packageJson = readJson("package.json");
  const checkEntryIds = new Set(resolveTier("check").map((entry) => entry.id));
  const verifyEntryIds = new Set(resolveTier("verify").map((entry) => entry.id));
  const structureDoc = readText("docs/project-structure.md");
  const gitignore = readText(".gitignore");
  const legacyBrowserServer = readText("src/server.mjs");
  const legacyJsReverseServer = readText("src/js-reverse-server.mjs");

  const missingDirectories = REQUIRED_DIRECTORIES.filter((dir) => !pathExists(dir));
  const missingFiles = REQUIRED_FILES.filter((file) => !pathExists(file));
  const forbiddenTopLevelTracked = tracked.filter((path) => (
    FORBIDDEN_TOP_LEVEL_DIRECTORIES.some((dir) => path === dir || path.startsWith(`${dir}/`))
  ));
  const forbiddenRuntimeTracked = tracked.filter((path) => (
    FORBIDDEN_TRACKED_PREFIXES.some((prefix) => path.startsWith(prefix))
  ));
  const forbiddenLocalTracked = tracked.filter(isForbiddenLocalArtifact);
  const unexpectedSrcRootModules = tracked.filter((path) => (
    /^src\/[^/]+\.mjs$/.test(path) && !ALLOWED_SRC_ROOT_MODULES.has(path)
  ));

  const checks = [
    createCheck(
      "required_directories_exist",
      missingDirectories.length === 0,
      `missing=${missingDirectories.length ? missingDirectories.join(",") : "none"}`,
      "Restore the canonical top-level project directories before adding new surfaces.",
    ),
    createCheck(
      "required_files_exist",
      missingFiles.length === 0,
      `missing=${missingFiles.length ? missingFiles.join(",") : "none"}`,
      "Restore project-structure docs, MCP entrypoints, runtime-home resolver, and this audit script.",
    ),
    createCheck(
      "no_forbidden_top_level_directories",
      forbiddenTopLevelTracked.length === 0,
      `tracked=${forbiddenTopLevelTracked.length ? forbiddenTopLevelTracked.join(",") : "none"}`,
      "Move generic helper/temp/experimental content into a domain-owned directory or repo-external temp storage.",
    ),
    createCheck(
      "no_tracked_runtime_artifacts",
      forbiddenRuntimeTracked.length === 0,
      `tracked=${forbiddenRuntimeTracked.length ? forbiddenRuntimeTracked.join(",") : "none"}`,
      "Runtime state belongs under the active browser67 home, not in the repository.",
    ),
    createCheck(
      "no_tracked_local_or_secret_artifacts",
      forbiddenLocalTracked.length === 0,
      `tracked=${forbiddenLocalTracked.length ? forbiddenLocalTracked.join(",") : "none"}`,
      "Keep OS metadata, env files, extension install config, and network captures out of tracked source.",
    ),
    createCheck(
      "src_root_module_allowlist",
      unexpectedSrcRootModules.length === 0,
      `unexpected=${unexpectedSrcRootModules.length ? unexpectedSrcRootModules.join(",") : "none"} allowed=${ALLOWED_SRC_ROOT_MODULES.size}`,
      "Place new source modules under a domain directory or intentionally update docs and this allowlist with a migration rationale.",
    ),
    createCheck(
      "src_root_module_budget_non_increasing",
      ALLOWED_SRC_ROOT_MODULES.size <= SRC_ROOT_MODULE_BUDGET,
      `allowed=${ALLOWED_SRC_ROOT_MODULES.size} budget=${SRC_ROOT_MODULE_BUDGET}`,
      "Do not increase the root module budget; move implementation under capability directories and reduce the budget as shims migrate.",
    ),
    createCheck(
      "legacy_entrypoints_are_canonical_shims",
      legacyBrowserServer.includes('import "./mcp/browser/server.mjs";')
        && legacyJsReverseServer.includes('import "./mcp/js-reverse/server.mjs";'),
      "src/server.mjs and src/js-reverse-server.mjs import the canonical MCP entrypoints",
      "Keep legacy entrypoints as thin shims until downstream MCP configs have migrated.",
    ),
    createCheck(
      "project_structure_doc_contract",
      textIncludesAll(structureDoc, [
        "Target structure direction",
        "Directory rules",
        "Do not add new top-level generic directories",
        "Runtime artifacts must live outside the repository",
      ]),
      "docs/project-structure.md preserves target direction and directory rules",
      "Update docs/project-structure.md when changing structure policy.",
    ),
    createCheck(
      "gitignore_preserves_runtime_boundaries",
      textIncludesAll(gitignore, [
        ".DS_Store",
        "/runtime/",
        "extension/config.js",
        "*.har",
        "*.pcap",
      ]),
      ".gitignore excludes OS metadata, runtime state, install config, and capture artifacts",
      "Keep repo-external runtime and evidence boundaries in .gitignore.",
    ),
    createCheck(
      "package_scripts_include_structure_gate",
      packageJson.scripts?.["check:project-structure"] === "node scripts/project-structure-audit.mjs"
        && checkEntryIds.has("project-structure"),
      "package.json registers check:project-structure and the verification manifest check tier includes it",
      "Register this audit in package scripts and the aggregate check gate.",
    ),
    createCheck(
      "verify_includes_structure_gate",
      verifyEntryIds.has("project-structure"),
      "verification manifest verify tier includes check:project-structure",
      "Keep structure governance in the broad verification path.",
    ),
  ];

  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? "ok" : "failed",
    check: "browser67-project-structure",
    repo_root: repoRoot,
    summary: {
      tracked_paths: tracked.length,
      check_count: checks.length,
      failed_count: failed.length,
    },
    checks,
  };
}

function printHuman(report) {
  process.stdout.write(
    `project_structure_audit=${report.status} checks=${report.summary.check_count} failed=${report.summary.failed_count} tracked=${report.summary.tracked_paths}\n`,
  );
  for (const check of report.checks) {
    process.stdout.write(`  - ${check.id}: ${check.ok ? "ok" : "fail"} (${check.detail})\n`);
    if (!check.ok && check.next) {
      process.stdout.write(`    next=${check.next}\n`);
    }
  }
}

try {
  const report = buildAudit();
  if (args.has("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHuman(report);
  }
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  process.stderr.write(`project-structure-audit failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
