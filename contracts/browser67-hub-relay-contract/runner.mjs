import assert from "node:assert/strict";

import {
  assertHubDidNotCrash,
  startHubProcess,
  terminateHubProcess,
} from "./hub-process.mjs";
import { pickFreePortPair, sleep, waitForPort } from "./ports.mjs";
import {
  runNewTabMonitoringRelayCase,
  runNoExtensionCase,
  runTabsCreateRelayCase,
  runTabsListCase,
} from "./relay-cases.mjs";
import { closeWs, openWs } from "./ws-client.mjs";

async function runHubRelayContract() {
  const { wsPort, linkPort } = await pickFreePortPair();
  const wsUrl = `ws://127.0.0.1:${String(wsPort)}`;
  const linkUrl = `http://127.0.0.1:${String(linkPort)}/link`;
  const hub = startHubProcess({ wsPort, linkPort });

  let extensionWs;
  let controllerWs;
  try {
    await waitForPort("127.0.0.1", wsPort);
    extensionWs = await openWs(wsUrl);
    controllerWs = await openWs(wsUrl);

    await runTabsListCase(extensionWs, controllerWs);
    await runTabsCreateRelayCase(extensionWs, controllerWs);
    await runNewTabMonitoringRelayCase(extensionWs, controllerWs, linkUrl);
    await runNoExtensionCase(extensionWs, controllerWs);

    await sleep(100);
    assert.equal(hub.child.exitCode, null);
    const health = await fetch(linkUrl);
    assert.equal(health.ok, true);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      ws_endpoint: wsUrl,
      tabs_list_intercept_ok: true,
      tabs_create_relay_ok: true,
      monitor_new_tabs_ws_relay_ok: true,
      monitor_new_tabs_link_relay_ok: true,
      monitor_new_tabs_default_compatible: true,
      no_extension_error_nonfatal: true,
    })}\n`);
  } finally {
    closeWs(controllerWs);
    closeWs(extensionWs);
    await terminateHubProcess(hub.child);
  }
  assertHubDidNotCrash(hub.child, hub.logs);
}

export {
  runHubRelayContract,
};
