import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  commandExists,
  ensureNativeCommandOk,
  normalizeCoordinate,
  parseJsonFromCommandOutput,
  runNativeCommand,
} from "../../native-core.mjs";

const PROVIDER_ID = "ljq-ctrl";
const SUPPORTED_PLATFORMS = ["win32"];
const DEFAULT_PYTHON_CANDIDATES = process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
const LJQ_BRIDGE_TIMEOUT_MS = 5_000;
const CAPTURE_DIR = path.join(tmpdir(), "tmwd-physical-input-captures");
const DEFAULT_CAPABILITY_CACHE_TTL_MS = 5_000;
const MACLJQ_REFERENCE_SOURCE = "docs/upstream/genericagent/macljqCtrl.py";
const MACLJQ_MODULES = [
  "Quartz",
  "AppKit",
  "ApplicationServices",
  "PIL",
  "cv2",
  "numpy",
];
let capabilityCache = null;

function envEnabled(name) {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function normalizeCandidate(raw) {
  const value = String(raw ?? "").trim();
  if (
    value.length >= 2
    && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function uniqueCandidates(candidates = []) {
  const seen = new Set();
  const normalized = [];
  for (const candidate of candidates) {
    const value = normalizeCandidate(candidate);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function configuredPythonCandidates() {
  const configured = normalizeCandidate(process.env.TMWD_LJQCTRL_PYTHON);
  if (configured) {
    return {
      source: "TMWD_LJQCTRL_PYTHON",
      candidates: [configured],
    };
  }
  const configuredCandidates = uniqueCandidates(
    String(process.env.TMWD_LJQCTRL_PYTHON_CANDIDATES ?? "")
      .split(path.delimiter),
  );
  if (configuredCandidates.length > 0) {
    return {
      source: "TMWD_LJQCTRL_PYTHON_CANDIDATES",
      candidates: configuredCandidates,
    };
  }
  return {
    source: "default",
    candidates: uniqueCandidates(DEFAULT_PYTHON_CANDIDATES),
  };
}

function compactReason(reason) {
  return String(reason ?? "unknown").slice(0, 300);
}

function summarizePythonCandidate(row = {}, selectedBinary = null) {
  const probe = row.probe && typeof row.probe === "object" ? row.probe : {};
  return {
    python: row.binary,
    exists: row.exists === true,
    importable: row.importable === true,
    selected: Boolean(selectedBinary && row.binary === selectedBinary),
    reason: row.importable === true ? undefined : compactReason(probe.reason),
    has_click: probe.has_click === true ? true : undefined,
    has_press: probe.has_press === true ? true : undefined,
    has_find_block: probe.has_find_block === true ? true : undefined,
    has_grab_window: probe.has_grab_window === true ? true : undefined,
    has_grab_window_bg: probe.has_grab_window_bg === true ? true : undefined,
    dpi_scale: probe.dpi_scale ?? undefined,
  };
}

async function probePythonCandidates() {
  const configured = configuredPythonCandidates();
  const rows = await Promise.all(configured.candidates.map(async (binary) => {
    const exists = await commandExists(binary, 1_200);
    const probe = exists ? await probeLjqCtrlApi(binary) : { ok: false, reason: "python_unavailable" };
    return {
      binary,
      exists,
      importable: probe.ok === true,
      probe,
    };
  }));
  const selected = rows.find((entry) => entry.importable)
    ?? rows.find((entry) => entry.exists)
    ?? rows[0]
    ?? null;
  const selectedBinary = selected?.binary ?? null;
  return {
    source: configured.source,
    rows,
    selected,
    selected_binary: selectedBinary,
    summaries: rows.map((row) => summarizePythonCandidate(row, selectedBinary)),
    selection_reason: selected?.importable === true
      ? "first_importable_candidate"
      : (selected?.exists === true ? "first_available_candidate_without_ljqctrl" : "no_available_python_candidate"),
  };
}

function executionBridgeEnabled(options = {}) {
  return options?.execute === true || envEnabled("TMWD_LJQCTRL_EXECUTE");
}

function platformSupported() {
  return SUPPORTED_PLATFORMS.includes(process.platform);
}

function cloneJson(value) {
  return structuredClone(value);
}

function normalizeCacheTtlMs(raw) {
  const parsed = Number(raw ?? DEFAULT_CAPABILITY_CACHE_TTL_MS);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CAPABILITY_CACHE_TTL_MS;
  }
  return Math.max(0, Math.min(60_000, Math.floor(parsed)));
}

function capabilityCacheKey(options = {}) {
  return JSON.stringify({
    platform: process.platform,
    path: process.env.PATH ?? "",
    python: process.env.TMWD_LJQCTRL_PYTHON ?? "",
    python_candidates: process.env.TMWD_LJQCTRL_PYTHON_CANDIDATES ?? "",
    probe: options?.probe === true || envEnabled("TMWD_LJQCTRL_PROBE"),
    execute: executionBridgeEnabled(options),
  });
}

async function probeLjqCtrlApi(pythonBinary) {
  if (!pythonBinary) {
    return {
      ok: false,
      reason: "python_unavailable",
    };
  }
  const script = [
    "import json",
    "try:",
    "    import ljqCtrl",
    "    print(json.dumps({",
    "        'ok': True,",
    "        'has_click': hasattr(ljqCtrl, 'Click'),",
    "        'has_press': hasattr(ljqCtrl, 'Press'),",
    "        'has_find_block': hasattr(ljqCtrl, 'FindBlock'),",
    "        'has_grab_window': hasattr(ljqCtrl, 'GrabWindow'),",
    "        'has_grab_window_bg': hasattr(ljqCtrl, 'GrabWindowBg'),",
    "        'has_mouse_dclick': hasattr(ljqCtrl, 'MouseDClick'),",
    "        'dpi_scale': getattr(ljqCtrl, 'dpi_scale', None),",
    "    }))",
    "except Exception as exc:",
    "    print(json.dumps({'ok': False, 'reason': str(exc)[:300]}))",
  ].join("\n");
  try {
    const result = await runNativeCommand(pythonBinary, ["-c", script], { timeoutMs: LJQ_BRIDGE_TIMEOUT_MS });
    const parsed = parseJsonFromCommandOutput(result.stdout);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return {
      ok: false,
      reason: "invalid_probe_output",
    };
  } catch (error) {
    return {
      ok: false,
      reason: String(error?.message ?? error).slice(0, 300),
    };
  }
}

async function probeMacLjqCtrlReadiness(pythonProbe = {}) {
  const base = {
    platform: process.platform,
    reference_source: MACLJQ_REFERENCE_SOURCE,
    coordinate_model: "physical_screen_pixels_with_crop_origin",
    optional_dependencies: [...MACLJQ_MODULES],
    permissions: {
      accessibility: "unknown_or_not_checked_by_default",
      screen_recording: "unknown_or_not_checked_by_default",
    },
    execution_default: "disabled_reference_only",
  };
  if (process.platform !== "darwin") {
    return {
      ...base,
      status: "not_applicable",
      missing_dependencies: [],
      available_dependencies: [],
      reason: "macljqCtrl is a macOS reference path.",
    };
  }
  const selected = pythonProbe.selected?.exists === true
    ? pythonProbe.selected
    : pythonProbe.rows?.find((row) => row.exists === true);
  const pythonBinary = selected?.binary;
  if (!pythonBinary) {
    return {
      ...base,
      status: "not_configured",
      python: undefined,
      missing_dependencies: [...MACLJQ_MODULES],
      available_dependencies: [],
      reason: "no Python candidate available for macljqCtrl dependency diagnostics",
    };
  }
  const script = [
    "import importlib.util, json",
    `mods = ${JSON.stringify(MACLJQ_MODULES)}`,
    "available = {m: importlib.util.find_spec(m) is not None for m in mods}",
    "print(json.dumps({'ok': True, 'available': available}))",
  ].join("\n");
  try {
    const result = await runNativeCommand(pythonBinary, ["-c", script], { timeoutMs: LJQ_BRIDGE_TIMEOUT_MS });
    const parsed = parseJsonFromCommandOutput(result.stdout);
    const availableMap = parsed?.available && typeof parsed.available === "object" ? parsed.available : {};
    const available = MACLJQ_MODULES.filter((name) => availableMap[name] === true);
    const missing = MACLJQ_MODULES.filter((name) => availableMap[name] !== true);
    return {
      ...base,
      status: missing.length === 0 ? "available_for_diagnostic" : "dependencies_missing",
      python: pythonBinary,
      available_dependencies: available,
      missing_dependencies: missing,
      reason: missing.length === 0
        ? "all macljqCtrl reference dependencies appear importable"
        : "install optional pyobjc/Pillow/opencv/numpy dependencies only when intentionally validating macljqCtrl",
    };
  } catch (error) {
    return {
      ...base,
      status: "probe_failed",
      python: pythonBinary,
      missing_dependencies: [...MACLJQ_MODULES],
      available_dependencies: [],
      reason: compactReason(error?.message ?? error),
    };
  }
}

function supportedActionsFromProbe(probe = {}, executeEnabled = false) {
  if (!executeEnabled || probe.ok !== true) {
    return [];
  }
  const supported = [];
  if (probe.has_click === true) {
    supported.push("click");
  }
  if (probe.has_grab_window === true || probe.has_grab_window_bg === true) {
    supported.push("capture_window_region");
  }
  return supported;
}

function unsupportedActionsFromSupported(supportedActions = []) {
  const supported = new Set(supportedActions);
  return ["activate_window", "click", "drag", "capture_window_region"]
    .filter((action) => !supported.has(action));
}

function buildRequirements({ importable, executeEnabled, probeEnabled, pythonProbe }) {
  if (!probeEnabled) {
    return ["Set TMWD_LJQCTRL_PROBE=1 to probe local ljqCtrl availability."];
  }
  if (importable) {
    return executeEnabled
      ? []
      : ["Set TMWD_LJQCTRL_EXECUTE=1 to enable the guarded ljqCtrl execution bridge."];
  }
  if (!platformSupported() && pythonProbe?.source === "default") {
    return ["Use native-os on non-Windows hosts, or validate ljqCtrl on Windows / an explicitly configured compatible interpreter."];
  }
  return ["Install Python with ljqCtrl importable, or set TMWD_LJQCTRL_PYTHON/TMWD_LJQCTRL_PYTHON_CANDIDATES."];
}

async function getLjqCtrlPhysicalInputProviderCapabilities(options = {}) {
  const cacheTtlMs = normalizeCacheTtlMs(options?.cache_ttl_ms);
  const cacheKey = capabilityCacheKey(options);
  const now = Date.now();
  if (
    options?.refresh !== true
    && cacheTtlMs > 0
    && capabilityCache?.key === cacheKey
    && capabilityCache.expires_at > now
  ) {
    return {
      ...cloneJson(capabilityCache.value),
      cache: {
        status: "hit",
        ttl_ms: cacheTtlMs,
      },
    };
  }
  const executeEnabled = executionBridgeEnabled(options);
  const probeEnabled = options?.probe === true || envEnabled("TMWD_LJQCTRL_PROBE") || executeEnabled;
  const pythonProbe = probeEnabled
    ? await probePythonCandidates()
    : {
      source: "probe_disabled",
      rows: [],
      selected: null,
      selected_binary: null,
      summaries: [],
      selection_reason: "probe_disabled",
    };
  const macLjqCtrlProbe = await probeMacLjqCtrlReadiness(pythonProbe);
  const python = pythonProbe.selected_binary;
  const apiProbe = probeEnabled
    ? (pythonProbe.selected?.probe ?? { ok: false, reason: "python_unavailable" })
    : { ok: false, reason: "probe_disabled" };
  const supportedActions = supportedActionsFromProbe(apiProbe, executeEnabled);
  const importable = apiProbe.ok === true;
  const captureAvailable = importable && (apiProbe.has_grab_window === true || apiProbe.has_grab_window_bg === true);
  const payload = {
    provider_id: PROVIDER_ID,
    provider_name: "ljqCtrl physical input",
    platform: process.platform,
    supported_platforms: SUPPORTED_PLATFORMS,
    platform_supported: platformSupported(),
    status: importable ? (executeEnabled ? "available" : "probe_available") : "not_configured",
    execution_mode: executeEnabled && importable ? "ljqctrl_physical_input" : "planned_provider",
    coordinate_system: "physical_screen_pixels",
    supports_window_activation: false,
    supports_window_rect: false,
    supports_window_region_capture: captureAvailable,
    supports_background_capture: importable && apiProbe.has_grab_window_bg === true,
    supported_actions: supportedActions,
    unsupported_actions: unsupportedActionsFromSupported(supportedActions),
    planned_actions: ["activate_window", "click", "drag", "capture_window_region"],
    requirements: buildRequirements({
      importable,
      executeEnabled,
      probeEnabled,
      pythonProbe,
    }),
    permission_notes: [
      "Use physical pixels only.",
      "Activate the target browser window before input.",
      "Capture only browser window or clipped regions; fullscreen capture is prohibited for CAPTCHA assist.",
    ],
    checks: {
      probe_enabled: probeEnabled,
      python: python ?? undefined,
      python_candidate_source: pythonProbe.source,
      python_selection_reason: pythonProbe.selection_reason,
      python_candidates: pythonProbe.summaries,
      ljqctrl_importable: importable,
      ljqctrl_probe: apiProbe,
      macljqctrl: macLjqCtrlProbe,
      execution_bridge_enabled: executeEnabled && importable,
    },
    cache: {
      status: "miss",
      ttl_ms: cacheTtlMs,
    },
  };
  if (cacheTtlMs > 0) {
    capabilityCache = {
      key: cacheKey,
      expires_at: now + cacheTtlMs,
      value: cloneJson(payload),
    };
  }
  return payload;
}

function normalizeWindowTarget(args = {}) {
  const windowTitle = String(args.window_title ?? "").trim();
  const pidParsed = Number(args.window_pid);
  const windowPid = Number.isInteger(pidParsed) && pidParsed > 0 ? pidParsed : null;
  if (windowPid !== null) {
    return windowPid;
  }
  if (windowTitle) {
    return windowTitle;
  }
  return null;
}

function normalizeCaptureClip(raw = {}) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const width = normalizeCoordinate(raw.width, "clip.width");
  const height = normalizeCoordinate(raw.height, "clip.height");
  if (width <= 0 || height <= 0) {
    throw new Error("clip width/height must be positive");
  }
  const x = normalizeCoordinate(raw.x, "clip.x");
  const y = normalizeCoordinate(raw.y, "clip.y");
  return { x, y, width, height };
}

async function makeCaptureArtifactPath() {
  await mkdir(CAPTURE_DIR, { recursive: true });
  return path.join(CAPTURE_DIR, `ljq-region-${Date.now()}-${randomBytes(4).toString("hex")}.png`);
}

function buildBridgeScript() {
  return [
    "import hashlib, json, os, sys",
    "payload = json.loads(sys.stdin.read() or '{}')",
    "action = payload.get('action')",
    "try:",
    "    import ljqCtrl",
    "    if action == 'click':",
    "        ljqCtrl.Click(int(payload['x']), int(payload['y']))",
    "        print(json.dumps({'ok': True, 'action': action}))",
    "    elif action == 'capture_window_region':",
    "        target = payload.get('window_pid') or payload.get('window_title')",
    "        if not target:",
    "            raise RuntimeError('window_title or window_pid is required')",
    "        use_bg = bool(payload.get('background')) and hasattr(ljqCtrl, 'GrabWindowBg')",
    "        img = ljqCtrl.GrabWindowBg(target, timeout=payload.get('timeout_s', 5)) if use_bg else ljqCtrl.GrabWindow(target)",
    "        clip = payload.get('clip')",
    "        original_size = getattr(img, 'size', [None, None])",
    "        if clip:",
    "            x = int(clip['x']); y = int(clip['y']); w = int(clip['width']); h = int(clip['height'])",
    "            img = img.crop((x, y, x + w, y + h))",
    "        else:",
    "            raise RuntimeError('clip is required for window-region capture')",
    "        size = getattr(img, 'size', [None, None])",
    "        output_path = payload.get('output_path')",
    "        artifact = None",
    "        if output_path:",
    "            os.makedirs(os.path.dirname(output_path), exist_ok=True)",
    "            img.save(output_path, format='PNG')",
    "            with open(output_path, 'rb') as fh:",
    "                data = fh.read()",
    "            artifact = {'path': output_path, 'sha256': hashlib.sha256(data).hexdigest(), 'mime_type': 'image/png', 'bytes': len(data), 'width': size[0], 'height': size[1], 'clip': clip, 'fullscreen': False, 'ttl_ms': 600000, 'created_at': payload.get('created_at'), 'expires_at': payload.get('expires_at')}",
    "        print(json.dumps({'ok': True, 'action': action, 'background': use_bg, 'original_width': original_size[0], 'original_height': original_size[1], 'width': size[0], 'height': size[1], 'clip_applied': bool(clip), 'artifact': artifact}))",
    "    else:",
    "        raise RuntimeError('unsupported ljqCtrl action: %s' % action)",
    "except Exception as exc:",
    "    print(json.dumps({'ok': False, 'action': action, 'error': str(exc)[:500]}))",
  ].join("\n");
}

async function runLjqCtrlPhysicalInputAction(action, args = {}, options = {}) {
  const capabilities = await getLjqCtrlPhysicalInputProviderCapabilities({
    ...options,
    probe: true,
  });
  if (!capabilities.supported_actions.includes(action)) {
    return {
      status: "blocked",
      action,
      reason: "ljqctrl_action_not_supported_or_not_enabled",
      provider_id: PROVIDER_ID,
      capabilities,
    };
  }
  const bridgePayload = { action };
  if (action === "click") {
    bridgePayload.x = normalizeCoordinate(args.x, "x");
    bridgePayload.y = normalizeCoordinate(args.y, "y");
  } else if (action === "capture_window_region") {
    const target = normalizeWindowTarget(args);
    if (target === null) {
      return {
        status: "blocked",
        action,
        reason: "window_target_required",
        provider_id: PROVIDER_ID,
      };
    }
    if (typeof target === "number") {
      bridgePayload.window_pid = target;
    } else {
      bridgePayload.window_title = target;
    }
    bridgePayload.background = args.background === true;
    bridgePayload.timeout_s = Math.max(1, Math.min(30, Math.round(Number(args.timeout_s ?? 5) || 5)));
    if (!args.clip) {
      return {
        status: "blocked",
        action,
        reason: "clip_required",
        provider_id: PROVIDER_ID,
      };
    }
    bridgePayload.clip = normalizeCaptureClip(args.clip);
    bridgePayload.output_path = await makeCaptureArtifactPath();
    const createdAtMs = Date.now();
    bridgePayload.created_at = new Date(createdAtMs).toISOString();
    bridgePayload.expires_at = new Date(createdAtMs + 600_000).toISOString();
  } else {
    return {
      status: "blocked",
      action,
      reason: "ljqctrl_action_not_implemented",
      provider_id: PROVIDER_ID,
    };
  }
  const python = capabilities.checks?.python;
  const result = await runNativeCommand(python, ["-c", buildBridgeScript()], {
    timeoutMs: LJQ_BRIDGE_TIMEOUT_MS,
    input: JSON.stringify(bridgePayload),
  });
  ensureNativeCommandOk(result, "ljqCtrl bridge");
  const parsed = parseJsonFromCommandOutput(result.stdout);
  if (!parsed?.ok) {
    return {
      status: "blocked",
      action,
      reason: "ljqctrl_bridge_failed",
      provider_id: PROVIDER_ID,
      error: String(parsed?.error ?? "invalid ljqCtrl bridge output"),
    };
  }
  return {
    status: "success",
    provider_id: PROVIDER_ID,
    coordinate_system: "physical_screen_pixels",
    ...parsed,
  };
}

export {
  PROVIDER_ID as LJQ_CTRL_PROVIDER_ID,
  getLjqCtrlPhysicalInputProviderCapabilities,
  runLjqCtrlPhysicalInputAction,
};
