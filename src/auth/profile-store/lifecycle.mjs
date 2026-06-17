import {
  redactProfileMetadata,
  writeProfileMetadata,
} from "../profile-metadata.mjs";

async function recordProfileAuthLifecycle(profile, details = {}) {
  if (profile?.source !== "profile_env" || !profile?.source_path) {
    return {};
  }
  try {
    return await writeProfileMetadata(profile.source_path, {
      profile_id: profile.profile_id,
      last_used_at: details.last_used_at,
      last_validated_at: details.last_validated_at,
      last_status: details.last_status || "success",
      last_reason: details.last_reason,
      last_origin: details.last_origin,
      last_path: details.last_path,
    });
  } catch (error) {
    return {
      metadata_write_error: String(error?.code ?? error?.message ?? error),
    };
  }
}

function redactProfile(profile) {
  return {
    profile_id: profile.profile_id,
    source: profile.source,
    source_path: profile.source_path,
    file_mode: profile.file_mode,
    insecure_file_permissions: profile.insecure_file_permissions,
    allowed_origins: profile.allowed_origins,
    login_path_patterns: profile.login_path_patterns,
    username_selector: profile.username_selector,
    password_selector: profile.password_selector,
    submit_selector: profile.submit_selector,
    success_path_not: profile.success_path_not,
    success_text_configured: profile.success_text.length > 0,
    lifecycle: redactProfileMetadata(profile.lifecycle),
    has_username: profile.username.length > 0,
    has_password: profile.password.length > 0,
  };
}

function lifecycleMetadataWasUpdated(lifecycle) {
  return Boolean(redactProfileMetadata(lifecycle));
}

export {
  lifecycleMetadataWasUpdated,
  redactProfile,
  recordProfileAuthLifecycle,
};
