import { hashText } from "../../runtime/identity.mjs";
import { createToolError } from "../../runtime/tool-errors.mjs";
import {
  getManagedTab,
  updateManagedTab,
} from "../../tab-workspace/index.mjs";
import { executeBrowserScript } from "../../browser-wrappers/shared.mjs";
import { resolvePreferredBrowserContext } from "../../tmwd-runtime/index.mjs";
import { browserSnapshotStore } from "../content/snapshot-store.mjs";
import { beginNetworkObservation } from "../network/observation.mjs";
import {
  assertManagedExecutionContext,
  authorizeManagedExecutionNavigation,
} from "./managed-context.mjs";

const SUPPORTED_NODE_OPERATIONS = ["click", "focus", "set_value", "select_option", "read"];

const STRUCTURED_OPERATION_BODY = `
function queryRoot(root, selector) {
  try { return Array.from(root.querySelectorAll(selector)); } catch { return []; }
}
function resolveRoot(framePath, shadowPath) {
  let root = document;
  for (const selector of framePath || []) {
    const frame = queryRoot(root, selector)[0];
    if (!frame?.contentDocument) return { error: 'frame_unavailable' };
    root = frame.contentDocument;
  }
  for (const selector of shadowPath || []) {
    const host = queryRoot(root, selector)[0];
    if (!host?.shadowRoot) return { error: 'shadow_root_unavailable' };
    root = host.shadowRoot;
  }
  return { root };
}
function accessibleName(element) {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelled = labelledBy.split(/\s+/).map((id) => element.ownerDocument?.getElementById(id)?.textContent || '').join(' ').trim();
    if (labelled) return labelled.slice(0, 300);
  }
  if (element.getAttribute('aria-label')) return element.getAttribute('aria-label').trim().slice(0, 300);
  if (element.labels?.length) return Array.from(element.labels).map((item) => item.innerText || item.textContent || '').join(' ').trim().slice(0, 300);
  return String(element.getAttribute('alt') || element.getAttribute('title') || element.getAttribute('placeholder') || element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
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
function candidates(root, node) {
  for (const candidate of node.locator_candidates || []) {
    if (candidate.type === 'role_name') {
      const matches = queryRoot(root, '*').filter((element) => roleOf(element) === candidate.role && accessibleName(element) === candidate.name);
      if (matches.length > 0) return { matches, candidate };
      continue;
    }
    if (candidate.value) {
      const matches = queryRoot(root, candidate.value);
      if (matches.length > 0) return { matches, candidate };
    }
  }
  return { matches: [], candidate: null };
}
const currentDocument = {
  url: location.href,
  navigation_start: performance.timeOrigin || performance.timing?.navigationStart || 0,
};
if (
  String(input.document?.url || '') !== currentDocument.url
  || Number(input.document?.navigation_start || 0) !== Number(currentDocument.navigation_start)
) {
  return { ok: false, code: 'DOCUMENT_CHANGED', current_document: currentDocument };
}
const rootResult = resolveRoot(input.node.frame_path, input.node.shadow_path);
if (!rootResult.root) return { ok: false, code: 'NODE_NOT_FOUND', reason: rootResult.error };
const resolved = candidates(rootResult.root, input.node);
if (resolved.matches.length === 0) return { ok: false, code: 'NODE_NOT_FOUND' };
if (resolved.matches.length !== 1) return { ok: false, code: 'NODE_AMBIGUOUS', count: resolved.matches.length };
const element = resolved.matches[0];
const actual = {
  tag: element.tagName.toLowerCase(),
  role: roleOf(element),
  accessible_name: accessibleName(element),
  visible: visibleOf(element),
  enabled: !element.disabled && element.getAttribute('aria-disabled') !== 'true',
};
for (const field of ['tag', 'role', 'accessible_name']) {
  if (input.expected?.[field] !== undefined && input.expected[field] !== actual[field]) {
    return { ok: false, code: 'NODE_EXPECTATION_MISMATCH', field, expected: input.expected[field], actual: actual[field] };
  }
}
if (input.operation !== 'read' && !actual.visible) return { ok: false, code: 'NODE_NOT_VISIBLE' };
if (['click', 'set_value', 'select_option'].includes(input.operation) && !actual.enabled) return { ok: false, code: 'NODE_DISABLED' };
if (input.operation === 'click') element.click();
if (input.operation === 'focus') element.focus();
if (input.operation === 'set_value') {
  if (element.isContentEditable) {
    element.textContent = String(input.value ?? '');
  } else {
    const view = element.ownerDocument?.defaultView || window;
    const prototype = element.tagName.toLowerCase() === 'textarea'
      ? view.HTMLTextAreaElement.prototype
      : view.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, String(input.value ?? '')); else element.value = String(input.value ?? '');
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}
if (input.operation === 'select_option') {
  if (element.tagName.toLowerCase() !== 'select') return { ok: false, code: 'NODE_EXPECTATION_MISMATCH', reason: 'select_option_requires_select' };
  element.value = String(input.value ?? '');
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}
const signature = [element.type, element.name, element.id, element.autocomplete, element.getAttribute('aria-label')].join(' ').toLowerCase();
const sensitive = element.type === 'password' || /password|passwd|pwd|one-time|otp|mfa|token|secret|api.?key/.test(signature);
const currentValue = element.isContentEditable ? String(element.textContent || '') : String(element.value ?? '');
return {
  ok: true,
  operation: input.operation,
  locator_used: resolved.candidate,
  node: {
    node_id: input.node.node_id,
    ...actual,
    focused: document.activeElement === element || rootResult.root.activeElement === element,
    value: input.operation === 'set_value'
      ? { present: Boolean(currentValue), length: currentValue.length, redacted: true, reason: 'write_only_operation' }
      : sensitive
        ? { present: Boolean(currentValue), length: currentValue.length, redacted: true, reason: 'sensitive_field' }
        : currentValue.slice(0, 500),
  },
  page: {
    url: location.href,
    title: document.title,
    navigation_start: performance.timeOrigin || performance.timing?.navigationStart || 0,
  },
};`;

