import { compactText } from "../common.mjs";
import {
  ensureNativeCommandOk,
  runNativeCommand,
} from "../native-core.mjs";

import {
  escapeAppleScriptString,
  runAppleScript,
} from "./apple-script.mjs";

const CHROMIUM_APPLICATIONS = ["Google Chrome", "Microsoft Edge"];
const CHROMIUM_BUNDLE_IDS = {
  "Google Chrome": "com.google.Chrome",
  "Microsoft Edge": "com.microsoft.edgemac",
};
const OUTPUT_DELIMITER = "\u001f";

function normalizeWindowUrlPrefix(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return "";
  }
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return value.split(/[?#]/u, 1)[0] ?? "";
  }
}

function normalizeWindowTabId(raw) {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function buildChromiumTabWindowScript({
  activate = false,
  applicationName,
  shellCommand = "",
  windowTabId,
  windowUrl,
}) {
  const app = String(applicationName ?? "").trim();
  const tabId = normalizeWindowTabId(windowTabId);
  const urlPrefix = normalizeWindowUrlPrefix(windowUrl);
  if (!app || (!tabId && !urlPrefix)) {
    throw new Error("chromium window lookup requires applicationName and windowTabId or windowUrl");
  }
  const escapedApp = escapeAppleScriptString(app);
  const escapedUrl = escapeAppleScriptString(urlPrefix);
  const bundleId = CHROMIUM_BUNDLE_IDS[app];
  if (!bundleId) {
    throw new Error(`unsupported Chromium application=${app}`);
  }
  const activationJxa = `ObjC.import("AppKit"); var apps=$.NSRunningApplication.runningApplicationsWithBundleIdentifier("${bundleId}"); if (apps.count === 0) throw new Error("Chromium application not running"); if (!apps.objectAtIndex(0).activateWithOptions(2)) throw new Error("Chromium application activation failed");`;
  const activationShellCommand = ["/usr/bin/osascript", "-l", "JavaScript", "-e", activationJxa]
    .map(shellQuote)
    .join(" ");
  const matchCondition = tabId
    ? `(id of candidateTab as text) is "${String(tabId)}"`
    : `candidateUrl starts with "${escapedUrl}"`;
  return [
    "set outputDelimiter to ASCII character 31",
    `if application "${escapedApp}" is not running then error "window not found"`,
    `tell application "${escapedApp}"`,
    "  repeat with windowIndex from 1 to count windows",
    "    set candidateWindow to window windowIndex",
    "    set tabIndex to active tab index of candidateWindow",
    "    set candidateTab to tab tabIndex of candidateWindow",
    ...(tabId ? [] : ["    set candidateUrl to URL of candidateTab"]),
    `    if ${matchCondition} then`,
    ...(activate ? [
      "      set index of candidateWindow to 1",
      "      activate",
      `      do shell script "${escapeAppleScriptString(activationShellCommand)}"`,
      "      set index of candidateWindow to 1",
      "      activate",
      "      delay 0.5",
    ] : []),
    ...(shellCommand ? [
      `      do shell script "${escapeAppleScriptString(shellCommand)}"`,
    ] : []),
    "      set windowBounds to bounds of candidateWindow",
    `      return "${escapedApp}" & outputDelimiter & windowIndex & outputDelimiter & tabIndex & outputDelimiter & (item 1 of windowBounds) & outputDelimiter & (item 2 of windowBounds) & outputDelimiter & (item 3 of windowBounds) & outputDelimiter & (item 4 of windowBounds)`,
    "    end if",
    "  end repeat",
    "  repeat with windowIndex from 1 to count windows",
    "    set candidateWindow to window windowIndex",
    "    repeat with tabIndex from 1 to count tabs of candidateWindow",
    "      set candidateTab to tab tabIndex of candidateWindow",
    ...(tabId ? [] : ["      set candidateUrl to URL of candidateTab"]),
    `      if ${matchCondition} then`,
    ...(activate ? [
      "        set active tab index of candidateWindow to tabIndex",
      "        set index of candidateWindow to 1",
      "        activate",
      `        do shell script "${escapeAppleScriptString(activationShellCommand)}"`,
      "        set active tab index of candidateWindow to tabIndex",
      "        set index of candidateWindow to 1",
      "        activate",
      "        delay 0.5",
    ] : []),
    ...(shellCommand ? [
      `        do shell script "${escapeAppleScriptString(shellCommand)}"`,
    ] : []),
    "        set windowBounds to bounds of candidateWindow",
    `        return "${escapedApp}" & outputDelimiter & windowIndex & outputDelimiter & tabIndex & outputDelimiter & (item 1 of windowBounds) & outputDelimiter & (item 2 of windowBounds) & outputDelimiter & (item 3 of windowBounds) & outputDelimiter & (item 4 of windowBounds)`,
    "      end if",
    "    end repeat",
    "  end repeat",
    "end tell",
    "error \"window not found\"",
  ];
}

function shellQuote(raw) {
  return `'${String(raw ?? "").replace(/'/gu, `'"'"'`)}'`;
}

let cliclickPathPromise;

async function resolveCliclickPath(timeoutMs) {
  if (!cliclickPathPromise) {
    cliclickPathPromise = runNativeCommand("which", ["cliclick"], { timeoutMs })
      .then((result) => {
        ensureNativeCommandOk(result, "which cliclick");
        const resolved = String(result.stdout ?? "").trim().split(/\r?\n/u, 1)[0] ?? "";
        if (!resolved.startsWith("/")) {
          throw new Error(`invalid cliclick path=${compactText(resolved, 120)}`);
        }
        return resolved;
      });
  }
  return cliclickPathPromise;
}

function parseChromiumTabWindowOutput(raw, windowUrl, windowTabId) {
  const pieces = String(raw ?? "").trim().split(OUTPUT_DELIMITER);
  if (pieces.length !== 7) {
    throw new Error(`invalid chromium window output=${compactText(raw, 240)}`);
  }
  const [applicationName, windowIndexRaw, tabIndexRaw, leftRaw, topRaw, rightRaw, bottomRaw] = pieces;
  const windowIndex = Number.parseInt(windowIndexRaw ?? "", 10);
  const tabIndex = Number.parseInt(tabIndexRaw ?? "", 10);
  const left = Number.parseInt(leftRaw ?? "", 10);
  const top = Number.parseInt(topRaw ?? "", 10);
  const right = Number.parseInt(rightRaw ?? "", 10);
  const bottom = Number.parseInt(bottomRaw ?? "", 10);
  if (
    !Number.isFinite(windowIndex)
    || !Number.isFinite(tabIndex)
    || !Number.isFinite(left)
    || !Number.isFinite(top)
    || !Number.isFinite(right)
    || !Number.isFinite(bottom)
    || right <= left
    || bottom <= top
  ) {
    throw new Error(`invalid chromium window numbers=${compactText(raw, 240)}`);
  }
  return {
    application_name: String(applicationName ?? "").trim(),
    window_index: windowIndex,
    tab_index: tabIndex,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    coordinate_system: "screen_points",
    reference_frame: "browser_window",
    browser_tab_id: normalizeWindowTabId(windowTabId) ?? undefined,
    window_url_prefix: normalizeWindowUrlPrefix(windowUrl),
  };
}

function chromiumApplicationCandidates(preferredApplication) {
  const preferred = String(preferredApplication ?? "").trim();
  if (!preferred) {
    return [...CHROMIUM_APPLICATIONS];
  }
  return [
    preferred,
    ...CHROMIUM_APPLICATIONS.filter((item) => item !== preferred),
  ];
}

async function findChromiumTabWindow({
  activate = false,
  preferredApplication,
  timeoutMs,
  windowTabId,
  windowUrl,
}) {
  const tabId = normalizeWindowTabId(windowTabId);
  const urlPrefix = normalizeWindowUrlPrefix(windowUrl);
  if (!tabId && !urlPrefix) {
    throw new Error("window not found: window_tab_id or window_url is required");
  }
  const failures = [];
  for (const applicationName of chromiumApplicationCandidates(preferredApplication)) {
    const result = await runAppleScript(buildChromiumTabWindowScript({
      activate,
      applicationName,
      windowTabId: tabId,
      windowUrl: urlPrefix,
    }), timeoutMs);
    if (result.code !== 0) {
      failures.push(`${applicationName}:${compactText(result.stderr || result.stdout, 120)}`);
      continue;
    }
    ensureNativeCommandOk(result, `osascript ${activate ? "activate" : "locate"} chromium tab`);
    return {
      driver: "macos-chromium-applescript",
      foregrounded: activate,
      ...parseChromiumTabWindowOutput(result.stdout, urlPrefix, tabId),
    };
  }
  throw new Error(`window not found: no Chromium tab matched selector (${failures.join("; ")})`);
}

async function runCliclickAgainstChromiumTab({
  cliclickArgs = [],
  preferredApplication,
  timeoutMs,
  windowTabId,
  windowUrl,
}) {
  const cliclickPath = await resolveCliclickPath(timeoutMs);
  const shellCommand = [cliclickPath, ...cliclickArgs]
    .map(shellQuote)
    .join(" ");
  const tabId = normalizeWindowTabId(windowTabId);
  const urlPrefix = normalizeWindowUrlPrefix(windowUrl);
  if (!tabId && !urlPrefix) {
    throw new Error("window not found: window_tab_id or window_url is required");
  }
  const failures = [];
  for (const applicationName of chromiumApplicationCandidates(preferredApplication)) {
    const result = await runAppleScript(buildChromiumTabWindowScript({
      activate: true,
      applicationName,
      shellCommand,
      windowTabId: tabId,
      windowUrl: urlPrefix,
    }), timeoutMs);
    if (result.code !== 0) {
      failures.push(`${applicationName}:${compactText(result.stderr || result.stdout, 120)}`);
      continue;
    }
    ensureNativeCommandOk(result, "osascript foreground chromium tab and run cliclick");
    return {
      driver: "macos-chromium-applescript-cliclick",
      foregrounded: true,
      input_executed: true,
      ...parseChromiumTabWindowOutput(result.stdout, urlPrefix, tabId),
    };
  }
  throw new Error(`window not found: no Chromium tab matched selector (${failures.join("; ")})`);
}

export {
  buildChromiumTabWindowScript,
  findChromiumTabWindow,
  normalizeWindowUrlPrefix,
  normalizeWindowTabId,
  parseChromiumTabWindowOutput,
  runCliclickAgainstChromiumTab,
};
