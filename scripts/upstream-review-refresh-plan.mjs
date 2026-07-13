#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const defaultReviewFile = resolve(repoRoot, "UPSTREAM.review.json");

function parseArgs(argv) {
  const parsed = {
    json: false,
    write: false,
    confirm_reviewed: false,
    print_review: false,
    latest_repo: null,
    latest_ref: "main",
    review_file: defaultReviewFile,
    reviewed_at: new Date().toISOString().slice(0, 10),
    release_context: "remote-main-review refresh plan",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--write") {
      parsed.write = true;
      continue;
    }
    if (token === "--confirm-reviewed") {
      parsed.confirm_reviewed = true;
      continue;
    }
    if (token === "--print-review") {
      parsed.print_review = true;
      continue;
    }
    if (token === "--latest-repo") {
      parsed.latest_repo = requiredValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--latest-ref") {
      parsed.latest_ref = requiredValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--review-file") {
      parsed.review_file = resolve(requiredValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--reviewed-at") {
      parsed.reviewed_at = requiredValue(argv, index, token);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.reviewed_at)) {
        throw new Error("invalid --reviewed-at value");
      }
      index += 1;
      continue;
    }
    if (token === "--release-context") {
      parsed.release_context = requiredValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (parsed.write && !parsed.confirm_reviewed) {
    throw new Error("--write requires --confirm-reviewed");
  }
  return parsed;
}

function requiredValue(argv, index, token) {
  const value = String(argv[index + 1] ?? "").trim();
  if (!value || value.startsWith("--")) {
    throw new Error(`missing ${token} value`);
  }
  return value;
}

