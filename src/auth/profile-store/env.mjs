import { PROFILE_FILE_EXTENSIONS } from "./constants.mjs";

function parseEnvContent(content) {
  const values = {};
  for (const rawLine of String(content ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const normalizedLine = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equalsIndex = normalizedLine.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = normalizedLine.slice(0, equalsIndex).trim();
    let value = normalizedLine.slice(equalsIndex + 1).trim();
    if (value.startsWith("\"") && value.endsWith("\"")) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function splitList(raw) {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => splitList(item));
  }
  return String(raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function fileBaseProfileId(fileName) {
  let base = fileName;
  for (const extension of PROFILE_FILE_EXTENSIONS) {
    if (base.endsWith(extension)) {
      base = base.slice(0, -extension.length);
      break;
    }
  }
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function envValue(value) {
  return JSON.stringify(String(value ?? ""));
}

function serializeProfileEnv(profile) {
  return [
    `PROFILE_ID=${envValue(profile.profile_id)}`,
    `ALLOWED_ORIGINS=${envValue(profile.allowed_origins.join(","))}`,
    `USERNAME=${envValue(profile.username)}`,
    `PASSWORD=${envValue(profile.password)}`,
    `LOGIN_PATH_PATTERNS=${envValue(profile.login_path_patterns.join(","))}`,
    `USERNAME_SELECTOR=${envValue(profile.username_selector)}`,
    `PASSWORD_SELECTOR=${envValue(profile.password_selector)}`,
    `SUBMIT_SELECTOR=${envValue(profile.submit_selector)}`,
    `SUCCESS_PATH_NOT=${envValue(profile.success_path_not.join(","))}`,
    `SUCCESS_TEXT=${envValue(profile.success_text)}`,
    "",
  ].join("\n");
}

export {
  fileBaseProfileId,
  parseEnvContent,
  serializeProfileEnv,
  splitList,
};
