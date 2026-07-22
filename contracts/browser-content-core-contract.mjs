#!/usr/bin/env node

import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { semanticDiffSnapshots } from "../src/browser/content/semantic-diff.mjs";
import { createSnapshotStore } from "../src/browser/content/snapshot-store.mjs";
import { parseBridgeCommand } from "../src/browser/execution/bridge-command.mjs";
import {
  assertManagedExecutionContext,
  authorizeManagedExecutionNavigation,
  executionMayNavigate,
} from "../src/browser/execution/managed-context.mjs";
import { redactBrowserValue } from "../src/runtime/redaction.mjs";
import { reconcileAdoptedNavigation } from "../src/tab-workspace/navigation-guard.mjs";
import {
  completedOutcome,
  failedOutcome,
} from "../src/runtime/tool-outcome.mjs";

function node(nodeId, overrides = {}) {
  return {
    node_id: nodeId,
    tag: "button",
    role: "button",
    accessible_name: "Submit",
    text: "Submit",
    value: "",
    visible: true,
    enabled: true,
    checked: undefined,
    selected: undefined,
    rect: { x: 10, y: 20, width: 80, height: 30 },
    frame_path: [],
    locator_candidates: [{ type: "marker", value: `[data-browser67-node-id="${nodeId}"]` }],
    ...overrides,
  };
}

