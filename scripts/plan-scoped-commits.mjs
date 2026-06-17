#!/usr/bin/env node

import { buildChangeSetReport } from "./change-set-lib.mjs";

function parseArgs(argv) {
  const parsed = {
    json: false,
    include_empty: false,
    max_paths: 80,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--include-empty") {
      parsed.include_empty = true;
      continue;
    }
    if (token === "--max-paths") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("invalid --max-paths value");
      }
      parsed.max_paths = Math.floor(value);
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

function shellQuotePath(path) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(path)) {
    return path;
  }
  return `'${path.replaceAll("'", "'\\''")}'`;
}

function buildCommitPlan(report) {
  return report.groups.map((group, index) => {
    const paths = group.paths.map((item) => item.path);
    return {
      order: index + 1,
      id: group.id,
      title: group.title,
      description: group.description,
      path_count: paths.length,
      commit_message: group.commit_message,
      paths,
      git_add_command: paths.length > 0 ? `git add ${paths.map(shellQuotePath).join(" ")}` : null,
      pre_commit_checks: [
        "git diff --cached --check",
        ...group.verification,
      ],
      risk_notes: group.risk_notes,
    };
  });
}

function outputText(plan, report, maxPaths) {
  process.stdout.write(
    `scoped_commit_plan=ok changed=${report.changed_paths_count} groups=${plan.length} ungrouped=${report.ungrouped_paths_count}\n`,
  );
  process.stdout.write("note=plan-only; no files were staged or committed\n");
  for (const item of plan) {
    process.stdout.write(`\n${String(item.order).padStart(2, "0")}. ${item.id}\n`);
    process.stdout.write(`title: ${item.title}\n`);
    process.stdout.write(`commit: ${item.commit_message}\n`);
    process.stdout.write(`paths: ${item.path_count}\n`);
    process.stdout.write("git_add:\n");
    process.stdout.write(`  ${item.git_add_command ?? "none"}\n`);
    process.stdout.write("checks:\n");
    for (const check of item.pre_commit_checks) {
      process.stdout.write(`  - ${check}\n`);
    }
    process.stdout.write("risk_notes:\n");
    for (const note of item.risk_notes) {
      process.stdout.write(`  - ${note}\n`);
    }
    process.stdout.write("path_preview:\n");
    for (const path of item.paths.slice(0, maxPaths)) {
      process.stdout.write(`  - ${path}\n`);
    }
    if (item.paths.length > maxPaths) {
      process.stdout.write(`  ... ${item.paths.length - maxPaths} more\n`);
    }
  }
  if (!report.ok) {
    process.stderr.write(`\nungrouped=${report.ungrouped_paths_count}; run npm run check:change-set for details\n`);
  }
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildChangeSetReport(undefined, {
    include_empty_groups: args.include_empty,
  });
  const plan = buildCommitPlan(report)
    .filter((item) => args.include_empty || item.path_count > 0);
  const payload = {
    ok: report.ok,
    check: "scoped-commit-plan",
    plan_only: true,
    changed_paths_count: report.changed_paths_count,
    ungrouped_paths_count: report.ungrouped_paths_count,
    commit_count: plan.length,
    plan,
    guidance: report.commit_guidance,
  };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    outputText(plan, report, args.max_paths);
  }
  process.exitCode = report.ok ? 0 : 1;
}

try {
  run();
} catch (error) {
  process.stderr.write(`plan-scoped-commits failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
