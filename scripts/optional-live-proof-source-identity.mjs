import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { extname, relative, resolve } from "node:path";

const OPTIONAL_PROOF_SOURCE_IDENTITY_SCHEMA = "browser67.optional-proof-source.v1";
const PHYSICAL_INPUT_SOURCE_SCOPE = "physical-input-v1";
const DIGEST_ALGORITHM = "sha256-path-normalized-text-v1";
const DEFAULT_REPO_ROOT = resolve(import.meta.dirname, "..");
const TEXT_SOURCE_EXTENSIONS = new Set([".html", ".js", ".json", ".mjs"]);
const PHYSICAL_INPUT_SOURCE_INPUTS = [
  "package.json",
  "package-lock.json",
  "src",
  "extension",
  "scripts/build-extension.mjs",
  "scripts/setup-extension.mjs",
  "scripts/native-live-proof-gate.mjs",
  "scripts/optional-live-proof-audit.mjs",
  "scripts/optional-live-proof-plan.mjs",
  "scripts/optional-live-proof-record.mjs",
  "scripts/optional-live-proof-source-identity.mjs",
  "scripts/optional-live-proof-status.mjs",
  "scripts/optional-live-proof-template.mjs",
  "contracts/browser-captcha-assist-live-smoke.mjs",
  "contracts/browser-captcha-assist-live-smoke",
  "contracts/browser-captcha-assist-physical-live-gate.mjs",
  "contracts/browser-captcha-assist-physical-live-gate",
];

const SOURCE_SCOPE_INPUTS = new Map([
  [PHYSICAL_INPUT_SOURCE_SCOPE, PHYSICAL_INPUT_SOURCE_INPUTS],
]);

function normalizedRelativePath(repoRoot, path) {
  return relative(repoRoot, path).replaceAll("\\", "/");
}

function isTextSourceFile(path) {
  return TEXT_SOURCE_EXTENSIONS.has(extname(path).toLowerCase());
}

function listInputFiles(repoRoot, inputs) {
  const files = [];
  const walk = (path) => {
    if (!existsSync(path)) {
      throw new Error(`optional proof source input is missing: ${normalizedRelativePath(repoRoot, path)}`);
    }
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.name === ".DS_Store") continue;
        walk(resolve(path, entry.name));
      }
      return;
    }
    if (stat.isFile() && isTextSourceFile(path)) {
      files.push(normalizedRelativePath(repoRoot, path));
    }
  };
  for (const input of inputs) {
    walk(resolve(repoRoot, input));
  }
  return [...new Set(files)].sort();
}

function normalizedTextContent(path) {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function digestSourceFiles(repoRoot, files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(normalizedTextContent(resolve(repoRoot, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function tryGit(repoRoot, args) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function resolveBuildRevision(repoRoot, packageJson) {
  const environmentRevision = String(
    process.env.BROWSER67_PROOF_BUILD_REVISION
    ?? process.env.GITHUB_SHA
    ?? "",
  ).trim();
  if (environmentRevision) {
    return { revision: environmentRevision, source: "environment" };
  }
  const gitRevision = tryGit(repoRoot, ["rev-parse", "HEAD"]);
  if (gitRevision) {
    return { revision: gitRevision, source: "git" };
  }
  const packageRevision = String(packageJson.gitHead ?? "").trim();
  if (packageRevision) {
    return { revision: packageRevision, source: "package_git_head" };
  }
  return {
    revision: `version:${String(packageJson.version ?? "unknown")}`,
    source: "package_version",
  };
}

function sourceInputsDirty(repoRoot, inputs) {
  const status = tryGit(repoRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...inputs,
  ]);
  return Boolean(status);
}

function buildOptionalProofSourceIdentity(scope = PHYSICAL_INPUT_SOURCE_SCOPE, options = {}) {
  const repoRoot = resolve(options.repo_root ?? DEFAULT_REPO_ROOT);
  const inputs = SOURCE_SCOPE_INPUTS.get(scope);
  if (!inputs) {
    throw new Error(`unknown optional proof source scope: ${scope}`);
  }
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const files = listInputFiles(repoRoot, inputs);
  const revision = resolveBuildRevision(repoRoot, packageJson);
  return {
    schema: OPTIONAL_PROOF_SOURCE_IDENTITY_SCHEMA,
    source_scope: scope,
    digest_algorithm: DIGEST_ALGORITHM,
    project_version: String(packageJson.version ?? "unknown"),
    build_revision: revision.revision,
    build_revision_source: revision.source,
    build_inputs_dirty: sourceInputsDirty(repoRoot, inputs),
    source_digest: digestSourceFiles(repoRoot, files),
    source_file_count: files.length,
  };
}

export {
  DIGEST_ALGORITHM,
  OPTIONAL_PROOF_SOURCE_IDENTITY_SCHEMA,
  PHYSICAL_INPUT_SOURCE_SCOPE,
  buildOptionalProofSourceIdentity,
  digestSourceFiles,
};
