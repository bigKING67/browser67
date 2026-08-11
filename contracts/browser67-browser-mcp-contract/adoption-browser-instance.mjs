import assert from "node:assert/strict";

import {
  adoptExisting,
  closeAdopted,
  createAdoptionRuntime,
} from "../../src/tab-workspace/adoption.mjs";

async function expectTargetMismatch(callback) {
  await assert.rejects(callback, (error) => {
    assert.equal(error?.errorCode, "ADOPTION_TARGET_CHANGED");
    assert.equal(error?.retryable, false);
    assert.equal(error?.details?.token_browser_instance_id, "browser-instance-a");
    assert.equal(error?.details?.requested_browser_instance_id, "browser-instance-b");
    return true;
  });
}

async function assertAdoptionBrowserInstanceBinding() {
  const now = Date.now();
  const runtime = createAdoptionRuntime({
    now: () => now,
    runtime_id: "browser-instance-adoption-contract",
    start_timer: false,
  });
  runtime.putAdoptionToken("adopt-instance-a", {
    token: "adopt-instance-a",
    tab_id: "same-tab-id",
    browser_instance_id: "browser-instance-a",
    scope: { workspace_key: "adoption-contract", task_id: "adoption-contract" },
    document_identity: "document-a",
    connection_generation: "connection-a",
    ownership_generation: "unmanaged",
    route_args: { browser_instance_id: "browser-instance-a" },
    expires_at_ms: now + 60_000,
  });
  await expectTargetMismatch(() => adoptExisting({
    adoption_token: "adopt-instance-a",
    browser_instance_id: "browser-instance-b",
    tab_id: "same-tab-id",
    confirm_adopt: true,
  }, { adoptionRuntime: runtime }));
  assert.equal(
    runtime.adoptionTokens.has("adopt-instance-a"),
    true,
    "a cross-instance attempt must not consume the valid adoption token",
  );

  runtime.putCloseToken("close-instance-a", {
    tab_id: "same-tab-id",
    browser_instance_id: "browser-instance-a",
    scope: { workspace_key: "adoption-contract", task_id: "adoption-contract" },
    ownership_generation: "ownership-a",
    lease_id: "lease-a",
    route_args: { browser_instance_id: "browser-instance-a" },
    expires_at_ms: now + 30_000,
  });
  await expectTargetMismatch(() => closeAdopted({
    close_token: "close-instance-a",
    browser_instance_id: "browser-instance-b",
    tab_id: "same-tab-id",
    close_adopted: true,
    confirm_close_adopted: true,
  }, { adoptionRuntime: runtime }));
  assert.equal(
    runtime.closeTokens.has("close-instance-a"),
    true,
    "a cross-instance attempt must not consume the valid close token",
  );
}

export {
  assertAdoptionBrowserInstanceBinding,
};
