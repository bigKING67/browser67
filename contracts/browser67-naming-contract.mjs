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
  assert.equal(pkg.scripts?.["check:js-reverse-upstream"], "node contracts/js-reverse-upstream-reference-contract.mjs");
  assert.equal(pkg.scripts?.["check:js-reverse-upstream-audit"], "node contracts/js-reverse-upstream-audit-contract.mjs");
  assert.equal(pkg.scripts?.["check:js-reverse-absorption-matrix"], "node contracts/js-reverse-absorption-matrix-contract.mjs");
  assert.equal(pkg.scripts?.["js-reverse:upstream-audit"], "node scripts/js-reverse-upstream-audit.mjs");
  assert.equal(pkg.scripts?.["skills:active:diff"], "node scripts/active-skill-sync.mjs --json");
  assert.equal(pkg.scripts?.["skills:active:check"], "node scripts/active-skill-sync.mjs --check");
  assert.equal(pkg.scripts?.["skills:active:sync"], "node scripts/active-skill-sync.mjs --write");
  assert.equal(pkg.scripts?.["skills:active:backups"], "node scripts/active-skill-sync.mjs --list-backups --json");
  assert.equal(pkg.scripts?.["skills:active:restore"], "node scripts/active-skill-sync.mjs --restore");
  assert.equal(pkg.scripts?.["skills:roots:audit"], "node scripts/skills-roots-audit.mjs --json");
  assert.equal(pkg.scripts?.["check:active-skill-sync"], "node contracts/active-skill-sync-contract.mjs");
  assert.equal(pkg.scripts?.["check:skills-roots-audit"], "node contracts/skills-roots-audit-contract.mjs");
  assert.equal(pkg.scripts?.["extension:doctor"], "node scripts/extension-install-doctor.mjs --json");
  assert.equal(pkg.scripts?.["check:extension-install-doctor"], "node contracts/extension-install-doctor-contract.mjs");
  assert.equal(pkg.scripts?.["verify:local"], "npm run verify && npm run skills:active:check");
  assert.equal(pkg.scripts?.["check:runtime-home"], "node contracts/runtime-home-contract.mjs");
  assert.equal(pkg.scripts?.["migrate:home"], "node scripts/migrate-home.mjs");
}

function assertDocsAndSkills() {
  assert.equal(readText("README.md").split(/\r?\n/, 1)[0], "# browser67");
  for (const file of [
    "AGENTS.md",
    "docs/naming-and-compatibility.md",
    "docs/migration-browser67.md",
    "docs/project-structure.md",
    "docs/maintenance-quality-model.md",
    "docs/active-skill-runtime-model.md",
    "skills/browser67/SKILL.md",
    "skills/tmwd-browser-mcp/SKILL.md",
    "skills/js-reverse/SKILL.md",
  ]) {
    assertFile(file);
  }
  assert.match(readText("AGENTS.md"), /# browser67 项目规范/);
  assert.match(readText("AGENTS.md"), /browser67.*canonical project\/package\/CLI\/runtime umbrella/);
  assert.match(readText("AGENTS.md"), /~\/\.browser67\/runtime/);
  assert.match(readText("docs/naming-and-compatibility.md"), /tmwd-browser-mcp.*compatibility alias/s);
  assert.match(readText("skills/tmwd-browser-mcp/SKILL.md"), /legacy skill name for browser67/);
}

function assertLaunchdCompatibility() {
  for (const file of [
    "scripts/install-launchd.mjs",
    "scripts/uninstall-launchd.mjs",
    "docs/migration-browser67.md",
  ]) {
    const text = readText(file);
    assert.match(text, /com\.browser67\.tmwd-hub/);
    assert.match(text, /com\.browser67\.tmwd-browser-mcp/);
    assert.match(text, /com\.gaoqian\.tmwd-browser-mcp/);
  }
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
    ...collectTextFiles("bin"),
    ...collectTextFiles("contracts"),
    ...collectTextFiles("docs"),
    ...collectTextFiles("scripts"),
    ...collectTextFiles("src"),
  ]) {
    assert.equal(readText(file).includes(retiredPrefix), false, `retired browser MCP name still present in ${file}`);
  }
}

function assertCliUsesCanonicalLiveGate() {
  const text = readText("bin/browser67.mjs");
  const retiredLiveGate = `contracts/${"browser-structured-" + "mcp"}-live-gate.mjs`;
  assert.match(text, /contracts\/browser67-live-gate\.mjs/);
  assert.equal(
    text.includes(retiredLiveGate),
    false,
    "browser67 CLI still references retired live-gate path",
  );
}

