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
  runNoExtensionCase,
  runTabsCreateRelayCase,
  runTabsListCase,
};
