import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

function managedRecord(tabId, patch = {}) {
  const now = new Date().toISOString();
  return {
    tab_id: tabId,
    owner: "tmwd",
    source: "contract",
    workspace_key: "cleanup-contract",
    reuse_key: `http://cleanup.example/${tabId}`,
    url: `http://cleanup.example/${tabId}`,
    title: tabId,
    origin: "http://cleanup.example",
    path_scope: `/${tabId}`,
    keep: false,
    dry_run: false,
    status: "open",
    created_at: now,
    updated_at: now,
    last_used_at: now,
    ...patch,
  };
}

async function writeRegistry(registryPath, records = []) {
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, `${JSON.stringify({
    version: 1,
    updated_at: new Date().toISOString(),
    managed_tabs: records,
  }, null, 2)}\n`);
}

function runCleanupScript(args = [], env = {}) {
  const result = spawnSync("node", ["scripts/check-managed-tab-cleanup.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
  const text = String(result.stdout || result.stderr || "").trim();
  let payload = null;
  if (text.startsWith("{")) {
    payload = JSON.parse(text);
  }
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    payload,
  };
}

async function assertManagedTabCleanupBaselineContract() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tmwd-managed-cleanup-contract-"));
  const registryPath = path.join(tmpDir, "managed-tabs.json");
  const baselinePath = path.join(tmpDir, "baseline.json");
  const env = {
    BROWSER_STRUCTURED_TAB_REGISTRY_PATH: registryPath,
  };
  try {
    await writeRegistry(registryPath, [
      managedRecord("pre-existing-unkept"),
      managedRecord("pre-existing-kept", { keep: true }),
    ]);

    const writeBaseline = runCleanupScript(["--write-baseline", baselinePath, "--json"], env);
    assert.equal(writeBaseline.status, 0, writeBaseline.stderr || writeBaseline.stdout);
    assert.equal(writeBaseline.payload?.status, "baseline_written");
    assert.equal(writeBaseline.payload?.unkept_count, 1);
    assert.deepEqual(writeBaseline.payload?.unkept_tab_ids, ["pre-existing-unkept"]);
    assert.deepEqual(writeBaseline.payload?.kept_tab_ids, ["pre-existing-kept"]);

    const overwriteBaseline = runCleanupScript(["--write-baseline", baselinePath, "--json"], env);
    assert.notEqual(overwriteBaseline.status, 0);

    const cleanWithBaseline = runCleanupScript(["--baseline-file", baselinePath, "--json"], env);
    assert.equal(cleanWithBaseline.status, 0, cleanWithBaseline.stderr || cleanWithBaseline.stdout);
    assert.equal(cleanWithBaseline.payload?.ok, true);
    assert.equal(cleanWithBaseline.payload?.effective_unkept_count, 0);
    assert.equal(cleanWithBaseline.payload?.ignored_preexisting_unkept_count, 1);

    await writeRegistry(registryPath, [
      managedRecord("pre-existing-unkept"),
      managedRecord("new-unkept"),
      managedRecord("pre-existing-kept", { keep: true }),
    ]);
    const leakedAfterBaseline = runCleanupScript(["--baseline-file", baselinePath, "--json"], env);
    assert.equal(leakedAfterBaseline.status, 1);
    assert.equal(leakedAfterBaseline.payload?.ok, false);
    assert.equal(leakedAfterBaseline.payload?.effective_unkept_count, 1);
    assert.equal(leakedAfterBaseline.payload?.ignored_preexisting_unkept_count, 1);
    assert.equal(leakedAfterBaseline.payload?.unkept?.[0]?.tab_id, "new-unkept");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export { assertManagedTabCleanupBaselineContract };
