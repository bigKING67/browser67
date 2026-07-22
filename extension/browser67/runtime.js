const BROWSER67_POLICY_STORAGE_KEY = "browser67.managed-tab-policies.v1";
const BROWSER67_POLICY_ALARM = "browser67-policy-expiry";
const managedPolicies = new Map();
const networkObservers = new Map();
let policiesLoaded = false;

function normalizeBrowser67TabId(raw) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function browser67RuleId(tabId) {
  return 100000 + (tabId % 1000000000);
}

function normalizedPolicy(raw = {}) {
  return {
    csp_override: raw.csp_override === "on" ? "on" : "off",
    dialog: raw.dialog === "capture" ? "capture" : "native",
    badge: raw.badge === "managed" ? "managed" : "off",
    marker: raw.marker === "off" ? "off" : "managed",
  };
}

function navigationState(record = {}) {
  return {
    navigation_generation: Math.max(0, Number(record.navigation_generation || 0)),
    navigation_authorized_until: String(record.navigation_authorized_until || ""),
    navigation_authorized_reason: String(record.navigation_authorized_reason || ""),
    last_navigation_actor: String(record.last_navigation_actor || "none"),
    last_navigation_authorization_id: String(record.last_navigation_authorization_id || ""),
    last_navigation_url: String(record.last_navigation_url || ""),
    last_navigation_at: String(record.last_navigation_at || ""),
  };
}

async function currentTabUrl(tabId, fallback = "") {
  try {
    const tab = await chrome.tabs.get(tabId);
    return String(tab?.url || fallback || "");
  } catch {
    return String(fallback || "");
  }
}

async function persistManagedPolicies() {
  await chrome.storage.local.set({
    [BROWSER67_POLICY_STORAGE_KEY]: [...managedPolicies.values()],
  });
}

async function loadManagedPolicies() {
  if (policiesLoaded) return;
  const stored = await chrome.storage.local.get(BROWSER67_POLICY_STORAGE_KEY);
  const rows = Array.isArray(stored[BROWSER67_POLICY_STORAGE_KEY])
    ? stored[BROWSER67_POLICY_STORAGE_KEY]
    : [];
  managedPolicies.clear();
  for (const row of rows) {
    const tabId = normalizeBrowser67TabId(row?.tab_id);
    if (tabId === null) continue;
    managedPolicies.set(tabId, { ...row, tab_id: tabId, policy: normalizedPolicy(row.policy) });
  }
  policiesLoaded = true;
}

async function updateTabScopedCspRule(tabId, policy) {
  const ruleId = browser67RuleId(tabId);
  const addRules = policy.csp_override === "on"
    ? [{
      id: ruleId,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "content-security-policy", operation: "remove" },
          { header: "content-security-policy-report-only", operation: "remove" },
        ],
      },
      condition: {
        tabIds: [tabId],
        urlFilter: "*",
        resourceTypes: ["main_frame", "sub_frame"],
      },
    }]
    : [];
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules,
  });
}

function applyManagedPagePolicy(policy, managed) {
  const badgeId = "browser67-managed-badge";
  const markerAttribute = "data-browser67-managed";
  const stateKey = "__browser67ManagedPageState";
  const current = globalThis[stateKey] || {
    alert: window.alert,
    confirm: window.confirm,
    prompt: window.prompt,
  };
  globalThis[stateKey] = current;

  document.getElementById(badgeId)?.remove();
  if (!managed) {
    window.alert = current.alert;
    window.confirm = current.confirm;
    window.prompt = current.prompt;
    document.documentElement?.removeAttribute(markerAttribute);
    document.querySelectorAll("[data-browser67-node-id]").forEach((node) => {
      node.removeAttribute("data-browser67-node-id");
    });
    delete globalThis[stateKey];
    return { managed: false, dialogs: "native", badge: false, marker: false };
  }

  if (policy.dialog === "capture") {
    const record = (type, message, defaultValue) => {
      const event = new CustomEvent("browser67-dialog", {
        detail: { type, message: String(message ?? ""), default_value: String(defaultValue ?? "") },
      });
      window.dispatchEvent(event);
    };
    window.alert = (message) => { record("alert", message, ""); };
    window.confirm = (message) => { record("confirm", message, ""); return false; };
    window.prompt = (message, defaultValue) => { record("prompt", message, defaultValue); return null; };
  } else {
    window.alert = current.alert;
    window.confirm = current.confirm;
    window.prompt = current.prompt;
  }

  if (policy.marker === "managed") document.documentElement?.setAttribute(markerAttribute, "true");
  else document.documentElement?.removeAttribute(markerAttribute);
  if (policy.badge === "managed" && window.self === window.top) {
    const badge = document.createElement("div");
    badge.id = badgeId;
    badge.textContent = "browser67 managed";
    badge.style.cssText = "position:fixed;bottom:8px;right:8px;z-index:2147483647;background:#1f7a4d;color:#fff;padding:4px 7px;border-radius:4px;font:11px sans-serif;opacity:.65;pointer-events:none";
    (document.body || document.documentElement).appendChild(badge);
  }
  return {
    managed: true,
    dialogs: policy.dialog,
    badge: policy.badge === "managed",
    marker: policy.marker === "managed",
  };
}

