import assert from "node:assert/strict";

import { sleep } from "./ports.mjs";
import { sendControllerRequest, waitForWsMessage } from "./ws-client.mjs";

async function runTabsListCase(extensionWs, controllerWs) {
  extensionWs.send(JSON.stringify({
    type: "ext_ready",
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
  runTabsCreateRelayCase,
  runTabsListCase,
};
