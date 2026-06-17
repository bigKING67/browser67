import { spawnSync } from "node:child_process";

const GROUPS = [
  {
    id: "auth_profile_lifecycle",
    title: "Refactor auth profile lifecycle",
    description: "Auth profile storage, login detection/submission, handlers, and auth live contracts.",
    commit_message: "Refactor TMWD auth profile lifecycle",
    verification: [
      "npm run check:mcp",
      "npm run check:auth-live",
      "npm run check:change-set",
    ],
    risk_notes: [
      "Exact-origin profile matching and secret redaction must remain intact.",
      "Manual-required CAPTCHA/MFA/SSO/OAuth states must not submit forms repeatedly.",
    ],
    patterns: [
      /^src\/auth\/(handlers|profile-store|login-detect|login-submit|profile-metadata|index)\b/,
      /^contracts\/browser-auth-live-smoke(?:\.mjs|\/)/,
    ],
  },
  {
    id: "captcha_assist",
    title: "Add CAPTCHA assist planning and live contracts",
    description: "CAPTCHA planning, bounded vision correction, physical assist gates, and SOP docs.",
    commit_message: "Add guarded CAPTCHA assist planning",
    verification: [
      "npm run check:auth-live",
      "npm run check:captcha-assist-live",
      "npm run check:ljqctrl",
      "npm run check:change-set",
    ],
    risk_notes: [
      "Default path must stay planning-only and must not move the mouse.",
      "Cross-origin CAPTCHA iframes must degrade to manual handoff.",
      "No JS/CDP CAPTCHA widget clicking or token/cookie extraction.",
    ],
    patterns: [
      /^src\/auth\/(?:captcha|captcha-assist|manual-challenge)\b/,
      /^src\/physical-input\//,
      /^contracts\/browser-captcha-assist(?:-live-smoke|-physical-live-gate)?(?:\.mjs|\/)/,
      /^contracts\/ljqctrl-doctor\.mjs$/,
      /^docs\/ljqCtrl-SOP\.md$/,
    ],
  },
  {
    id: "managed_tab_lifecycle",
    title: "Harden managed tab lifecycle",
    description: "Managed tab workspace registry, finalizer hygiene, and lifecycle live smoke contracts.",
    commit_message: "Harden TMWD managed tab lifecycle",
    verification: [
      "npm run check:mcp",
      "npm run check:managed-tab-live",
      "npm run verify",
      "npm run check:change-set",
    ],
    risk_notes: [
      "User unmanaged tabs must remain ignored by cleanup and reuse flows.",
      "Stale records should be pruned without closing user tabs.",
    ],
    patterns: [
      /^src\/tab-workspace(?:\.mjs|\/)/,
      /^contracts\/browser-managed-tab-live-smoke(?:\.mjs|\/)/,
      /^scripts\/check-managed-tab-cleanup\.mjs$/,
    ],
  },
  {
    id: "browser_mcp_surface",
    title: "Split structured browser MCP surface",
    description: "Structured browser MCP server, wrappers, schemas, and deterministic tool contracts.",
    commit_message: "Split structured browser MCP surface",
    verification: [
      "npm run check:mcp",
      "npm run check",
      "npm run check:change-set",
    ],
    risk_notes: [
      "Tool schemas must remain OpenAI-compatible and avoid top-level anyOf/oneOf.",
      "MCP tool results must keep standard text JSON payloads.",
    ],
    patterns: [
      /^src\/server(?:\.mjs|\/)/,
      /^src\/browser-wrappers(?:\.mjs|\/)/,
      /^src\/tool-schemas(?:\.mjs|\/)/,
      /^contracts\/browser-structured-mcp-contract(?:\.mjs|\/)/,
    ],
  },
  {
    id: "hub_runtime_lifecycle",
    title: "Split hub and TMWD runtime lifecycle",
    description: "TMWD runtime/hub, hub control, live doctor/gates, and runtime dispose contracts.",
    commit_message: "Split TMWD hub runtime lifecycle",
    verification: [
      "npm run check:hub-control",
      "npm run check:hub-relay",
      "npm run check:live:doctor",
      "npm run check:change-set",
    ],
    risk_notes: [
      "One-shot runtime imports must dispose websocket handles.",
      "Hub control contracts must not leave managed hub processes running.",
    ],
    patterns: [
      /^src\/tmwd-runtime(?:\.mjs|\/)/,
      /^src\/tmwd-hub(?:\.mjs|\/)/,
      /^src\/tmwd-hub-control(?:\.mjs|\/)/,
      /^contracts\/browser-structured-mcp-(?:hub-control-contract|hub-relay-contract|live-contract|live-doctor|live-gate)(?:\.mjs|\/)/,
      /^contracts\/tmwd-runtime-dispose-contract\.mjs$/,
    ],
  },
  {
    id: "js_reverse_mcp",
    title: "Split JS reverse MCP server and contracts",
    description: "TMWD-backed JS reverse MCP server, contracts, common RPC helpers, and live gate.",
    commit_message: "Split JS reverse MCP server",
    verification: [
      "npm run check:js-reverse-mcp",
      "npm run check:js-reverse-live",
      "npm run check:change-set",
    ],
    risk_notes: [
      "JS reverse pages created by new_page must remain TMWD-managed.",
      "Hook-first behavior must not pretend debugger callframes are supported.",
    ],
    patterns: [
      /^src\/js-reverse-server(?:\.mjs|\/)/,
      /^contracts\/js-reverse-mcp(?:-common|-contract|-live-gate)?(?:\.mjs|\/)/,
    ],
  },
  {
    id: "native_input",
    title: "Split native input providers and fallback policy",
    description: "Native input capabilities, fallback policy, platform providers, and native setup.",
    commit_message: "Split native input providers",
    verification: [
      "npm run check:mcp",
      "node src/native-deps-setup.mjs --json",
      "npm run check:change-set",
    ],
    risk_notes: [
      "Pointer execution must remain opt-in where required by the calling surface.",
      "macOS, Linux, and Windows providers should keep compatible action payloads.",
    ],
    patterns: [
      /^src\/native-(?:capabilities|core|deps-setup|fallback|input|linux|macos|windows)(?:\.mjs|\/)/,
    ],
  },
  {
    id: "remote_cdp",
    title: "Split explicit remote CDP contract",
    description: "Explicit remote-CDP contract and debug-browser fixture gates.",
    commit_message: "Split remote CDP contract",
    verification: [
      "npm run check:remote-cdp",
      "npm run check:change-set",
    ],
    risk_notes: [
      "Remote CDP must remain explicit and must not silently replace TMWD for login-state tasks.",
    ],
    patterns: [
      /^contracts\/browser-structured-mcp-remote-cdp-contract(?:\.mjs|\/)/,
    ],
  },
  {
    id: "doctor_schema",
    title: "Split browser doctor schema contract",
    description: "Browser doctor JSON schema fixture and validation contract.",
    commit_message: "Split browser doctor schema contract",
    verification: [
      "npm run check:doctor-schema",
      "npm run check:change-set",
    ],
    risk_notes: [
      "Doctor JSON shape is consumed by agents; keep schema enum and required fields stable.",
    ],
    patterns: [
      /^contracts\/browser-doctor-json-schema-contract(?:\.mjs|\/)/,
    ],
  },
  {
    id: "docs_skills_setup",
    title: "Sync docs and TMWD skill guidance",
    description: "README, architecture docs, Codex integration docs, skills, and agent setup.",
    commit_message: "Sync TMWD docs and skill guidance",
    verification: [
      "npm run skills:check",
      "npm run check:change-set",
    ],
    risk_notes: [
      "Docs must preserve managed-tab ownership and CAPTCHA physical-input boundaries.",
    ],
    patterns: [
      /^README\.md$/,
      /^docs\/(?:agent-setup|architecture|codex-integration|global-prompt-snippet|optional-live-proofs)\.md$/,
      /^skills\/tmwd-browser-mcp\//,
    ],
  },
  {
    id: "package_verify_scripts",
    title: "Add verification and change-set governance scripts",
    description: "Package scripts and repository verification orchestration.",
    commit_message: "Add change-set governance gate",
    verification: [
      "npm run check:syntax",
      "npm run check:change-set",
      "npm run verify",
    ],
    risk_notes: [
      "Verification scripts should stay read-only unless explicitly named setup/install commands.",
    ],
    patterns: [
      /^package\.json$/,
      /^scripts\/(?:verify|check-change-set|change-set-lib|plan-scoped-commits|readiness-audit|optional-live-proof-audit|optional-live-proof-plan|optional-live-proof-status|optional-live-proof-template|optional-live-proof-record)\.mjs$/,
    ],
  },
];

