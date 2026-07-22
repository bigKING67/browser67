#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import madge from "madge";

const repoRoot = path.resolve(import.meta.dirname, "..");
const srcRoot = path.join(repoRoot, "src");

const forbiddenBoundaries = [
  {
    id: "runtime_to_protocol",
    source: (file) => file.startsWith("runtime/"),
    dependency: (file) => file.startsWith("mcp/") || file.startsWith("server/"),
  },
  {
    id: "browser_to_mcp",
    source: (file) => file.startsWith("browser/"),
    dependency: (file) => file.startsWith("mcp/"),
  },
  {
    id: "native_to_protocol",
    source: (file) => /^(?:native-|native\/|physical-input\/)/.test(file),
    dependency: (file) => file.startsWith("mcp/") || file.startsWith("server/"),
  },
  {
    id: "governance_to_hot_path",
    source: (file) => file.startsWith("governance/"),
    dependency: (file) => file.startsWith("browser/") || file.startsWith("tmwd-runtime/"),
  },
];

function branchCount(source) {
  return (source.match(/\b(?:if|for|while|switch|catch)\b|\?\?|\?\s*[^:]+:/g) ?? []).length;
}

async function buildReport() {
  const result = await madge(srcRoot, {
    baseDir: srcRoot,
    fileExtensions: ["mjs"],
  });
  const graph = result.obj();
  const cycles = result.circular();
  const violations = [];
  const warnings = [];

  for (const [source, dependencies] of Object.entries(graph)) {
    for (const dependency of dependencies) {
      for (const boundary of forbiddenBoundaries) {
        if (boundary.source(source) && boundary.dependency(dependency)) {
          violations.push({ rule: boundary.id, source, dependency });
        }
      }
    }
    const content = await readFile(path.join(srcRoot, source), "utf8").catch(() => "");
    const lines = content ? content.split("\n").length : 0;
    const branches = branchCount(content);
    if (lines > 600) warnings.push({ kind: "loc", file: source, value: lines, threshold: 600 });
    if (dependencies.length > 20) {
      warnings.push({ kind: "import_fan_out", file: source, value: dependencies.length, threshold: 20 });
    }
    if (branches > 80) {
      warnings.push({ kind: "branch_complexity", file: source, value: branches, threshold: 80 });
    }
  }

  return {
    ok: cycles.length === 0 && violations.length === 0,
    check: "dependency-boundary-audit",
    schema_version: "browser67.dependency-boundaries.v1",
    module_count: Object.keys(graph).length,
    cycles,
    violations,
    warnings,
  };
}

async function main() {
  const report = await buildReport();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(`dependency_boundaries=${report.ok ? "ok" : "failed"} modules=${report.module_count} cycles=${report.cycles.length} violations=${report.violations.length} warnings=${report.warnings.length}\n`);
    for (const warning of report.warnings) {
      process.stdout.write(`warning=${warning.kind} file=${warning.file} value=${warning.value} threshold=${warning.threshold}\n`);
    }
  }
  return report.ok ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`dependency boundary audit failed: ${String(error?.stack ?? error)}\n`);
    process.exitCode = 1;
  });
}

export { buildReport };
