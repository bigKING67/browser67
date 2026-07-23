import { createToolError } from "../../runtime/tool-errors.mjs";
import { splitList } from "./env.mjs";

function normalizeOrigin(raw) {
  try {
    return new URL(String(raw ?? "").trim()).origin;
  } catch {
    return "";
  }
}

function validateExactHttpOrigin(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return { ok: false, origin: "", reason: "missing_origin" };
  }
  if (value.includes("*")) {
    return { ok: false, origin: "", reason: "wildcard_origin_not_allowed" };
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, origin: "", reason: "invalid_origin" };
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, origin: "", reason: "origin_protocol_not_allowed" };
  }
  return { ok: true, origin: url.origin, reason: "" };
}

function normalizePathPattern(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return "";
  }
  return value.startsWith("/") ? value : `/${value}`;
}

function sanitizeProfileId(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    throw createToolError("INVALID_ARGUMENT", "profile_id is required", {
      retryable: false,
      details: { reason: "missing_profile_id" },
    });
  }
  if (value === "." || value === ".." || !/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw createToolError("INVALID_ARGUMENT", "profile_id must use only letters, numbers, dot, underscore, and dash", {
      retryable: false,
      details: { reason: "invalid_profile_id" },
    });
  }
  return value;
}

function profileIdFromOrigin(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return "login-profile";
  }
  const url = new URL(normalized);
  const port = url.port ? `-${url.port}` : "";
  const raw = `${url.hostname}${port}`.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return raw.replace(/^-+|-+$/g, "").slice(0, 96) || "login-profile";
}

function normalizeProfile(rawProfile) {
  const profileId = String(rawProfile.profile_id ?? "").trim();
  if (!profileId) {
    return null;
  }
  const allowedOrigins = splitList(rawProfile.allowed_origins)
    .map((origin) => normalizeOrigin(origin))
    .filter((origin) => origin.length > 0);
  const loginPathPatterns = splitList(rawProfile.login_path_patterns)
    .map((item) => normalizePathPattern(item))
    .filter((item) => item.length > 0);
  const successPathNot = splitList(rawProfile.success_path_not)
    .map((item) => normalizePathPattern(item))
    .filter((item) => item.length > 0);
  const normalizedLoginPathPatterns = loginPathPatterns.length > 0 ? loginPathPatterns : ["/login"];
  return {
    profile_id: profileId,
    source: String(rawProfile.source ?? "profile_env"),
    source_path: String(rawProfile.source_path ?? ""),
    file_mode: rawProfile.file_mode,
    insecure_file_permissions: rawProfile.insecure_file_permissions === true,
    allowed_origins: [...new Set(allowedOrigins)],
    login_path_patterns: normalizedLoginPathPatterns,
    username_selector: String(rawProfile.username_selector ?? "#username").trim() || "#username",
    password_selector: String(rawProfile.password_selector ?? "#password").trim() || "#password",
    submit_selector: String(rawProfile.submit_selector ?? "button[type=\"submit\"]").trim() || "button[type=\"submit\"]",
    success_path_not: successPathNot.length > 0 ? successPathNot : normalizedLoginPathPatterns,
    success_text: String(rawProfile.success_text ?? "").trim(),
    lifecycle: rawProfile.lifecycle && typeof rawProfile.lifecycle === "object" ? rawProfile.lifecycle : {},
    username: String(rawProfile.username ?? ""),
    password: String(rawProfile.password ?? ""),
  };
}

function statModePayload(stat) {
  if (!stat) {
    return { mode: undefined, insecure: false };
  }
  const mode = stat.mode & 0o777;
  return {
    mode: mode.toString(8).padStart(3, "0"),
    insecure: (mode & 0o077) !== 0,
  };
}

function validateProfileShape(profile) {
  const errors = [];
  const warnings = [];
  if (!profile.profile_id) {
    errors.push("missing_profile_id");
  }
  if (!Array.isArray(profile.allowed_origins) || profile.allowed_origins.length === 0) {
    errors.push("missing_allowed_origins");
  }
  if (!profile.username) {
    errors.push("missing_username");
  }
  if (!profile.password) {
    errors.push("missing_password");
  }
  if (!profile.username_selector) {
    errors.push("missing_username_selector");
  }
  if (!profile.password_selector) {
    errors.push("missing_password_selector");
  }
  if (!profile.submit_selector) {
    warnings.push("missing_submit_selector");
  }
  if (profile.insecure_file_permissions === true) {
    warnings.push("profile_file_permissions_are_not_private");
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function pathMatchesPattern(pathname, pattern) {
  const normalizedPath = normalizePathPattern(pathname);
  const normalizedPattern = normalizePathPattern(pattern);
  if (!normalizedPattern) {
    return false;
  }
  return normalizedPath === normalizedPattern
    || normalizedPath.startsWith(`${normalizedPattern}/`);
}

function pathMatchesAny(pathname, patterns) {
  return (Array.isArray(patterns) ? patterns : []).some((pattern) => pathMatchesPattern(pathname, pattern));
}

export {
  normalizeOrigin,
  normalizePathPattern,
  normalizeProfile,
  pathMatchesAny,
  profileIdFromOrigin,
  sanitizeProfileId,
  statModePayload,
  validateExactHttpOrigin,
  validateProfileShape,
};
