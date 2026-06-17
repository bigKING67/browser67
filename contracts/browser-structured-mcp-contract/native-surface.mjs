import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearNativeInputCapabilitiesCache,
  detectNativeInputCapabilities,
} from "../../src/native-capabilities.mjs";
import { buildNativePointerReadinessReport } from "../../src/native-capabilities/pointer-readiness.mjs";
import { detectPhysicalInputCapabilities } from "../../src/physical-input/index.mjs";

async function writeFakePythonProbe(dir, name, payload) {
  const file = path.join(dir, name);
  await fs.writeFile(
    file,
    [
      "#!/bin/sh",
      "cat <<'TMWD_LJQCTRL_JSON'",
      JSON.stringify(payload),
      "TMWD_LJQCTRL_JSON",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  await fs.chmod(file, 0o700);
  return file;
}

async function assertLjqCtrlPythonCandidateSelection() {
  if (process.platform === "win32") {
    return;
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tmwd-ljqctrl-candidates-"));
  const failingPython = await writeFakePythonProbe(tmpDir, "python-no-ljqctrl", {
    ok: false,
    reason: "No module named 'ljqCtrl'",
  });
  const workingPython = await writeFakePythonProbe(tmpDir, "python-with-ljqctrl", {
    ok: true,
    has_click: true,
    has_press: true,
    has_find_block: true,
    has_grab_window: true,
    has_grab_window_bg: false,
    has_mouse_dclick: false,
    dpi_scale: 1,
  });
  const previousPython = process.env.TMWD_LJQCTRL_PYTHON;
  const previousCandidates = process.env.TMWD_LJQCTRL_PYTHON_CANDIDATES;
  const previousExecute = process.env.TMWD_LJQCTRL_EXECUTE;
  try {
    delete process.env.TMWD_LJQCTRL_PYTHON;
    delete process.env.TMWD_LJQCTRL_EXECUTE;
    process.env.TMWD_LJQCTRL_PYTHON_CANDIDATES = [failingPython, workingPython].join(path.delimiter);
    const capabilities = await detectPhysicalInputCapabilities({
      action: "click",
      preferred_provider: "ljq-ctrl",
      ljq_ctrl: {
        probe: true,
        execute: true,
        refresh: true,
        cache_ttl_ms: 0,
      },
    });
    const ljq = capabilities.providers.find((provider) => provider.provider_id === "ljq-ctrl");
    assert.equal(ljq?.status, "available");
    assert.equal(ljq?.platform, process.platform);
    assert.equal(Array.isArray(ljq?.supported_platforms), true);
    assert.equal(ljq.supported_platforms.includes("win32"), true);
    assert.equal(ljq?.platform_supported, process.platform === "win32");
    assert.equal(ljq?.checks?.python, workingPython);
    assert.equal(ljq?.checks?.python_candidate_source, "TMWD_LJQCTRL_PYTHON_CANDIDATES");
    assert.equal(ljq?.checks?.python_selection_reason, "first_importable_candidate");
    assert.equal(ljq?.checks?.ljqctrl_importable, true);
    assert.equal(capabilities.provider_selection?.selected_provider_id, "ljq-ctrl");
    assert.equal(Array.isArray(ljq?.checks?.python_candidates), true);
    assert.equal(ljq.checks.python_candidates.length, 2);
    assert.deepEqual(
      ljq.checks.python_candidates.map((candidate) => ({
        python: candidate.python,
        exists: candidate.exists,
        importable: candidate.importable,
        selected: candidate.selected,
      })),
      [
        { python: failingPython, exists: true, importable: false, selected: false },
        { python: workingPython, exists: true, importable: true, selected: true },
      ],
    );
  } finally {
    if (previousPython === undefined) {
      delete process.env.TMWD_LJQCTRL_PYTHON;
    } else {
      process.env.TMWD_LJQCTRL_PYTHON = previousPython;
    }
    if (previousCandidates === undefined) {
      delete process.env.TMWD_LJQCTRL_PYTHON_CANDIDATES;
    } else {
      process.env.TMWD_LJQCTRL_PYTHON_CANDIDATES = previousCandidates;
    }
    if (previousExecute === undefined) {
      delete process.env.TMWD_LJQCTRL_EXECUTE;
    } else {
      process.env.TMWD_LJQCTRL_EXECUTE = previousExecute;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function assertNativePointerReadinessReportContract() {
  const ready = buildNativePointerReadinessReport({
    platform: "contract-os",
    driver: "contract-driver",
    supported_actions: ["click", "drag", "press"],
    unsupported_actions: ["scroll"],
    checks: { contract_ready: true },
    requirements: [],
    permission_notes: ["contract note"],
  }, {
    check: "contract-pointer-readiness",
    ready_message: "ready contract message",
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.status, "pointer_ready");
  assert.equal(ready.check, "contract-pointer-readiness");
  assert.equal(ready.supports_click, true);
  assert.equal(ready.supports_drag, true);
  assert.deepEqual(ready.next_steps, ["ready contract message"]);
  assert.deepEqual(ready.permission_notes, ["contract note"]);

  const missingWithRequirement = buildNativePointerReadinessReport({
    platform: "contract-os",
    driver: "contract-driver",
    supported_actions: ["press"],
    unsupported_actions: ["click", "drag"],
    checks: { contract_ready: false },
    requirements: ["grant contract permission"],
  }, {
    include_readiness_command: true,
  });
  assert.equal(missingWithRequirement.ok, false);
  assert.equal(missingWithRequirement.status, "requirements_missing");
  assert.equal(missingWithRequirement.supports_click, false);
  assert.equal(missingWithRequirement.supports_drag, false);
  assert.deepEqual(missingWithRequirement.next_steps, [
    "Run npm run check:native-pointer.",
    "grant contract permission",
  ]);

  const missingWithoutRequirement = buildNativePointerReadinessReport({
    platform: "contract-os",
    driver: "contract-driver",
    supported_actions: ["click"],
    unsupported_actions: ["drag"],
    checks: {},
  }, {
    missing_message: "contract missing message",
  });
  assert.equal(missingWithoutRequirement.ok, false);
  assert.equal(missingWithoutRequirement.status, "requirements_missing");
  assert.equal(missingWithoutRequirement.supports_click, true);
  assert.equal(missingWithoutRequirement.supports_drag, false);
  assert.deepEqual(missingWithoutRequirement.requirements, []);
  assert.deepEqual(missingWithoutRequirement.next_steps, ["contract missing message"]);
}

async function assertNativeCapabilitySurface() {
  assertNativePointerReadinessReportContract();
  clearNativeInputCapabilitiesCache();
  const uncachedNativeCapabilities = await detectNativeInputCapabilities({
    cache_ttl_ms: 60_000,
    refresh: true,
  });
  const cachedNativeCapabilities = await detectNativeInputCapabilities({
    cache_ttl_ms: 60_000,
  });
  const physicalInputCapabilities = await detectPhysicalInputCapabilities({
    action: "drag",
    preferred_provider: "auto",
  });

  assert.equal(Array.isArray(physicalInputCapabilities.providers), true);
  assert.equal(
    physicalInputCapabilities.providers.some((provider) => provider.provider_id === "native-os"),
    true,
  );
  assert.equal(
    physicalInputCapabilities.providers.some((provider) => provider.provider_id === "ljq-ctrl"),
    true,
  );
  assert.equal(
    typeof physicalInputCapabilities.providers.find((provider) => provider.provider_id === "ljq-ctrl")?.cache?.status,
    "string",
  );
  assert.equal(typeof physicalInputCapabilities.provider_selection?.reason, "string");
  assert.equal(
    physicalInputCapabilities.capture_provider_selection?.action,
    "capture_window_region",
  );
  assert.equal(typeof physicalInputCapabilities.capture_provider_selection?.reason, "string");
  assert.deepEqual(
    cachedNativeCapabilities.supported_actions,
    uncachedNativeCapabilities.supported_actions,
  );
  assert.deepEqual(
    cachedNativeCapabilities.unsupported_actions,
    uncachedNativeCapabilities.unsupported_actions,
  );
  await assertLjqCtrlPythonCandidateSelection();
}

export { assertNativeCapabilitySurface };
