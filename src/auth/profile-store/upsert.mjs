import { createToolError } from "../../errors.mjs";
import { splitList } from "./env.mjs";
import {
  normalizePathPattern,
  normalizeProfile,
  sanitizeProfileId,
  validateExactHttpOrigin,
  validateProfileShape,
} from "./validation.mjs";

function buildProfileFromUpsertArgs(args) {
  const profileId = sanitizeProfileId(args?.profile_id);
  const originInputs = splitList(args?.allowed_origins ?? args?.allowed_origin ?? args?.origin);
  const normalizedOrigins = [];
  for (const rawOrigin of originInputs) {
    const validation = validateExactHttpOrigin(rawOrigin);
    if (!validation.ok) {
      throw createToolError("INVALID_ARGUMENT", `invalid allowed origin: ${validation.reason}`, {
        retryable: false,
        details: { reason: validation.reason, origin: String(rawOrigin ?? "") },
      });
    }
    normalizedOrigins.push(validation.origin);
  }
  const uniqueOrigins = [...new Set(normalizedOrigins)];
  if (uniqueOrigins.length === 0) {
    throw createToolError("INVALID_ARGUMENT", "origin or allowed_origins is required", {
      retryable: false,
      details: { reason: "missing_allowed_origins" },
    });
  }

  const loginPathPatterns = splitList(args?.login_path_patterns ?? args?.login_path_pattern)
    .map((item) => normalizePathPattern(item))
    .filter((item) => item.length > 0);
  const successPathNot = splitList(args?.success_path_not)
    .map((item) => normalizePathPattern(item))
    .filter((item) => item.length > 0);
  const username = String(args?.username ?? "");
  const password = String(args?.password ?? "");
  const profile = normalizeProfile({
    profile_id: profileId,
    source: "profile_env",
    allowed_origins: uniqueOrigins,
    username,
    password,
    login_path_patterns: loginPathPatterns.length > 0 ? loginPathPatterns : ["/login"],
    username_selector: args?.username_selector,
    password_selector: args?.password_selector,
    submit_selector: args?.submit_selector,
    success_path_not: successPathNot,
    success_text: args?.success_text,
  });
  const validation = validateProfileShape(profile);
  if (!validation.valid) {
    throw createToolError("INVALID_ARGUMENT", "profile is missing required login fields", {
      retryable: false,
      details: { reason: "profile_invalid", validation },
    });
  }
  return profile;
}

export {
  buildProfileFromUpsertArgs,
};
