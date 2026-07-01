import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SERVER_NAME } from "../src/server/protocol.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assertFile(relativePath) {
  assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `missing ${relativePath}`);
}

function assertPackage() {
  const pkg = JSON.parse(readText("package.json"));
  assert.equal(pkg.name, "browser67");
  assert.equal(pkg.bin?.browser67, "./bin/browser67.mjs");
  assert.equal(pkg.bin?.["tmwd-browser-mcp"], "./bin/tmwd-browser-mcp.mjs");
  assert.equal(pkg.bin?.["tmwd-browser"], "./bin/tmwd-browser.mjs");
  assert.equal(pkg.scripts?.["check:browser67-naming"], "node contracts/browser67-naming-contract.mjs");
  assert.equal(pkg.scripts?.["check:runtime-home"], "node contracts/runtime-home-contract.mjs");
  assert.equal(pkg.scripts?.["migrate:home"], "node scripts/migrate-home.mjs");
}

function assertDocsAndSkills() {
  assert.equal(readText("README.md").split(/\r?\n/, 1)[0], "# browser67");
  for (const file of [
    "docs/naming-and-compatibility.md",
    "docs/migration-browser67.md",
    "docs/project-structure.md",
    "docs/maintenance-quality-model.md",
    "skills/browser67/SKILL.md",
    "skills/tmwd-browser-mcp/SKILL.md",
    "skills/js-reverse/SKILL.md",
  ]) {
    assertFile(file);
  }
  assert.match(readText("docs/naming-and-compatibility.md"), /tmwd-browser-mcp.*compatibility alias/s);
  assert.match(readText("skills/tmwd-browser-mcp/SKILL.md"), /legacy skill name for browser67/);
}

function assertServerIdentity() {
  assert.equal(SERVER_NAME, "browser67-tmwd-browser");
}

function assertTopLevelStructure() {
  const banned = new Set(["utils", "helpers", "misc", "new", "tmp", "experimental"]);
  const topLevelDirs = readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const dir of topLevelDirs) {
    assert.equal(banned.has(dir), false, `banned generic top-level directory: ${dir}`);
  }
  assertFile("src/runtime/paths/home.mjs");
}

function run() {
  assertPackage();
  assertDocsAndSkills();
  assertServerIdentity();
  assertTopLevelStructure();
  process.stdout.write(`${JSON.stringify({ ok: true, contract: "browser67-naming" })}\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`browser67-naming-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
