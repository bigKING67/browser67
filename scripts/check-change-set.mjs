#!/usr/bin/env node

import {
  buildChangeSetReport,
  truncateGroup,
} from "./change-set-lib.mjs";

function parseArgs(argv) {
  const parsed = {
    fail_ungrouped: false,
    json: false,
    max_items: 16,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--fail-ungrouped") {
      parsed.fail_ungrouped = true;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--max-items") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("invalid --max-items value");
      }
      parsed.max_items = Math.floor(value);
      index += 1;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function outputText(report, maxItems) {
  const status = report.ok ? "ok" : "fail";
  process.stdout.write(
    `change_set=${status} changed=${report.changed_paths_count} grouped=${report.grouped_paths_count} ungrouped=${report.ungrouped_paths_count}\n`,
  );
  for (const group of report.groups) {
    process.stdout.write(`\n[${group.id}] count=${group.count}\n`);
    for (const item of group.paths.slice(0, maxItems)) {
      process.stdout.write(`  ${item.status} ${item.path}\n`);
    }
    if (group.paths.length > maxItems) {
      process.stdout.write(`  ... ${group.paths.length - maxItems} more\n`);
    }
  }
  if (report.ungrouped.count > 0) {
    process.stderr.write(`\n[ungrouped] count=${report.ungrouped.count}\n`);
    for (const item of report.ungrouped.paths.slice(0, maxItems)) {
      process.stderr.write(`  ${item.status} ${item.path}\n`);
    }
    if (report.ungrouped.paths.length > maxItems) {
      process.stderr.write(`  ... ${report.ungrouped.paths.length - maxItems} more\n`);
    }
  }
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildChangeSetReport();
  if (args.json) {
    const payload = {
      ...report,
      groups: report.groups.map((group) => truncateGroup(group, args.max_items)),
      ungrouped: truncateGroup(report.ungrouped, args.max_items),
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    outputText(report, args.max_items);
  }
  process.exitCode = args.fail_ungrouped && !report.ok ? 1 : 0;
}

try {
  run();
} catch (error) {
  process.stderr.write(`check-change-set failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
