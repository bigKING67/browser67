import assert from "node:assert/strict";

import { pruneStaleRegistryRecords } from "../../src/js-reverse-server/finalizer.mjs";

function managedRecord(browserInstanceId, tabId) {
  return {
    browser_instance_id: browserInstanceId,
    browser_instance_identity: browserInstanceId ? "resolved" : "legacy_unresolved",
    tab_id: tabId,
    session_key: browserInstanceId ? `${browserInstanceId}:${tabId}` : `__browser67_legacy_unresolved__:${tabId}`,
  };
}

async function runBrowserInstancePruneCases() {
  const records = [
    managedRecord("browser-instance-a", "123"),
    managedRecord("browser-instance-a", "456"),
    managedRecord("browser-instance-b", "123"),
    managedRecord("", "123"),
  ];
  const bridgeCalls = [];
  const deleted = [];
  const result = await pruneStaleRegistryRecords({ dry_run: false }, {
    all: false,
    scope: "workspace",
    taskId: "",
    workspaceKey: "multi-instance-prune-contract",
  }, {
    recordsInScope: async () => records,
    bridgeCommand: async (args, command) => {
      bridgeCalls.push({ args, command });
      if (args.browser_instance_id === "browser-instance-b") {
        const error = new Error("configured Browser Instance is unavailable");
        error.code = "BROWSER_INSTANCE_UNAVAILABLE";
        throw error;
      }
      return {
        value: [{
          browser_instance_id: "browser-instance-a",
          id: "123",
          tab_id: "123",
        }],
        transport: "tmwd_ws",
        transport_attempts: [{ transport: "tmwd_ws", ok: true }],
      };
    },
    deleteManagedTab: async (tabId, browserInstanceId) => {
      deleted.push({ tab_id: tabId, browser_instance_id: browserInstanceId });
    },
  });

  assert.deepEqual(
    bridgeCalls.map((call) => call.args.browser_instance_id).sort(),
    ["browser-instance-a", "browser-instance-b"],
    "prune must query each Browser Instance explicitly",
  );
  assert.deepEqual(
    bridgeCalls.map((call) => call.command),
    [{ cmd: "tabs" }, { cmd: "tabs" }],
  );
  assert.deepEqual(deleted, [{
    tab_id: "456",
    browser_instance_id: "browser-instance-a",
  }]);
  assert.equal(result.checked_count, 4);
  assert.equal(result.would_prune_count, 1);
  assert.equal(result.pruned_count, 1);
  assert.equal(result.preserved_count, 3);
  assert.equal(
    result.kept.some((record) => (
      record.browser_instance_id === "browser-instance-a"
      && record.tab_id === "123"
      && record.reason === "live"
    )),
    true,
  );
  assert.equal(
    result.kept.some((record) => (
      record.browser_instance_id === "browser-instance-b"
      && record.tab_id === "123"
      && record.reason === "live_check_unavailable"
      && record.error_code === "BROWSER_INSTANCE_UNAVAILABLE"
    )),
    true,
    "an unavailable Browser Instance must be preserved rather than pruned",
  );
  assert.equal(
    result.kept.some((record) => (
      record.browser_instance_id === undefined
      && record.tab_id === "123"
      && record.reason === "legacy_browser_instance_unresolved"
    )),
    true,
    "legacy records without a Browser Instance identity must remain unresolved",
  );
}

export {
  runBrowserInstancePruneCases,
};
