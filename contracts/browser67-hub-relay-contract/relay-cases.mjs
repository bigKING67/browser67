import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { compareExtensionRuntimeIdentity } from "../browser67-live-doctor/extension-identity.mjs";
import { sleep } from "./ports.mjs";
import {
  closeWs,
  openWs,
  sendControllerRequest,
  waitForWsMessage,
} from "./ws-client.mjs";

const extensionIdentity = {
  schema: "browser67.extension-identity.v1",
  product: "browser67",
  extension_version: "0.4.0",
  manifest_version: "0.4.0",
  build_revision: "0123456789abcdef0123456789abcdef01234567",
  build_revision_source: "git",
  build_inputs_dirty: false,
  source_digest: "b".repeat(64),
  protocol_revision: 2,
};

const browserInstanceId = "browser-instance-a";
const secondBrowserInstanceId = "browser-instance-b";

async function sendLinkCommand(linkUrl, payload) {
  const response = await fetch(linkUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(response.ok, true);
  return response.json();
}

async function readBrowserInstanceInventory(linkUrl, payload = { action: "list" }) {
  const body = await sendLinkCommand(linkUrl, { cmd: "browser_instance_ops", ...payload });
  assert.equal(body?.r?.ok, true);
  return body.r;
}

function matchesBrowserInstanceStates(inventory, expectedStates) {
  return expectedStates.every((expected) => {
    const actual = inventory?.browser_instances?.find((entry) => (
      entry.browser_instance_id === expected.browser_instance_id
    ));
    return actual
      && actual.active === expected.active
      && actual.tab_count === expected.tab_count;
  });
}

async function waitForBrowserInstanceStates(linkUrl, expectedStates, label, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  let lastInventory = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      lastInventory = await readBrowserInstanceInventory(linkUrl);
      lastError = null;
      if (matchesBrowserInstanceStates(lastInventory, expectedStates)) return lastInventory;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await sleep(20);
  }
  const observed = lastError
    ? `error=${lastError.stack ?? lastError.message}`
    : `inventory=${JSON.stringify(lastInventory?.browser_instances ?? null)}`;
  throw new Error(`timed out waiting for browser instance state: ${label}; ${observed}`);
}

async function runResponseListenerOrderingCase() {
  class ImmediateResponseSocket extends EventEmitter {
    send(raw) {
      const payload = JSON.parse(String(raw));
      this.emit("message", JSON.stringify({ id: payload.id, success: true }));
    }
  }
  const response = await sendControllerRequest(new ImmediateResponseSocket(), {
    id: "immediate_response",
    code: { cmd: "fixture" },
  });
  assert.equal(response?.success, true);
}

async function runExplicitInstanceRelay({
  extensionWs,
  controllerWs,
  controllerId,
  instanceId,
  expression,
  resultValue,
}) {
  const relayPromise = waitForWsMessage(
    extensionWs,
    (message) => message?.code?.params?.expression === expression,
    `relayed ${controllerId}`,
  );
  controllerWs.send(JSON.stringify({
    id: controllerId,
    browser_instance_id: instanceId,
    tabId: 123,
    code: {
      cmd: "cdp",
      method: "Runtime.evaluate",
      params: { expression },
    },
  }));
  const relayed = await relayPromise;
  assert.equal(relayed.browser_instance_id, instanceId);
  assert.equal(relayed.tabId, 123);
  const responsePromise = waitForWsMessage(
    controllerWs,
    (message) => String(message.id ?? "") === controllerId,
    `${controllerId} controller response`,
  );
  extensionWs.send(JSON.stringify({
    type: "result",
    id: relayed.id,
    browser_instance_id: instanceId,
    result: { value: resultValue },
  }));
  const response = await responsePromise;
  assert.equal(response?.type, "result");
  assert.equal(response?.browser_instance_id, instanceId);
  assert.equal(response?.result?.value, resultValue);
  return relayed;
}

