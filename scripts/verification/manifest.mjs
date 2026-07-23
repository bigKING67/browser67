const DEFAULT_CHANGED_PATHS = ["src/**", "contracts/**", "scripts/**", "package.json"];

function npmEntry(id, script, options = {}) {
  return {
    id,
    command: ["npm", "run", script, ...(options.args ?? [])],
    script,
    label: options.label ?? script,
    changed_paths: options.changed_paths ?? DEFAULT_CHANGED_PATHS,
    requirements: options.requirements ?? ["node"],
  };
}

function commandEntry(id, command, options = {}) {
  return {
    id,
    command,
    label: options.label ?? command.join(" "),
    changed_paths: options.changed_paths ?? DEFAULT_CHANGED_PATHS,
    requirements: options.requirements ?? ["node"],
  };
}

const entries = [
  npmEntry("lint", "lint"),
  npmEntry("type-check", "type-check"),
  npmEntry("dependency-boundaries", "check:dependency-boundaries"),
  npmEntry("syntax", "check:syntax"),
  npmEntry("core-coverage", "coverage:core", {
    changed_paths: [
      "src/browser/content/snapshot-store.mjs",
      "src/browser/execution/batch-references.mjs",
      "src/browser/execution/page-script.mjs",
      "src/runtime/adoption/**",
      "src/runtime/downloads/**",
      "src/runtime/network/**",
      "src/runtime/sessions/**",
      "src/runtime/tab-scheduler.mjs",
      "src/tmwd-runtime/health.mjs",
      "test/runtime-core.test.mjs",
      "package.json",
    ],
  }),
  npmEntry("mcp", "check:mcp"),
  npmEntry("browser-runtime", "check:browser-runtime"),
  npmEntry("browser-content-core", "check:browser-content-core"),
  npmEntry("run-store", "check:run-store"),
  npmEntry("job-persistence", "check:job-persistence"),
  npmEntry("hub-control", "check:hub-control"),
  npmEntry("hub-relay", "check:hub-relay"),
  npmEntry("doctor-schema", "check:doctor-schema"),
  npmEntry("js-reverse-mcp", "check:js-reverse-mcp", { changed_paths: ["src/mcp/js-reverse/**", "src/js-reverse-server/**", "contracts/js-reverse-**", "skills/js-reverse/**"] }),
  npmEntry("js-reverse-upstream", "check:js-reverse-upstream", { changed_paths: ["docs/upstream/js-reverse/**", "contracts/js-reverse-**", "UPSTREAM.review.json"] }),
  npmEntry("js-reverse-upstream-audit-contract", "check:js-reverse-upstream-audit", { changed_paths: ["docs/upstream/js-reverse/**", "contracts/js-reverse-**", "scripts/js-reverse-**"] }),
  npmEntry("js-reverse-absorption", "check:js-reverse-absorption-matrix", { changed_paths: ["docs/upstream/js-reverse/**", "contracts/js-reverse-**"] }),
  npmEntry("active-skill-sync-contract", "check:active-skill-sync", { changed_paths: ["skills/**", "contracts/active-skill-**", "scripts/active-skill-**"] }),
  npmEntry("skills-roots-audit-contract", "check:skills-roots-audit", { changed_paths: ["skills/**", "contracts/skills-roots-**", "scripts/skills-roots-**"] }),
  npmEntry("browser67-naming", "check:browser67-naming", { changed_paths: ["src/**", "docs/**", "skills/**", "README.md", "package.json"] }),
  npmEntry("runtime-home", "check:runtime-home", { changed_paths: ["src/runtime/**", "scripts/migrate-**", "contracts/runtime-**"] }),
  npmEntry("project-structure", "check:project-structure", { changed_paths: ["src/**", "scripts/project-structure-audit.mjs", "docs/project-structure.md"] }),
  npmEntry("change-set-contract", "check:change-set-contract", { changed_paths: ["scripts/change-set-lib.mjs", "contracts/change-set-contract.mjs"] }),
  npmEntry("setup-extension", "check:setup-extension", { changed_paths: ["extension/**", "scripts/setup-extension.mjs", "scripts/build-extension.mjs", "contracts/setup-extension-contract.mjs"] }),
  npmEntry("extension-build", "check:extension-build", { changed_paths: ["extension/**", "scripts/build-extension.mjs", "contracts/extension-build-contract.mjs"] }),
  npmEntry("extension-managed-runtime", "check:extension-managed-runtime", { changed_paths: ["extension/**", "contracts/extension-managed-runtime-contract.mjs"] }),
  npmEntry("extension-install-doctor", "check:extension-install-doctor", { changed_paths: ["extension/**", "scripts/extension-install-doctor.mjs", "contracts/extension-install-doctor-contract.mjs"] }),
  npmEntry("extension-reload-live-contract", "check:extension-reload-live", { changed_paths: ["scripts/reload-extension-live.mjs", "contracts/extension-reload-live-contract.mjs"] }),
  npmEntry("agent-integration-doctor", "check:agent-integration-doctor", { changed_paths: ["AGENTS.md", "docs/agent-setup.md", "docs/global-prompt-snippet.md", "skills/**", "scripts/agent-integration-doctor.mjs", "contracts/agent-integration-doctor-contract.mjs", "package.json"] }),
  npmEntry("performance-smoke", "check:performance-smoke", { changed_paths: ["src/**", "scripts/performance-smoke.mjs"] }),
  npmEntry("runtime-cleanup", "check:runtime-cleanup", { changed_paths: ["src/runtime/runs/**", "src/runtime/jobs/**", "scripts/cleanup-runtime-artifacts.mjs", "contracts/runtime-artifact-cleanup-contract.mjs"] }),
  npmEntry("task-templates", "check:task-templates", { changed_paths: ["docs/**", "scripts/task-template.mjs"] }),
  npmEntry("regression-matrix", "check:regression-matrix", { changed_paths: ["scripts/regression-matrix.mjs", "package.json"] }),
  npmEntry("verification-manifest", "check:verification-manifest", { changed_paths: ["scripts/verification/**", "scripts/verification-manifest.mjs", "scripts/run-verification.mjs", "scripts/verify.mjs", "package.json"] }),
  npmEntry("upstream-audit-contract", "check:upstream-audit", { changed_paths: ["extension/**", "UPSTREAM.lock.json", "UPSTREAM.review.json", "contracts/upstream-**"] }),
  npmEntry("upstream-review-contract", "check:upstream-review", { changed_paths: ["UPSTREAM.review.json", "contracts/upstream-review-**"] }),
  npmEntry("upstream-review-refresh-contract", "check:upstream-review-refresh-plan", { changed_paths: ["UPSTREAM.review.json", "scripts/upstream-review-**", "contracts/upstream-review-**"] }),
  npmEntry("tmwd-runtime-dispose", "check:tmwd-runtime-dispose", { changed_paths: ["src/tmwd-runtime/**", "contracts/tmwd-runtime-dispose-contract.mjs"] }),
  npmEntry("tmwd-transport-health", "check:tmwd-transport-health", { changed_paths: ["src/tmwd-runtime/**", "contracts/tmwd-transport-health-contract.mjs"] }),
  npmEntry("extension-bridge", "check:extension", { changed_paths: ["extension/**", "scripts/check-extension-bridge.mjs"] }),
  npmEntry("release-readiness-contract", "check:release-readiness", { changed_paths: ["scripts/release-readiness.mjs", "package.json", "docs/**"] }),

  commandEntry("managed-baseline-start", ["node", "scripts/check-managed-tab-cleanup.mjs", "--write-baseline", "{managed_baseline}"], { label: "managed tab cleanup baseline", changed_paths: ["src/tab-workspace/**", "scripts/check-managed-tab-cleanup.mjs"] }),
  npmEntry("extension-upstream-check", "extension:check", { changed_paths: ["extension/**", "scripts/sync-genericagent-extension.mjs", "UPSTREAM.lock.json"] }),
  npmEntry("upstream-lock-check", "upstream:check", { changed_paths: ["extension/**", "UPSTREAM.lock.json"] }),
  npmEntry("upstream-audit", "upstream:audit", { changed_paths: ["extension/**", "UPSTREAM.lock.json", "UPSTREAM.review.json"] }),
  npmEntry("upstream-audit-latest", "upstream:audit:latest", { changed_paths: ["extension/**", "UPSTREAM.lock.json", "UPSTREAM.review.json"], requirements: ["node", "network"] }),
  npmEntry("upstream-review-refresh", "upstream:review-refresh-plan", { changed_paths: ["UPSTREAM.review.json", "scripts/upstream-review-refresh-plan.mjs"] }),
  npmEntry("js-reverse-upstream-audit", "js-reverse:upstream-audit", { args: ["--", "--json"], changed_paths: ["docs/upstream/js-reverse/**", "scripts/js-reverse-upstream-audit.mjs"], requirements: ["node", "network"] }),
  npmEntry("skills-active-diff", "skills:active:diff", { changed_paths: ["skills/**", "scripts/active-skill-sync.mjs"] }),
  npmEntry("skills-roots-audit", "skills:roots:audit", { changed_paths: ["skills/**", "scripts/skills-roots-audit.mjs"] }),
  npmEntry("skills-check", "skills:check", { changed_paths: ["skills/**", "scripts/check-js-reverse-sync.mjs"] }),
  npmEntry("captcha-router", "check:captcha-router", { changed_paths: ["src/auth/captcha/**", "contracts/browser-captcha-**"] }),
  npmEntry("captcha-provider-jfbym", "check:captcha-provider-jfbym", { changed_paths: ["src/auth/captcha/**", "contracts/browser-captcha-**"] }),
  npmEntry("captcha-provider-jfbym-setup", "check:captcha-provider-jfbym-setup", { changed_paths: ["scripts/setup-captcha-provider-jfbym.mjs", "contracts/browser-captcha-provider-jfbym-setup-contract.mjs"] }),
  npmEntry("captcha-provider-jfbym-coordinate", "check:captcha-provider-jfbym-coordinate", { changed_paths: ["src/auth/captcha/**", "contracts/browser-captcha-provider-jfbym-coordinate-contract.mjs"] }),
  npmEntry("change-set", "check:change-set", { changed_paths: ["**"] }),
  npmEntry("readiness", "check:readiness", { changed_paths: ["**"] }),
  npmEntry("live-doctor", "check:live:doctor", { requirements: ["node", "tmwd_hub", "browser67_extension"] }),
  npmEntry("js-reverse-live", "check:js-reverse-live", { requirements: ["node", "tmwd_hub", "browser67_extension"] }),
  npmEntry("managed-tab-live", "check:managed-tab-live", { requirements: ["node", "tmwd_hub", "browser67_extension"] }),
  npmEntry("tmwd-performance-live", "check:tmwd-performance-live", { requirements: ["node", "tmwd_hub", "browser67_extension"] }),
  npmEntry("screenshot-live", "check:screenshot-live", { requirements: ["node", "tmwd_hub", "browser67_extension"] }),
  npmEntry("auth-live", "check:auth-live", { requirements: ["node", "tmwd_hub", "browser67_extension"] }),
  npmEntry("captcha-assist-live", "check:captcha-assist-live", { requirements: ["node", "tmwd_hub", "browser67_extension"] }),
  npmEntry("native-pointer", "check:native-pointer", { requirements: ["node", "native_capability_probe"] }),
  npmEntry("native-live", "check:native-live", { requirements: ["node", "interactive_gui"] }),
  npmEntry("ljqctrl", "check:ljqctrl", { requirements: ["node", "platform_capability_probe"] }),
  npmEntry("optional-live-proofs", "check:optional-live-proofs", { requirements: ["node", "optional_external_proofs"] }),
  npmEntry("optional-live-plan", "plan:optional-live-proofs"),
  npmEntry("optional-live-status", "proof:optional-live-status"),
  commandEntry("managed-baseline-end", ["node", "scripts/check-managed-tab-cleanup.mjs", "--baseline-file", "{managed_baseline}"], { label: "managed tab cleanup finalizer", changed_paths: ["src/tab-workspace/**", "scripts/check-managed-tab-cleanup.mjs"] }),
  commandEntry("npm-audit", ["npm", "audit", "--audit-level=moderate"], { changed_paths: ["package.json", "package-lock.json"], requirements: ["node", "network"] }),
  npmEntry("active-skill-strict", "skills:active:check", { changed_paths: ["skills/**", "scripts/active-skill-sync.mjs"] }),
  npmEntry("remote-cdp", "check:remote-cdp", {
    changed_paths: [
      "src/cdp-runtime/**",
      "src/cdp-runtime/**",
      "src/browser/**",
      "src/server/browser-core/execute-js.mjs",
      "contracts/browser67-live-contract.mjs",
      "contracts/browser67-live-contract/**",
      "contracts/browser67-live-gate.mjs",
      "contracts/browser67-live-gate/**",
      "contracts/browser67-remote-cdp-contract/**",
    ],
    requirements: ["node", "local_chrome"],
  }),
  commandEntry("release-ready", ["node", "scripts/release-readiness.mjs", "--require-clean", "--require-synced", "--require-current-upstreams"], { changed_paths: ["**"], requirements: ["clean_git", "synced_origin_main", "network"] }),
  commandEntry("release-ready-strict", ["node", "scripts/release-readiness.mjs", "--require-clean", "--require-synced", "--require-current-upstreams", "--strict-optional-proofs"], { changed_paths: ["**"], requirements: ["clean_git", "synced_origin_main", "network", "optional_external_proofs"] }),
];