async function injectManagedPolicy(tabId, policy) {
  const pageResults = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "MAIN",
    func: applyManagedPagePolicy,
    args: [policy, true],
  });
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "ISOLATED",
    files: ["config.js", "browser67/managed-content.js"],
  });
  return { page_frame_count: pageResults.length, content_bridge: true };
}

async function releaseManagedPolicy(tabId) {
  await updateTabScopedCspRule(tabId, normalizedPolicy());
  let pageFrameCount = 0;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: applyManagedPagePolicy,
      args: [normalizedPolicy(), false],
    });
    pageFrameCount = results.length;
  } catch {
    // The tab may have navigated or closed; policy storage and DNR still release.
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "ISOLATED",
      func: () => globalThis.__browser67ManagedContentBridge?.dispose?.(),
    });
  } catch {
    // Best effort for a tab that is no longer scriptable.
  }
  managedPolicies.delete(tabId);
  await persistManagedPolicies();
  return { page_frame_count: pageFrameCount };
}

async function applyManagedPolicyCommand(message) {
  await loadManagedPolicies();
  const tabId = normalizeBrowser67TabId(message.tabId);
  if (tabId === null) throw new Error("policy.apply requires numeric tabId");
  const existing = managedPolicies.get(tabId);
  const replacesExisting = existing
    && existing.ownership_generation === String(message.previousOwnershipGeneration || "")
    && existing.lease_id === String(message.previousLeaseId || "");
  if (
    existing
    && existing.ownership_generation
    && existing.ownership_generation !== String(message.ownershipGeneration || "")
    && !replacesExisting
    && (!existing.lease_expires_at || Date.parse(existing.lease_expires_at) > Date.now())
  ) {
    throw new Error("tab policy is owned by another active ownership generation");
  }
  const policy = normalizedPolicy(message.policy);
  const leaseExpiresAt = String(message.leaseExpiresAt || "");
  const priorNavigation = existing
    && existing.ownership_generation === String(message.ownershipGeneration || "")
    && existing.lease_id === String(message.leaseId || "")
    ? navigationState(existing)
    : navigationState();
  const record = {
    tab_id: tabId,
    ownership_generation: String(message.ownershipGeneration || ""),
    lease_id: String(message.leaseId || ""),
    lease_expires_at: leaseExpiresAt,
    policy,
    ...priorNavigation,
    last_navigation_url: priorNavigation.last_navigation_url || await currentTabUrl(tabId),
    navigation_in_progress: existing?.navigation_in_progress === true,
    navigation_authorization_id: String(existing?.navigation_authorization_id || ""),
    updated_at: new Date().toISOString(),
  };
  await updateTabScopedCspRule(tabId, policy);
  const injected = await injectManagedPolicy(tabId, policy);
  managedPolicies.set(tabId, record);
  await persistManagedPolicies();
  chrome.alarms.create(BROWSER67_POLICY_ALARM, { periodInMinutes: 1 });
  return { managed: true, ...record, ...injected };
}

