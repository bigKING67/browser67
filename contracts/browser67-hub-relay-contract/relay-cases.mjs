import assert from "node:assert/strict";

import { compareExtensionRuntimeIdentity } from "../browser67-live-doctor/extension-identity.mjs";
import { sleep } from "./ports.mjs";
import { sendControllerRequest, waitForWsMessage } from "./ws-client.mjs";

const extensionIdentity = {
  schema: "browser67.extension-identity.v1",
  product: "browser67",
  extension_version: "0.4.0",
  manifest_version: "0.4.0",
  build_revision: "0123456789abcdef0123456789abcdef01234567",
  build_revision_source: "git",
  build_inputs_dirty: false,
  source_digest: "b".repeat(64),
  protocol_revision: 1,
};

async function runTabsListCase(extensionWs, controllerWs) {
  extensionWs.send(JSON.stringify({
    type: "ext_ready",
    extension_identity: extensionIdentity,
    tabs: [
      { id: 123, url: "http://127.0.0.1/fake", title: "Fake Tab" },
    ],
  }));

  const listResponse = await sendControllerRequest(controllerWs, {
    id: "list_tabs",
    code: { cmd: "tabs" },
  });
  assert.equal(listResponse?.success, true);
  assert.equal(Array.isArray(listResponse?.result), true);
  assert.equal(listResponse.result[0]?.id, "123");
}

async function runRuntimeIdentityCase(controllerWs, linkUrl) {
  const wsResponse = await sendControllerRequest(controllerWs, {
    id: "runtime_info",
    code: { cmd: "browser67_runtime_info" },
  });
  assert.equal(wsResponse?.success, true);
  assert.equal(wsResponse?.result?.schema, "browser67.hub-runtime-info.v1");
  assert.equal(wsResponse?.result?.extension_connected, true);
  assert.equal(wsResponse?.result?.extension_identity_status, "valid");
  assert.deepEqual(wsResponse?.result?.extension_identity, extensionIdentity);
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
  assert.equal(relayedCreate.code.url, "http://127.0.0.1/new");
  extensionWs.send(JSON.stringify({
    type: "result",
    id: relayedCreate.id,
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
  extensionWs.send(JSON.stringify({
    type: "result",
    id: relayedWs.id,
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
    result: { value: "link-no-monitor" },
  }));
  const linkResponse = await linkResponsePromise;
  assert.equal(linkResponse.ok, true);
  assert.deepEqual(await linkResponse.json(), {
    r: { data: { value: "link-no-monitor" } },
  });
}

async function runNoExtensionCase(extensionWs, controllerWs) {
  extensionWs.close();
  await sleep(100);
  const noExtensionResponse = await sendControllerRequest(controllerWs, {
    id: "no_extension",
    tabId: 123,
    code: { cmd: "cdp", method: "Runtime.evaluate", params: { expression: "1" } },
  });
  assert.equal(noExtensionResponse?.type, "error");
  assert.match(String(noExtensionResponse?.error ?? ""), /no active extension websocket connection/);
}

export {
  runNewTabMonitoringRelayCase,
  runNoExtensionCase,
  runRuntimeIdentityCase,
  runTabsCreateRelayCase,
  runTabsListCase,
};
