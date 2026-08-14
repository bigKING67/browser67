#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const readmePath = path.resolve(repoRoot, "README.md");

const REQUIRED_HEADINGS = [
  "# browser67",
  "## Why browser67",
  "## Capabilities",
  "## Architecture",
  "## Quick start",
  "## Agent integration",
  "## Operating model",
  "## Documentation",
  "## Development and verification",
  "## Compatibility",
  "## License",
  "## Acknowledgements",
];

const REQUIRED_RELEASE_FRAGMENTS = [
  "npm run check",
  "npm run verify",
  "npm run check:release-readiness",
  "npm run release:ready",
  "docs/release-governance.md",
];

const REQUIRED_PROVENANCE_FRAGMENTS = [
  "lsdefine/GenericAgent",
  "https://github.com/lsdefine/GenericAgent",
  "THIRD_PARTY_NOTICES.md",
  "UPSTREAM.lock.json",
  "UPSTREAM.review.json",
];

function repositoryPaths() {
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, String(result.stderr || result.stdout));
  return new Set(
    String(result.stdout)
      .split("\0")
      .filter(Boolean)
      .map((item) => item.replaceAll("\\", "/")),
  );
}

function markdownTargets(markdown) {
  const targets = [];
  const pattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
  for (const match of markdown.matchAll(pattern)) {
    targets.push(match[1]);
  }
  return targets;
}

function isExternalTarget(target) {
  return /^(?:[a-z][a-z\d+.-]*:|#)/i.test(target);
}

function normalizedRepositoryTarget(target) {
  const withoutSuffix = target.split(/[?#]/, 1)[0];
  const decoded = decodeURIComponent(withoutSuffix);
  const normalized = path.posix.normalize(decoded.replace(/^\.\//, ""));
  assert.ok(
    normalized && normalized !== ".." && !normalized.startsWith("../") && !path.isAbsolute(normalized),
    `README link escapes the repository: ${target}`,
  );
  return normalized;
}

function main() {
  const markdown = readFileSync(readmePath, "utf8");
  const lines = markdown.split(/\r?\n/);
  const bytes = Buffer.byteLength(markdown);
  const headings = lines.filter((line) => /^#{1,2} /.test(line));

  assert.equal(lines[0], "# browser67", "README must start with the project heading");
  assert.ok(lines.length <= 400, `README exceeds 400 lines: ${lines.length}`);
  assert.ok(bytes <= 30 * 1024, `README exceeds 30 KiB: ${bytes} bytes`);

  let previousIndex = -1;
  for (const heading of REQUIRED_HEADINGS) {
    const index = headings.indexOf(heading);
    assert.ok(index >= 0, `README missing required heading: ${heading}`);
    assert.ok(index > previousIndex, `README heading is out of order: ${heading}`);
    previousIndex = index;
  }
  assert.equal(
    headings.at(-1),
    "## Acknowledgements",
    "Acknowledgements must be the final README section",
  );

  assert.doesNotMatch(
    markdown,
    /skills\/tmwd-browser-mcp/,
    "README must not advertise the retired tmwd-browser-mcp Skill",
  );
  for (const fragment of [...REQUIRED_RELEASE_FRAGMENTS, ...REQUIRED_PROVENANCE_FRAGMENTS]) {
    assert.ok(markdown.includes(fragment), `README missing required content: ${fragment}`);
  }

  const knownPaths = repositoryPaths();
  const relativeTargets = markdownTargets(markdown).filter((target) => !isExternalTarget(target));
  const checkedTargets = [];
  for (const target of relativeTargets) {
    const repositoryTarget = normalizedRepositoryTarget(target);
    const absoluteTarget = path.resolve(repoRoot, repositoryTarget);
    assert.ok(existsSync(absoluteTarget), `README link target does not exist: ${target}`);
    assert.ok(statSync(absoluteTarget).isFile(), `README link target is not a file: ${target}`);
    assert.ok(
      knownPaths.has(repositoryTarget),
      `README link target is ignored or outside the repository file set: ${target}`,
    );
    checkedTargets.push(repositoryTarget);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "readme-contract",
    lines: lines.length,
    bytes,
    headings: REQUIRED_HEADINGS.length,
    relative_links: checkedTargets.length,
  })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`readme-contract failed: ${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
}
