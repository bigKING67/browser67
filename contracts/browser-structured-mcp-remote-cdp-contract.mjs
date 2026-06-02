#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { accessSync, constants, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const liveGatePath = resolve(repoRoot, "contracts/browser-structured-mcp-live-gate.mjs");

function parseArgs(argv) {
  const parsed = {
    timeout_ms: 15_000,
    chrome_bin: "",
    keep_temp: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--timeout-ms") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("invalid --timeout-ms value");
      }
      parsed.timeout_ms = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--chrome-bin") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --chrome-bin value");
      }
      parsed.chrome_bin = value;
      index += 1;
      continue;
    }
    if (token === "--keep-temp") {
      parsed.keep_temp = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function commandExists(command) {
  const pathEntries = String(process.env.PATH ?? "")
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  const extensions = process.platform === "win32"
    ? String(process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = resolve(directory, `${command}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // continue
      }
    }
  }
  return "";
}

function findChromeBinary(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.CHROME_BIN,
    process.env.GOOGLE_CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    commandExists("google-chrome-stable"),
    commandExists("google-chrome"),
    commandExists("chromium"),
    commandExists("chromium-browser"),
    commandExists("msedge"),
  ].map((item) => String(item ?? "").trim()).filter(Boolean);

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
    });
    if (probe.status === 0) {
      return {
        path: candidate,
        version: String(probe.stdout || probe.stderr || "").trim(),
      };
    }
  }
  throw new Error("Chrome/Chromium binary not found; pass --chrome-bin or set CHROME_BIN");
}

function listen(server, host = "127.0.0.1") {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, host, () => {
      server.off("error", rejectPromise);
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectPromise(new Error("server returned invalid address"));
        return;
      }
      resolvePromise(address.port);
    });
  });
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      lastError = `http_${String(response.status)}`;
    } catch (error) {
      lastError = String(error?.message ?? error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`timed out waiting for ${url}: ${lastError || "no response"}`);
}

async function waitForCdpTarget(cdpEndpoint, expectedUrl, timeoutMs) {
  const endpoint = `${String(cdpEndpoint).replace(/\/$/, "")}/json/list`;
  const deadline = Date.now() + timeoutMs;
  let lastSeen = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint);
      const rows = await response.json();
      const targets = Array.isArray(rows) ? rows : [];
      const pageUrls = targets
        .filter((item) => item?.type === "page")
        .map((item) => String(item?.url ?? ""));
      lastSeen = pageUrls.join(", ");
      const matched = targets.find((item) => item?.type === "page" && String(item?.url ?? "") === expectedUrl);
      if (matched) {
        return {
          id: String(matched.id ?? ""),
          url: String(matched.url ?? ""),
          title: String(matched.title ?? ""),
        };
      }
    } catch (error) {
      lastSeen = String(error?.message ?? error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`timed out waiting for CDP target url=${expectedUrl}; last_seen=${lastSeen || "<none>"}`);
}

async function createCdpTarget(cdpEndpoint, url) {
  const base = String(cdpEndpoint).replace(/\/$/, "");
  const targetUrl = `${base}/json/new?${encodeURIComponent(url)}`;
  let response = await fetch(targetUrl, { method: "PUT" });
  if (!response.ok && response.status === 405) {
    response = await fetch(targetUrl);
  }
  if (!response.ok) {
    throw new Error(`CDP /json/new failed status=${String(response.status)}`);
  }
  const payload = await response.json();
  return {
    id: String(payload?.id ?? ""),
    url: String(payload?.url ?? ""),
  };
}

async function closeOtherCdpTargets(cdpEndpoint, keepTargetId) {
  const base = String(cdpEndpoint).replace(/\/$/, "");
  const response = await fetch(`${base}/json/list`);
  if (!response.ok) {
    return;
  }
  const rows = await response.json();
  const targets = Array.isArray(rows) ? rows : [];
  await Promise.all(targets
    .filter((item) => item?.type === "page")
    .filter((item) => String(item?.id ?? "") !== keepTargetId)
    .map(async (item) => {
      try {
        await fetch(`${base}/json/close/${encodeURIComponent(String(item.id))}`);
      } catch {
        // best-effort cleanup
      }
    }));
}

function parseLastJsonLine(stdout) {
  const rows = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(rows[index]);
    } catch {
      // continue
    }
  }
  return null;
}

function runGate(args, timeoutMs) {
  const result = spawnSync(process.execPath, [liveGatePath, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    payload: parseLastJsonLine(result.stdout),
    error: result.error ? String(result.error.message ?? result.error) : "",
  };
}

function closeServer(server) {
  return new Promise((resolvePromise) => {
    server.close(() => resolvePromise());
  });
}

async function run() {
  const cli = parseArgs(process.argv.slice(2));
  const chrome = findChromeBinary(cli.chrome_bin);
  const tempRoot = mkdtempSync(resolve(tmpdir(), "tmwd-remote-cdp-"));
  const userDataDir = resolve(tempRoot, "chrome-profile");
  const fixtureHtml = "<!doctype html><html><head><title>remote-cdp-fixture</title></head><body>remote cdp fixture</body></html>";
  const fixtureServer = createServer((request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(fixtureHtml);
  });
  let chromeProcess = null;
  try {
    const fixturePort = await listen(fixtureServer);
    const cdpServer = createServer((_request, response) => {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("reserved");
    });
    const cdpPort = await listen(cdpServer);
    await closeServer(cdpServer);

    const fixtureUrl = `http://127.0.0.1:${String(fixturePort)}/`;
    const cdpEndpoint = `http://127.0.0.1:${String(cdpPort)}`;
    chromeProcess = spawn(chrome.path, [
      "--headless=new",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${String(cdpPort)}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let chromeStderr = "";
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

    const output = {
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
    };
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return ok ? 0 : 1;
  } finally {
    if (chromeProcess) {
      try {
        chromeProcess.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    await closeServer(fixtureServer).catch(() => {});
    if (chromeProcess) {
      await new Promise((resolvePromise) => {
        const timer = setTimeout(() => {
          try {
            chromeProcess.kill("SIGKILL");
          } catch {
            // ignore
          }
          resolvePromise();
        }, 1_000);
        chromeProcess.once("exit", () => {
          clearTimeout(timer);
          resolvePromise();
        });
      });
    }
    if (cli.keep_temp !== true) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

try {
  process.exitCode = await run();
} catch (error) {
  process.stderr.write(`browser-structured-mcp-remote-cdp-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
