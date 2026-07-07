#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.resolve(repoRoot, "skills");
const DEFAULT_SKILLS = ["browser67", "tmwd-browser-mcp", "js-reverse"];
const DEFAULT_TARGET = "~/.agents/skills";

function parseArgs(argv) {
  const parsed = {
    target: process.env.BROWSER67_ACTIVE_SKILLS_DIR || DEFAULT_TARGET,
    backupDir: null,
    skills: DEFAULT_SKILLS,
    json: false,
    write: false,
    check: false,
    listBackups: false,
    restore: false,
    backupRef: null,
    confirmRestore: false,
    prune: false,
    confirmPrune: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--target") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) throw new Error("missing --target value");
      parsed.target = value;
      index += 1;
      continue;
    }
    if (token === "--backup-dir") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) throw new Error("missing --backup-dir value");
      parsed.backupDir = value;
      index += 1;
      continue;
    }
    if (token === "--skills") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) throw new Error("missing --skills value");
      parsed.skills = value.split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--write") {
      parsed.write = true;
      continue;
    }
    if (token === "--list-backups" || token === "--backups") {
      parsed.listBackups = true;
      continue;
    }
    if (token === "--restore") {
      parsed.restore = true;
      const value = String(argv[index + 1] ?? "").trim();
      if (value && !value.startsWith("--")) {
        parsed.backupRef = value;
        index += 1;
      }
      continue;
    }
    if (token === "--backup") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) throw new Error("missing --backup value");
      parsed.backupRef = value;
      parsed.restore = true;
      index += 1;
      continue;
    }
    if (token === "--confirm-restore") {
      parsed.confirmRestore = true;
      continue;
    }
    if (token === "--check") {
      parsed.check = true;
      continue;
    }
    if (token === "--prune") {
      parsed.prune = true;
      continue;
    }
    if (token === "--confirm-prune") {
      parsed.confirmPrune = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  const modeCount = [parsed.write, parsed.listBackups, parsed.restore].filter(Boolean).length;
  if (modeCount > 1) {
    throw new Error("--write, --list-backups, and --restore are mutually exclusive");
  }
  if (parsed.restore && !parsed.backupRef) {
    throw new Error("--restore requires a backup id or path");
  }
  if (parsed.restore && !parsed.confirmRestore) {
    throw new Error("--restore requires --confirm-restore");
  }
  if (parsed.skills.length === 0) {
    throw new Error("--skills must include at least one skill id");
  }
  if (parsed.prune && !parsed.confirmPrune) {
    throw new Error("--prune requires --confirm-prune");
  }
  return parsed;
}

function usage() {
  return [
    "Usage: node scripts/active-skill-sync.mjs [--json] [--check]",
    "       node scripts/active-skill-sync.mjs --write [--target ~/.agents/skills] [--backup-dir <backup-root>] [--json]",
    "       node scripts/active-skill-sync.mjs --list-backups [--target ~/.agents/skills] [--backup-dir <backup-root>] [--json]",
    "       node scripts/active-skill-sync.mjs --restore <backup-id-or-path> --confirm-restore [--backup-dir <backup-root>] [--json]",
    "",
    "Compares browser67 canonical skills/ with an active skill install directory.",
    "Default target: ~/.agents/skills or BROWSER67_ACTIVE_SKILLS_DIR.",
    "--backup-dir selects the backup root; timestamped backup entries are created under it.",
    "--check exits non-zero when the active copy drifts from canonical source.",
    "--write copies canonical files into the target after creating a backup.",
    "--list-backups lists timestamped backups under the target backup root.",
    "--restore copies a prior backup into the active target after backing up current files.",
    "--prune --confirm-prune removes target files that are not present in canonical source.",
  ].join("\n");
}

