#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.resolve(repoRoot, "skills");
const DEFAULT_SKILLS = ["browser67", "tmwd-browser-mcp", "js-reverse"];
const DEFAULT_SHARED_ROOT = "~/.agents/skills";
const DEFAULT_AUDIT_ROOTS = [
  DEFAULT_SHARED_ROOT,
  "~/.codex/skills",
  "~/.pi/agent/skills",
];

function parseArgs(argv) {
  const parsed = {
    roots: [],
    skills: DEFAULT_SKILLS,
    sharedRoot: process.env.BROWSER67_ACTIVE_SKILLS_DIR || DEFAULT_SHARED_ROOT,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--roots") {
      const value = requiredValue(argv, index, token);
      parsed.roots.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (token === "--root") {
      parsed.roots.push(requiredValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--skills") {
      const value = requiredValue(argv, index, token);
      parsed.skills = value.split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (token === "--shared-root") {
      parsed.sharedRoot = requiredValue(argv, index, token);
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
  if (parsed.roots.length === 0) parsed.roots = DEFAULT_AUDIT_ROOTS;
  parsed.roots = unique(parsed.roots);
  if (parsed.skills.length === 0) throw new Error("--skills must include at least one skill id");
  return parsed;
}

function requiredValue(argv, index, token) {
  const value = String(argv[index + 1] ?? "").trim();
  if (!value || value.startsWith("--")) throw new Error(`missing ${token} value`);
  return value;
}

function usage() {
  return [
    "Usage: node scripts/skills-roots-audit.mjs [--json]",
    "       node scripts/skills-roots-audit.mjs --roots <root1,root2> [--shared-root <root>] [--skills <ids>] [--json]",
    "",
    "Read-only audit for browser67-managed skills across active/private skill roots.",
    "Default roots: ~/.agents/skills, ~/.codex/skills, ~/.pi/agent/skills.",
    "Default shared root: ~/.agents/skills or BROWSER67_ACTIVE_SKILLS_DIR.",
  ].join("\n");
}

function unique(values) {
  return [...new Set(values)];
}

function expandHome(input) {
  const value = String(input ?? "");
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function normalizeRoot(input) {
  return path.resolve(expandHome(input));
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  const rows = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      const absolute = path.resolve(current, entry.name);
      const relativePath = path.relative(root, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        rows.push(relativePath);
      }
    }
  }
  walk(root);
  return rows.sort();
}

function pathKind(absolutePath) {
  try {
    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
      const link_target = readlinkSync(absolutePath);
      try {
        const resolved = realpathSync(absolutePath);
        const targetStats = statSync(absolutePath);
        return {
          exists: true,
          kind: targetStats.isDirectory() ? "symlink_directory" : "symlink_other",
          is_symlink: true,
          link_target,
          realpath: resolved,
        };
      } catch {
        return {
          exists: false,
          kind: "broken_symlink",
          is_symlink: true,
          link_target,
          realpath: null,
        };
      }
    }
    if (stats.isDirectory()) return { exists: true, kind: "directory", is_symlink: false, link_target: null, realpath: realpathSync(absolutePath) };
    if (stats.isFile()) return { exists: true, kind: "file", is_symlink: false, link_target: null, realpath: realpathSync(absolutePath) };
    return { exists: true, kind: "other", is_symlink: false, link_target: null, realpath: realpathSync(absolutePath) };
  } catch {
    return { exists: false, kind: "missing", is_symlink: false, link_target: null, realpath: null };
  }
}

function rootRole(rootPath, sharedRootPath) {
  if (rootPath === sharedRootPath) return "shared_active_root";
  if (rootPath === normalizeRoot("~/.codex/skills")) return "codex_private_root";
  if (rootPath === normalizeRoot("~/.pi/agent/skills")) return "pi_private_root";
  return "audit_only_root";
}

function skillStatus({ skill, rootPath }) {
  const sourceDir = path.resolve(sourceRoot, skill);
  const skillDir = path.resolve(rootPath, skill);
  const kind = pathKind(skillDir);
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`missing canonical skill source: ${path.relative(repoRoot, sourceDir)}`);
  }
  if (kind.kind === "missing") {
    return {
      skill,
      status: "missing",
      install_model: "none",
      path: skillDir,
      source_dir: sourceDir,
      missing: listFiles(sourceDir),
      changed: [],
      extra: [],
      warnings: [],
      ...kind,
    };
  }
  if (kind.kind === "broken_symlink") {
    return {
      skill,
      status: "broken_symlink",
      install_model: "broken_symlink",
      path: skillDir,
      source_dir: sourceDir,
      missing: listFiles(sourceDir),
      changed: [],
      extra: [],
      warnings: ["replace_broken_symlink_with_copy"],
      ...kind,
    };
  }
  if (kind.kind !== "directory" && kind.kind !== "symlink_directory") {
    return {
      skill,
      status: "invalid",
      install_model: kind.is_symlink ? "symlink" : kind.kind,
      path: skillDir,
      source_dir: sourceDir,
      missing: listFiles(sourceDir),
      changed: [],
      extra: [],
      warnings: ["skill_path_is_not_a_directory"],
      ...kind,
    };
  }
  const sourceFiles = listFiles(sourceDir);
  const targetFiles = listFiles(skillDir);
  const sourceSet = new Set(sourceFiles);
  const targetSet = new Set(targetFiles);
  const missing = sourceFiles.filter((file) => !targetSet.has(file));
  const extra = targetFiles.filter((file) => !sourceSet.has(file));
  const changed = sourceFiles.filter((file) => (
    targetSet.has(file) && sha256(path.resolve(sourceDir, file)) !== sha256(path.resolve(skillDir, file))
  ));
  const current = missing.length === 0 && changed.length === 0 && extra.length === 0;
  const warnings = [];
  if (kind.is_symlink) warnings.push("symlink_install_model_not_default");
  return {
    skill,
    status: current ? "current" : "drift",
    install_model: kind.is_symlink ? "symlink" : "copy",
    path: skillDir,
    source_dir: sourceDir,
    source_file_count: sourceFiles.length,
    target_file_count: targetFiles.length,
    missing,
    changed,
    extra,
    warnings,
    ...kind,
  };
}

