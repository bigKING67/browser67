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
    "       node scripts/active-skill-sync.mjs --write [--target ~/.agents/skills] [--json]",
    "",
    "Compares browser67 canonical skills/ with an active skill install directory.",
    "Default target: ~/.agents/skills or BROWSER67_ACTIVE_SKILLS_DIR.",
    "--write copies canonical files into the target after creating a backup.",
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

function buildReport(options) {
  const targetRoot = path.resolve(expandHome(options.target));
  const before = options.skills.map((skill) => skillStatus({ skill, targetRoot }));
  const writes = [];
  let backupRoot = null;
  if (options.write) {
    backupRoot = path.resolve(expandHome(options.backupDir || path.join(targetRoot, ".browser67-backups", timestamp())));
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
  const report = buildReport(options);
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
