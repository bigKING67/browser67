import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

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

function runReadinessAudit(env = {}) {
  const result = spawnSync("node", ["scripts/readiness-audit.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

function findGap(audit, id) {
  return audit.optional_gaps.find((gap) => gap.id === id);
}

async function assertReadinessLjqCtrlProbeContract() {
  if (process.platform === "win32") {
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tmwd-readiness-ljqctrl-"));
  try {
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

    const availableAudit = runReadinessAudit({
      TMWD_LJQCTRL_PYTHON_CANDIDATES: [failingPython, workingPython].join(path.delimiter),
      TMWD_LJQCTRL_EXECUTE: "",
    });
    const availableGap = findGap(availableAudit, "ljqctrl_probe_available_execution_gated");
    assert.equal(availableGap?.deduction, 0);
    assert.match(availableGap?.evidence ?? "", /importable=true/);
    assert.match(availableGap?.evidence ?? "", /execution_bridge_enabled=false/);
    assert.equal(findGap(availableAudit, "ljqctrl_not_configured"), undefined);
    assert.equal(findGap(availableAudit, "ljqctrl_config_invalid"), undefined);

    const executableAudit = runReadinessAudit({
      TMWD_LJQCTRL_PYTHON_CANDIDATES: [failingPython, workingPython].join(path.delimiter),
      TMWD_LJQCTRL_EXECUTE: "1",
    });
    const executableGap = findGap(executableAudit, "ljqctrl_execution_bridge_available");
    assert.equal(executableGap?.deduction, 0);
    assert.match(executableGap?.evidence ?? "", /execution_bridge_enabled=true/);

    const invalidAudit = runReadinessAudit({
      TMWD_LJQCTRL_PYTHON: failingPython,
      TMWD_LJQCTRL_PYTHON_CANDIDATES: "",
      TMWD_LJQCTRL_EXECUTE: "",
    });
    const invalidGap = findGap(invalidAudit, "ljqctrl_config_invalid");
    assert.equal(invalidGap?.deduction, 0.006);
    assert.match(invalidGap?.evidence ?? "", /source=TMWD_LJQCTRL_PYTHON/);
    assert.match(invalidGap?.evidence ?? "", /importable=false/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export { assertReadinessLjqCtrlProbeContract };
