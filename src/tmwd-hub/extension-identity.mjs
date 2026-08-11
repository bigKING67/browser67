import { normalizeBrowserInstanceId } from "./browser-instance.mjs";
import { listBrowserInstances } from "./sessions.mjs";
import { nowIso } from "./time.mjs";

const HUB_RUNTIME_INFO_SCHEMA = "browser67.hub-runtime-info.v2";
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
    || !/^[a-f0-9]{64}$/u.test(identity.source_digest)
    || !Number.isInteger(identity.protocol_revision)
    || identity.protocol_revision < 2
  ) return null;
  return identity;
}

function registerExtensionHandshake(hub, browserInstanceId, socket, rawIdentity) {
  const instanceId = normalizeBrowserInstanceId(browserInstanceId);
  if (!instanceId) return null;
  const identity = normalizeExtensionIdentity(rawIdentity);
  const now = nowIso();
  const previous = hub.browserInstances.get(instanceId);
  if (previous?.socket && previous.socket !== socket) hub.socketBrowserInstances.delete(previous.socket);
  const record = {
    socket,
    identity,
    identity_status: identity ? "valid" : (rawIdentity ? "invalid" : "missing"),
    identity_received_at: now,
    connected_at: now,
    disconnected_at: null,
  };
  hub.browserInstances.set(instanceId, record);
  hub.socketBrowserInstances.set(socket, instanceId);
  return record;
}

function updateExtensionIdentity(hub, browserInstanceId, rawIdentity) {
  const instanceId = normalizeBrowserInstanceId(browserInstanceId);
  const record = hub.browserInstances.get(instanceId);
  if (!record) return null;
  const identity = normalizeExtensionIdentity(rawIdentity);
  record.identity = identity;
  record.identity_status = identity ? "valid" : (rawIdentity ? "invalid" : "missing");
  record.identity_received_at = nowIso();
  return record;
}

function markExtensionDisconnected(hub, browserInstanceId, socket) {
  const instanceId = normalizeBrowserInstanceId(browserInstanceId);
  const record = hub.browserInstances.get(instanceId);
  if (!record || record.socket !== socket) return;
  record.socket = null;
  record.disconnected_at = nowIso();
  hub.socketBrowserInstances.delete(socket);
}

function extensionRuntimeInfo(hub) {
  const instances = listBrowserInstances(hub).map((summary) => {
    const record = hub.browserInstances.get(summary.browser_instance_id);
    return {
      ...summary,
      extension_identity_status: record?.identity_status ?? "missing",
      extension_identity_received_at: record?.identity_received_at ?? null,
      extension_identity: record?.identity ?? null,
    };
  });
  const selectedId = hub.defaultBrowserInstanceId
    || (instances.filter((instance) => instance.active).length === 1
      ? instances.find((instance) => instance.active)?.browser_instance_id
      : "");
  const selected = selectedId ? instances.find((instance) => instance.browser_instance_id === selectedId) : null;
  return {
    schema: HUB_RUNTIME_INFO_SCHEMA,
    extension_connected: instances.some((instance) => instance.active),
    extension_connected_at: selected?.connected_at ?? null,
    extension_disconnected_at: selected?.disconnected_at ?? null,
    extension_identity_status: selected?.extension_identity_status ?? "missing",
    extension_identity_received_at: selected?.extension_identity_received_at ?? null,
    extension_identity: selected?.extension_identity ?? null,
    default_browser_instance_id: hub.defaultBrowserInstanceId || null,
    browser_instances: instances,
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
