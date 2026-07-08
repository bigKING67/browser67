#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const ledgerPath = path.resolve(repoRoot, "docs", "upstream", "js-reverse", "references.json");
const matrixPath = path.resolve(repoRoot, "docs", "upstream", "js-reverse", "absorption-matrix.md");

const REQUIRED_FIELDS = [
  "Reference",
  "Reviewed commit",
  "Direct import allowed",
  "Priority",
  "Absorbable pattern",
  "Current browser67 coverage",
  "Gap",
  "Target layer",
  "Promotion requirement",
  "Verification",
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function parseSections(markdown) {
  const sections = new Map();
  let currentName = null;
  let currentLines = [];

  function flush() {
    if (currentName) {
      sections.set(currentName, currentLines.join("\n").trim());
    }
  }

  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^### `([^`]+)`\s*$/);
    if (match) {
      flush();
      currentName = match[1];
      currentLines = [];
      continue;
    }
    if (currentName) {
      currentLines.push(line);
    }
  }
  flush();

  return sections;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fieldValue(section, field) {
  const pattern = new RegExp(`^- \\*\\*${escapeRegExp(field)}\\*\\*: (.+)$`, "m");
  const match = section.match(pattern);
  assert.ok(match, `missing field ${field}`);
  return match[1].trim();
}

function assertBacktickedValue(actual, expected, label) {
  assert.equal(actual, `\`${expected}\``, `${label} must be \`${expected}\``);
}

function assertSection(reference, section) {
  for (const field of REQUIRED_FIELDS) {
    fieldValue(section, field);
  }

  assertBacktickedValue(fieldValue(section, "Reference"), reference.name, `${reference.name}.Reference`);
  assertBacktickedValue(fieldValue(section, "Reviewed commit"), reference.reviewed_commit, `${reference.name}.Reviewed commit`);
  assertBacktickedValue(fieldValue(section, "Direct import allowed"), "false", `${reference.name}.Direct import allowed`);

  const priority = fieldValue(section, "Priority").replaceAll("`", "");
  assert.match(priority, /^P[0-3]$/, `${reference.name}.Priority must be P0, P1, P2, or P3`);

  const targetLayer = fieldValue(section, "Target layer");
  assert.match(
    targetLayer,
    /(src\/|contracts\/|docs\/|skills\/|templates\/|scripts\/)/,
    `${reference.name}.Target layer must point at browser67-owned artifacts`,
  );

  const promotionRequirement = fieldValue(section, "Promotion requirement");
  assert.ok(promotionRequirement.length >= 40, `${reference.name}.Promotion requirement must be specific`);
  assert.doesNotMatch(
    promotionRequirement,
    /direct import|copy whole|wholesale import/i,
    `${reference.name}.Promotion requirement must not allow direct imports`,
  );

  const verification = fieldValue(section, "Verification");
  assert.match(verification, /`(?:npm run|node )[^`]+`/, `${reference.name}.Verification must include a command`);
  assert.match(verification, /check:js-reverse/, `${reference.name}.Verification must include a js-reverse gate`);

  if (priority === "P0" || priority === "P1") {
    assert.ok(targetLayer.length >= 20, `${reference.name}.P0/P1 Target layer must be concrete`);
    assert.ok(promotionRequirement.length >= 60, `${reference.name}.P0/P1 Promotion requirement must be concrete`);
    assert.match(verification, /`npm run [^`]+`/, `${reference.name}.P0/P1 Verification must include an npm gate`);
  }
}

function main() {
  assert.equal(existsSync(ledgerPath), true, "missing docs/upstream/js-reverse/references.json");
  assert.equal(existsSync(matrixPath), true, "missing docs/upstream/js-reverse/absorption-matrix.md");

  const ledger = readJson(ledgerPath);
  const matrix = readFileSync(matrixPath, "utf8");
  const sections = parseSections(matrix);
  const references = Array.isArray(ledger.references) ? ledger.references : [];

  assert.equal(references.length > 0, true, "references.json must contain references");
  assert.doesNotMatch(matrix, /direct_import_allowed\s*=\s*true|Direct import allowed\*\*: `true`/i);
  assert.match(matrix, /future reviewed change promotes/i);

  for (const reference of references) {
    const section = sections.get(reference.name);
    assert.ok(section, `absorption matrix missing section for ${reference.name}`);
    assert.equal(reference.direct_import_allowed, false, `${reference.name}.direct_import_allowed must remain false in ledger`);
    assertSection(reference, section);
  }

  const extraSections = [...sections.keys()].filter((name) => !references.some((reference) => reference.name === name));
  assert.deepEqual(extraSections, [], `absorption matrix has sections not present in references.json: ${extraSections.join(", ")}`);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "js-reverse-absorption-matrix-contract",
    reference_count: references.length,
    sections: sections.size,
  })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`js-reverse-absorption-matrix-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
