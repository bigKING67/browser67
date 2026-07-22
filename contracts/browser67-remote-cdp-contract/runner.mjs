import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { closeOtherCdpTargets, createCdpTarget, waitForCdpTarget, waitForUrl } from "./cdp-targets.mjs";
import { findChromeBinary, launchChrome, terminateChrome } from "./chrome.mjs";
import { parseArgs } from "./cli.mjs";
import {
  closeServer,
  createCrossOriginFrameServer,
  createFixtureServer,
  listen,
  reservePort,
} from "./fixture.mjs";
import { runGate } from "./gate-runner.mjs";
import { repoRoot } from "./paths.mjs";
import { createRpcClient } from "../browser67-browser-mcp-contract/rpc-client.mjs";
import {
  firstJsonContent,
  firstOutcomeContent,
} from "../browser67-browser-mcp-contract/rpc-content.mjs";

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function removeTempRoot(tempRoot) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(tempRoot, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 125,
      });
      return;
    } catch (error) {
      lastError = error;
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error?.code) || attempt === 9) {
        throw error;
      }
      await sleep(250);
    }
  }
  throw lastError;
}

async function callTool(rpc, name, args, timeoutMs) {
  const response = await rpc.call("tools/call", { name, arguments: args }, timeoutMs);
  const outcome = firstOutcomeContent(response.result);
  assert.equal(response?.result?.isError, undefined, JSON.stringify(outcome));
  assert.equal(outcome?.schema, "browser67.tool-outcome.v3");
  assert.equal(outcome?.ok, true);
  return firstJsonContent(response.result);
}

