import assert from "node:assert/strict";

import { handleFinalizeTask } from "../../src/js-reverse-server/finalizer.mjs";
import {
  appendServerEvidence,
  createJsReverseStateStore,
  listServerEvidence,
  listServerHooks,
  setServerHook,
} from "../../src/js-reverse-server/state.mjs";

async function runStateCases() {
  let nowMs = 1_000;
  const store = createJsReverseStateStore({
    now: () => nowMs,
    limits: {
      hooks_per_scope: 2,
      hooks_global: 3,
      evidence_per_scope: 2,
      evidence_global: 3,
      evidence_bytes_per_scope: 1_000,
      evidence_bytes_global: 1_500,
      ttl_ms: 500,
    },
  });
  const scopeA = { workspace_key: "workspace-a", task_id: "task-a" };
  const scopeB = { workspace_key: "workspace-b", task_id: "task-b" };

  store.setHook(scopeA, { id: "shared", enabled: false });
  store.setHook(scopeB, { id: "shared", enabled: true });
  assert.equal(store.getHook(scopeA, "shared")?.enabled, false);
  assert.equal(store.getHook(scopeB, "shared")?.enabled, true);
  assert.equal(store.listHooks(scopeA).length, 1);
  assert.equal(store.listHooks({ workspace_key: "workspace-c", task_id: "task-c" }).length, 0);

  nowMs += 1;
  store.setHook(scopeA, { id: "scope-a-2" });
  nowMs += 1;
  store.setHook(scopeA, { id: "scope-a-3" });
  assert.deepEqual(store.listHooks(scopeA).map((hook) => hook.id), ["scope-a-2", "scope-a-3"]);
  assert.equal(store.stats().hooks_count, 3);

  store.appendEvidence(scopeA, { id: "evidence-a-1", value: "a" });
  nowMs += 1;
  store.appendEvidence(scopeA, { id: "evidence-a-2", value: "b" });
  nowMs += 1;
  store.appendEvidence(scopeA, { id: "evidence-a-3", value: "c" });
  assert.deepEqual(
    store.listEvidence(scopeA).map((entry) => entry.id),
    ["evidence-a-2", "evidence-a-3"],
  );
  store.appendEvidence(scopeB, { id: "evidence-b-1", value: "d" });
  assert.equal(store.stats().evidence_count, 3);

  const cleared = store.clearScope(scopeA);
  assert.equal(cleared.hooks_removed, 2);
  assert.equal(cleared.evidence_removed, 2);
  assert.equal(store.listHooks(scopeB).length, 1);
  assert.equal(store.listEvidence(scopeB).length, 1);

  nowMs += 501;
  assert.equal(store.listHooks(scopeB).length, 0);
  assert.equal(store.listEvidence(scopeB).length, 0);

  store.setHook(scopeA, { id: "after-ttl" });
  store.appendEvidence(scopeA, { id: "after-ttl-evidence" });
  const disposed = store.dispose();
  assert.equal(disposed.hooks_removed, 1);
  assert.equal(disposed.evidence_removed, 1);
  assert.deepEqual(store.stats(), {
    hooks_count: 0,
    evidence_count: 0,
    evidence_bytes: 0,
    scopes_count: 0,
  });

  const finalizedScope = { workspace_key: "finalizer-workspace", task_id: "finalizer-task" };
  setServerHook(finalizedScope, { id: "finalizer-hook" });
  appendServerEvidence(finalizedScope, { id: "finalizer-evidence" });
  const dryRun = await handleFinalizeTask({
    ...finalizedScope,
    prune_stale: false,
    dry_run: true,
  });
  assert.equal(dryRun.server_state_cleanup.status, "dry_run");
  assert.equal(listServerHooks(finalizedScope).length, 1);
  assert.equal(listServerEvidence(finalizedScope).length, 1);
  const finalized = await handleFinalizeTask({
    ...finalizedScope,
    prune_stale: false,
  });
  assert.equal(finalized.ok, true);
  assert.equal(finalized.server_state_cleanup.status, "cleared");
  assert.equal(finalized.server_state_cleanup.hooks_removed, 1);
  assert.equal(finalized.server_state_cleanup.evidence_removed, 1);
  assert.equal(listServerHooks(finalizedScope).length, 0);
  assert.equal(listServerEvidence(finalizedScope).length, 0);
}

export {
  runStateCases,
};