const tiers = {
  fast: {
    purpose: "Fast static and core runtime feedback for local edits.",
    steps: ["lint", "type-check", "dependency-boundaries", "syntax", "core-coverage", "mcp", "browser-runtime", "browser-content-core", "run-store", "job-persistence"],
  },
  check: {
    purpose: "Deterministic repository contracts without requiring a real browser profile.",
    steps: [
      "lint", "type-check", "dependency-boundaries", "syntax", "core-coverage", "mcp", "browser-runtime", "browser-content-core", "run-store", "job-persistence",
      "hub-control", "hub-relay", "doctor-schema", "js-reverse-mcp", "js-reverse-upstream", "js-reverse-upstream-audit-contract",
      "js-reverse-absorption", "active-skill-sync-contract", "skills-roots-audit-contract", "browser67-naming", "runtime-home",
      "project-structure", "change-set-contract", "setup-extension", "extension-build", "extension-managed-runtime", "extension-install-doctor", "performance-smoke",
      "extension-reload-live-contract", "agent-integration-doctor",
      "runtime-cleanup", "task-templates", "regression-matrix", "verification-manifest", "upstream-audit-contract", "upstream-review-contract",
      "upstream-review-refresh-contract", "tmwd-runtime-dispose", "tmwd-transport-health", "extension-bridge",
      "release-readiness-contract",
    ],
  },
  ci: {
    purpose: "Deterministic checks, canonical skill sync, and dependency audit.",
    steps: ["@check", "skills-check", "npm-audit"],
  },
  verify: {
    purpose: "Release-grade local verification with live TMWD gates and managed-tab leak detection.",
    steps: [
      "managed-baseline-start", "extension-upstream-check", "upstream-lock-check", "upstream-audit", "upstream-audit-latest",
      "upstream-review-refresh", "js-reverse-upstream-audit", "skills-active-diff", "skills-roots-audit", "skills-check", "@check",
      "captcha-router", "captcha-provider-jfbym", "captcha-provider-jfbym-setup", "captcha-provider-jfbym-coordinate", "change-set",
      "readiness", "live-doctor", "js-reverse-live", "managed-tab-live", "tmwd-performance-live", "screenshot-live", "auth-live", "captcha-assist-live",
      "native-pointer", "native-live", "ljqctrl", "optional-live-proofs", "optional-live-plan", "optional-live-status",
      "managed-baseline-end", "npm-audit",
    ],
  },
  local: {
    purpose: "Default verify plus strict active-skill drift detection.",
    steps: ["@verify", "active-skill-strict"],
  },
  live: {
    purpose: "Real-browser TMWD behavior without deterministic repository checks.",
    steps: ["live-doctor", "js-reverse-live", "managed-tab-live", "tmwd-performance-live", "auth-live", "captcha-assist-live", "screenshot-live"],
  },
  platform: {
    purpose: "Explicit remote-CDP and native/platform capability gates.",
    steps: ["remote-cdp", "native-pointer", "native-live", "ljqctrl", "optional-live-proofs"],
  },
  all: {
    purpose: "Local release-grade verification plus isolated remote-CDP proof.",
    steps: ["@local", "remote-cdp"],
  },
  release: {
    purpose: "Verify then require a clean, synced checkout and current upstream evidence.",
    steps: ["@verify", "release-ready"],
  },
  "release-strict": {
    purpose: "Release verification with required optional external proofs.",
    steps: ["@verify", "release-ready-strict"],
  },
};

function entryMap() {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

function resolveTier(tier, stack = []) {
  if (!tiers[tier]) throw new Error(`unknown verification tier: ${tier}`);
  if (stack.includes(tier)) throw new Error(`verification tier cycle: ${[...stack, tier].join(" -> ")}`);
  const byId = entryMap();
  const resolved = [];
  const seen = new Set();
  for (const step of tiers[tier].steps) {
    const nested = step.startsWith("@")
      ? resolveTier(step.slice(1), [...stack, tier])
      : [byId.get(step)];
    for (const entry of nested) {
      if (!entry) throw new Error(`verification tier ${tier} references missing entry: ${step}`);
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      resolved.push(entry);
    }
  }
  return resolved;
}

export {
  entries,
  resolveTier,
  tiers,
};
