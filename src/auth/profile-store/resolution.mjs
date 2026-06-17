import { normalizeOrigin } from "./validation.mjs";

function findProfileById(profiles, profileId) {
  const normalized = String(profileId ?? "").trim();
  if (!normalized || normalized === "auto") {
    return null;
  }
  return profiles.find((profile) => profile.profile_id === normalized) ?? null;
}

function findProfileByOrigin(profiles, origin) {
  const normalizedOrigin = normalizeOrigin(origin);
  return profiles.find((profile) => profile.allowed_origins.includes(normalizedOrigin)) ?? null;
}

function resolveProfileForOrigin(profiles, args, origin) {
  const requestedProfileId = String(args?.profile_id ?? "auto").trim() || "auto";
  const explicit = requestedProfileId !== "auto" ? findProfileById(profiles, requestedProfileId) : null;
  if (requestedProfileId !== "auto" && !explicit) {
    return {
      profile: null,
      blocked_reason: "profile_not_found",
      requested_profile_id: requestedProfileId,
    };
  }
  const profile = explicit ?? findProfileByOrigin(profiles, origin);
  if (!profile) {
    return {
      profile: null,
      blocked_reason: "no_matching_login_profile",
      requested_profile_id: requestedProfileId,
    };
  }
  const normalizedOrigin = normalizeOrigin(origin);
  if (!profile.allowed_origins.includes(normalizedOrigin)) {
    return {
      profile,
      blocked_reason: "origin_not_allowed_for_profile",
      requested_profile_id: requestedProfileId,
    };
  }
  return {
    profile,
    blocked_reason: "",
    requested_profile_id: requestedProfileId,
  };
}

export {
  findProfileById,
  findProfileByOrigin,
  resolveProfileForOrigin,
};