const COMMIT_GUIDANCE = [
  "Review and commit by group; do not use `git add -A` for this refactor.",
  "Use scoped `git add <paths...>` and `git diff --cached --check` before each commit.",
  "Keep behavior changes, live contract updates, docs, and verification scripts in reviewable slices.",
];

function readGitStatus() {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git status failed: ${String(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  return result.stdout
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const rawPath = line.slice(3);
      const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) : rawPath;
      return {
        status,
        path,
      };
    });
}

function classifyPath(path) {
  for (const group of GROUPS) {
    if (group.patterns.some((pattern) => pattern.test(path))) {
      return group.id;
    }
  }
  return "ungrouped";
}

function createEmptyGroupBucket(group) {
  return {
    id: group.id,
    title: group.title,
    description: group.description,
    commit_message: group.commit_message,
    verification: [...group.verification],
    risk_notes: [...group.risk_notes],
    count: 0,
    paths: [],
  };
}

function buildChangeSetReport(changes = readGitStatus(), options = {}) {
  const includeEmptyGroups = Boolean(options.include_empty_groups);
  const groups = Object.fromEntries(GROUPS.map((group) => [
    group.id,
    createEmptyGroupBucket(group),
  ]));
  const ungrouped = {
    id: "ungrouped",
    title: "Ungrouped changes",
    description: "Changed paths that do not match the current review/commit grouping contract.",
    count: 0,
    paths: [],
  };

  for (const change of changes) {
    const id = classifyPath(change.path);
    const bucket = groups[id] ?? ungrouped;
    bucket.count += 1;
    bucket.paths.push({
      status: change.status,
      path: change.path,
    });
  }

  return {
    ok: ungrouped.count === 0,
    check: "change-set",
    changed_paths_count: changes.length,
    grouped_paths_count: changes.length - ungrouped.count,
    ungrouped_paths_count: ungrouped.count,
    groups: Object.values(groups).filter((group) => includeEmptyGroups || group.count > 0),
    ungrouped,
    commit_guidance: [...COMMIT_GUIDANCE],
  };
}

function truncateGroup(group, maxItems) {
  return {
    ...group,
    paths: group.paths.slice(0, maxItems),
    returned_count: Math.min(group.paths.length, maxItems),
    truncated: group.paths.length > maxItems,
  };
}

export {
  COMMIT_GUIDANCE,
  GROUPS,
  buildChangeSetReport,
  classifyPath,
  readGitStatus,
  truncateGroup,
};
