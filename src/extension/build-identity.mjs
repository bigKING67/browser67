import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { relative, resolve } from "node:path";

const EXTENSION_IDENTITY_SCHEMA = "browser67.extension-identity.v1";
const EXTENSION_HANDSHAKE_PROTOCOL_REVISION = 1;

function listExtensionSourceFiles(rootDir) {
  const files = [];
  function walk(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const absolute = resolve(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile() || entry.name === ".DS_Store") continue;
      files.push(relative(rootDir, absolute).replaceAll("\\", "/"));
    }
  }
  walk(rootDir);
  return files.sort();
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function digestExtensionBundle(targetDir, bundleFiles) {
  const hash = createHash("sha256");
  for (const relativePath of [...bundleFiles].sort()) {
    const absolute = resolve(targetDir, relativePath);
    if (!existsSync(absolute)) {
      throw new Error(`missing generated extension bundle file: ${relativePath}`);
    }
    hash.update(relativePath);
    hash.update("\0");
    hash.update(sha256File(absolute));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function normalizeManifestVersion(version) {
  const numericCore = String(version ?? "")
    .trim()
    .split("-", 1)[0]
    .split("+")[0];
  const components = numericCore.split(".");
  if (
    components.length < 1
    || components.length > 4
    || components.some((part) => !/^\d+$/.test(part) || Number(part) > 65535)
  ) {
    throw new Error(`package version cannot be used as a Chrome extension version: ${String(version)}`);
  }
  return components.map((part) => String(Number(part))).join(".");
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
    process.env.BROWSER67_EXTENSION_BUILD_REVISION
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
  return { revision: `version:${String(packageJson.version ?? "unknown")}`, source: "package_version" };
}

function extensionBuildInputsDirty(repoRoot) {
  return Boolean(tryGit(repoRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    "extension",
    "src/browser/execution",
    "src/extension",
    "scripts/build-extension.mjs",
    "package.json",
    "package-lock.json",
  ]));
}

function createExtensionBuildIdentity({ repoRoot, targetDir, bundleFiles, manifestVersion }) {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const revision = resolveBuildRevision(repoRoot, packageJson);
  return {
    schema: EXTENSION_IDENTITY_SCHEMA,
    product: "browser67",
    extension_version: String(packageJson.version),
    manifest_version: String(manifestVersion),
    build_revision: revision.revision,
    build_revision_source: revision.source,
    build_inputs_dirty: extensionBuildInputsDirty(repoRoot),
    source_digest: digestExtensionBundle(targetDir, bundleFiles),
    protocol_revision: EXTENSION_HANDSHAKE_PROTOCOL_REVISION,
  };
}

function extensionBuildIdentityJavaScript(identity) {
  return `globalThis.__browser67BuildIdentity = Object.freeze(${JSON.stringify(identity)});\n`;
}

function extensionBuildIdentityJson(identity) {
  return `${JSON.stringify(identity, null, 2)}\n`;
}

export {
  EXTENSION_HANDSHAKE_PROTOCOL_REVISION,
  EXTENSION_IDENTITY_SCHEMA,
  createExtensionBuildIdentity,
  digestExtensionBundle,
  extensionBuildIdentityJavaScript,
  extensionBuildIdentityJson,
  listExtensionSourceFiles,
  normalizeManifestVersion,
};
