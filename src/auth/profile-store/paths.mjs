import os from "node:os";
import path from "node:path";

import { createToolError } from "../../runtime/tool-errors.mjs";
import {
  DEFAULT_PROFILE_DIR,
  PROJECT_ROOT,
} from "./constants.mjs";

function expandUserPath(raw) {
  const value = String(raw ?? "").trim();
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function resolveProfileDir(args = {}) {
  return path.resolve(expandUserPath(
    args.profiles_dir
    || process.env.BROWSER_STRUCTURED_LOGIN_PROFILE_DIR
    || DEFAULT_PROFILE_DIR,
  ));
}

function ensureRepoExternalProfileDir(profileDir) {
  const resolved = path.resolve(profileDir);
  const roots = [...new Set([path.resolve(process.cwd()), PROJECT_ROOT])];
  const unsafeRoot = roots.find((root) => {
    const relative = path.relative(root, resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  if (unsafeRoot) {
    throw createToolError("INVALID_ARGUMENT", "login profile directory must be outside the repository", {
      retryable: false,
      details: { reason: "profile_dir_inside_repo", profiles_dir: resolved, blocked_root: unsafeRoot },
    });
  }
  return resolved;
}

export {
  ensureRepoExternalProfileDir,
  expandUserPath,
  resolveProfileDir,
};