function countSkillDirectories(rootPath) {
  const root = pathKind(rootPath);
  if (root.kind !== "directory" && root.kind !== "symlink_directory") return 0;
  return readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) return false;
      return existsSync(path.resolve(rootPath, entry.name, "SKILL.md"));
    })
    .length;
}

function auditRoot({ rootInput, sharedRootPath, skills }) {
  const rootPath = normalizeRoot(rootInput);
  const kind = pathKind(rootPath);
  const role = rootRole(rootPath, sharedRootPath);
  const managed = skills.map((skill) => skillStatus({ skill, rootPath }));
  const statusCounts = managed.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, {});
  const driftCount = managed.filter((row) => row.status !== "current").length;
  const brokenSymlinkCount = managed.filter((row) => row.status === "broken_symlink").length;
  return {
    input: rootInput,
    path: rootPath,
    role,
    browser67_managed_default_target: role === "shared_active_root",
    sync_policy: role === "shared_active_root" ? "sync_allowed_when_intentional" : "audit_only_do_not_blind_sync",
    root_status: kind.kind,
    exists: kind.exists,
    is_symlink: kind.is_symlink,
    link_target: kind.link_target,
    realpath: kind.realpath,
    skill_count: countSkillDirectories(rootPath),
    managed_skills: managed,
    summary: {
      managed_skill_count: managed.length,
      current_count: statusCounts.current ?? 0,
      drift_count: driftCount,
      missing_count: statusCounts.missing ?? 0,
      broken_symlink_count: brokenSymlinkCount,
      invalid_count: statusCounts.invalid ?? 0,
      symlink_count: managed.filter((row) => row.install_model === "symlink").length,
    },
  };
}