async function runTabsListCase(extensionWs, controllerWs, linkUrl) {
  extensionWs.send(JSON.stringify({
    type: "ext_ready",
    browser_instance_id: browserInstanceId,
    extension_identity: extensionIdentity,
    tabs: [
      { id: 123, url: "http://127.0.0.1/fake", title: "Fake Tab" },
    ],
  }));
  await waitForBrowserInstanceStates(linkUrl, [{
    browser_instance_id: browserInstanceId,
    active: true,
    tab_count: 1,
  }], "initial extension handshake");

  const listResponse = await sendControllerRequest(controllerWs, {
    id: "list_tabs",
    code: { cmd: "tabs" },
  });
  assert.equal(listResponse?.success, true);
  assert.equal(Array.isArray(listResponse?.result), true);
  assert.equal(listResponse.result[0]?.id, "123");
  assert.equal(listResponse.result[0]?.browser_instance_id, browserInstanceId);
  assert.equal(listResponse.result[0]?.session_key, `${browserInstanceId}:123`);
}

async function runRuntimeIdentityCase(controllerWs, linkUrl) {
  const wsResponse = await sendControllerRequest(controllerWs, {
    id: "runtime_info",
    code: { cmd: "browser67_runtime_info" },
  });
  assert.equal(wsResponse?.success, true);
  assert.equal(wsResponse?.result?.schema, "browser67.hub-runtime-info.v2");
  assert.equal(wsResponse?.result?.extension_connected, true);
  assert.equal(wsResponse?.result?.extension_identity_status, "valid");
  assert.deepEqual(wsResponse?.result?.extension_identity, extensionIdentity);
  assert.equal(wsResponse?.result?.browser_instances?.[0]?.browser_instance_id, browserInstanceId);
  const verified = compareExtensionRuntimeIdentity({
    endpoint: "ws://127.0.0.1:fixture",
    ok: true,
    latency_ms: 1,
    detail: "ws_runtime_info_ok",
    runtime_info: wsResponse.result,
  }, {
    available: true,
    path: "/fixture/build-identity.json",
    identity: extensionIdentity,
    error: "",
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.identity_match, true);
  const packagedVerified = compareExtensionRuntimeIdentity({
    endpoint: "ws://127.0.0.1:fixture",
    ok: true,
    latency_ms: 1,
    detail: "ws_runtime_info_ok",
    runtime_info: wsResponse.result,
  }, {
    available: true,
    path: "/fixture/package-build-identity.json",
    identity: {
      ...extensionIdentity,
      build_revision: "packaged-fixture-revision",
      build_revision_source: "package_git_head",
      build_inputs_dirty: true,
    },
    installed_candidates: [{
      available: true,
      basis: "packaged",
      path: "/fixture/installed-build-identity.json",
      identity: {
        ...extensionIdentity,
        build_revision: "packaged-fixture-revision",
        build_revision_source: "package_git_head",
        build_inputs_dirty: true,
      },
      error: "",
    }],
    error: "",
  });
  assert.equal(packagedVerified.ok, true);
  assert.equal(packagedVerified.identity_match, true);
  assert.equal(packagedVerified.provenance_variant, true);
  assert.deepEqual(packagedVerified.mismatches, []);
  assert.equal(packagedVerified.observed_browser_instances[0]?.identity_match, true);
  assert.deepEqual(packagedVerified.matching_installed_paths, ["/fixture/installed-build-identity.json"]);
  const mismatch = compareExtensionRuntimeIdentity({
    endpoint: "ws://127.0.0.1:fixture",
    ok: true,
    latency_ms: 1,
    detail: "ws_runtime_info_ok",
    runtime_info: wsResponse.result,
  }, {
    available: true,
    path: "/fixture/build-identity.json",
    identity: { ...extensionIdentity, source_digest: "c".repeat(64) },
    error: "",
  });
  assert.equal(mismatch.ok, false);
  assert.deepEqual(mismatch.mismatches, ["source_digest"]);

  const linkResponse = await fetch(linkUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd: "get_runtime_info" }),
  });
  assert.equal(linkResponse.ok, true);
  const linkPayload = await linkResponse.json();
  assert.equal(linkPayload?.r?.extension_connected, true);
  assert.equal(linkPayload?.r?.extension_identity_status, "valid");
  assert.deepEqual(linkPayload?.r?.extension_identity, extensionIdentity);
  assert.equal(linkPayload?.r?.browser_instances?.[0]?.browser_instance_id, browserInstanceId);
}

