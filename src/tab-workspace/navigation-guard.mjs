import { hashText, randomId } from "../common.mjs";

const NAVIGATION_AUTHORIZATION_TTL_MS = 5_000;

function browserDocumentIdentity(target = {}) {
  const tabId = String(target.id ?? target.tab_id ?? target.tabId ?? "").trim();
  const url = String(target.url ?? "").trim();
  return hashText(`${tabId}|${url}`);
}

function browserConnectionGeneration(preferred = {}) {
  const transport = String(preferred.transport ?? "unknown");
  const endpoint = String(preferred.context?.endpoint ?? "");
  const generation = preferred.context?.connection_generation;
  return generation === undefined || generation === null
    ? `${transport}:${endpoint}`
    : `${transport}:${endpoint}:${String(generation)}`;
}

function createNavigationAuthorization(record, reason, options = {}) {
  const nowMs = Number(options.now_ms ?? Date.now());
  const ttlMs = Math.max(500, Math.min(
    15_000,
    Number(options.ttl_ms ?? NAVIGATION_AUTHORIZATION_TTL_MS),
  ));
  return {
    navigation_authorization_id: randomId("navigation"),
    navigation_authorized_until: new Date(nowMs + ttlMs).toISOString(),
    navigation_authorized_reason: String(reason ?? "agent_navigation").trim() || "agent_navigation",
    ownership_generation: record.ownership_generation,
    lease_id: record.lease_id,
  };
}

function navigationStatusFromPolicy(raw = {}) {
  return {
    managed: raw.managed === true,
    ownership_generation: String(raw.ownership_generation ?? ""),
    lease_id: String(raw.lease_id ?? ""),
    navigation_generation: Math.max(0, Number(raw.navigation_generation ?? 0)),
    last_navigation_actor: String(raw.last_navigation_actor ?? "none"),
    last_navigation_authorization_id: String(raw.last_navigation_authorization_id ?? ""),
    last_navigation_url: String(raw.last_navigation_url ?? ""),
    last_navigation_at: String(raw.last_navigation_at ?? ""),
  };
}

function reconcileAdoptedNavigation(record, observation = {}, options = {}) {
  if (record?.ownership_origin !== "user_adopted") {
    return { record, changed: false, status: "not_applicable" };
  }
  const now = String(options.now ?? new Date().toISOString());
  const policy = navigationStatusFromPolicy(observation.policy_status);
  const observedConnectionGeneration = String(
    observation.connection_generation ?? record.connection_generation ?? "",
  );
  const observedUrl = String(
    policy.last_navigation_url
      || observation.url
      || record.observed_url
      || record.url
      || "",
  );
  const observedTitle = String(observation.title ?? record.observed_title ?? record.title ?? "");
  const basePatch = {
    observed_url: observedUrl,
    observed_title: observedTitle,
    observed_at: now,
  };
  const suspend = (reason, extra = {}) => ({
    record: {
      ...record,
      ...basePatch,
      ...extra,
      suspended: true,
      suspension_reason: reason,
    },
    changed: true,
    status: "suspended",
    reason,
  });

  if (!policy.managed) {
    return suspend("managed_policy_missing");
  }
  if (
    policy.ownership_generation !== String(record.ownership_generation ?? "")
    || policy.lease_id !== String(record.lease_id ?? "")
  ) {
    return suspend("ownership_or_lease_changed");
  }
  if (
    record.connection_generation
    && observedConnectionGeneration
    && observedConnectionGeneration !== record.connection_generation
  ) {
    return suspend("connection_generation_changed", {
      observed_connection_generation: observedConnectionGeneration,
    });
  }

  const priorGeneration = Math.max(0, Number(record.navigation_generation ?? 0));
  if (policy.navigation_generation < priorGeneration) {
    return suspend("navigation_generation_regressed", {
      observed_navigation_generation: policy.navigation_generation,
    });
  }
  if (policy.navigation_generation > priorGeneration) {
    const authorized = policy.last_navigation_actor === "agent_authorized"
      && policy.last_navigation_authorization_id
      && policy.last_navigation_authorization_id === String(record.navigation_authorization_id ?? "");
    if (!authorized) {
      return suspend("out_of_band_navigation", {
        navigation_generation: policy.navigation_generation,
        last_navigation_actor: policy.last_navigation_actor,
        last_navigation_at: policy.last_navigation_at,
      });
    }
    return {
      record: {
        ...record,
        ...basePatch,
        url: observedUrl || record.url,
        title: observedTitle || record.title,
        adopted_document_identity: browserDocumentIdentity({ id: record.tab_id, url: observedUrl }),
        connection_generation: observedConnectionGeneration || record.connection_generation,
        navigation_generation: policy.navigation_generation,
        navigation_authorization_id: "",
        navigation_authorized_until: "",
        navigation_authorized_reason: "",
        last_navigation_actor: policy.last_navigation_actor,
        last_navigation_at: policy.last_navigation_at,
        suspension_reason: "",
        suspended: false,
      },
      changed: true,
      status: "authorized_navigation_accepted",
    };
  }

  return {
    record: {
      ...record,
      ...basePatch,
      connection_generation: observedConnectionGeneration || record.connection_generation,
    },
    changed: observedUrl !== record.observed_url
      || observedTitle !== record.observed_title
      || observedConnectionGeneration !== record.connection_generation,
    status: record.suspended === true ? "suspended" : "unchanged",
    reason: record.suspension_reason || undefined,
  };
}

export {
  NAVIGATION_AUTHORIZATION_TTL_MS,
  browserConnectionGeneration,
  browserDocumentIdentity,
  createNavigationAuthorization,
  navigationStatusFromPolicy,
  reconcileAdoptedNavigation,
};
