import {
  captureActionableSnapshot,
  publicSnapshot,
} from "../../browser/content/actionable-snapshot.mjs";
import {
  diffStoredSnapshots,
  semanticDiffSnapshots,
} from "../../browser/content/semantic-diff.mjs";
import { browserSnapshotStore } from "../../browser/content/snapshot-store.mjs";
import { createToolError } from "../../errors.mjs";

async function handleBrowserExtract(args = {}) {
  const snapshot = await captureActionableSnapshot(args);
  return publicSnapshot(snapshot);
}

async function handleBrowserDiff(args = {}) {
  const beforeSnapshotId = String(args.before_snapshot_id ?? "").trim();
  if (!beforeSnapshotId) {
    throw createToolError("INVALID_ARGUMENT", "before_snapshot_id is required", { retryable: false });
  }
  if (args.capture_after === true) {
    const before = browserSnapshotStore.get(beforeSnapshotId, args, { require_scope: true });
    const after = await captureActionableSnapshot({
      ...args,
      tab_id: before.tab_id,
      switch_tab_id: before.tab_id,
      session_id: before.tab_id,
    });
    if (before.workspace_key !== after.workspace_key || before.task_id !== after.task_id) {
      throw createToolError("SNAPSHOT_SCOPE_MISMATCH", "captured snapshot scope changed", {
        retryable: false,
      });
    }
    return semanticDiffSnapshots(before, after);
  }
  const afterSnapshotId = String(args.after_snapshot_id ?? "").trim();
  if (!afterSnapshotId) {
    throw createToolError(
      "INVALID_ARGUMENT",
      "after_snapshot_id is required unless capture_after=true",
      { retryable: false },
    );
  }
  return diffStoredSnapshots({
    ...args,
    before_snapshot_id: beforeSnapshotId,
    after_snapshot_id: afterSnapshotId,
  });
}

export { handleBrowserDiff, handleBrowserExtract };
