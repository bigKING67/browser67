#!/usr/bin/env node
import { detectPhysicalInputCapabilities } from "../src/physical-input/index.mjs";

function parseArgs(argv = []) {
  const parsed = {
    action: "capture_window_region",
    json: false,
    require_available: false,
    require_execute: false,
    require_capture: false,
    execute_capabilities: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--json") {
      parsed.json = true;
    } else if (token === "--require-available") {
      parsed.require_available = true;
    } else if (token === "--require-execute") {
      parsed.require_execute = true;
      parsed.execute_capabilities = true;
    } else if (token === "--require-capture") {
      parsed.require_capture = true;
    } else if (token === "--execute-capabilities") {
      parsed.execute_capabilities = true;
    } else if (token === "--action") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --action value");
      }
      parsed.action = value;
      index += 1;
    } else if (token === "--help" || token === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  if (String(process.env.TMWD_LJQCTRL_REQUIRE ?? "").trim() === "1") {
    parsed.require_available = true;
  }
  if (String(process.env.TMWD_LJQCTRL_REQUIRE_EXECUTE ?? "").trim() === "1") {
    parsed.require_execute = true;
    parsed.execute_capabilities = true;
  }
  if (String(process.env.TMWD_LJQCTRL_REQUIRE_CAPTURE ?? "").trim() === "1") {
    parsed.require_capture = true;
  }
  return parsed;
}

function usage() {
  return [
    "Usage: node contracts/ljqctrl-doctor.mjs [--json] [--action <name>]",
    "       [--execute-capabilities] [--require-available] [--require-execute] [--require-capture]",
    "",
    "Default mode probes local Python ljqCtrl importability and reports capability metadata.",
    "It does not click, drag, capture, or move the mouse.",
    "",
    "Env hard gates:",
    "  TMWD_LJQCTRL_REQUIRE=1",
    "  TMWD_LJQCTRL_REQUIRE_EXECUTE=1",
    "  TMWD_LJQCTRL_REQUIRE_CAPTURE=1",
  ].join("\n");
}

function compactProvider(provider = {}) {
  return {
    provider_id: provider.provider_id,
    status: provider.status,
    execution_mode: provider.execution_mode,
    coordinate_system: provider.coordinate_system,
    supports_window_region_capture: provider.supports_window_region_capture === true,
    supports_background_capture: provider.supports_background_capture === true,
    supported_actions: Array.isArray(provider.supported_actions) ? provider.supported_actions : [],
    unsupported_actions: Array.isArray(provider.unsupported_actions) ? provider.unsupported_actions : [],
    requirements: Array.isArray(provider.requirements) ? provider.requirements : [],
    checks: provider.checks ?? {},
    cache: provider.cache ?? {},
  };
}

function summarize(args = {}, capabilities = {}) {
  const ljq = capabilities.providers?.find((provider) => provider.provider_id === "ljq-ctrl") ?? {};
  const compact = compactProvider(ljq);
  const importable = compact.checks?.ljqctrl_importable === true;
  const probe = compact.checks?.ljqctrl_probe ?? {};
  const executionBridgeEnabled = compact.checks?.execution_bridge_enabled === true;
  const supportsCapture = compact.supports_window_region_capture === true;
  const failedRequirements = [];
  if (args.require_available && !importable) {
    failedRequirements.push("ljqctrl_importable");
  }
  if (args.require_execute && !executionBridgeEnabled) {
    failedRequirements.push("execution_bridge_enabled");
  }
  if (args.require_capture && !supportsCapture) {
    failedRequirements.push("window_region_capture");
  }
  const ok = failedRequirements.length === 0;
  return {
    ok,
    status: ok ? "diagnosed" : "failed",
    provider_id: "ljq-ctrl",
    driver_connected: importable,
    driver_connection_basis: "python_import_ljqctrl",
    python: compact.checks?.python,
    execution_bridge_enabled: executionBridgeEnabled,
    coordinate_system: compact.coordinate_system,
    supports_click: probe.has_click === true,
    supports_press: probe.has_press === true,
    supports_find_block: probe.has_find_block === true,
    supports_window_region_capture: supportsCapture,
    supports_background_capture: compact.supports_background_capture,
    supported_actions: compact.supported_actions,
    unsupported_actions: compact.unsupported_actions,
    selected_action: args.action,
    selected_provider_id: capabilities.provider_selection?.selected_provider_id,
    provider_selection_reason: capabilities.provider_selection?.reason,
    capture_provider_selection_reason: capabilities.capture_provider_selection?.reason,
    dpi_scale: probe.dpi_scale ?? null,
    requirements: compact.requirements,
    failed_requirements: failedRequirements,
    probe_enabled: compact.checks?.probe_enabled === true,
    execute_capabilities_requested: args.execute_capabilities === true,
    note: "This doctor is diagnostic-only. It does not perform click, drag, screenshot, clipboard, or window activation.",
    provider: compact,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const capabilities = await detectPhysicalInputCapabilities({
    preferred_provider: "ljq-ctrl",
    action: args.action,
    ljq_ctrl: {
      probe: true,
      refresh: true,
      execute: args.execute_capabilities,
      cache_ttl_ms: 0,
    },
  });
  const summary = summarize(args, capabilities);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  }
  return summary.ok ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`ljqctrl-doctor failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
