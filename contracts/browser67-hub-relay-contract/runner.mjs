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
  runMultiBrowserInstanceRelayCase,
  runRuntimeIdentityCase,
  runResponseListenerOrderingCase,
  runTabsCreateRelayCase,
  runTabsListCase,
} from "./relay-cases.mjs";
import { closeWs, openWs } from "./ws-client.mjs";

async function runHubRelayContract() {
  await runResponseListenerOrderingCase();
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

    await runTabsListCase(extensionWs, controllerWs, linkUrl);
    await runRuntimeIdentityCase(controllerWs, linkUrl);
    await runTabsCreateRelayCase(extensionWs, controllerWs);
    await runNewTabMonitoringRelayCase(extensionWs, controllerWs, linkUrl);
    await runMultiBrowserInstanceRelayCase(extensionWs, controllerWs, linkUrl, wsUrl);
    await runNoExtensionCase(extensionWs, controllerWs, linkUrl);

    await sleep(100);
    assert.equal(hub.child.exitCode, null);
    const health = await fetch(linkUrl);
    assert.equal(health.ok, true);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      ws_endpoint: wsUrl,
      tabs_list_intercept_ok: true,
      response_listener_before_send_ok: true,
      extension_identity_handshake_ok: true,
      extension_identity_ws_link_query_ok: true,
      tabs_create_relay_ok: true,
      monitor_new_tabs_ws_relay_ok: true,
      monitor_new_tabs_link_relay_ok: true,
      monitor_new_tabs_default_compatible: true,
      multi_browser_instance_same_tab_id_ok: true,
      ambiguous_target_fail_closed: true,
      default_browser_instance_no_fallback: true,
      pending_relay_instance_bound: true,
      link_session_selection_instance_bound: true,
      multi_instance_doctor_identity_aggregate_ok: true,
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