function expandHome(input) {
  const value = String(input ?? "");
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
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

function skillStatus({ skill, targetRoot }) {
  const sourceDir = path.resolve(sourceRoot, skill);
  const targetDir = path.resolve(targetRoot, skill);
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`missing canonical skill source: ${path.relative(repoRoot, sourceDir)}`);
  }
  const sourceFiles = listFiles(sourceDir);
  const targetFiles = listFiles(targetDir);
  const sourceSet = new Set(sourceFiles);
  const targetSet = new Set(targetFiles);
  const missing = sourceFiles.filter((file) => !targetSet.has(file));
  const extra = targetFiles.filter((file) => !sourceSet.has(file));
  const changed = sourceFiles.filter((file) => {
    if (!targetSet.has(file)) return false;
    return sha256(path.resolve(sourceDir, file)) !== sha256(path.resolve(targetDir, file));
  });
  const current = missing.length === 0 && changed.length === 0 && extra.length === 0;
  return {
    skill,
    source_dir: sourceDir,
    target_dir: targetDir,
    source_file_count: sourceFiles.length,
    target_file_count: targetFiles.length,
    status: current ? "current" : "drift",
    missing,
    changed,
    extra,
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function defaultBackupBase(targetRoot) {
  return path.resolve(targetRoot, ".browser67-backups");
}

function backupBase(options, targetRoot) {
  return path.resolve(expandHome(options.backupDir || defaultBackupBase(targetRoot)));
}

function newBackupRoot(options, targetRoot, prefix = "") {
  return path.resolve(backupBase(options, targetRoot), `${prefix}${timestamp()}`);
}

function backupSkill({ skill, targetRoot, backupRoot }) {
  const targetDir = path.resolve(targetRoot, skill);
  if (!existsSync(targetDir)) return null;
  mkdirSync(backupRoot, { recursive: true });
  const backupDir = path.resolve(backupRoot, skill);
  cpSync(targetDir, backupDir, { recursive: true, force: true });
  return backupDir;
}

function writeSkill({ skill, targetRoot, backupRoot, prune }) {
  const sourceDir = path.resolve(sourceRoot, skill);
  const targetDir = path.resolve(targetRoot, skill);
  const backupDir = backupSkill({ skill, targetRoot, backupRoot });
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true, force: true });
  const afterCopy = skillStatus({ skill, targetRoot });
  const pruned = [];
  if (prune) {
    for (const file of afterCopy.extra) {
      const absolute = path.resolve(targetDir, file);
      rmSync(absolute, { force: true });
      pruned.push(file);
    }
  }
  return {
    skill,
    backup_dir: backupDir,
    pruned,
  };
}

function backupEntry({ backupDir, skills }) {
  const id = path.basename(backupDir);
  const presentSkills = skills.filter((skill) => {
    const skillDir = path.resolve(backupDir, skill);
    return existsSync(skillDir) && statSync(skillDir).isDirectory();
  });
  const fileCount = presentSkills.reduce((total, skill) => total + listFiles(path.resolve(backupDir, skill)).length, 0);
  const stat = statSync(backupDir);
  return {
    id,
    path: backupDir,
    mtime: stat.mtime.toISOString(),
    skills: presentSkills,
    skill_count: presentSkills.length,
    file_count: fileCount,
  };
}

function buildBackupsReport(options) {
  const targetRoot = path.resolve(expandHome(options.target));
  const backupRoot = backupBase(options, targetRoot);
  const backups = existsSync(backupRoot)
    ? readdirSync(backupRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => backupEntry({ backupDir: path.resolve(backupRoot, entry.name), skills: options.skills }))
      .filter((entry) => entry.skill_count > 0)
      .sort((left, right) => right.id.localeCompare(left.id))
    : [];
  return {
    ok: true,
    check: "active-skill-backups",
    mode: "backups",
    target_root: targetRoot,
    backup_root: backupRoot,
    skills: options.skills,
    backups,
    summary: {
      backup_count: backups.length,
    },
  };
}

function resolveBackupRef({ options, targetRoot }) {
  const ref = String(options.backupRef ?? "").trim();
  if (!ref) throw new Error("--restore requires a backup id or path");
  const expanded = expandHome(ref);
  if (path.isAbsolute(expanded) || expanded.includes("/") || expanded.includes("\\")) {
    return path.resolve(expanded);
  }
  return path.resolve(backupBase(options, targetRoot), ref);
}

function restoreSkill({ skill, targetRoot, restoreSourceRoot, currentBackupRoot }) {
  const sourceDir = path.resolve(restoreSourceRoot, skill);
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`backup does not contain requested skill: ${skill}`);
  }
  const targetDir = path.resolve(targetRoot, skill);
  const currentBackupDir = backupSkill({ skill, targetRoot, backupRoot: currentBackupRoot });
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true, force: true });
  return {
    skill,
    source_backup_dir: sourceDir,
    current_backup_dir: currentBackupDir,
  };
}