async function runContentCoreFixture({ cdpEndpoint, fixtureTarget, fixtureUrl, registryPath, timeoutMs }) {
  const now = new Date().toISOString();
  const workspaceKey = "remote-cdp-content-contract";
  const taskId = "snapshot-node-ref-diff";
  await writeFile(registryPath, `${JSON.stringify({
    version: 2,
    updated_at: now,
    managed_tabs: [{
      tab_id: fixtureTarget.id,
      owner: "tmwd",
      managed: true,
      ownership_origin: "agent_created",
      close_on_finalize: true,
      ownership_generation: "remote-cdp-contract-ownership",
      source: "remote-cdp-contract",
      workspace_key: workspaceKey,
      task_id: taskId,
      reuse_key: fixtureUrl,
      url: fixtureUrl,
      title: "remote-cdp-fixture",
      origin: new URL(fixtureUrl).origin,
      path_scope: "/",
      keep: true,
      dry_run: false,
      status: "open",
      created_at: now,
      updated_at: now,
      last_used_at: now,
    }],
  }, null, 2)}\n`);

  const priorRegistryPath = process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
  process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = registryPath;
  const rpc = createRpcClient();
  const route = {
    tmwd_mode: "remote_cdp",
    cdp_endpoint: cdpEndpoint,
    switch_tab_id: fixtureTarget.id,
  };
  try {
    await rpc.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "browser67-remote-cdp-content-contract", version: "1.0.0" },
    }, timeoutMs);
    rpc.notify("notifications/initialized", {});

    const before = await callTool(rpc, "browser_extract", {
      ...route,
      selector_limit: 200,
    }, timeoutMs);
    assert.equal(before.schema, "browser67.actionable-snapshot.v2");
    assert.equal(before.scope.workspace_key, workspaceKey);
    assert.equal(before.scope.task_id, taskId);
    assert.equal(before.tab_id, fixtureTarget.id);

    const increment = before.nodes.find((node) => node.locator_candidates
      .some((candidate) => candidate.type === "id" && candidate.value === "#increment"));
    const displayName = before.nodes.find((node) => node.locator_candidates
      .some((candidate) => candidate.type === "id" && candidate.value === "#display-name"));
    const password = before.nodes.find((node) => node.locator_candidates
      .some((candidate) => candidate.type === "id" && candidate.value === "#secret"));
    const roleAction = before.nodes.find((node) => node.accessible_name === "Role action");
    const editable = before.nodes.find((node) => node.accessible_name === "Editable note");
    const shadowAction = before.nodes.find((node) => node.accessible_name === "Shadow action");
    const frameAction = before.nodes.find((node) => node.accessible_name === "Frame action");
    const nodeSummary = before.nodes.map((node) => ({
      node_id: node.node_id,
      tag: node.tag,
      name: node.accessible_name,
      locators: node.locator_candidates,
    }));
    assert.ok(increment, JSON.stringify(nodeSummary));
    assert.ok(displayName, JSON.stringify(nodeSummary));
    assert.ok(password, JSON.stringify(nodeSummary));
    assert.equal(password.value?.redacted, true);
    assert.equal(password.value?.length, "remote-secret".length);
    assert.ok(roleAction);
    assert.ok(editable);
    assert.ok(shadowAction);
    assert.ok(frameAction);
    assert.equal(shadowAction.shadow_path.length > 0, true);
    assert.equal(frameAction.frame_path.length > 0, true);
    assert.equal(before.limitations.includes("cross_origin_or_denied"), true);
    assert.equal(before.limitations.includes("closed_shadow_roots_unobservable"), true);
    assert.equal(before.marker_policy.scope, "current_document");
    assert.equal(before.marker_policy.lifetime, "until_navigation_or_managed_policy_release");

    const operationRoute = { ...route, workspace_key: workspaceKey, task_id: taskId };
    const click = await callTool(rpc, "browser_execute_js", {
      ...operationRoute,
      operation: "click",
      node_ref: { snapshot_id: before.snapshot_id, node_id: increment.node_id },
      expected: { tag: "button", role: "button", accessible_name: "Increment" },
      network_observation: {
        enabled: true,
        ttl_ms: 3_000,
        idle_ms: 100,
        max_inflight: 0,
        interval_ms: 25,
      },
    }, timeoutMs);
    assert.equal(click.operation, "click");
    assert.equal(typeof click.network_observation_id, "string");
    assert.equal(click.network_observation?.idle_status, "passed", "structured click network observation");
    assert.equal(click.network_observation?.observed_count >= 1, true);

    const setValue = await callTool(rpc, "browser_execute_js", {
      ...operationRoute,
      operation: "set_value",
      node_ref: { snapshot_id: before.snapshot_id, node_id: displayName.node_id },
      expected: { tag: "input", role: "textbox", accessible_name: "Display name" },
      value: "updated-display-name",
    }, timeoutMs);
    assert.equal(setValue.result.value.redacted, true);
    assert.equal(setValue.result.value.reason, "write_only_operation");
    assert.equal(setValue.result.value.length, "updated-display-name".length);
    assert.equal(JSON.stringify(setValue).includes("updated-display-name"), false);

    const editableSetValue = await callTool(rpc, "browser_execute_js", {
      ...operationRoute,
      operation: "set_value",
      node_ref: { snapshot_id: before.snapshot_id, node_id: editable.node_id },
      expected: { tag: "div", accessible_name: "Editable note" },
      value: "updated-editable-note",
    }, timeoutMs);
    assert.equal(editableSetValue.result.value.reason, "write_only_operation");
    assert.equal(editableSetValue.result.value.length, "updated-editable-note".length);
    assert.equal(JSON.stringify(editableSetValue).includes("updated-editable-note"), false);

    const shadowRead = await callTool(rpc, "browser_execute_js", {
      ...operationRoute,
      operation: "read",
      node_ref: { snapshot_id: before.snapshot_id, node_id: shadowAction.node_id },
      expected: { tag: "button", role: "button", accessible_name: "Shadow action" },
    }, timeoutMs);
    assert.equal(shadowRead.result.accessible_name, "Shadow action");

    const frameRead = await callTool(rpc, "browser_execute_js", {
      ...operationRoute,
      operation: "read",
      node_ref: { snapshot_id: before.snapshot_id, node_id: frameAction.node_id },
      expected: { tag: "button", role: "button", accessible_name: "Frame action" },
    }, timeoutMs);
    assert.equal(frameRead.result.accessible_name, "Frame action");

    const after = await callTool(rpc, "browser_extract", {
      ...route,
      selector_limit: 200,
    }, timeoutMs);
    assert.equal(new Set(after.nodes.map((node) => node.node_id)).size, after.nodes.length);
    const dynamicAction = after.nodes.find((node) => node.accessible_name === "Dynamic action");
    assert.ok(dynamicAction);
    const dynamicRead = await callTool(rpc, "browser_execute_js", {
      ...operationRoute,
      operation: "read",
      node_ref: { snapshot_id: after.snapshot_id, node_id: dynamicAction.node_id },
      expected: { tag: "button", role: "button", accessible_name: "Dynamic action" },
    }, timeoutMs);
    assert.equal(dynamicRead.result.accessible_name, "Dynamic action");
    const diff = await callTool(rpc, "browser_diff", {
      ...operationRoute,
      before_snapshot_id: before.snapshot_id,
      after_snapshot_id: after.snapshot_id,
    }, timeoutMs);
    assert.equal(diff.schema, "browser67.semantic-diff.v2");
    assert.equal(diff.page_state_changed, true);
    assert.equal(diff.summary.added_count >= 1, true);
    assert.equal(diff.summary.changed_count >= 1, true);

    const scan = await callTool(rpc, "browser_scan", {
      ...route,
      text_only: true,
      main_only: true,
      main_only_min_chars: 100,
      main_only_min_coverage: 0.2,
      max_chars: 10_000,
    }, timeoutMs);
    assert.equal(scan.metadata?.main_only_guardrail?.capture_passes, 1);
    assert.equal(typeof scan.content, "string");

    await callTool(rpc, "browser_execute_js", {
      ...route,
      script: "setTimeout(async () => { const response = await fetch('/slow?ms=300'); await response.text(); window.__browser67WaitFetchDone = true; }, 50); return true;",
      no_monitor: true,
    }, timeoutMs);
    const networkIdle = await callTool(rpc, "browser_wait", {
      ...route,
      type: "network_idle",
      idle_ms: 100,
      max_inflight: 0,
      interval_ms: 25,
      timeout_ms: 2_000,
    }, timeoutMs);
    assert.equal(networkIdle.status, "passed", `browser_wait network_idle ${JSON.stringify(networkIdle)}`);
    assert.equal(networkIdle.detail?.observed_count >= 1, true);
    assert.equal(typeof networkIdle.network_observation_id, "string");

    const rawObservation = await callTool(rpc, "browser_execute_js", {
      ...route,
      script: "const response = await fetch('/slow?ms=180'); await response.text(); return true;",
      no_monitor: true,
      network_observation: {
        enabled: true,
        ttl_ms: 3_000,
        idle_ms: 100,
        max_inflight: 0,
        interval_ms: 25,
      },
    }, timeoutMs);
    assert.equal(rawObservation.status, "success");
    assert.equal(rawObservation.network_observation?.idle_status, "passed");
    assert.equal(rawObservation.network_observation?.observed_count >= 1, true);

    const resourceQuiet = await callTool(rpc, "browser_wait", {
      ...route,
      type: "resource_quiet",
      stable_ms: 100,
      interval_ms: 25,
      timeout_ms: 1_000,
    }, timeoutMs);
    assert.equal(resourceQuiet.status, "passed", "browser_wait resource_quiet");
    assert.equal(resourceQuiet.wait_type, "resource_quiet");

    await callTool(rpc, "browser_execute_js", {
      ...route,
      script: "let n = 0; const timer = setInterval(() => { document.querySelector('#status').textContent = 'noise:' + String(++n); if (n >= 6) clearInterval(timer); }, 30); return true;",
      no_monitor: true,
    }, timeoutMs);
    const domStable = await callTool(rpc, "browser_wait", {
      ...route,
      type: "dom_stable",
      root_selector: "main",
      ignore_selectors: ["#status"],
      ignore_attributes: ["data-noise"],
      mutation_threshold: 0,
      stable_ms: 100,
      interval_ms: 25,
      timeout_ms: 1_000,
    }, timeoutMs);
    assert.equal(domStable.status, "passed", "browser_wait dom_stable");
    assert.equal(domStable.detail?.ignored_mutations >= 1, true);

    const crossScopeDiffResponse = await rpc.call("tools/call", {
      name: "browser_diff",
      arguments: {
        ...route,
        workspace_key: "another-workspace",
        task_id: taskId,
        before_snapshot_id: before.snapshot_id,
        after_snapshot_id: after.snapshot_id,
      },
    }, timeoutMs);
    assert.equal(crossScopeDiffResponse?.result?.isError, true);
    assert.equal(firstJsonContent(crossScopeDiffResponse.result)?.error_code, "SNAPSHOT_SCOPE_MISMATCH");

    await callTool(rpc, "browser_execute_js", {
      ...route,
      script: "history.pushState({}, '', '/document-changed'); return location.href;",
      no_monitor: true,
    }, timeoutMs);
    const staleResponse = await rpc.call("tools/call", {
      name: "browser_execute_js",
      arguments: {
        ...operationRoute,
        operation: "read",
        node_ref: { snapshot_id: before.snapshot_id, node_id: increment.node_id },
      },
    }, timeoutMs);
    assert.equal(staleResponse?.result?.isError, true);
    assert.equal(firstJsonContent(staleResponse.result)?.error_code, "DOCUMENT_CHANGED");

    return {
      ok: true,
      snapshot_node_count: before.nodes.length,
      shadow_dom: true,
      iframe: true,
      cross_origin_iframe_limitation: true,
      closed_shadow_root_limitation: true,
      redaction: true,
      write_only_set_value: true,
      contenteditable_set_value: true,
      unique_document_markers: true,
      semantic_diff: diff.summary,
      single_pass_main_scan: true,
      network_observation: true,
      raw_network_observation: true,
      network_idle: true,
      resource_quiet: true,
      dom_stable_filters: true,
      stale_document_rejected: true,
    };
  } finally {
    await rpc.close();
    if (priorRegistryPath === undefined) delete process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
    else process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = priorRegistryPath;
  }
}

