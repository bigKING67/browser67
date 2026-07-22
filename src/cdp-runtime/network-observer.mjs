import { normalizeTimeoutMs, nowIso, randomId } from "../common.mjs";
import { createCdpClient } from "./client.mjs";
import { resolveTarget } from "./target.mjs";

function matchesNetworkIgnorePattern(url, patterns = []) {
  return patterns.some((pattern) => {
    const value = String(pattern ?? "").trim();
    if (!value) return false;
    if (value.startsWith("/") && value.lastIndexOf("/") > 0) {
      const lastSlash = value.lastIndexOf("/");
      try {
        return new RegExp(value.slice(1, lastSlash), value.slice(lastSlash + 1)).test(url);
      } catch {
        return url.includes(value);
      }
    }
    return url.includes(value);
  });
}

async function createCdpNetworkObserver(args = {}, options = {}) {
  const timeoutMs = normalizeTimeoutMs(args?.timeout_ms);
  const resolved = await resolveTarget(args);
  const client = createCdpClient(resolved.target.webSocketDebuggerUrl);
  await client.connect(Math.min(timeoutMs, 10_000));
  const observationId = randomId("network_observation");
  const startedAtMs = Date.now();
  let lastActivityAtMs = startedAtMs;
  let observedCount = 0;
  let ignoredCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  let stopped = false;
  const active = new Map();
  const ignorePatterns = Array.isArray(options.ignore_patterns) ? options.ignore_patterns : [];
  const ignoredTypes = new Set(
    (Array.isArray(options.ignore_resource_types)
      ? options.ignore_resource_types
      : ["WebSocket", "EventSource"])
      .map((value) => String(value)),
  );
  const removeEventListener = client.onEvent((event) => {
    const method = String(event?.method ?? "");
    const params = event?.params ?? {};
    if (method === "Network.requestWillBeSent") {
      observedCount += 1;
      lastActivityAtMs = Date.now();
      const requestId = String(params.requestId ?? "");
      const url = String(params.request?.url ?? "");
      const resourceType = String(params.type ?? "Other");
      if (ignoredTypes.has(resourceType) || matchesNetworkIgnorePattern(url, ignorePatterns)) {
        ignoredCount += 1;
        active.delete(requestId);
        return;
      }
      active.set(requestId, {
        request_id: requestId,
        resource_type: resourceType,
        started_at_ms: Date.now(),
      });
      return;
    }
    if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
      lastActivityAtMs = Date.now();
      const requestId = String(params.requestId ?? "");
      if (active.delete(requestId)) {
        if (method === "Network.loadingFailed") failedCount += 1;
        else completedCount += 1;
      }
    }
  });
  try {
    await client.send("Network.enable", {}, Math.min(timeoutMs, 10_000));
  } catch (error) {
    removeEventListener();
    client.close();
    throw error;
  }

  function snapshot() {
    const now = Date.now();
    return {
      schema: "browser67.network-observation.v1",
      network_observation_id: observationId,
      tab_id: resolved.target.id,
      transport: "cdp",
      coverage: "from_observation_start",
      started_at: new Date(startedAtMs).toISOString(),
      sampled_at: new Date(now).toISOString(),
      elapsed_ms: now - startedAtMs,
      quiet_for_ms: now - lastActivityAtMs,
      inflight_count: active.size,
      observed_count: observedCount,
      ignored_count: ignoredCount,
      completed_count: completedCount,
      failed_count: failedCount,
      active_resource_types: [...new Set([...active.values()].map((item) => item.resource_type))],
      ignore_patterns: ignorePatterns,
      ignore_resource_types: [...ignoredTypes],
      stopped,
    };
  }

  async function waitForIdle(waitOptions = {}) {
    const idleMs = Math.max(50, Math.min(30_000, Number(waitOptions.idle_ms ?? 750)));
    const maxInflight = Math.max(0, Math.min(100, Number(waitOptions.max_inflight ?? 0)));
    const intervalMs = Math.max(25, Math.min(5_000, Number(waitOptions.interval_ms ?? 100)));
    const waitTimeoutMs = Math.max(100, Math.min(120_000, Number(waitOptions.timeout_ms ?? timeoutMs)));
    const deadline = Date.now() + waitTimeoutMs;
    while (Date.now() < deadline) {
      const current = snapshot();
      if (current.inflight_count <= maxInflight && current.quiet_for_ms >= idleMs) {
        return { status: "passed", idle_ms: idleMs, max_inflight: maxInflight, ...current };
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return { status: "timeout", idle_ms: idleMs, max_inflight: maxInflight, ...snapshot() };
  }

  async function stop() {
    if (stopped) return snapshot();
    stopped = true;
    removeEventListener();
    try {
      await client.send("Network.disable", {}, Math.min(timeoutMs, 2_000));
    } catch {
      // Closing the isolated CDP client is sufficient cleanup.
    }
    const finalSnapshot = snapshot();
    client.close();
    return { ...finalSnapshot, stopped_at: nowIso() };
  }

  return Object.freeze({
    network_observation_id: observationId,
    snapshot,
    stop,
    waitForIdle,
  });
}

export { createCdpNetworkObserver };