async function authorizeManagedNavigation(message) {
  await loadManagedPolicies();
  const tabId = normalizeBrowser67TabId(message.tabId);
  if (tabId === null) throw new Error("policy.authorize_navigation requires numeric tabId");
  const record = managedPolicies.get(tabId);
  if (!record) throw new Error("managed tab policy is not active");
  if (
    record.ownership_generation !== String(message.ownershipGeneration || "")
    || record.lease_id !== String(message.leaseId || "")
  ) {
    throw new Error("navigation authorization ownership or lease mismatch");
  }
  const authorizationId = String(message.authorizationId || "");
  if (!authorizationId) throw new Error("navigation authorization id is required");
  const requestedExpiry = Date.parse(String(message.authorizedUntil || ""));
  const maxExpiry = Date.now() + 15_000;
  const expiresAtMs = Number.isFinite(requestedExpiry)
    ? Math.max(Date.now() + 250, Math.min(maxExpiry, requestedExpiry))
    : Date.now() + 5_000;
  record.navigation_authorization_id = authorizationId;
  record.navigation_authorized_until = new Date(expiresAtMs).toISOString();
  record.navigation_authorized_reason = String(message.reason || "agent_navigation");
  record.updated_at = new Date().toISOString();
  await persistManagedPolicies();
  return {
    managed: true,
    tab_id: tabId,
    ownership_generation: record.ownership_generation,
    lease_id: record.lease_id,
    navigation_authorization_id: authorizationId,
    navigation_authorized_until: record.navigation_authorized_until,
    navigation_authorized_reason: record.navigation_authorized_reason,
    ...navigationState(record),
  };
}

async function recordManagedNavigation(tabId, changeInfo = {}) {
  await loadManagedPolicies();
  const record = managedPolicies.get(tabId);
  if (!record) return null;
  const started = changeInfo.status === "loading" || Boolean(changeInfo.url);
  if (started && record.navigation_in_progress !== true) {
    const now = Date.now();
    const authorizationExpiry = Date.parse(String(record.navigation_authorized_until || ""));
    const authorized = Boolean(record.navigation_authorization_id)
      && Number.isFinite(authorizationExpiry)
      && authorizationExpiry >= now;
    record.navigation_generation = Math.max(0, Number(record.navigation_generation || 0)) + 1;
    record.navigation_in_progress = true;
    record.last_navigation_actor = authorized ? "agent_authorized" : "out_of_band";
    record.last_navigation_authorization_id = authorized
      ? String(record.navigation_authorization_id)
      : "";
    record.last_navigation_at = new Date(now).toISOString();
    record.navigation_authorization_id = "";
    record.navigation_authorized_until = "";
    record.navigation_authorized_reason = "";
  }
  if (changeInfo.url) record.last_navigation_url = String(changeInfo.url);
  if (changeInfo.status === "complete") {
    record.navigation_in_progress = false;
    record.last_navigation_url = await currentTabUrl(tabId, record.last_navigation_url);
  }
  record.updated_at = new Date().toISOString();
  await persistManagedPolicies();
  return record;
}

function normalizeNetworkResourceType(value) {
  return String(value || "other").toLowerCase();
}

function networkStatus(observer) {
  const now = Date.now();
  return {
    observing: true,
    observation_id: observer.observation_id,
    started_at: new Date(observer.started_at_ms).toISOString(),
    sampled_at: new Date(now).toISOString(),
    elapsed_ms: now - observer.started_at_ms,
    quiet_for_ms: now - observer.last_activity_at_ms,
    inflight_count: observer.active.size,
    observed_count: observer.observed_count,
    ignored_count: observer.ignored_count,
    completed_count: observer.completed_count,
    failed_count: observer.failed_count,
    active_resource_types: [...new Set([...observer.active.values()].map((entry) => entry.resource_type))],
  };
}

function networkRequestIgnored(observer, details) {
  const resourceType = normalizeNetworkResourceType(details.type);
  if (observer.ignore_resource_types.has(resourceType)) return true;
  return observer.ignore_patterns.some((pattern) => String(details.url || "").includes(pattern));
}

chrome.webRequest.onBeforeRequest.addListener((details) => {
  const observer = networkObservers.get(details.tabId);
  if (!observer) return;
  observer.observed_count += 1;
  observer.last_activity_at_ms = Date.now();
  if (networkRequestIgnored(observer, details)) {
    observer.ignored_count += 1;
    return;
  }
  observer.active.set(details.requestId, {
    resource_type: normalizeNetworkResourceType(details.type),
    started_at_ms: Date.now(),
  });
}, { urls: ["<all_urls>"] });

chrome.webRequest.onCompleted.addListener((details) => {
  const observer = networkObservers.get(details.tabId);
  if (!observer) return;
  observer.last_activity_at_ms = Date.now();
  if (observer.active.delete(details.requestId)) observer.completed_count += 1;
}, { urls: ["<all_urls>"] });

chrome.webRequest.onErrorOccurred.addListener((details) => {
  const observer = networkObservers.get(details.tabId);
  if (!observer) return;
  observer.last_activity_at_ms = Date.now();
  if (observer.active.delete(details.requestId)) observer.failed_count += 1;
}, { urls: ["<all_urls>"] });

