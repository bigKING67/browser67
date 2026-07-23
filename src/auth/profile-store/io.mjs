import { promises as fs } from "node:fs";
import path from "node:path";

import { createToolError } from "../../runtime/tool-errors.mjs";
import { readProfileMetadata } from "../profile-metadata.mjs";
import {
  DEFAULT_MAX_PROFILE_FILES,
  LEGACY_DATAHUB_PROFILE_PATH,
  PROFILE_FILE_EXTENSIONS,
} from "./constants.mjs";
import {
  fileBaseProfileId,
  parseEnvContent,
  serializeProfileEnv,
} from "./env.mjs";
import {
  ensureRepoExternalProfileDir,
  resolveProfileDir,
} from "./paths.mjs";
import {
  normalizeProfile,
  statModePayload,
} from "./validation.mjs";

function profileFromGenericEnv(filePath, fileName, env, stat) {
  const mode = statModePayload(stat);
  return normalizeProfile({
    profile_id: env.PROFILE_ID || fileBaseProfileId(fileName),
    source: "profile_env",
    source_path: filePath,
    file_mode: mode.mode,
    insecure_file_permissions: mode.insecure,
    allowed_origins: env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN,
    username: env.USERNAME || env.LOGIN_USERNAME,
    password: env.PASSWORD || env.LOGIN_PASSWORD,
    login_path_patterns: env.LOGIN_PATH_PATTERNS || env.LOGIN_PATH_PATTERN || env.LOGIN_URL_PATTERN,
    username_selector: env.USERNAME_SELECTOR,
    password_selector: env.PASSWORD_SELECTOR,
    submit_selector: env.SUBMIT_SELECTOR,
    success_path_not: env.SUCCESS_PATH_NOT || env.SUCCESS_PATH_NOTS,
    success_text: env.SUCCESS_TEXT,
  });
}

function profileFromLegacyDatahub(filePath, env, stat) {
  const mode = statModePayload(stat);
  return normalizeProfile({
    profile_id: "datahub-groland",
    source: "legacy_datahub_env",
    source_path: filePath,
    file_mode: mode.mode,
    insecure_file_permissions: mode.insecure,
    allowed_origins: env.DATAHUB_GROLAND_ALLOWED_ORIGINS,
    username: env.DATAHUB_GROLAND_USERNAME,
    password: env.DATAHUB_GROLAND_PASSWORD,
    login_path_patterns: "/login",
    username_selector: "#username",
    password_selector: "#password",
    submit_selector: "button[type=\"submit\"]",
    success_path_not: "/login",
  });
}

async function maybeReadEnvFile(filePath) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) {
    return null;
  }
  const content = await fs.readFile(filePath, "utf8");
  return {
    env: parseEnvContent(content),
    stat,
  };
}

async function loadLoginProfiles(args = {}) {
  const profiles = new Map();
  const legacy = await maybeReadEnvFile(LEGACY_DATAHUB_PROFILE_PATH);
  if (legacy) {
    const profile = profileFromLegacyDatahub(LEGACY_DATAHUB_PROFILE_PATH, legacy.env, legacy.stat);
    if (profile) {
      profiles.set(profile.profile_id, profile);
    }
  }

  const profilesDir = resolveProfileDir(args);
  try {
    const entries = await fs.readdir(profilesDir, { withFileTypes: true });
    const profileFileEntries = entries
      .filter((entry) => entry.isFile() && PROFILE_FILE_EXTENSIONS.some((extension) => entry.name.endsWith(extension)))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (profileFileEntries.length > DEFAULT_MAX_PROFILE_FILES) {
      throw createToolError("INVALID_ARGUMENT", "too many login profile files", {
        retryable: false,
        details: {
          reason: "too_many_profile_files",
          profiles_dir: profilesDir,
          profile_file_count: profileFileEntries.length,
          max_profile_files: DEFAULT_MAX_PROFILE_FILES,
        },
      });
    }
    const parsedProfiles = await Promise.all(profileFileEntries.map(async (entry) => {
      const filePath = path.join(profilesDir, entry.name);
      const parsed = await maybeReadEnvFile(filePath);
      if (!parsed) {
        return null;
      }
      const profile = profileFromGenericEnv(filePath, entry.name, parsed.env, parsed.stat);
      if (profile) {
        profile.lifecycle = await readProfileMetadata(filePath);
      }
      return profile;
    }));
    for (const profile of parsedProfiles) {
      if (profile) {
        profiles.set(profile.profile_id, profile);
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  return {
    profiles: [...profiles.values()],
    profiles_dir: profilesDir,
    legacy_profile_path: LEGACY_DATAHUB_PROFILE_PATH,
  };
}

async function writeProfileAtomic(args, profile) {
  if (args?.confirm_write !== true) {
    throw createToolError("INVALID_ARGUMENT", "confirm_write=true is required to save login credentials", {
      retryable: false,
      details: { reason: "confirm_write_required" },
    });
  }
  const profilesDir = ensureRepoExternalProfileDir(resolveProfileDir(args));
  const filePath = path.join(profilesDir, `${profile.profile_id}.env`);
  const relative = path.relative(profilesDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw createToolError("INVALID_ARGUMENT", "profile path must stay within the profile directory", {
      retryable: false,
      details: { reason: "profile_path_escape" },
    });
  }

  let existingStat = null;
  try {
    existingStat = await fs.stat(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  if (existingStat && args?.overwrite !== true) {
    throw createToolError("INVALID_ARGUMENT", "profile already exists; pass overwrite=true to update it", {
      retryable: false,
      details: { reason: "profile_exists", profile_id: profile.profile_id },
    });
  }

  await fs.mkdir(profilesDir, { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(profilesDir, 0o700);
  } catch {
    // Best effort on filesystems that do not support POSIX mode changes.
  }
  const tmpPath = path.join(
    profilesDir,
    `.${profile.profile_id}.${process.pid}.${Date.now()}.${Math.floor(Math.random() * 1_000_000)}.tmp`,
  );
  try {
    await fs.writeFile(tmpPath, serializeProfileEnv(profile), { mode: 0o600 });
    try {
      await fs.chmod(tmpPath, 0o600);
    } catch {
      // Best effort on non-POSIX filesystems.
    }
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true });
    throw error;
  }
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // Best effort on non-POSIX filesystems.
  }
  const finalStat = await fs.stat(filePath);
  const mode = statModePayload(finalStat);
  return {
    filePath,
    created: !existingStat,
    updated: Boolean(existingStat),
    file_mode: mode.mode,
    insecure_file_permissions: mode.insecure,
  };
}

export {
  loadLoginProfiles,
  maybeReadEnvFile,
  profileFromGenericEnv,
  profileFromLegacyDatahub,
  writeProfileAtomic,
};
