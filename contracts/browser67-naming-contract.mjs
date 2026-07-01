import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SERVER_NAME } from "../src/server/protocol.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const textFileExtensions = new Set([
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".toml",
  ".yaml",
  ".yml",
]);

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

function collectTextFiles(relativeDir) {
  const root = path.join(repoRoot, relativeDir);
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === ".DS_Store" || entry.name === "node_modules") continue;
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTextFiles(relativePath));
      continue;
    }
    if (textFileExtensions.has(path.extname(entry.name))) {
      files.push(relativePath);
    }
  }
  return files;
}

function assertRetiredStructuredMcpName() {
  const retiredPrefix = "browser-structured-" + "mcp";
  for (const oldPath of [
    `${retiredPrefix}-contract.mjs`,
    `${retiredPrefix}-contract`,
    `${retiredPrefix}-hub-control-contract.mjs`,
    `${retiredPrefix}-hub-control-contract`,
    `${retiredPrefix}-hub-relay-contract.mjs`,
    `${retiredPrefix}-hub-relay-contract`,
    `${retiredPrefix}-live-contract.mjs`,
    `${retiredPrefix}-live-contract`,
    `${retiredPrefix}-live-doctor.mjs`,
    `${retiredPrefix}-live-doctor`,
    `${retiredPrefix}-live-gate.mjs`,
    `${retiredPrefix}-live-gate`,
    `${retiredPrefix}-remote-cdp-contract.mjs`,
    `${retiredPrefix}-remote-cdp-contract`,
  ]) {
    assert.equal(existsSync(path.join(repoRoot, "contracts", oldPath)), false, `retired contract path still exists: ${oldPath}`);
  }

  for (const file of [
    "package.json",
    "README.md",
    ...collectTextFiles("contracts"),
    ...collectTextFiles("docs"),
    ...collectTextFiles("scripts"),
    ...collectTextFiles("src"),
  ]) {
    assert.equal(readText(file).includes(retiredPrefix), false, `retired browser MCP name still present in ${file}`);
  }
}

function run() {
  assertPackage();
  assertDocsAndSkills();
  assertServerIdentity();
  assertTopLevelStructure();
  assertRetiredStructuredMcpName();
  process.stdout.write(`${JSON.stringify({ ok: true, contract: "browser67-naming" })}\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`browser67-naming-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