async function handleNetworkCommand(message) {
  await loadManagedPolicies();
  const tabId = normalizeBrowser67TabId(message.tabId);
  if (tabId === null) throw new Error("network command requires numeric tabId");
  if (!managedPolicies.has(tabId)) throw new Error("network observation requires a managed tab policy");
  const method = String(message.method || "status");
  if (method === "observe") {
    const now = Date.now();
    const observer = {
      observation_id: String(message.observationId || ""),
      started_at_ms: now,
      last_activity_at_ms: now,
      active: new Map(),
      observed_count: 0,
      ignored_count: 0,
      completed_count: 0,
      failed_count: 0,
      ignore_patterns: (Array.isArray(message.ignorePatterns) ? message.ignorePatterns : [])
        .map(String).filter(Boolean),
      ignore_resource_types: new Set(
        (Array.isArray(message.ignoreResourceTypes) ? message.ignoreResourceTypes : ["websocket", "eventsource"])
          .map(normalizeNetworkResourceType),
      ),
    };
    networkObservers.set(tabId, observer);
    return networkStatus(observer);
  }
  const observer = networkObservers.get(tabId);
  if (!observer || (message.observationId && observer.observation_id !== message.observationId)) {
    throw new Error("network observation is not active for tab");
  }
  if (method === "status") return networkStatus(observer);
  if (method === "unobserve") {
    const status = networkStatus(observer);
    networkObservers.delete(tabId);
    return { ...status, observing: false, stopped_at: new Date().toISOString() };
  }
  throw new Error(`unsupported network method: ${method}`);
}

async function browser67HandleCommand(message) {
  try {
    if (message?.cmd === "network") {
      return { ok: true, data: await handleNetworkCommand(message) };
    }
    if (message?.cmd !== "policy") return undefined;
    await loadManagedPolicies();
    const method = String(message.method || "status");
    const tabId = normalizeBrowser67TabId(message.tabId);
    if (tabId === null) throw new Error("policy command requires numeric tabId");
    if (method === "apply") {
      return { ok: true, data: await applyManagedPolicyCommand(message) };
    }
    if (method === "authorize_navigation") {
      return { ok: true, data: await authorizeManagedNavigation(message) };
    }
    if (method === "release") {
      const existing = managedPolicies.get(tabId);
      if (
        existing
        && ((message.ownershipGeneration && existing.ownership_generation !== message.ownershipGeneration)
          || (message.leaseId && existing.lease_id !== message.leaseId))
      ) {
        throw new Error("policy release ownership or lease mismatch");
      }
      const released = await releaseManagedPolicy(tabId);
      return { ok: true, data: { managed: false, tab_id: tabId, ...released } };
    }
    if (method === "status") {
      const record = managedPolicies.get(tabId);
      return { ok: true, data: record ? { managed: true, ...record } : { managed: false, tab_id: tabId } };
    }
    throw new Error(`unsupported policy method: ${method}`);
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

globalThis.browser67HandleCommand = browser67HandleCommand;

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  await loadManagedPolicies();
  const record = managedPolicies.get(tabId);
  if (!record) return;
  await recordManagedNavigation(tabId, changeInfo);
  if (changeInfo.status !== "complete") return;
  try {
    await updateTabScopedCspRule(tabId, record.policy);
    await injectManagedPolicy(tabId, record.policy);
  } catch {
    // Loading transitions can be temporarily unscriptable; completion retries.
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  networkObservers.delete(tabId);
  await loadManagedPolicies();
  if (!managedPolicies.has(tabId)) return;
  managedPolicies.delete(tabId);
  await updateTabScopedCspRule(tabId, normalizedPolicy());
  await persistManagedPolicies();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== BROWSER67_POLICY_ALARM) return;
  await loadManagedPolicies();
  const now = Date.now();
  for (const record of [...managedPolicies.values()]) {
    if (record.lease_expires_at && Date.parse(record.lease_expires_at) <= now) {
      await releaseManagedPolicy(record.tab_id);
    }
  }
});

(async () => {
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [9999] });
  await loadManagedPolicies();
  for (const record of managedPolicies.values()) {
    if (!record.lease_expires_at || Date.parse(record.lease_expires_at) > Date.now()) {
      await updateTabScopedCspRule(record.tab_id, record.policy);
    }
  }
})();
