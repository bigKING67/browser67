#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const docsRoot = resolve(repoRoot, "docs/js-reverse");
const skillsRoot = resolve(repoRoot, "skills/js-reverse");

function listFiles(rootDir) {
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
    throw new Error(`missing directory: ${rootDir}`);
  }
  const rows = [];
  function walk(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const absolute = resolve(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (entry.isFile()) {
        rows.push(relative(rootDir, absolute).replaceAll("\\", "/"));
      }
    }
  }
  walk(rootDir);
  return rows.sort();
}

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function run() {
  const docsFiles = listFiles(docsRoot);
  const skillsFiles = listFiles(skillsRoot);
  const docsSet = new Set(docsFiles);
  const skillsSet = new Set(skillsFiles);
  const missingInSkills = docsFiles.filter((file) => !skillsSet.has(file));
  const missingInDocs = skillsFiles.filter((file) => !docsSet.has(file));
  const changed = docsFiles.filter((file) => (
    skillsSet.has(file)
    && hash(resolve(docsRoot, file)) !== hash(resolve(skillsRoot, file))
  ));
  const payload = {
    ok: missingInSkills.length === 0 && missingInDocs.length === 0 && changed.length === 0,
    docs_root: docsRoot,
    skills_root: skillsRoot,
    file_count: docsFiles.length,
    missing_in_skills: missingInSkills,
    missing_in_docs: missingInDocs,
    changed,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return payload.ok ? 0 : 1;
}

try {
  process.exitCode = run();
} catch (error) {
  process.stderr.write(`check-js-reverse-sync failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