function assertAgentFacingPromptBranding() {
  const files = [
    "README.md",
    "AGENTS.md",
    "docs/agent-setup.md",
    "docs/architecture.md",
    "docs/codex-integration.md",
    "docs/global-prompt-snippet.md",
    "docs/project-structure.md",
    "skills/browser67/SKILL.md",
    "skills/js-reverse/SKILL.md",
    "skills/tmwd-browser-mcp/SKILL.md",
  ];
  const forbiddenPrimaryBrandPatterns = [
    /\bUse TMWD\b/,
    /\bTMWD-backed\b/,
    /\bTMWD-owned\b/,
    /\bTMWD-managed\b/,
    /\bTMWD run root\b/,
    /\bTMWD login-state\b/,
    /\bTMWD native fallback\b/,
    /\bTMWD controls\b/,
    /\bselected TMWD tab\b/,
    /\bTMWD still avoids\b/,
    /\bLocal TMWD hub\b/,
    /Why TMWD first/,
  ];
  for (const file of files) {
    const text = readText(file);
    for (const pattern of forbiddenPrimaryBrandPatterns) {
      assert.doesNotMatch(
        text,
        pattern,
        `agent-facing prompt/doc uses TMWD as primary browser67 brand: ${file} (${pattern})`,
      );
    }
  }
  assert.match(readText("docs/agent-setup.md"), /skills\/browser67/);
  assert.match(readText("skills/tmwd-browser-mcp/SKILL.md"), /Legacy alias for browser67/);
  assertJsReverseSkillBoundary();
}

function assertJsReverseSkillBoundary() {
  for (const file of ["docs/js-reverse/SKILL.md", "skills/js-reverse/SKILL.md"]) {
    const text = readText(file);
    assert.match(
      text,
      /browser67-backed/,
      `js-reverse skill must keep browser67-backed as the default path: ${file}`,
    );
    assert.match(
      text,
      /browser67-owned/,
      `js-reverse skill must preserve browser67-owned managed tab lifecycle: ${file}`,
    );
    assert.match(
      text,
      /finalize_task/,
      `js-reverse skill must preserve finalize_task cleanup guidance: ${file}`,
    );
    assert.match(
      text,
      /record_reverse_evidence/,
      `js-reverse skill must preserve structured reverse evidence capture: ${file}`,
    );
    assert.match(
      text,
      /evidence\.v1/,
      `js-reverse skill must preserve evidence.v1 contract: ${file}`,
    );
    assert.doesNotMatch(
      text,
      /ACTION REQUIRED|读完后立刻执行|field-journal\/precedent-reverse|bootstrap-reverse/,
      `js-reverse skill must not inherit reverse-skill auto-execution/bootstrap semantics: ${file}`,
    );
    assert.doesNotMatch(
      text,
      /Playwright MCP.*互补使用/,
      `js-reverse skill must keep browser67 as the default automation path: ${file}`,
    );
  }
}

function assertProjectSurfaceBranding() {
  const files = [
    "package.json",
    "src/tool-schemas/tab-lifecycle.mjs",
    "src/js-reverse-server/tool-schemas.mjs",
    "src/js-reverse-server/hooks.mjs",
    "scripts/change-set-lib.mjs",
    "scripts/extension-install-doctor.mjs",
    "scripts/skills-roots-audit.mjs",
    "scripts/optional-live-proof-template.mjs",
    "scripts/optional-live-proof-plan.mjs",
    "scripts/optional-live-proof-audit.mjs",
    "scripts/readiness-audit.mjs",
    "contracts/setup-extension-contract.mjs",
    "scripts/setup-extension.mjs",
    "scripts/upstream-audit.mjs",
    "docs/js-reverse-SOP.md",
    "docs/ljqCtrl-SOP.md",
    "docs/optional-live-proofs.md",
    "docs/js-reverse/references/tmwd-browser-mcp.md",
    "skills/js-reverse/references/tmwd-browser-mcp.md",
    "contracts/browser67-browser-mcp-contract/optional-live-proofs.mjs",
    "contracts/browser67-browser-mcp-contract/readiness-audit.mjs",
    "contracts/browser-captcha-assist-physical-live-gate/proof.mjs",
  ];
  const forbiddenPrimaryBrandPatterns = [
    /\bTMWD-backed\b/,
    /\bTMWD-owned\b/,
    /\bTMWD-managed\b/,
    /\bTMWD skill\b/,
    /\bTMWD docs\b/,
    /\bTMWD Browser MCP\b/,
    /\bStandalone TMWD browser MCP\b/,
  ];
  for (const file of files) {
    const text = readText(file);
    for (const pattern of forbiddenPrimaryBrandPatterns) {
      assert.doesNotMatch(
        text,
        pattern,
        `project surface uses TMWD as primary browser67 brand: ${file} (${pattern})`,
      );
    }
  }
}

function run() {
  assertPackage();
  assertDocsAndSkills();
  assertLaunchdCompatibility();
  assertServerIdentity();
  assertTopLevelStructure();
  assertRetiredStructuredMcpName();
  assertCliUsesCanonicalLiveGate();
  assertAgentFacingPromptBranding();
  assertProjectSurfaceBranding();
  process.stdout.write(`${JSON.stringify({ ok: true, contract: "browser67-naming" })}\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`browser67-naming-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
