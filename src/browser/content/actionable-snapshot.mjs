import { hashText, nowIso } from "../../runtime/identity.mjs";
import { createToolError } from "../../runtime/tool-errors.mjs";
import { getManagedTab } from "../../tab-workspace/index.mjs";
import { resolvePreferredBrowserContext } from "../../tmwd-runtime/index.mjs";
import { executeBrowserScript } from "../../browser-wrappers/shared.mjs";
import { assertManagedExecutionContext } from "../execution/managed-context.mjs";
import { browserSnapshotStore } from "./snapshot-store.mjs";

const ACTIONABLE_SNAPSHOT_BODY = `
const limit = Math.max(1, Math.min(5000, Number(input.limit || 1000)));
const markerAttribute = 'data-browser67-node-id';
const actionableRoles = new Set(['button', 'link', 'checkbox', 'radio', 'textbox', 'combobox', 'menuitem', 'tab', 'switch', 'option']);
const actionableTags = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);
const nodes = [];
const transients = [];
const limitations = ['closed_shadow_roots_unobservable'];
const markerState = globalThis.__browser67NodeMarkerState || { sequence: 0 };
globalThis.__browser67NodeMarkerState = markerState;
let mutationCount = 0;
const observer = new MutationObserver((records) => {
  mutationCount += records.filter((record) => !(record.type === 'attributes' && record.attributeName === markerAttribute)).length;
});
observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });

function textOf(element) {
  return String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}
function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
function accessibleName(element) {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelled = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
    if (labelled) return labelled.slice(0, 300);
  }
  const aria = element.getAttribute('aria-label');
  if (aria) return aria.trim().slice(0, 300);
  if (element.labels?.length) {
    const label = Array.from(element.labels).map((item) => textOf(item)).join(' ').trim();
    if (label) return label.slice(0, 300);
  }
  return String(element.getAttribute('alt') || element.getAttribute('title') || element.getAttribute('placeholder') || textOf(element)).slice(0, 300);
}
function roleOf(element) {
  const explicit = String(element.getAttribute('role') || '').trim().toLowerCase();
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === 'a' && element.hasAttribute('href')) return 'link';
  if (tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(element.type))) return 'button';
  if (tag === 'select') return element.multiple ? 'listbox' : 'combobox';
  if (tag === 'textarea' || (tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'hidden'].includes(element.type))) return 'textbox';
  if (tag === 'input' && element.type === 'checkbox') return 'checkbox';
  if (tag === 'input' && element.type === 'radio') return 'radio';
  return '';
}
function visibleOf(element) {
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument?.defaultView?.getComputedStyle(element) || getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
}
function sensitiveReason(element) {
  const signature = [element.type, element.name, element.id, element.autocomplete, element.getAttribute('aria-label')].join(' ').toLowerCase();
  if (element.type === 'password' || /password|passwd|pwd/.test(signature)) return 'password_field';
  if (/one-time|otp|mfa|verification.?code|oauth.?code/.test(signature)) return 'one_time_code_field';
  if (/token|secret|api.?key/.test(signature)) return 'secret_field';
  if (element.type === 'email' || element.type === 'tel') return 'personal_identifier_field';
  return '';
}
function cssPath(element) {
  const segments = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && segments.length < 6) {
    let segment = current.tagName.toLowerCase();
    if (current.id) {
      segment += '#' + cssEscape(current.id);
      segments.unshift(segment);
      break;
    }
    const parent = current.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
      if (same.length > 1) segment += ':nth-of-type(' + String(same.indexOf(current) + 1) + ')';
    }
    segments.unshift(segment);
    current = parent;
  }
  return segments.join(' > ');
}
function uniqueSelector(selector, root = document) {
  if (!selector) return false;
  try { return root.querySelectorAll(selector).length === 1; } catch { return false; }
}
function locatorCandidates(element, role, name, root) {
  const candidates = [];
  if (element.id) {
    const selector = '#' + cssEscape(element.id);
    if (uniqueSelector(selector, root)) candidates.push({ type: 'id', value: selector });
  }
  for (const attribute of ['data-testid', 'data-test', 'data-qa']) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const selector = '[' + attribute + '="' + String(value).replace(/"/g, '\\"') + '"]';
    if (uniqueSelector(selector, root)) candidates.push({ type: 'testid', value: selector });
  }
  if (element.getAttribute('name')) {
    const selector = '[name="' + String(element.getAttribute('name')).replace(/"/g, '\\"') + '"]';
    if (uniqueSelector(selector, root)) candidates.push({ type: 'name', value: selector });
  }
  if (role && name) candidates.push({ type: 'role_name', role, name });
  const path = cssPath(element);
  if (path && uniqueSelector(path, root)) candidates.push({ type: 'css', value: path });
  return candidates;
}
function recordElement(element, framePath, shadowPath, root) {
  if (nodes.length >= limit || element?.nodeType !== 1) return;
  const tag = element.tagName.toLowerCase();
  const role = roleOf(element);
  const isActionable = actionableTags.has(tag)
    || actionableRoles.has(role)
    || element.isContentEditable
    || typeof element.onclick === 'function'
    || element.hasAttribute('onclick')
    || Number(element.tabIndex) >= 0;
  if (isActionable) {
    const rect = element.getBoundingClientRect();
    const name = accessibleName(element);
    const sensitivity = sensitiveReason(element);
    const existingMarker = element.getAttribute(markerAttribute);
    const marker = existingMarker || ('node_' + (++markerState.sequence).toString(36));
    if (!existingMarker) element.setAttribute(markerAttribute, marker);
    const candidates = locatorCandidates(element, role, name, root);
    candidates.unshift({ type: 'marker', value: '[' + markerAttribute + '="' + marker + '"]' });
    nodes.push({
      node_id: marker,
      tag,
      role,
      accessible_name: name,
      text: textOf(element),
      value: sensitivity ? { present: Boolean(element.value), length: String(element.value || '').length, redacted: true, reason: sensitivity } : String(element.value ?? '').slice(0, 500),
      visible: visibleOf(element),
      enabled: !element.disabled && element.getAttribute('aria-disabled') !== 'true',
      checked: typeof element.checked === 'boolean' ? element.checked : undefined,
      selected: typeof element.selected === 'boolean' ? element.selected : undefined,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      frame_path: framePath,
      shadow_path: shadowPath,
      sensitivity: sensitivity || 'none',
      locator_candidates: candidates,
    });
  }
  if (element.shadowRoot) walkRoot(element.shadowRoot, framePath, shadowPath.concat([cssPath(element) || tag]));
  if (tag === 'iframe') {
    const nextFramePath = framePath.concat([cssPath(element) || 'iframe']);
    try {
      if (element.contentDocument?.documentElement) walkRoot(element.contentDocument, nextFramePath, shadowPath);
      else {
        let reason = 'frame_document_unavailable';
        try {
          const frameUrl = new URL(element.src || 'about:blank', location.href);
          if (frameUrl.origin !== location.origin) reason = 'cross_origin_or_denied';
        } catch {}
        transients.push({ type: 'opaque_frame', frame_path: nextFramePath, reason });
        if (!limitations.includes(reason)) limitations.push(reason);
      }
    } catch {
      transients.push({ type: 'opaque_frame', frame_path: nextFramePath, reason: 'cross_origin_or_denied' });
      if (!limitations.includes('cross_origin_or_denied')) limitations.push('cross_origin_or_denied');
    }
  }
}
function walkRoot(root, framePath, shadowPath) {
  const elements = Array.from(root.querySelectorAll('*'));
  for (const element of elements) {
    recordElement(element, framePath, shadowPath, root);
    if (nodes.length >= limit) break;
  }
}
walkRoot(document, [], []);
for (const element of document.querySelectorAll('[role="alert"], [role="status"], [aria-live], .toast, .notification, [popover], [aria-busy="true"]')) {
  const text = textOf(element);
  if (text) transients.push({ type: element.getAttribute('role') || (element.matches('[aria-busy="true"]') ? 'loading' : 'transient'), text, visible: visibleOf(element) });
  if (transients.length >= 50) break;
}
await Promise.resolve();
observer.disconnect();
return {
  url: location.href,
  title: document.title,
  navigation_start: performance.timeOrigin || performance.timing?.navigationStart || 0,
  node_count: nodes.length,
  truncated: nodes.length >= limit,
  nodes,
  transients,
  limitations,
  consistency: { status: mutationCount > 0 ? 'changed_during_capture' : 'stable', mutation_count: mutationCount },
};`;