async function runRemoteCdpContract(argv) {
  const cli = parseArgs(argv);
  const chrome = findChromeBinary(cli.chrome_bin);
  const tempRoot = mkdtempSync(resolve(tmpdir(), "tmwd-remote-cdp-"));
  const userDataDir = resolve(tempRoot, "chrome-profile");
  const registryPath = resolve(tempRoot, "managed-tabs.json");
  const crossOriginServer = createCrossOriginFrameServer();
  let fixtureServer = null;
  let chromeProcess = null;
  let chromeStderr = "";
  try {
    const crossOriginPort = await listen(crossOriginServer);
    fixtureServer = createFixtureServer({
      cross_origin_url: `http://127.0.0.1:${String(crossOriginPort)}/frame`,
    });
    const fixturePort = await listen(fixtureServer);
    const cdpPort = await reservePort();
    const fixtureUrl = `http://127.0.0.1:${String(fixturePort)}/`;
    const cdpEndpoint = `http://127.0.0.1:${String(cdpPort)}`;
    chromeProcess = launchChrome({
      chromePath: chrome.path,
      cdpPort,
      userDataDir,
    });
    chromeProcess.stderr?.setEncoding("utf8");
    chromeProcess.stderr?.on("data", (chunk) => {
      chromeStderr += String(chunk);
    });

    await waitForUrl(`${cdpEndpoint}/json/version`, cli.timeout_ms);
    await waitForUrl(fixtureUrl, cli.timeout_ms);
    const createdTarget = await createCdpTarget(cdpEndpoint, fixtureUrl);
    const fixtureTarget = await waitForCdpTarget(cdpEndpoint, fixtureUrl, cli.timeout_ms);
    await closeOtherCdpTargets(cdpEndpoint, fixtureTarget.id || createdTarget.id);

    const commonGateArgs = [
      "--tmwd-mode", "remote_cdp",
      "--cdp-endpoint", cdpEndpoint,
      "--target-url-contains", fixtureUrl,
      "--disable-event-log",
      "--timeout-ms", String(cli.timeout_ms),
    ];
    const doctor = runGate(["--doctor-only", ...commonGateArgs], cli.timeout_ms + 5_000);
    const live = runGate(commonGateArgs, cli.timeout_ms + 5_000);
    const livePayload = live.payload;
    const contentCore = await runContentCoreFixture({
      cdpEndpoint,
      fixtureTarget,
      fixtureUrl,
      registryPath,
      timeoutMs: cli.timeout_ms,
    });
    const ok = doctor.status === 0
      && live.status === 0
      && doctor.payload?.doctor?.readiness?.path === "cdp"
      && livePayload?.stage === "live_passed"
      && livePayload?.live?.transport === "cdp"
      && livePayload?.live?.href === fixtureUrl
      && livePayload?.live?.title === "remote-cdp-fixture"
      && contentCore.ok === true;

    process.stdout.write(`${JSON.stringify({
      ok,
      chrome_bin: chrome.path,
      chrome_version: chrome.version,
      cdp_endpoint: cdpEndpoint,
      fixture_url: fixtureUrl,
      doctor: {
        exit_code: doctor.status,
        ready: doctor.payload?.doctor?.readiness?.ready === true,
        reason: doctor.payload?.doctor?.readiness?.reason ?? "",
        path: doctor.payload?.doctor?.readiness?.path ?? "",
      },
      live: {
        exit_code: live.status,
        stage: livePayload?.stage ?? "",
        transport: livePayload?.live?.transport ?? "",
        title: livePayload?.live?.title ?? "",
        href: livePayload?.live?.href ?? "",
        tabs_count: livePayload?.live?.tabs_count ?? 0,
      },
      content_core: contentCore,
      diagnostics: ok ? undefined : {
        doctor_stdout: doctor.stdout.trim(),
        doctor_stderr: doctor.stderr.trim(),
        live_stdout: live.stdout.trim(),
        live_stderr: live.stderr.trim(),
        chrome_stderr: chromeStderr.trim().slice(-4_000),
      },
    })}\n`);
    return ok ? 0 : 1;
  } finally {
    if (fixtureServer) await closeServer(fixtureServer).catch(() => {});
    await closeServer(crossOriginServer).catch(() => {});
    await terminateChrome(chromeProcess);
    if (cli.keep_temp !== true) {
      await removeTempRoot(tempRoot);
    }
  }
}

export {
  runRemoteCdpContract,
};