function usage() {
  return [
    "Usage: node scripts/upstream-review-refresh-plan.mjs [--json] [--print-review]",
    "       node scripts/upstream-review-refresh-plan.mjs --write --confirm-reviewed",
    "       node scripts/upstream-review-refresh-plan.mjs --latest-repo <repo> [--latest-ref main] [--review-file <path>]",
    "",
    "Creates a no-write UPSTREAM.review.json refresh draft from upstream:audit:latest.",
    "--write only persists the proposed review ledger after --confirm-reviewed.",
  ].join("\n");
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function runLatestAudit(args) {
  const auditArgs = ["scripts/upstream-audit.mjs", "--latest-temp", "--json", "--review-file", args.review_file];
  if (args.latest_repo) auditArgs.push("--latest-repo", args.latest_repo);
  if (args.latest_ref) auditArgs.push("--latest-ref", args.latest_ref);
  const result = spawnSync(process.execPath, auditArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(`upstream:audit:latest failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "").trim());
}

function sortedStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value)).filter(Boolean))).sort();
}

function extensionActionFor(mode, directSyncAllowed) {
  if (directSyncAllowed) return "direct_sync_allowed_after_manual_review";
  if (mode === "manual_merge_preserve_local_bridge_features") {
    return "keep_local_bridge_and_selectively_cherry_pick_future_useful_hunks";
  }
  if (mode === "no_extension_changes") return "no_local_extension_change";
  if (mode === "no_behavior_changes_keep_local") return "keep_local_no_behavior_change";
  return "selective_cherry_pick_after_manual_review";
}

function buildReason(audit, missingFeatures) {
  const mode = audit.extension_review?.recommended_merge_mode ?? "unknown";
  const changed = sortedStrings(audit.extension_review?.files?.map((file) => file.file));
  const changedText = changed.length > 0 ? changed.join(",") : "none";
  const missingText = missingFeatures.length > 0 ? missingFeatures.join(",") : "none";
  if (mode === "manual_merge_preserve_local_bridge_features") {
    return `Latest upstream ${audit.remote_main?.commit ?? "unknown"} was checked with upstream:audit:latest. Extension drift changed_files=${changedText}; upstream background.js is still missing local enhanced bridge features (${missingText}), so direct sync remains disabled and the local bridge stays authoritative.`;
  }
  if (mode === "no_extension_changes") {
    return `Latest upstream ${audit.remote_main?.commit ?? "unknown"} was checked with upstream:audit:latest and produced no extension file changes against the local browser67 bridge.`;
  }
  if (mode === "no_behavior_changes_keep_local") {
    return `Latest upstream ${audit.remote_main?.commit ?? "unknown"} was checked with upstream:audit:latest; detected drift is non-behavioral formatting only, so local files should be kept to avoid noisy sync.`;
  }
  return `Latest upstream ${audit.remote_main?.commit ?? "unknown"} was checked with upstream:audit:latest; changed_files=${changedText} require selective cherry-pick review before any local bridge update.`;
}

function perFileDecision(file = {}) {
  if (file.file === "background.js" && file.recommended_action === "manual_merge_preserve_local_bridge_features") {
    return {
      file: file.file,
      action: "keep_local_bridge_features",
      risk: "high_if_blind_synced",
    };
  }
  if (file.diff_kind === "final_newline_only") {
    return {
      file: file.file,
      action: "keep_local_no_behavior_change",
      risk: "none_final_newline_only",
    };
  }
  return {
    file: file.file,
    action: file.recommended_action,
    risk: file.risk,
  };
}

function buildProposedReview({ currentReview, audit, args }) {
  const mode = audit.extension_review?.recommended_merge_mode ?? "manual_merge_preserve_local_bridge_features";
  const changedFiles = sortedStrings(audit.extension_review?.files?.map((file) => file.file));
  const missingFeatures = sortedStrings(audit.extension_review?.local_only_enhanced_features);
  const directSyncAllowed = audit.safe_to_direct_sync === true && audit.extension_diff?.ok === true;
  const preservedFeatures = mode === "manual_merge_preserve_local_bridge_features"
    ? missingFeatures
    : sortedStrings(currentReview?.extension_review?.background_preserve_features);

  return {
    schema_version: 1,
    upstream: {
      name: currentReview?.upstream?.name ?? "lsdefine/GenericAgent",
      remote: audit.remote_main?.remote ?? currentReview?.upstream?.remote ?? "https://github.com/lsdefine/GenericAgent.git",
      reviewed_ref: args.latest_ref,
      reviewed_commit: audit.remote_main?.commit ?? audit.local_genericagent?.head,
      reviewed_at: args.reviewed_at,
      release_context: args.release_context,
    },
    decision: {
      extension_merge_mode: mode,
      direct_sync_allowed: directSyncAllowed,
      local_extension_action: extensionActionFor(mode, directSyncAllowed),
      lock_action: audit.lock_matches_remote_main === true
        ? "lock_matches_reviewed_upstream"
        : "keep_UPSTREAM.lock.json_at_extension_sync_baseline_until_intentional_extension_sync",
      reason: buildReason(audit, preservedFeatures),
    },
    extension_review: {
      changed_files: changedFiles,
      background_preserve_features: preservedFeatures,
      per_file_decision: (audit.extension_review?.files ?? []).map(perFileDecision),
    },
    absorbed_reference: currentReview?.absorbed_reference ?? {
      paths: [
        "docs/upstream/genericagent/README.md",
      ],
      notes: "GenericAgent upstream review refresh plan generated from upstream:audit:latest.",
    },
  };
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildPlan(args) {
  const currentReview = readJsonIfExists(args.review_file);
  const audit = runLatestAudit(args);
  const needsRefresh = audit.upstream_review?.status !== "current"
    || audit.upstream_review?.current_extension_review_matches_decision !== true;
  const proposedReview = needsRefresh
    ? buildProposedReview({ currentReview, audit, args })
    : currentReview;
  const changedFields = needsRefresh ? [
    "upstream.reviewed_commit",
    "upstream.reviewed_at",
    "upstream.release_context",
    "decision",
    "extension_review",
  ] : [];
  const wrote = args.write && needsRefresh;
  if (wrote) {
    writeFileSync(args.review_file, stableJson(proposedReview));
  }
  return {
    ok: true,
    check: "upstream-review-refresh-plan",
    status: wrote ? "written" : (needsRefresh ? "ready_for_confirmation" : "current"),
    write: args.write,
    wrote,
    needs_refresh: needsRefresh,
    review_file: args.review_file,
    remote_main_commit: audit.remote_main?.commit ?? null,
    reviewed_commit: audit.upstream_review?.reviewed_commit ?? null,
    proposed_reviewed_commit: proposedReview?.upstream?.reviewed_commit ?? null,
    safe_to_direct_sync: audit.safe_to_direct_sync,
    extension_merge_mode: audit.extension_review?.recommended_merge_mode ?? null,
    changed_files: sortedStrings(audit.extension_review?.files?.map((file) => file.file)),
    preserve_features: sortedStrings(audit.extension_review?.local_only_enhanced_features),
    changed_fields: changedFields,
    commands: {
      preview_json: "npm run upstream:review-refresh-plan -- --json",
      print_review: "npm run upstream:review-refresh-plan -- --print-review",
      write_review: "npm run upstream:review-refresh-plan -- --write --confirm-reviewed",
      validate: "npm run check:upstream-review",
      audit_latest: "npm run upstream:audit:latest",
    },
    audit_summary: {
      upstream_review_status: audit.upstream_review?.status ?? null,
      pending_remote_review: audit.upstream_review?.pending_remote_review === true,
      manual_review_required: audit.manual_review_required === true,
    },
    proposed_review: proposedReview,
  };
}

function outputText(plan, args) {
  process.stdout.write(`upstream_review_refresh_plan=${plan.status} needs_refresh=${plan.needs_refresh} write=${plan.write} wrote=${plan.wrote}\n`);
  process.stdout.write(`review_file=${plan.review_file}\n`);
  process.stdout.write(`remote_main=${plan.remote_main_commit ?? "unknown"} reviewed=${plan.reviewed_commit ?? "none"} proposed=${plan.proposed_reviewed_commit ?? "none"}\n`);
  process.stdout.write(`extension_merge_mode=${plan.extension_merge_mode ?? "unknown"} safe_to_direct_sync=${plan.safe_to_direct_sync}\n`);
  process.stdout.write(`changed_files=${plan.changed_files.join(",") || "none"}\n`);
  process.stdout.write(`preserve_features=${plan.preserve_features.join(",") || "none"}\n`);
  if (plan.needs_refresh) {
    process.stdout.write(`next=${plan.commands.write_review} && ${plan.commands.validate}\n`);
  } else {
    process.stdout.write("next=No ledger refresh needed; remote main already matches UPSTREAM.review.json.\n");
  }
  if (args.print_review && plan.proposed_review) {
    process.stdout.write("\nproposed_review:\n");
    process.stdout.write(stableJson(plan.proposed_review));
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const plan = buildPlan(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
  } else {
    outputText(plan, args);
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`upstream-review-refresh-plan failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
