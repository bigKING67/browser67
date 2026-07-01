import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { closeOtherCdpTargets, createCdpTarget, waitForCdpTarget, waitForUrl } from "./cdp-targets.mjs";
import { findChromeBinary, launchChrome, terminateChrome } from "./chrome.mjs";
import { parseArgs } from "./cli.mjs";
import { closeServer, createFixtureServer, listen, reservePort } from "./fixture.mjs";
import { runGate } from "./gate-runner.mjs";
import { repoRoot } from "./paths.mjs";

async function runRemoteCdpContract(argv) {
  const cli = parseArgs(argv);
  const chrome = findChromeBinary(cli.chrome_bin);
  const tempRoot = mkdtempSync(resolve(tmpdir(), "tmwd-remote-cdp-"));
  const userDataDir = resolve(tempRoot, "chrome-profile");
  const fixtureServer = createFixtureServer();
  let chromeProcess = null;
  let chromeStderr = "";
  try {
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
    const ok = doctor.status === 0
      && live.status === 0
      && doctor.payload?.doctor?.readiness?.path === "cdp"
      && livePayload?.stage === "live_passed"
      && livePayload?.live?.transport === "cdp"
      && livePayload?.live?.href === fixtureUrl
      && livePayload?.live?.title === "remote-cdp-fixture";

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
    await closeServer(fixtureServer).catch(() => {});
    await terminateChrome(chromeProcess);
    if (cli.keep_temp !== true) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

export {
  runRemoteCdpContract,
};
