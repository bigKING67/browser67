import { writeProfileMetadata } from "../profile-metadata.mjs";
import {
  buildProfileFromUpsertArgs,
  findProfileById,
  findProfileByOrigin,
  loadLoginProfiles,
  redactProfile,
  resolveProfileForOrigin,
  validateExactHttpOrigin,
  validateProfileShape,
  writeProfileAtomic,
} from "../profile-store.mjs";
import {
  detectLoginFromUrl,
  detectLoginPage,
  inspectCurrentPage,
  makeSuggestedProfile,
  manualRequirementFields,
  manualRequirementFromPageState,
  parseUrlState,
  publicAuthSurfaceFields,
  publicChallengeFields,
  suggestProfileFromCurrentPage,
} from "../login-detect.mjs";
import { pageStateWithPage } from "./shared.mjs";

async function handleListProfiles(args) {
  const loaded = await loadLoginProfiles(args);
  const profiles = loaded.profiles.map((profile) => ({
    ...redactProfile(profile),
    validation: validateProfileShape(profile),
  }));
  return {
    status: "success",
    action: "list_profiles",
    profiles_dir: loaded.profiles_dir,
    legacy_profile_path: loaded.legacy_profile_path,
    profile_count: profiles.length,
    profiles,
    secrets_redacted: true,
  };
}

async function handleValidateProfile(args) {
  const loaded = await loadLoginProfiles(args);
  const urlState = args?.url ? parseUrlState(args.url) : null;
  const profileId = String(args?.profile_id ?? "").trim();
  if (profileId && profileId !== "auto") {
    const profile = findProfileById(loaded.profiles, profileId);
    const originAllowed = !urlState?.origin || (profile?.allowed_origins ?? []).includes(urlState.origin);
    const matchedProfiles = profile ? [profile] : [];
    return {
      status: profile && originAllowed ? "success" : "blocked",
      action: "validate_profile",
      reason: profile
        ? (originAllowed ? "matched" : "origin_not_allowed_for_profile")
        : "profile_not_found",
      url: urlState?.url,
      origin: urlState?.origin,
      profiles: matchedProfiles.map((entry) => ({
        ...redactProfile(entry),
        validation: validateProfileShape(entry),
      })),
      secrets_redacted: true,
    };
  }

  let profiles = loaded.profiles;
  if (urlState?.origin) {
    const matched = findProfileByOrigin(profiles, urlState.origin);
    profiles = matched ? [matched] : [];
  }
  return {
    status: profiles.length > 0 ? "success" : "blocked",
    action: "validate_profile",
    reason: profiles.length > 0 ? "matched" : "no_matching_login_profile",
    url: urlState?.url,
    origin: urlState?.origin,
    profiles: profiles.map((profile) => ({
      ...redactProfile(profile),
      validation: validateProfileShape(profile),
    })),
    secrets_redacted: true,
  };
}

async function handleInspectLoginPage(args) {
  const loaded = await loadLoginProfiles(args);
  if (args?.dry_run === true && args?.url) {
    const urlState = parseUrlState(args.url);
    const resolved = resolveProfileForOrigin(loaded.profiles, args, urlState.origin);
    const detection = detectLoginFromUrl(args.url, resolved.profile);
    return {
      status: "success",
      action: "inspect_login_page",
      dry_run: true,
      url: urlState.url,
      origin: urlState.origin,
      profile: resolved.profile ? redactProfile(resolved.profile) : undefined,
      blocked_reason: resolved.blocked_reason || undefined,
      ...detection,
      secrets_redacted: true,
    };
  }
  const firstState = await inspectCurrentPage(args, null);
  const resolved = resolveProfileForOrigin(loaded.profiles, args, firstState.origin);
  const profile = resolved.profile;
  const pageState = profile ? await inspectCurrentPage(args, profile) : firstState;
  const detection = detectLoginPage(pageState, profile);
  const manualReason = manualRequirementFromPageState(pageState);
  return {
    status: "success",
    action: "inspect_login_page",
    url: pageState.url,
    origin: pageState.origin,
    pathname: pageState.pathname,
    title: pageState.title,
    transport: pageState.transport,
    transport_attempts: pageState.transport_attempts,
    page: pageState.page,
    profile: profile ? redactProfile(profile) : undefined,
    blocked_reason: resolved.blocked_reason || undefined,
    ...detection,
    profile_selectors: pageState.profile_selectors,
    password_input_count: pageState.password_input_count,
    username_like_input_count: pageState.username_like_input_count,
    mfa_input_count: pageState.mfa_input_count,
    ...publicChallengeFields(pageState),
    mfa_detected: pageState.mfa_detected === true,
    ...publicAuthSurfaceFields(pageState),
    manual_required_reason: manualReason || undefined,
    ...manualRequirementFields(manualReason, pageStateWithPage(pageState, pageState.page), args),
    secrets_redacted: true,
  };
}