function buildRestoreReport(options) {
  const targetRoot = path.resolve(expandHome(options.target));
  const restoreSourceRoot = resolveBackupRef({ options, targetRoot });
  if (!existsSync(restoreSourceRoot) || !statSync(restoreSourceRoot).isDirectory()) {
    throw new Error(`backup not found: ${restoreSourceRoot}`);
  }
  const before = options.skills.map((skill) => skillStatus({ skill, targetRoot }));
  const currentBackupRoot = newBackupRoot(options, targetRoot, "pre-restore-");
  const restores = options.skills.map((skill) => restoreSkill({
    skill,
    targetRoot,
    restoreSourceRoot,
    currentBackupRoot,
  }));
  const after = options.skills.map((skill) => skillStatus({ skill, targetRoot }));
  const driftCount = after.filter((row) => row.status !== "current").length;
  return {
    ok: true,
    check: "active-skill-restore",
    mode: "restore",
    target_root: targetRoot,
    source_root: sourceRoot,
    skills: options.skills,
    restore_source_root: restoreSourceRoot,
    current_backup_root: currentBackupRoot,
    before,
    restores,
    after,
    summary: {
      skill_count: options.skills.length,
      restored_count: restores.length,
      drift_count: driftCount,
    },
  };
}

function buildReport(options) {
  const targetRoot = path.resolve(expandHome(options.target));
  const before = options.skills.map((skill) => skillStatus({ skill, targetRoot }));
  const writes = [];
  let backupRoot = null;
  if (options.write) {
    backupRoot = newBackupRoot(options, targetRoot);
    mkdirSync(targetRoot, { recursive: true });
    for (const skill of options.skills) {
      writes.push(writeSkill({
        skill,
        targetRoot,
        backupRoot,
        prune: options.prune,
      }));
    }
  }
  const after = options.skills.map((skill) => skillStatus({ skill, targetRoot }));
  const driftCount = after.filter((row) => row.status !== "current").length;
  return {
    ok: driftCount === 0,
    check: "active-skill-sync",
    mode: options.write ? "write" : "diff",
    target_root: targetRoot,
    source_root: sourceRoot,
    skills: options.skills,
    prune: options.prune,
    backup_root: backupRoot,
    before,
    writes,
    after,
    summary: {
      skill_count: options.skills.length,
      drift_count: driftCount,
    },
  };
}

function buildModeReport(options) {
  if (options.listBackups) return buildBackupsReport(options);
  if (options.restore) return buildRestoreReport(options);
  return buildReport(options);
}

function formatStatusRows(rows) {
  const lines = [];
  for (const row of rows) {
    lines.push(`  - ${row.skill}: ${row.status} files=${row.source_file_count} missing=${row.missing.length} changed=${row.changed.length} extra=${row.extra.length}`);
    if (row.changed.length > 0) lines.push(`    changed=${row.changed.join(", ")}`);
    if (row.missing.length > 0) lines.push(`    missing=${row.missing.join(", ")}`);
    if (row.extra.length > 0) lines.push(`    extra=${row.extra.join(", ")}`);
  }
  return lines;
}

function formatText(report) {
  if (report.mode === "backups") {
    const lines = [
      `active_skill_backups=count=${report.summary.backup_count} target=${report.target_root} backup_root=${report.backup_root}`,
    ];
    for (const backup of report.backups) {
      lines.push(`  - ${backup.id} skills=${backup.skills.join(",")} files=${backup.file_count} path=${backup.path}`);
    }
    return `${lines.join("\n")}\n`;
  }
  if (report.mode === "restore") {
    const lines = [
      `active_skill_restore=ok target=${report.target_root} backup=${report.restore_source_root} restored=${report.summary.restored_count} active_drift=${report.summary.drift_count}`,
      `current_backup_root=${report.current_backup_root}`,
    ];
    for (const restore of report.restores) {
      lines.push(`  - restored ${restore.skill} from=${restore.source_backup_dir} current_backup=${restore.current_backup_dir ?? "none"}`);
    }
    return `${lines.join("\n")}\n`;
  }
  const lines = [
    `active_skill_sync=${report.ok ? "current" : "drift"} mode=${report.mode} target=${report.target_root} drift=${report.summary.drift_count}`,
  ];
  lines.push("after:");
  lines.push(...formatStatusRows(report.after));
  if (report.writes.length > 0) {
    lines.push(`backup_root=${report.backup_root}`);
    for (const write of report.writes) {
      lines.push(`  - wrote ${write.skill} backup=${write.backup_dir ?? "none"} pruned=${write.pruned.length}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = buildModeReport(options);
  process.stdout.write(options.json ? `${JSON.stringify(report)}\n` : formatText(report));
  if (options.check && !report.ok) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`active-skill-sync failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