function buildRecommendations({ roots, sharedRootPath }) {
  const recommendations = [
    `Use ${sharedRootPath} as the shared active browser67 skill root unless a caller explicitly selects another target.`,
    "Use npm run skills:active:sync -- --target <root> only for the selected active root.",
    "Do not blindly sync browser67 skills into audit-only roots; first prove that an agent loader actually reads that root.",
  ];
  const broken = roots.flatMap((root) => root.managed_skills
    .filter((skill) => skill.status === "broken_symlink")
    .map((skill) => `${root.path}/${skill.skill}`));
  if (broken.length > 0) {
    recommendations.push(`Replace broken symlinks with copy installs via skills:active:sync: ${broken.join(", ")}`);
  }
  const shared = roots.find((root) => root.path === sharedRootPath);
  if (shared && shared.summary.drift_count > 0) {
    recommendations.push(`Shared active root has drift; run npm run skills:active:diff and then npm run skills:active:sync -- --target ${sharedRootPath} if the update is intentional.`);
  }
  const auditDrift = roots.filter((root) => root.path !== sharedRootPath && root.summary.drift_count > 0);
  if (auditDrift.length > 0) {
    recommendations.push("Audit-only roots contain missing or stale browser67-managed skills; leave them unchanged unless that agent root is confirmed active.");
  }
  return recommendations;
}

function buildReport(options) {
  const sharedRootPath = normalizeRoot(options.sharedRoot);
  const roots = options.roots.map((rootInput) => auditRoot({
    rootInput,
    sharedRootPath,
    skills: options.skills,
  }));
  const duplicateManagedSkills = options.skills.map((skill) => {
    const locations = roots
      .map((root) => ({
        root: root.path,
        role: root.role,
        status: root.managed_skills.find((row) => row.skill === skill)?.status ?? "unknown",
        install_model: root.managed_skills.find((row) => row.skill === skill)?.install_model ?? "unknown",
      }))
      .filter((row) => row.status !== "missing");
    return { skill, locations, location_count: locations.length };
  });
  return {
    ok: true,
    check: "skills-roots-audit",
    mode: "audit",
    canonical_source_root: sourceRoot,
    shared_root: sharedRootPath,
    managed_skills: options.skills,
    roots,
    duplicate_managed_skills: duplicateManagedSkills,
    summary: {
      root_count: roots.length,
      existing_root_count: roots.filter((root) => root.exists).length,
      managed_skill_location_count: duplicateManagedSkills.reduce((total, row) => total + row.location_count, 0),
      drift_root_count: roots.filter((root) => root.summary.drift_count > 0).length,
      broken_symlink_count: roots.reduce((total, root) => total + root.summary.broken_symlink_count, 0),
    },
    recommendations: buildRecommendations({ roots, sharedRootPath }),
  };
}

function formatText(report) {
  const lines = [
    `skills_roots_audit=ok roots=${report.summary.root_count} existing=${report.summary.existing_root_count} shared=${report.shared_root}`,
  ];
  for (const root of report.roots) {
    lines.push(`  - ${root.role} path=${root.path} status=${root.root_status} policy=${root.sync_policy} current=${root.summary.current_count} drift=${root.summary.drift_count} missing=${root.summary.missing_count} broken_symlinks=${root.summary.broken_symlink_count}`);
    for (const skill of root.managed_skills) {
      lines.push(`      ${skill.skill}: ${skill.status} install_model=${skill.install_model} changed=${skill.changed.length} extra=${skill.extra.length}`);
    }
  }
  lines.push("recommendations:");
  for (const recommendation of report.recommendations) {
    lines.push(`  - ${recommendation}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const report = buildReport(options);
  process.stdout.write(options.json ? `${JSON.stringify(report)}\n` : formatText(report));
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`skills-roots-audit failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
