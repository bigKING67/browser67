import {
  lifecycleMetadataWasUpdated,
  loadLoginProfiles,
  redactProfile,
  recordProfileAuthLifecycle,
  resolveProfileForOrigin,
  validateProfileShape,
} from "../profile-store.mjs";
import {
  detectLoginFromUrl,
  detectLoginPage,
  inspectCurrentPage,
  manualRequirementFields,
  manualRequirementFromPageState,
  parseUrlState,
  publicAuthSurfaceFields,
  publicChallengeFields,
} from "../login-detect.mjs";
import { submitLoginForm } from "../login-submit.mjs";
import { pageStateWithPage } from "./shared.mjs";

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
  const firstManualRequiredReason = manualRequirementFromPageState(firstState);
  if (!genericDetection.login_detected && !firstManualRequiredReason) {
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
      ...publicAuthSurfaceFields(firstState),
      metadata_updated: lifecycleMetadataWasUpdated(lifecycle),
      secrets_redacted: true,
    };
  }

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
      ...publicChallengeFields(firstState),
      mfa_detected: firstState.mfa_detected === true,
      mfa_input_count: firstState.mfa_input_count,
      ...publicAuthSurfaceFields(firstState),
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
  const manualRequiredReason = manualRequirementFromPageState(pageState);
  if (!detection.login_detected && !manualRequiredReason) {
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
      ...publicAuthSurfaceFields(pageState),
      reason: "already_authenticated",
      metadata_updated: lifecycleMetadataWasUpdated(lifecycle),
      secrets_redacted: true,
    };
  }

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
      ...publicChallengeFields(pageState),
      mfa_detected: pageState.mfa_detected === true,
      mfa_input_count: pageState.mfa_input_count,
      ...publicAuthSurfaceFields(pageState),
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
    ...publicChallengeFields(payload),
    mfa_detected: payload.mfa_detected === true,
    mfa_input_count: payload.mfa_input_count,
    ...publicAuthSurfaceFields(payload),
    metadata_updated: lifecycleMetadataWasUpdated(lifecycle),
    missing_selectors: Array.isArray(payload.missing_selectors) ? payload.missing_selectors : [],
    ...manualRequirementFields(reason, pageStateWithPage(payload, submitted.page), args),
    secrets_redacted: true,
  };
}

export {
  handleEnsureLogin,
};