async function handleSuggestProfile(args) {
  if (args?.dry_run === true && args?.url) {
    const urlState = parseUrlState(args.url);
    const originValidation = validateExactHttpOrigin(urlState.origin);
    if (!originValidation.ok) {
      return {
        status: "blocked",
        action: "suggest_profile",
        dry_run: true,
        reason: originValidation.reason,
        url: urlState.url,
        origin: urlState.origin,
        secrets_redacted: true,
      };
    }
    const suggestion = makeSuggestedProfile({
      origin: urlState.origin,
      pathname: urlState.pathname || "/login",
      username_selector: args?.username_selector || "#username",
      password_selector: args?.password_selector || "#password",
      submit_selector: args?.submit_selector || "button[type=\"submit\"]",
    }, args);
    return {
      status: "success",
      action: "suggest_profile",
      dry_run: true,
      url: urlState.url,
      origin: urlState.origin,
      profile: redactProfile(suggestion.profile),
      confidence: suggestion.confidence,
      secrets_redacted: true,
    };
  }

  const pageState = await suggestProfileFromCurrentPage(args);
  const originValidation = validateExactHttpOrigin(pageState.origin);
  if (!originValidation.ok) {
    return {
      status: "blocked",
      action: "suggest_profile",
      reason: originValidation.reason,
      url: pageState.url,
      origin: pageState.origin,
      pathname: pageState.pathname,
      title: pageState.title,
      transport: pageState.transport,
      transport_attempts: pageState.transport_attempts,
      page: pageState.page,
      secrets_redacted: true,
    };
  }
  const suggestion = makeSuggestedProfile(pageState, args);
  const manualReason = manualRequirementFromPageState(pageState);
  return {
    status: "success",
    action: "suggest_profile",
    url: pageState.url,
    origin: pageState.origin,
    pathname: pageState.pathname,
    title: pageState.title,
    transport: pageState.transport,
    transport_attempts: pageState.transport_attempts,
    page: pageState.page,
    profile: redactProfile(suggestion.profile),
    confidence: suggestion.confidence,
    ...publicChallengeFields(pageState),
    mfa_detected: pageState.mfa_detected === true,
    mfa_input_count: pageState.mfa_input_count,
    ...publicAuthSurfaceFields(pageState),
    manual_required_reason: manualReason || undefined,
    ...manualRequirementFields(manualReason, pageStateWithPage(pageState, pageState.page), args),
    form_detected: pageState.form_detected === true,
    password_input_count: pageState.password_input_count,
    username_like_input_count: pageState.username_like_input_count,
    secrets_redacted: true,
  };
}

async function handleUpsertProfile(args) {
  const profile = buildProfileFromUpsertArgs(args);
  const writeResult = await writeProfileAtomic(args, profile);
  const lifecycle = await writeProfileMetadata(writeResult.filePath, {
    profile_id: profile.profile_id,
    last_status: "saved",
    last_reason: writeResult.created ? "created" : "updated",
  });
  const storedProfile = {
    ...profile,
    source: "profile_env",
    source_path: writeResult.filePath,
    file_mode: writeResult.file_mode,
    insecure_file_permissions: writeResult.insecure_file_permissions,
    lifecycle,
  };
  return {
    status: "success",
    action: "upsert_profile",
    created: writeResult.created,
    updated: writeResult.updated,
    profile: redactProfile(storedProfile),
    secrets_redacted: true,
  };
}

export {
  handleInspectLoginPage,
  handleListProfiles,
  handleSuggestProfile,
  handleUpsertProfile,
  handleValidateProfile,
};
