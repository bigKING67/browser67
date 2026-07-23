#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const packageJsonPath = resolve(repoRoot, "package.json");
const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const failures = [];

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

requireCondition(pkg.name === "browser67", "package name must be browser67");
requireCondition(Array.isArray(pkg.keywords) && pkg.keywords.includes("pi-package"), "keywords must include pi-package");

const expectedSkills = ["skills/browser67", "skills/tmwd-browser-mcp", "skills/js-reverse"];
const actualSkills = Array.isArray(pkg.pi?.skills) ? pkg.pi.skills : [];

for (const skill of expectedSkills) {
  requireCondition(actualSkills.includes(skill), `pi.skills must include ${skill}`);
  requireCondition(existsSync(resolve(repoRoot, skill, "SKILL.md")), `missing package skill entrypoint: ${skill}/SKILL.md`);
  requireCondition(
    existsSync(resolve(repoRoot, skill, "agents/openai.yaml")),
    `missing package skill descriptor: ${skill}/agents/openai.yaml`,
  );
}

requireCondition(Boolean(pkg.bin?.browser67), "bin.browser67 must be declared");
requireCondition(existsSync(resolve(repoRoot, "src/mcp/browser/server.mjs")), "missing canonical tmwd_browser MCP server entrypoint");
requireCondition(existsSync(resolve(repoRoot, "src/mcp/js-reverse/server.mjs")), "missing canonical js-reverse MCP server entrypoint");
requireCondition(existsSync(resolve(repoRoot, "src/server.mjs")), "missing tmwd_browser compatibility entrypoint");
requireCondition(existsSync(resolve(repoRoot, "src/js-reverse-server.mjs")), "missing js-reverse compatibility entrypoint");

const payload = {
  ok: failures.length === 0,
  package: pkg.name,
  version: pkg.version,
  skills: actualSkills,
  failures,
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
process.exitCode = failures.length === 0 ? 0 : 1;
