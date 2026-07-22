import { randomId } from "../../common.mjs";
import { createToolError } from "../../errors.mjs";

const DEFAULT_SNAPSHOT_TTL_MS = 5 * 60_000;
const MAX_SNAPSHOTS_PER_TAB = 8;
const MAX_SNAPSHOTS_GLOBAL = 64;

function createSnapshotStore(options = {}) {
  const ttlMs = Number(options.ttl_ms ?? DEFAULT_SNAPSHOT_TTL_MS);
  const maxPerTab = Number(options.max_per_tab ?? MAX_SNAPSHOTS_PER_TAB);
  const maxGlobal = Number(options.max_global ?? MAX_SNAPSHOTS_GLOBAL);
  const snapshots = new Map();

  function evictExpired() {
    const now = Date.now();
    for (const [id, entry] of snapshots) {
      if (entry.expires_at_ms <= now) snapshots.delete(id);
    }
  }

  function enforceBounds(tabId) {
    const tabEntries = [...snapshots.values()]
      .filter((entry) => entry.tab_id === tabId)
      .sort((left, right) => left.created_at_ms - right.created_at_ms);
    while (tabEntries.length >= maxPerTab) {
      snapshots.delete(tabEntries.shift().snapshot_id);
    }
    const all = [...snapshots.values()].sort((left, right) => left.created_at_ms - right.created_at_ms);
    while (all.length >= maxGlobal) {
      snapshots.delete(all.shift().snapshot_id);
    }
  }

  function put(snapshot, scope = {}) {
    evictExpired();
    const tabId = String(snapshot?.tab_id ?? "").trim();
    if (!tabId) {
      throw new Error("snapshot requires tab_id");
    }
    enforceBounds(tabId);
    const createdAtMs = Date.now();
    const snapshotId = String(snapshot.snapshot_id || randomId("snapshot"));
    const entry = Object.freeze({
      ...snapshot,
      snapshot_id: snapshotId,
      tab_id: tabId,
      workspace_key: String(scope.workspace_key ?? snapshot.workspace_key ?? ""),
      task_id: String(scope.task_id ?? snapshot.task_id ?? ""),
      created_at_ms: createdAtMs,
      expires_at_ms: createdAtMs + ttlMs,
    });
    snapshots.set(snapshotId, entry);
    return entry;
  }

  function get(snapshotId, scope = {}, options = {}) {
    evictExpired();
    const entry = snapshots.get(String(snapshotId ?? ""));
    if (!entry) {
      throw createToolError("STALE_NODE_REF", "snapshot is missing or expired", {
        retryable: true,
      });
    }
    const workspaceKey = String(scope.workspace_key ?? "");
    const taskId = String(scope.task_id ?? "");
    if (
      options.require_scope === true
      && ((entry.workspace_key && workspaceKey !== entry.workspace_key)
        || (entry.task_id && taskId !== entry.task_id))
    ) {
      throw createToolError("SNAPSHOT_SCOPE_MISMATCH", "snapshot requires its owning workspace/task scope", {
        retryable: false,
      });
    }
    if (
      (workspaceKey && entry.workspace_key !== workspaceKey)
      || (taskId && entry.task_id !== taskId)
    ) {
      throw createToolError("SNAPSHOT_SCOPE_MISMATCH", "snapshot belongs to another workspace/task", {
        retryable: false,
      });
    }
    return entry;
  }

  function invalidateTab(tabId) {
    for (const [id, entry] of snapshots) {
      if (entry.tab_id === String(tabId ?? "")) snapshots.delete(id);
    }
  }

  function stats() {
    evictExpired();
    return { snapshot_count: snapshots.size, ttl_ms: ttlMs, max_per_tab: maxPerTab, max_global: maxGlobal };
  }

  async function dispose() {
    snapshots.clear();
  }

  return Object.freeze({ dispose, get, invalidateTab, put, stats });
}

const browserSnapshotStore = createSnapshotStore();

export {
  DEFAULT_SNAPSHOT_TTL_MS,
  MAX_SNAPSHOTS_GLOBAL,
  MAX_SNAPSHOTS_PER_TAB,
  browserSnapshotStore,
  createSnapshotStore,
};
