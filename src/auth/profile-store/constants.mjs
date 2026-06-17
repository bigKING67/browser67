import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AUTH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_PROFILE_DIR = path.join(os.homedir(), ".codex", "secrets", "tmwd-login-profiles");
const LEGACY_DATAHUB_PROFILE_PATH = path.join(os.homedir(), ".codex", "secrets", "datahub-groland-login.env");
const PROFILE_FILE_EXTENSIONS = [".env", ".profile"];
const DEFAULT_MAX_PROFILE_FILES = 200;
const PROJECT_ROOT = path.resolve(AUTH_DIR, "..", "..");

export {
  DEFAULT_MAX_PROFILE_FILES,
  DEFAULT_PROFILE_DIR,
  LEGACY_DATAHUB_PROFILE_PATH,
  PROFILE_FILE_EXTENSIONS,
  PROJECT_ROOT,
};