function snapshotFingerprint(nodes, fields) {
  return hashText(JSON.stringify(nodes.map((node) => fields.map((field) => node[field]))));
}

async function captureActionableSnapshot(args = {}, runtimeOptions = {}) {
  const snapshotStore = runtimeOptions.runtime?.snapshotStore ?? browserSnapshotStore;
  if (typeof args.html === "string" && args.html.length > 0) {
    throw createToolError(
      "OFFLINE_HTML_NOT_SUPPORTED_V3",
      "browser_extract v3 captures the live managed document; raw HTML extraction was removed",
      { retryable: false },
    );
  }
  const preferred = await resolvePreferredBrowserContext(args, runtimeOptions);
  const tabId = String(preferred.context?.target?.id ?? "").trim();
  const managed = await getManagedTab(tabId);
  if (!managed) {
    throw createToolError("TAB_NOT_MANAGED", "browser_extract requires an agent-created or user-adopted tab", {
      retryable: false,
      details: { tab_id: tabId },
    });
  }
  if (managed.suspended === true) {
    throw createToolError("ADOPTED_TAB_SUSPENDED", "adopted tab changed outside the managed action window", {
      retryable: false,
    });
  }
  await assertManagedExecutionContext(preferred, args, runtimeOptions);
  const limitRaw = Number(args.selector_limit ?? 1000);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, Math.floor(limitRaw))) : 1000;
  const executed = await executeBrowserScript({
    ...args,
    no_monitor: true,
    tab_id: tabId,
    switch_tab_id: tabId,
    session_id: tabId,
  }, ACTIONABLE_SNAPSHOT_BODY, { limit }, { ...runtimeOptions, preferred });
  const value = executed.value && typeof executed.value === "object" ? executed.value : {};
  const documentId = hashText(`${tabId}|${value.url}|${value.navigation_start}`);
  const snapshot = snapshotStore.put({
    tab_id: tabId,
    document_id: documentId,
    captured_at: nowIso(),
    url: String(value.url ?? managed.url ?? ""),
    title: String(value.title ?? managed.title ?? ""),
    navigation_start: Number(value.navigation_start ?? 0),
    consistency: value.consistency ?? { status: "stable", mutation_count: 0 },
    document_fingerprint: hashText(JSON.stringify(value.nodes ?? [])),
    semantic_fingerprint: snapshotFingerprint(value.nodes ?? [], ["tag", "role", "accessible_name", "text", "visible", "enabled"]),
    nodes: Array.isArray(value.nodes) ? value.nodes : [],
    transients: Array.isArray(value.transients) ? value.transients : [],
    limitations: Array.isArray(value.limitations) ? value.limitations : ["closed_shadow_roots_unobservable"],
    truncated: value.truncated === true,
    transport: executed.transport,
    transport_attempts: executed.transport_attempts,
  }, managed);
  return snapshot;
}