async function runTabsCreateRelayCase(extensionWs, controllerWs) {
  const relayedCreatePromise = waitForWsMessage(
    extensionWs,
    (message) => String(message?.code?.cmd ?? "") === "tabs"
      && String(message?.code?.method ?? "") === "create",
    "relayed tabs.create",
  );
  controllerWs.send(JSON.stringify({
    id: "create_tab",
    browser_instance_id: browserInstanceId,
    tabId: 123,
    code: {
      cmd: "tabs",
      method: "create",
      url: "http://127.0.0.1/new",
      active: false,
    },
  }));
  const relayedCreate = await relayedCreatePromise;
  assert.equal(relayedCreate.tabId, 123);
  assert.equal(relayedCreate.browser_instance_id, browserInstanceId);
  assert.equal(relayedCreate.code.url, "http://127.0.0.1/new");
  extensionWs.send(JSON.stringify({
    type: "result",
    id: relayedCreate.id,
    browser_instance_id: browserInstanceId,
    result: { id: 456, url: "http://127.0.0.1/new", title: "New Tab" },
    newTabs: [{ id: 456, url: "http://127.0.0.1/new", title: "New Tab" }],
  }));
  const createResponse = await waitForWsMessage(
    controllerWs,
    (message) => String(message.id ?? "") === "create_tab",
    "tabs.create controller response",
  );
  assert.equal(createResponse?.type, "result");
  assert.equal(createResponse?.result?.id, 456);
}

async function runNewTabMonitoringRelayCase(extensionWs, controllerWs, linkUrl) {
  const noMonitorWsRelay = waitForWsMessage(
    extensionWs,
    (message) => message?.code?.params?.expression === "browser67_no_monitor_ws",
    "relayed websocket monitorNewTabs=false",
  );
  controllerWs.send(JSON.stringify({
    id: "no_monitor_ws",
    browser_instance_id: browserInstanceId,
    tabId: 123,
    monitorNewTabs: false,
    code: {
      cmd: "cdp",
      method: "Runtime.evaluate",
      params: { expression: "browser67_no_monitor_ws" },
    },
  }));
  const relayedWs = await noMonitorWsRelay;
  assert.equal(relayedWs.monitorNewTabs, false);
  assert.equal(relayedWs.browser_instance_id, browserInstanceId);
  extensionWs.send(JSON.stringify({
    type: "result",
    id: relayedWs.id,
    browser_instance_id: browserInstanceId,
    result: { value: "ws-no-monitor" },
  }));
  const wsResponse = await waitForWsMessage(
    controllerWs,
    (message) => String(message.id ?? "") === "no_monitor_ws",
    "websocket monitorNewTabs=false response",
  );
  assert.equal(wsResponse?.type, "result");

  const defaultMonitorRelay = waitForWsMessage(
    extensionWs,
    (message) => message?.code?.params?.expression === "browser67_default_monitor",
    "relayed websocket default monitorNewTabs",
  );
  controllerWs.send(JSON.stringify({
    id: "default_monitor_ws",
    browser_instance_id: browserInstanceId,
    tabId: 123,
    code: {
      cmd: "cdp",
      method: "Runtime.evaluate",
      params: { expression: "browser67_default_monitor" },
    },
  }));
  const relayedDefault = await defaultMonitorRelay;
  assert.equal(relayedDefault.monitorNewTabs, true);
  extensionWs.send(JSON.stringify({
    type: "result",
    id: relayedDefault.id,
    browser_instance_id: browserInstanceId,
    result: { value: "ws-default-monitor" },
  }));
  const defaultResponse = await waitForWsMessage(
    controllerWs,
    (message) => String(message.id ?? "") === "default_monitor_ws",
    "websocket default monitorNewTabs response",
  );
  assert.equal(defaultResponse?.type, "result");

  const noMonitorLinkRelay = waitForWsMessage(
    extensionWs,
    (message) => message?.code?.params?.expression === "browser67_no_monitor_link",
    "relayed link monitorNewTabs=false",
  );
  const linkResponsePromise = fetch(linkUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cmd: "execute_js",
      browser_instance_id: browserInstanceId,
      sessionId: 123,
      timeout: "3",
      monitorNewTabs: false,
      code: {
        cmd: "cdp",
        method: "Runtime.evaluate",
        params: { expression: "browser67_no_monitor_link" },
      },
    }),
  });
  const relayedLink = await noMonitorLinkRelay;
  assert.equal(relayedLink.monitorNewTabs, false);
  extensionWs.send(JSON.stringify({
    type: "result",
    id: relayedLink.id,
    browser_instance_id: browserInstanceId,
    result: { value: "link-no-monitor" },
  }));
  const linkResponse = await linkResponsePromise;
  assert.equal(linkResponse.ok, true);
  assert.deepEqual(await linkResponse.json(), {
    r: { data: { value: "link-no-monitor" } },
  });
}