function operationError(result) {
  const retryable = ["NODE_NOT_FOUND", "STALE_NODE_REF", "DOCUMENT_CHANGED"].includes(result?.code);
  return createToolError(result?.code || "EXECUTION_ERROR", result?.reason || "structured operation failed", {
    retryable,
    details: result,
  });
}

async function executeStructuredNodeOperation(args = {}, runtimeOptions = {}) {
  const snapshotStore = runtimeOptions.runtime?.snapshotStore ?? browserSnapshotStore;
  const operation = String(args.operation ?? "").trim();
  if (!SUPPORTED_NODE_OPERATIONS.includes(operation)) {
    throw createToolError("INVALID_ARGUMENT", `unsupported structured operation: ${operation}`, {
      retryable: false,
      details: { supported_operations: SUPPORTED_NODE_OPERATIONS },
    });
  }
  const snapshotId = String(args.node_ref?.snapshot_id ?? "").trim();
  const nodeId = String(args.node_ref?.node_id ?? "").trim();
  if (!snapshotId || !nodeId) {
    throw createToolError("INVALID_ARGUMENT", "structured operation requires node_ref.snapshot_id and node_ref.node_id", {
      retryable: false,
    });
  }
  const snapshot = snapshotStore.get(snapshotId, args, { require_scope: true });
  const managed = await getManagedTab(snapshot.tab_id);
  if (!managed) {
    throw createToolError("TAB_NOT_MANAGED", "snapshot tab is no longer managed", { retryable: false });
  }
  if (managed.suspended === true) {
    throw createToolError("ADOPTED_TAB_SUSPENDED", "adopted tab is suspended after an out-of-band change", {
      retryable: false,
    });
  }
  const node = snapshot.nodes.find((item) => item.node_id === nodeId);
  if (!node) {
    throw createToolError("STALE_NODE_REF", "node_id is not present in the snapshot", { retryable: true });
  }
  const routeArgs = {
    ...args,
    tab_id: snapshot.tab_id,
    switch_tab_id: snapshot.tab_id,
    session_id: snapshot.tab_id,
  };
  const preferred = await resolvePreferredBrowserContext(routeArgs, runtimeOptions);
  const management = await assertManagedExecutionContext(preferred, routeArgs, runtimeOptions);
  const navigationAuthorization = operation === "click"
    ? await authorizeManagedExecutionNavigation(preferred, routeArgs, "structured_click", runtimeOptions)
    : { status: "not_required", authorized: false };
  const observationOptions = args.network_observation?.enabled === true
    ? args.network_observation
    : null;
  const observer = observationOptions
    ? await beginNetworkObservation({
      ...routeArgs,
      ...observationOptions,
      timeout_ms: observationOptions.ttl_ms ?? args.timeout_ms,
    }, { ...runtimeOptions, preferred })
    : null;
  let executed;
  let result;
  let observationWait;
  let observationFinal;
  try {
    executed = await executeBrowserScript(routeArgs, STRUCTURED_OPERATION_BODY, {
      operation,
      node,
      document: {
        url: snapshot.url,
        navigation_start: snapshot.navigation_start,
      },
      expected: args.expected ?? {},
      value: args.value,
    }, { ...runtimeOptions, preferred });
    result = executed.value;
    if (result?.ok !== true) throw operationError(result);
    const currentDocumentId = hashText(`${snapshot.tab_id}|${result.page?.url}|${result.page?.navigation_start}`);
    if (currentDocumentId !== snapshot.document_id && operation !== "click") {
      throw createToolError("DOCUMENT_CHANGED", "document changed since the actionable snapshot was captured", {
        retryable: true,
        details: { snapshot_document_id: snapshot.document_id, current_document_id: currentDocumentId },
      });
    }
    if (result.page?.url && result.page.url !== managed.url) {
      await updateManagedTab(snapshot.tab_id, {
        url: result.page.url,
        title: result.page.title,
        suspended: false,
      });
    }
    if (observer) {
      observationWait = await observer.waitForIdle({
        ...observationOptions,
        timeout_ms: observationOptions.ttl_ms ?? args.timeout_ms,
      });
    }
  } finally {
    if (observer) observationFinal = await observer.stop();
  }
  return {
    status: "success",
    action: "structured_operation",
    operation,
    node_ref: { snapshot_id: snapshotId, node_id: nodeId },
    result: result.node,
    page: result.page,
    transport: executed.transport,
    transport_attempts: executed.transport_attempts,
    management,
    navigation_authorization: navigationAuthorization,
    network_observation_id: observer?.network_observation_id,
    network_observation: observer ? {
      ...observationFinal,
      idle_status: observationWait?.status,
      idle_ms: observationWait?.idle_ms,
      max_inflight: observationWait?.max_inflight,
    } : undefined,
  };
}

export {
  STRUCTURED_OPERATION_BODY,
  SUPPORTED_NODE_OPERATIONS,
  executeStructuredNodeOperation,
};
