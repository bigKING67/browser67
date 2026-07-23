import { nowIso } from "./time.mjs";

const HUB_RUNTIME_INFO_SCHEMA = "browser67.hub-runtime-info.v1";
const EXTENSION_IDENTITY_SCHEMA = "browser67.extension-identity.v1";

function normalizedString(raw) {
  return String(raw ?? "").trim();
}

function normalizeExtensionIdentity(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const identity = {
    schema: normalizedString(raw.schema),
    product: normalizedString(raw.product),
    extension_version: normalizedString(raw.extension_version),
    manifest_version: normalizedString(raw.manifest_version),
    build_revision: normalizedString(raw.build_revision),
    build_revision_source: normalizedString(raw.build_revision_source),
    build_inputs_dirty: raw.build_inputs_dirty === true,
    source_digest: normalizedString(raw.source_digest).toLowerCase(),
    protocol_revision: Number(raw.protocol_revision),
  };
  if (
    identity.schema !== EXTENSION_IDENTITY_SCHEMA
    || identity.product !== "browser67"
    || !identity.extension_version
    || !identity.manifest_version
    || !identity.build_revision
    || !identity.build_revision_source
    || !/^[a-f0-9]{64}$/.test(identity.source_digest)
    || !Number.isInteger(identity.protocol_revision)
    || identity.protocol_revision < 1
  ) {
    return null;
  }
  return identity;
}

function registerExtensionHandshake(hub, rawIdentity) {
  const identity = normalizeExtensionIdentity(rawIdentity);
  hub.extensionIdentity = identity;
  hub.extensionIdentityStatus = identity ? "valid" : (rawIdentity ? "invalid" : "missing");
  hub.extensionIdentityReceivedAt = nowIso();
  hub.extensionConnectedAt = hub.extensionIdentityReceivedAt;
  hub.extensionDisconnectedAt = null;
}

function updateExtensionIdentity(hub, rawIdentity) {
  const identity = normalizeExtensionIdentity(rawIdentity);
  hub.extensionIdentity = identity;
  hub.extensionIdentityStatus = identity ? "valid" : (rawIdentity ? "invalid" : "missing");
  hub.extensionIdentityReceivedAt = nowIso();
}

function markExtensionDisconnected(hub) {
  hub.extensionDisconnectedAt = nowIso();
}

function extensionRuntimeInfo(hub) {
  return {
    schema: HUB_RUNTIME_INFO_SCHEMA,
    extension_connected: hub.extensionSocket !== null,
    extension_connected_at: hub.extensionConnectedAt,
    extension_disconnected_at: hub.extensionDisconnectedAt,
    extension_identity_status: hub.extensionIdentityStatus,
    extension_identity_received_at: hub.extensionIdentityReceivedAt,
    extension_identity: hub.extensionIdentity,
  };
}

export {
  EXTENSION_IDENTITY_SCHEMA,
  HUB_RUNTIME_INFO_SCHEMA,
  extensionRuntimeInfo,
  markExtensionDisconnected,
  normalizeExtensionIdentity,
  registerExtensionHandshake,
  updateExtensionIdentity,
};