async function run() {
  const store = createSnapshotStore({ ttl_ms: 20, max_per_tab: 2, max_global: 3 });
  const before = store.put({
    tab_id: "tab-1",
    document_id: "document-1",
    nodes: [node("node-1"), node("node-removed", { text: "Old" })],
    transients: [],
  }, { workspace_key: "workspace", task_id: "task" });
  const after = store.put({
    tab_id: "tab-1",
    document_id: "document-1",
    nodes: [
      node("node-1", { text: "Submitted", enabled: false }),
      node("node-added", { accessible_name: "Cancel", text: "Cancel" }),
    ],
    transients: [{ type: "status", text: "Saved" }],
  }, { workspace_key: "workspace", task_id: "task" });
  const diff = semanticDiffSnapshots(before, after);
  assert.equal(diff.schema, "browser67.semantic-diff.v2");
  assert.equal(diff.page_state_changed, true);
  assert.equal(diff.document_changed, false);
  assert.equal(diff.summary.added_count, 1);
  assert.equal(diff.summary.removed_count, 1);
  assert.equal(diff.summary.changed_count, 1);
  assert.equal(diff.changed_nodes[0].changes.text.after, "Submitted");
  assert.equal(diff.changed_nodes[0].changes.enabled.after, false);
  assert.equal(diff.transient_changes.changed, true);
  assert.throws(
    () => store.get(before.snapshot_id, { workspace_key: "other" }),
    /another workspace/,
  );
  assert.throws(
    () => store.get(before.snapshot_id, {}, { require_scope: true }),
    /requires its owning workspace/,
  );

  const redacted = redactBrowserValue({
    password: "contract-password",
    password_selector: "#password",
    secret_source: "env",
    cookie_warning: "HttpOnly cookies are unavailable from document context.",
    has_password: true,
    url: "https://example.test/path?token=secret#/route",
    authorization: "Bearer contract-token-value",
    adoption_token: "adopt-safe-routing-token",
  });
  assert.equal(redacted.password.redacted, true);
  assert.equal(redacted.password_selector, "#password");
  assert.equal(redacted.secret_source, "env");
  assert.equal(redacted.cookie_warning, "HttpOnly cookies are unavailable from document context.");
  assert.equal(redacted.has_password, true);
  assert.match(redacted.url, /token=%5BREDACTED%5D/);
  assert.equal(redacted.authorization.redacted, true);
  assert.equal(redacted.adoption_token, "adopt-safe-routing-token");

  const completed = completedOutcome({ status: "success", password: "hidden" });
  assert.equal(completed.schema, "browser67.tool-outcome.v3");
  assert.equal(completed.ok, true);
  assert.equal(completed.status, "completed");
  assert.equal(completed.data.password.redacted, true);
  const failed = failedOutcome(new Error("contract failure"), {
    code: "CONTRACT_FAILURE",
    retryable: false,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "CONTRACT_FAILURE");

  assert.deepEqual(parseBridgeCommand('{"cmd":"tabs"}'), { cmd: "tabs" });
  assert.equal(parseBridgeCommand("{cmd:'tabs'}"), undefined);
  assert.equal(parseBridgeCommand("(() => ({ cmd: 'tabs' }))()"), undefined);
  await assert.rejects(
    () => assertManagedExecutionContext({
      transport: "tmwd_ws",
      context: { target: { id: "user-tab" } },
    }, {}, { get_managed_tab: async () => null }),
    (error) => error?.errorCode === "TAB_NOT_MANAGED",
  );
  const managedContext = await assertManagedExecutionContext({
    transport: "tmwd_ws",
    context: {
      endpoint: "ws://contract.test",
      connection_generation: 1,
      target: { id: "managed-tab", url: "https://example.test/adopted", title: "Adopted" },
    },
  }, { workspace_key: "workspace" }, {
    get_managed_tab: async () => ({
      tab_id: "managed-tab",
      workspace_key: "workspace",
      task_id: "task",
      ownership_origin: "user_adopted",
      ownership_generation: "ownership-1",
      lease_id: "lease-1",
      connection_generation: "tmwd_ws:ws://contract.test:1",
      navigation_generation: 2,
      suspended: false,
    }),
    read_policy_status: async () => ({
      managed: true,
      ownership_generation: "ownership-1",
      lease_id: "lease-1",
      navigation_generation: 2,
      last_navigation_actor: "none",
      last_navigation_url: "https://example.test/adopted",
    }),
    update_managed_tab: async (_tabId, patch) => patch,
  });
  assert.equal(managedContext.ownership_origin, "user_adopted");
  const remoteContext = await assertManagedExecutionContext(
    { transport: "cdp" },
    { tmwd_mode: "remote_cdp" },
  );
  assert.equal(remoteContext.reason, "explicit_remote_cdp");
  await assert.rejects(
    () => assertManagedExecutionContext({ transport: "cdp" }, { tmwd_mode: "auto" }),
    (error) => error?.errorCode === "TMWD_REQUIRED",
  );

  const adoptedBase = {
    tab_id: "managed-tab",
    workspace_key: "workspace",
    task_id: "task",
    ownership_origin: "user_adopted",
    ownership_generation: "ownership-1",
    lease_id: "lease-1",
    connection_generation: "tmwd_ws:ws://contract.test:1",
    navigation_generation: 2,
    navigation_authorization_id: "navigation-1",
    suspended: false,
    url: "https://example.test/adopted",
  };
  let authorizedPatch;
  const authorizedContext = await assertManagedExecutionContext({
    transport: "tmwd_ws",
    context: {
      endpoint: "ws://contract.test",
      connection_generation: 1,
      target: { id: "managed-tab", url: "https://example.test/agent-navigation", title: "Agent" },
    },
  }, { workspace_key: "workspace", task_id: "task" }, {
    get_managed_tab: async () => adoptedBase,
    read_policy_status: async () => ({
      managed: true,
      ownership_generation: "ownership-1",
      lease_id: "lease-1",
      navigation_generation: 3,
      last_navigation_actor: "agent_authorized",
      last_navigation_authorization_id: "navigation-1",
      last_navigation_url: "https://example.test/agent-navigation",
    }),
    update_managed_tab: async (_tabId, patch) => {
      authorizedPatch = patch;
      return patch;
    },
  });
  assert.equal(authorizedContext.navigation_guard.status, "authorized_navigation_accepted");
  assert.equal(authorizedPatch.suspended, false);
  assert.equal(authorizedPatch.navigation_generation, 3);

  let outOfBandPatch;
  await assert.rejects(
    () => assertManagedExecutionContext({
      transport: "tmwd_ws",
      context: {
        endpoint: "ws://contract.test",
        connection_generation: 1,
        target: { id: "managed-tab", url: "https://example.test/user-navigation", title: "User" },
      },
    }, { workspace_key: "workspace", task_id: "task" }, {
      get_managed_tab: async () => ({ ...adoptedBase, navigation_authorization_id: "" }),
      read_policy_status: async () => ({
        managed: true,
        ownership_generation: "ownership-1",
        lease_id: "lease-1",
        navigation_generation: 3,
        last_navigation_actor: "out_of_band",
        last_navigation_url: "https://example.test/user-navigation",
      }),
      update_managed_tab: async (_tabId, patch) => {
        outOfBandPatch = patch;
        return patch;
      },
    }),
    (error) => error?.errorCode === "ADOPTED_TAB_SUSPENDED",
  );
  assert.equal(outOfBandPatch.suspended, true);
  assert.equal(outOfBandPatch.suspension_reason, "out_of_band_navigation");

  const connectionMismatch = reconcileAdoptedNavigation(adoptedBase, {
    connection_generation: "tmwd_ws:ws://contract.test:2",
    policy_status: {
      managed: true,
      ownership_generation: "ownership-1",
      lease_id: "lease-1",
      navigation_generation: 2,
    },
  });
  assert.equal(connectionMismatch.record.suspended, true);
  assert.equal(connectionMismatch.reason, "connection_generation_changed");
  const ownershipMismatch = reconcileAdoptedNavigation(adoptedBase, {
    connection_generation: adoptedBase.connection_generation,
    policy_status: {
      managed: true,
      ownership_generation: "ownership-other",
      lease_id: "lease-1",
      navigation_generation: 2,
    },
  });
  assert.equal(ownershipMismatch.record.suspended, true);
  assert.equal(ownershipMismatch.reason, "ownership_or_lease_changed");

  let authorizationPatch;
  const authorization = await authorizeManagedExecutionNavigation({
    transport: "tmwd_ws",
    context: { target: { id: "managed-tab" } },
  }, { workspace_key: "workspace", task_id: "task" }, "contract_navigation", {
    get_managed_tab: async () => adoptedBase,
    authorize_navigation: async () => ({
      authorized: true,
      navigation_authorization_id: "navigation-contract",
      navigation_authorized_until: new Date(Date.now() + 5_000).toISOString(),
      navigation_authorized_reason: "contract_navigation",
    }),
    update_managed_tab: async (_tabId, patch) => {
      authorizationPatch = patch;
      return patch;
    },
  });
  assert.equal(authorization.authorized, true);
  assert.equal(authorizationPatch.navigation_authorization_id, "navigation-contract");
  assert.equal(executionMayNavigate("document.querySelector('button').click()"), true);
  assert.equal(executionMayNavigate("return document.title"), false);

  await delay(25);
  assert.throws(() => store.get(after.snapshot_id), /missing or expired/);
  await store.dispose();
  assert.equal(store.stats().snapshot_count, 0);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "browser-content-core-contract",
    diff_summary: diff.summary,
    redaction: true,
    snapshot_ttl: true,
    strict_bridge_json: true,
    managed_raw_execution: true,
    explicit_remote_cdp_boundary: true,
    adopted_navigation_guard: true,
  })}\n`);
}

run().catch((error) => {
  process.stderr.write(`browser-content-core-contract failed: ${error?.stack || String(error)}\n`);
  process.exitCode = 1;
});
