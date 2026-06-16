import { createToolError } from "../errors.mjs";
import { writeProfileMetadata } from "./profile-metadata.mjs";
import {
  buildProfileFromUpsertArgs,
  findProfileById,
  findProfileByOrigin,
  lifecycleMetadataWasUpdated,
  loadLoginProfiles,
  redactProfile,
  recordProfileAuthLifecycle,
  resolveProfileForOrigin,
  validateExactHttpOrigin,
  validateProfileShape,
  writeProfileAtomic,
} from "./profile-store.mjs";
import {
  detectLoginFromUrl,
  detectLoginPage,
  inspectCurrentPage,
  makeSuggestedProfile,
  manualRequirementFields,
  manualRequirementFromPageState,
  parseUrlState,
  suggestProfileFromCurrentPage,
} from "./login-detect.mjs";
import { submitLoginForm } from "./login-submit.mjs";

function normalizeAction(args, supported) {
  const action = String(args?.action ?? "").trim().toLowerCase();
  if (!action) {
    throw createToolError("INVALID_ARGUMENT", "action is required", {
      details: { supported_actions: supported },
    });
  }
  if (!supported.includes(action)) {
    throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${action}`, {
      details: { supported_actions: supported },
    });
  }
  return action;
}

function pageStateWithPage(pageState, page) {
  return {
    ...(pageState ?? {}),
    page: pageState?.page ?? page,
  };
}

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
    captcha_detected: pageState.captcha_detected === true,
    mfa_detected: pageState.mfa_detected === true,
    sso_detected: pageState.sso_detected === true,
    oauth_popup_detected: pageState.oauth_popup_detected === true,
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
    captcha_detected: pageState.captcha_detected === true,
    mfa_detected: pageState.mfa_detected === true,
    mfa_input_count: pageState.mfa_input_count,
    sso_detected: pageState.sso_detected === true,
    oauth_popup_detected: pageState.oauth_popup_detected === true,
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

async function handleEnsureLogin(args) {
  const loaded = await loadLoginProfiles(args);
  if (args?.dry_run === true && args?.url) {
    const urlState = parseUrlState(args.url);
    const genericDetection = detectLoginFromUrl(args.url, null);
    if (!genericDetection.login_detected) {
      return {
        status: "success",
        action: "ensure_login",
        dry_run: true,
        already_authenticated: true,
        submitted: false,
        would_submit: false,
        reason: "profile_missing_but_not_needed",
        url: urlState.url,
        origin: urlState.origin,
        ...genericDetection,
        secrets_redacted: true,
      };
    }
    const resolved = resolveProfileForOrigin(loaded.profiles, args, urlState.origin);
    const detection = detectLoginFromUrl(args.url, resolved.profile);
    const canSubmit = Boolean(resolved.profile && !resolved.blocked_reason && detection.login_detected);
    return {
      status: canSubmit ? "success" : "blocked",
      action: "ensure_login",
      dry_run: true,
      would_submit: canSubmit,
      reason: resolved.blocked_reason || (detection.login_detected ? "would_submit" : "login_not_detected"),
      url: urlState.url,
      origin: urlState.origin,
      profile: resolved.profile ? redactProfile(resolved.profile) : undefined,
      ...detection,
      secrets_redacted: true,
    };
  }

  const firstState = await inspectCurrentPage(args, null);
  const genericDetection = detectLoginPage(firstState, null);
  if (!genericDetection.login_detected) {
    const optionalResolved = resolveProfileForOrigin(loaded.profiles, args, firstState.origin);
    const optionalProfile = optionalResolved.blocked_reason ? null : optionalResolved.profile;
    const lifecycle = optionalProfile
      ? await recordProfileAuthLifecycle(optionalProfile, {
        last_used_at: new Date().toISOString(),
        last_validated_at: new Date().toISOString(),
        last_status: "success",
        last_reason: "already_authenticated",
        last_origin: firstState.origin,
        last_path: firstState.pathname,
      })
      : {};
    return {
      status: "success",
      action: "ensure_login",
      already_authenticated: true,
      submitted: false,
      reason: optionalProfile ? "already_authenticated" : "profile_missing_but_not_needed",
      url: firstState.url,
      origin: firstState.origin,
      pathname: firstState.pathname,
      title: firstState.title,
      transport: firstState.transport,
      transport_attempts: firstState.transport_attempts,
      page: firstState.page,
      profile: optionalProfile ? redactProfile({ ...optionalProfile, lifecycle: { ...optionalProfile.lifecycle, ...lifecycle } }) : undefined,
      ...genericDetection,
      metadata_updated: lifecycleMetadataWasUpdated(lifecycle),
      secrets_redacted: true,
    };
  }

  const firstManualRequiredReason = manualRequirementFromPageState(firstState);
  if (firstManualRequiredReason) {
    return {
      status: "blocked",
      action: "ensure_login",
      reason: firstManualRequiredReason,
      submitted: false,
      url: firstState.url,
      origin: firstState.origin,
      pathname: firstState.pathname,
      title: firstState.title,
      transport: firstState.transport,
      transport_attempts: firstState.transport_attempts,
      page: firstState.page,
      ...genericDetection,
      captcha_detected: firstState.captcha_detected === true,
      mfa_detected: firstState.mfa_detected === true,
      mfa_input_count: firstState.mfa_input_count,
      sso_detected: firstState.sso_detected === true,
      oauth_popup_detected: firstState.oauth_popup_detected === true,
      ...manualRequirementFields(firstManualRequiredReason, pageStateWithPage(firstState, firstState.page), args),
      secrets_redacted: true,
    };
  }

  const resolved = resolveProfileForOrigin(loaded.profiles, args, firstState.origin);
  const profile = resolved.profile;
  if (!profile) {
    return {
      status: "blocked",
      action: "ensure_login",
      reason: resolved.blocked_reason || "no_matching_login_profile",
      url: firstState.url,
      origin: firstState.origin,
      pathname: firstState.pathname,
      title: firstState.title,
      transport: firstState.transport,
      transport_attempts: firstState.transport_attempts,
      page: firstState.page,
      ...genericDetection,
      secrets_redacted: true,
    };
  }
  if (resolved.blocked_reason) {
    const detection = detectLoginPage(firstState, profile);
    return {
      status: "blocked",
      action: "ensure_login",
      reason: resolved.blocked_reason,
      url: firstState.url,
      origin: firstState.origin,
      pathname: firstState.pathname,
      title: firstState.title,
      transport: firstState.transport,
      transport_attempts: firstState.transport_attempts,
      page: firstState.page,
      profile: redactProfile(profile),
      ...detection,
      secrets_redacted: true,
    };
  }

  const pageState = await inspectCurrentPage(args, profile);
  const detection = detectLoginPage(pageState, profile);
  if (!detection.login_detected) {
    const lifecycle = await recordProfileAuthLifecycle(profile, {
      last_used_at: new Date().toISOString(),
      last_validated_at: new Date().toISOString(),
      last_status: "success",
      last_reason: "already_authenticated",
      last_origin: pageState.origin,
      last_path: pageState.pathname,
    });
    return {
      status: "success",
      action: "ensure_login",
      already_authenticated: true,
      submitted: false,
      url: pageState.url,
      origin: pageState.origin,
      pathname: pageState.pathname,
      title: pageState.title,
      transport: pageState.transport,
      transport_attempts: pageState.transport_attempts,
      page: pageState.page,
      profile: redactProfile({ ...profile, lifecycle: { ...profile.lifecycle, ...lifecycle } }),
      ...detection,
      reason: "already_authenticated",
      metadata_updated: lifecycleMetadataWasUpdated(lifecycle),
      secrets_redacted: true,
    };
  }

  const manualRequiredReason = manualRequirementFromPageState(pageState);
  if (manualRequiredReason) {
    return {
      status: "blocked",
      action: "ensure_login",
      reason: manualRequiredReason,
      submitted: false,
      url: pageState.url,
      origin: pageState.origin,
      pathname: pageState.pathname,
      title: pageState.title,
      transport: pageState.transport,
      transport_attempts: pageState.transport_attempts,
      page: pageState.page,
      profile: redactProfile(profile),
      ...detection,
      captcha_detected: pageState.captcha_detected === true,
      mfa_detected: pageState.mfa_detected === true,
      mfa_input_count: pageState.mfa_input_count,
      sso_detected: pageState.sso_detected === true,
      oauth_popup_detected: pageState.oauth_popup_detected === true,
      ...manualRequirementFields(manualRequiredReason, pageStateWithPage(pageState, pageState.page), args),
      secrets_redacted: true,
    };
  }

  const validation = validateProfileShape(profile);
  if (!validation.valid) {
    return {
      status: "blocked",
      action: "ensure_login",
      reason: "profile_invalid",
      validation,
      url: pageState.url,
      origin: pageState.origin,
      pathname: pageState.pathname,
      profile: redactProfile(profile),
      ...detection,
      secrets_redacted: true,
    };
  }
  if (args?.dry_run === true) {
    return {
      status: "success",
      action: "ensure_login",
      dry_run: true,
      would_submit: true,
      reason: "would_submit",
      url: pageState.url,
      origin: pageState.origin,
      pathname: pageState.pathname,
      title: pageState.title,
      transport: pageState.transport,
      transport_attempts: pageState.transport_attempts,
      page: pageState.page,
      profile: redactProfile(profile),
      ...detection,
      secrets_redacted: true,
    };
  }

  const submitted = await submitLoginForm(args, profile);
  const payload = submitted.result ?? {};
  const reason = String(payload.reason ?? (payload.ok === true ? "logged_in" : "login_failed"));
  const lifecycle = payload.ok === true
    ? await recordProfileAuthLifecycle(profile, {
      last_used_at: new Date().toISOString(),
      last_validated_at: new Date().toISOString(),
      last_status: "success",
      last_reason: reason,
      last_origin: payload.final_origin,
      last_path: payload.final_path,
    })
    : {};
  const status = payload.ok === true
    ? "success"
    : (reason.startsWith("manual_required_") ? "blocked" : "failed");
  return {
    status,
    action: "ensure_login",
    profile: redactProfile({ ...profile, lifecycle: { ...profile.lifecycle, ...lifecycle } }),
    login_detected: true,
    detection_source: detection.detection_source,
    submitted: payload.submitted === true,
    reason,
    transport: submitted.transport,
    transport_attempts: submitted.transport_attempts,
    page: submitted.page,
    submit_method: payload.submit_method,
    waited_ms: payload.waited_ms,
    final_url: payload.final_url,
    final_origin: payload.final_origin,
    final_path: payload.final_path,
    title: payload.title,
    blocked_path: payload.blocked_path,
    success_text_matched: payload.success_text_matched,
    captcha_detected: payload.captcha_detected === true,
    mfa_detected: payload.mfa_detected === true,
    mfa_input_count: payload.mfa_input_count,
    sso_detected: payload.sso_detected === true,
    oauth_popup_detected: payload.oauth_popup_detected === true,
    metadata_updated: lifecycleMetadataWasUpdated(lifecycle),
    missing_selectors: Array.isArray(payload.missing_selectors) ? payload.missing_selectors : [],
    ...manualRequirementFields(reason, pageStateWithPage(payload, submitted.page), args),
    secrets_redacted: true,
  };
}

async function handleBrowserAuthOps(args) {
  const action = normalizeAction(args, [
    "list_profiles",
    "validate_profile",
    "inspect_login_page",
    "suggest_profile",
    "upsert_profile",
    "ensure_login",
  ]);
  if (action === "list_profiles") {
    return handleListProfiles(args);
  }
  if (action === "validate_profile") {
    return handleValidateProfile(args);
  }
  if (action === "inspect_login_page") {
    return handleInspectLoginPage(args);
  }
  if (action === "suggest_profile") {
    return handleSuggestProfile(args);
  }
  if (action === "upsert_profile") {
    return handleUpsertProfile(args);
  }
  return handleEnsureLogin(args);
}

export {
  handleBrowserAuthOps,
};