async function runMultiBrowserInstanceRelayCase(extensionWs, controllerWs, linkUrl, wsUrl) {
  const secondExtensionWs = await openWs(wsUrl);
  try {
    secondExtensionWs.send(JSON.stringify({
      type: "ext_ready",
      browser_instance_id: secondBrowserInstanceId,
      extension_identity: extensionIdentity,
      tabs: [
        { id: 123, url: "http://127.0.0.1/profile-b", title: "Profile B Tab" },
      ],
    }));
    await waitForBrowserInstanceStates(linkUrl, [
      { browser_instance_id: browserInstanceId, active: true, tab_count: 1 },
      { browser_instance_id: secondBrowserInstanceId, active: true, tab_count: 1 },
    ], "second extension handshake");

    const ambiguousTabs = await sendControllerRequest(controllerWs, {
      id: "multi_instance_tabs_ambiguous",
      code: { cmd: "tabs" },
    });
    assert.equal(ambiguousTabs?.type, "error");
    assert.equal(ambiguousTabs?.errorCode, "AMBIGUOUS_TARGET");
    const tabsA = await sendControllerRequest(controllerWs, {
      id: "multi_instance_tabs_a",
      browser_instance_id: browserInstanceId,
      code: { cmd: "tabs" },
    });
    const tabsB = await sendControllerRequest(controllerWs, {
      id: "multi_instance_tabs_b",
      browser_instance_id: secondBrowserInstanceId,
      code: { cmd: "tabs" },
    });
    const tabs = [...tabsA.result, ...tabsB.result];
    assert.deepEqual(
      tabs.map((tab) => tab.browser_instance_id).sort(),
      [browserInstanceId, secondBrowserInstanceId],
    );
    assert.deepEqual(
      tabs.map((tab) => tab.tab_id),
      ["123", "123"],
    );

    const ambiguousLinkSessions = await sendLinkCommand(linkUrl, { cmd: "get_all_sessions" });
    assert.equal(ambiguousLinkSessions?.r?.errorCode, "AMBIGUOUS_TARGET");
    const explicitLinkSessionsA = await sendLinkCommand(linkUrl, {
      cmd: "get_all_sessions",
      browser_instance_id: browserInstanceId,
    });
    assert.deepEqual(
      explicitLinkSessionsA?.r?.map((session) => `${session.browser_instance_id}:${session.tab_id}`),
      [`${browserInstanceId}:123`],
    );
    const ambiguousLinkFind = await sendLinkCommand(linkUrl, {
      cmd: "find_session",
      url_pattern: "127.0.0.1",
    });
    assert.equal(ambiguousLinkFind?.r?.errorCode, "AMBIGUOUS_TARGET");
    const explicitLinkFindA = await sendLinkCommand(linkUrl, {
      cmd: "find_session",
      browserInstanceId,
      url_pattern: "fake",
    });
    assert.deepEqual(
      explicitLinkFindA?.r?.map(([key, session]) => [key, `${session.browser_instance_id}:${session.tab_id}`]),
      [[`${browserInstanceId}:123`, `${browserInstanceId}:123`]],
    );

    const multiRuntimeInfo = await sendControllerRequest(controllerWs, {
      id: "multi_instance_runtime_info",
      code: { cmd: "browser67_runtime_info" },
    });
    assert.equal(multiRuntimeInfo?.success, true);
    assert.equal(multiRuntimeInfo?.result?.extension_connected, true);
    assert.equal(multiRuntimeInfo?.result?.extension_identity, null);
    assert.equal(multiRuntimeInfo?.result?.extension_identity_status, "missing");
    const multiIdentityVerified = compareExtensionRuntimeIdentity({
      endpoint: "ws://127.0.0.1:fixture",
      ok: true,
      latency_ms: 1,
      detail: "ws_runtime_info_ok",
      runtime_info: multiRuntimeInfo.result,
    }, {
      available: true,
      path: "/fixture/build-identity.json",
      identity: extensionIdentity,
      error: "",
    });
    assert.equal(multiIdentityVerified.ok, true);
    assert.equal(multiIdentityVerified.identity_match, true);
    assert.equal(multiIdentityVerified.detail, "extension_identity_ok");
    assert.deepEqual(
      multiIdentityVerified.observed_browser_instances.map((instance) => ({
        browser_instance_id: instance.browser_instance_id,
        identity_match: instance.identity_match,
        extension_version: instance.extension_version,
        build_revision: instance.build_revision,
      })),
      [
        {
          browser_instance_id: browserInstanceId,
          identity_match: true,
          extension_version: extensionIdentity.extension_version,
          build_revision: extensionIdentity.build_revision,
        },
        {
          browser_instance_id: secondBrowserInstanceId,
          identity_match: true,
          extension_version: extensionIdentity.extension_version,
          build_revision: extensionIdentity.build_revision,
        },
      ],
    );
    const staleRuntimeInfo = structuredClone(multiRuntimeInfo.result);
    staleRuntimeInfo.browser_instances[1].extension_identity.source_digest = "c".repeat(64);
    const staleIdentity = compareExtensionRuntimeIdentity({
      endpoint: "ws://127.0.0.1:fixture",
      ok: true,
      latency_ms: 1,
      detail: "ws_runtime_info_ok",
      runtime_info: staleRuntimeInfo,
    }, {
      available: true,
      path: "/fixture/build-identity.json",
      identity: extensionIdentity,
      error: "",
    });
    assert.equal(staleIdentity.ok, false);
    assert.deepEqual(staleIdentity.mismatches, ["source_digest"]);
    assert.equal(
      staleIdentity.observed_browser_instances.find((instance) => (
        instance.browser_instance_id === secondBrowserInstanceId
      ))?.identity_match,
      false,
    );

    const inventory = await readBrowserInstanceInventory(linkUrl);
    assert.equal(inventory.default_browser_instance_id, null);
    assert.deepEqual(
      inventory.browser_instances.map((instance) => ({
        id: instance.browser_instance_id,
        active: instance.active,
        tab_count: instance.tab_count,
      })),
      [
        { id: browserInstanceId, active: true, tab_count: 1 },
        { id: secondBrowserInstanceId, active: true, tab_count: 1 },
      ],
    );

    const ambiguous = await sendControllerRequest(controllerWs, {
      id: "multi_instance_ambiguous",
      tabId: 123,
      code: { cmd: "cdp", method: "Runtime.evaluate", params: { expression: "ambiguous" } },
    });
    assert.equal(ambiguous?.type, "error");
    assert.equal(ambiguous?.errorCode, "AMBIGUOUS_TARGET");
    assert.deepEqual(
      ambiguous?.details?.available_browser_instance_ids,
      [browserInstanceId, secondBrowserInstanceId],
    );

    await runExplicitInstanceRelay({
      extensionWs,
      controllerWs,
      controllerId: "explicit_instance_a",
      instanceId: browserInstanceId,
      expression: "explicit_instance_a",
      resultValue: "a",
    });
    await runExplicitInstanceRelay({
      extensionWs: secondExtensionWs,
      controllerWs,
      controllerId: "explicit_instance_b",
      instanceId: secondBrowserInstanceId,
      expression: "explicit_instance_b",
      resultValue: "b",
    });

    const instanceBoundRelayPromise = waitForWsMessage(
      extensionWs,
      (message) => message?.code?.params?.expression === "instance_bound_pending",
      "instance-bound pending relay",
    );
    controllerWs.send(JSON.stringify({
      id: "instance_bound_pending",
      browser_instance_id: browserInstanceId,
      tabId: 123,
      code: {
        cmd: "cdp",
        method: "Runtime.evaluate",
        params: { expression: "instance_bound_pending" },
      },
    }));
    const instanceBoundRelay = await instanceBoundRelayPromise;
    const wrongSocketResponse = waitForWsMessage(
      controllerWs,
      (message) => String(message.id ?? "") === "instance_bound_pending",
      "wrong Browser Instance must not settle pending relay",
      100,
    );
    secondExtensionWs.send(JSON.stringify({
      type: "result",
      id: instanceBoundRelay.id,
      browser_instance_id: secondBrowserInstanceId,
      result: { value: "wrong-instance" },
    }));
    const wrongSocketSettled = await wrongSocketResponse.then(() => true, () => false);
    assert.equal(wrongSocketSettled, false);
    const correctResponsePromise = waitForWsMessage(
      controllerWs,
      (message) => String(message.id ?? "") === "instance_bound_pending",
      "correct Browser Instance settles pending relay",
    );
    extensionWs.send(JSON.stringify({
      type: "result",
      id: instanceBoundRelay.id,
      browser_instance_id: browserInstanceId,
      result: { value: "correct-instance" },
    }));
    const correctResponse = await correctResponsePromise;
    assert.equal(correctResponse?.result?.value, "correct-instance");
    assert.equal(correctResponse?.browser_instance_id, browserInstanceId);

    const setDefault = await readBrowserInstanceInventory(linkUrl, {
      action: "set_default",
      browser_instance_id: browserInstanceId,
    });
    assert.equal(setDefault.default_browser_instance_id, browserInstanceId);
    const defaultLinkSessions = await sendLinkCommand(linkUrl, { cmd: "get_all_sessions" });
    assert.deepEqual(
      defaultLinkSessions?.r?.map((session) => `${session.browser_instance_id}:${session.tab_id}`),
      [`${browserInstanceId}:123`],
    );
    const defaultLinkFind = await sendLinkCommand(linkUrl, {
      cmd: "find_session",
      url_pattern: "fake",
    });
    assert.deepEqual(
      defaultLinkFind?.r?.map(([key]) => key),
      [`${browserInstanceId}:123`],
    );

    const defaultRelayPromise = waitForWsMessage(
      extensionWs,
      (message) => message?.code?.params?.expression === "default_instance_route",
      "default Browser Instance relay",
    );
    controllerWs.send(JSON.stringify({
      id: "default_instance_route",
      tabId: 123,
      code: {
        cmd: "cdp",
        method: "Runtime.evaluate",
        params: { expression: "default_instance_route" },
      },
    }));
    const defaultRelay = await defaultRelayPromise;
    assert.equal(defaultRelay.browser_instance_id, browserInstanceId);
    const defaultResponsePromise = waitForWsMessage(
      controllerWs,
      (message) => String(message.id ?? "") === "default_instance_route",
      "default Browser Instance controller response",
    );
    extensionWs.send(JSON.stringify({
      type: "result",
      id: defaultRelay.id,
      browser_instance_id: browserInstanceId,
      result: { value: "default-a" },
    }));
    await defaultResponsePromise;

    extensionWs.close();
    await waitForBrowserInstanceStates(linkUrl, [
      { browser_instance_id: browserInstanceId, active: false, tab_count: 0 },
      { browser_instance_id: secondBrowserInstanceId, active: true, tab_count: 1 },
    ], "default extension disconnect");
    const defaultUnavailable = await sendControllerRequest(controllerWs, {
      id: "default_instance_unavailable",
      tabId: 123,
      code: { cmd: "cdp", method: "Runtime.evaluate", params: { expression: "must-not-fallback" } },
    });
    assert.equal(defaultUnavailable?.type, "error");
    assert.equal(defaultUnavailable?.errorCode, "BROWSER_INSTANCE_UNAVAILABLE");
    assert.equal(defaultUnavailable?.details?.browser_instance_id, browserInstanceId);
    const defaultLinkSessionsUnavailable = await sendLinkCommand(linkUrl, { cmd: "get_all_sessions" });
    assert.equal(defaultLinkSessionsUnavailable?.r?.errorCode, "BROWSER_INSTANCE_UNAVAILABLE");
    assert.equal(defaultLinkSessionsUnavailable?.r?.details?.browser_instance_id, browserInstanceId);
    const defaultLinkFindUnavailable = await sendLinkCommand(linkUrl, {
      cmd: "find_session",
      url_pattern: "127.0.0.1",
    });
    assert.equal(defaultLinkFindUnavailable?.r?.errorCode, "BROWSER_INSTANCE_UNAVAILABLE");
    const survivingLinkSessions = await sendLinkCommand(linkUrl, {
      cmd: "get_all_sessions",
      browser_instance_id: secondBrowserInstanceId,
    });
    assert.deepEqual(
      survivingLinkSessions?.r?.map((session) => `${session.browser_instance_id}:${session.tab_id}`),
      [`${secondBrowserInstanceId}:123`],
    );
    const survivingLinkFind = await sendLinkCommand(linkUrl, {
      cmd: "find_session",
      browser_instance_id: secondBrowserInstanceId,
      url_pattern: "profile-b",
    });
    assert.deepEqual(
      survivingLinkFind?.r?.map(([key]) => key),
      [`${secondBrowserInstanceId}:123`],
    );

    const survivingTabs = await sendControllerRequest(controllerWs, {
      id: "surviving_instance_tabs",
      browser_instance_id: secondBrowserInstanceId,
      code: { cmd: "tabs" },
    });
    assert.deepEqual(
      survivingTabs?.result?.map((tab) => `${tab.browser_instance_id}:${tab.tab_id}`),
      [`${secondBrowserInstanceId}:123`],
    );
    await runExplicitInstanceRelay({
      extensionWs: secondExtensionWs,
      controllerWs,
      controllerId: "surviving_instance_b",
      instanceId: secondBrowserInstanceId,
      expression: "surviving_instance_b",
      resultValue: "b-still-active",
    });
  } finally {
    closeWs(secondExtensionWs);
  }
}

async function runNoExtensionCase(extensionWs, controllerWs, linkUrl) {
  extensionWs.close();
  await waitForBrowserInstanceStates(linkUrl, [
    { browser_instance_id: browserInstanceId, active: false, tab_count: 0 },
    { browser_instance_id: secondBrowserInstanceId, active: false, tab_count: 0 },
  ], "all extensions disconnected");
  const noExtensionResponse = await sendControllerRequest(controllerWs, {
    id: "no_extension",
    browser_instance_id: browserInstanceId,
    tabId: 123,
    code: { cmd: "cdp", method: "Runtime.evaluate", params: { expression: "1" } },
  });
  assert.equal(noExtensionResponse?.type, "error");
  assert.equal(noExtensionResponse?.errorCode, "BROWSER_INSTANCE_UNAVAILABLE");
  assert.match(String(noExtensionResponse?.error ?? ""), /browser instance is unavailable/);
}

export {
  runNewTabMonitoringRelayCase,
  runNoExtensionCase,
  runMultiBrowserInstanceRelayCase,
  runResponseListenerOrderingCase,
  runRuntimeIdentityCase,
  runTabsCreateRelayCase,
  runTabsListCase,
};
