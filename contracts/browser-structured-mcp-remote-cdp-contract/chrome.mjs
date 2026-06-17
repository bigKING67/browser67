import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, resolve } from "node:path";

import { repoRoot } from "./paths.mjs";

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

function launchChrome({ chromePath, cdpPort, userDataDir }) {
  return spawn(chromePath, [
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
}

async function terminateChrome(chromeProcess) {
  if (!chromeProcess) {
    return;
  }
  try {
    chromeProcess.kill("SIGTERM");
  } catch {
    // ignore
  }
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

export {
  findChromeBinary,
  launchChrome,
  terminateChrome,
};