function publicSnapshot(snapshot, store = browserSnapshotStore) {
  const storePolicy = store.stats();
  return {
    schema: "browser67.actionable-snapshot.v2",
    snapshot_id: snapshot.snapshot_id,
    tab_id: snapshot.tab_id,
    document_id: snapshot.document_id,
    scope: {
      workspace_key: snapshot.workspace_key || undefined,
      task_id: snapshot.task_id || undefined,
    },
    captured_at: snapshot.captured_at,
    consistency: snapshot.consistency,
    document_fingerprint: snapshot.document_fingerprint,
    semantic_fingerprint: snapshot.semantic_fingerprint,
    nodes: snapshot.nodes,
    transients: snapshot.transients,
    limitations: snapshot.limitations,
    marker_policy: {
      attribute: "data-browser67-node-id",
      scope: "current_document",
      lifetime: "until_navigation_or_managed_policy_release",
      reuse: "stable_within_document",
      snapshot_ttl_ms: storePolicy.ttl_ms,
      max_snapshots_per_tab: storePolicy.max_per_tab,
      max_snapshots_global: storePolicy.max_global,
    },
    truncated: snapshot.truncated,
    transport: snapshot.transport,
    transport_attempts: snapshot.transport_attempts,
  };
}

export {
  ACTIONABLE_SNAPSHOT_BODY,
  captureActionableSnapshot,
  publicSnapshot,
};
