import { compactText } from "../browser/content/output-limits.mjs";
import { ensureNativeCommandOk } from "../native-core/index.mjs";

import {
  escapeAppleScriptString,
  runAppleScript,
} from "./apple-script.mjs";
import { normalizeWindowTabId } from "./chromium-window.mjs";

const OUTPUT_DELIMITER = "\u001f";
const APPLICATION_BY_BROWSER_FAMILY = Object.freeze({
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
});
const BUNDLE_ID_BY_APPLICATION = Object.freeze({
  "Google Chrome": "com.google.Chrome",
  "Microsoft Edge": "com.microsoft.edgemac",
});

function shellQuote(raw) {
  return `'${String(raw ?? "").replace(/'/gu, `'"'"'`)}'`;
}

function applicationForBrowserFamily(browserFamily) {
  const normalized = String(browserFamily ?? "").trim().toLowerCase();
  const applicationName = APPLICATION_BY_BROWSER_FAMILY[normalized];
  if (!applicationName) {
    throw new Error(`unsupported Agent window browser family=${normalized || "unknown"}`);
  }
  return applicationName;
}

function buildMacAgentWindowFullscreenScript({
  anchorTabId,
  anchorUrl,
  applicationName,
  restoreTabId,
}) {
  const normalizedAnchorTabId = normalizeWindowTabId(anchorTabId);
  const normalizedRestoreTabId = normalizeWindowTabId(restoreTabId);
  const normalizedAnchorUrl = String(anchorUrl ?? "").trim();
  const normalizedApplicationName = String(applicationName ?? "").trim();
  if (!normalizedAnchorTabId || !normalizedAnchorUrl || !normalizedApplicationName) {
    throw new Error("macOS Agent window fullscreen requires application, anchor tab id, and anchor URL");
  }
  const escapedApplication = escapeAppleScriptString(normalizedApplicationName);
  const escapedAnchorUrl = escapeAppleScriptString(normalizedAnchorUrl);
  const bundleId = BUNDLE_ID_BY_APPLICATION[normalizedApplicationName];
  if (!bundleId) {
    throw new Error(`unsupported Agent window application=${normalizedApplicationName}`);
  }
  const activationJxa = `ObjC.import("AppKit"); var apps=$.NSRunningApplication.runningApplicationsWithBundleIdentifier("${bundleId}"); if (apps.count === 0) throw new Error("Agent window browser not running"); if (!apps.objectAtIndex(0).activateWithOptions(2)) throw new Error("Agent window browser activation failed");`;
  const activationShellCommand = ["/usr/bin/osascript", "-l", "JavaScript", "-e", activationJxa]
    .map(shellQuote)
    .join(" ");
  const restoreId = normalizedRestoreTabId ?? 0;
  return [
    "set outputDelimiter to ASCII character 31",
    "set originalProcessName to \"\"",
    "try",
    "  tell application \"System Events\"",
    "    set frontProcesses to every application process whose frontmost is true",
    "    if (count frontProcesses) > 0 then set originalProcessName to name of item 1 of frontProcesses",
    "  end tell",
    "end try",
    `if application "${escapedApplication}" is not running then error "Agent window browser is not running"`,
    "set targetWindowIndex to 0",
    `tell application "${escapedApplication}"`,
    "  repeat with windowIndex from 1 to count windows",
    "    set candidateWindow to window windowIndex",
    "    repeat with tabIndex from 1 to count tabs of candidateWindow",
    "      set candidateTab to tab tabIndex of candidateWindow",
    `      if (id of candidateTab as text) is "${String(normalizedAnchorTabId)}" and (URL of candidateTab as text) is "${escapedAnchorUrl}" then`,
    "        set targetWindowIndex to windowIndex",
    "        exit repeat",
    "      end if",
    "    end repeat",
    "    if targetWindowIndex is not 0 then exit repeat",
    "  end repeat",
    "  if targetWindowIndex is 0 then error \"browser67 Agent anchor not found\"",
    "  set index of window targetWindowIndex to 1",
    "  activate",
    `  do shell script "${escapeAppleScriptString(activationShellCommand)}"`,
    "  set index of window targetWindowIndex to 1",
    "  activate",
    "end tell",
    "delay 0.75",
    `tell application "${escapedApplication}"`,
    "  set exactAnchorStillPresent to false",
    "  repeat with candidateTab in tabs of window 1",
    `    if (id of candidateTab as text) is "${String(normalizedAnchorTabId)}" and (URL of candidateTab as text) is "${escapedAnchorUrl}" then set exactAnchorStillPresent to true`,
    "  end repeat",
    "  if exactAnchorStillPresent is false then error \"front window does not contain the exact browser67 Agent anchor\"",
    "end tell",
    "set changedState to false",
    "set nativeFullScreen to false",
    "set transitionMethod to \"none\"",
    "tell application \"System Events\"",
    `  tell application process "${escapedApplication}"`,
    "    set frontmost to true",
    "    if (count windows) is 0 then error \"Agent window accessibility surface is unavailable\"",
    "    set targetAccessibilityWindow to window 1",
    "    set nativeFullScreen to value of attribute \"AXFullScreen\" of targetAccessibilityWindow",
    "    if nativeFullScreen is false then",
    "      try",
    "        if exists menu item \"进入全屏幕\" of menu 1 of menu bar item \"显示\" of menu bar 1 then",
    "          click menu item \"进入全屏幕\" of menu 1 of menu bar item \"显示\" of menu bar 1",
    "          set transitionMethod to \"view_menu_zh_cn\"",
    "        else if exists menu item \"Enter Full Screen\" of menu 1 of menu bar item \"View\" of menu bar 1 then",
    "          click menu item \"Enter Full Screen\" of menu 1 of menu bar item \"View\" of menu bar 1",
    "          set transitionMethod to \"view_menu_en\"",
    "        end if",
    "      end try",
    "      if transitionMethod is \"none\" then",
    "        keystroke \"f\" using {control down, command down}",
    "        set transitionMethod to \"control_command_f\"",
    "      end if",
    "      set changedState to true",
    "    else",
    "      set transitionMethod to \"already_fullscreen\"",
    "    end if",
    "  end tell",
    "end tell",
    "if changedState is true then delay 2.0",
    "set focusRestored to false",
    "set restoreReason to \"not_requested\"",
    `set restoreTabId to ${String(restoreId)}`,
    "if restoreTabId is not 0 then",
    "  set restoreWindowIndex to 0",
    "  set restoreTabIndex to 0",
    `  tell application "${escapedApplication}"`,
    "    repeat with windowIndex from 1 to count windows",
    "      set candidateWindow to window windowIndex",
    "      repeat with tabIndex from 1 to count tabs of candidateWindow",
    "        if (id of tab tabIndex of candidateWindow as text) is (restoreTabId as text) then",
    "          set restoreWindowIndex to windowIndex",
    "          set restoreTabIndex to tabIndex",
    "          exit repeat",
    "        end if",
    "      end repeat",
    "      if restoreWindowIndex is not 0 then exit repeat",
    "    end repeat",
    "    if restoreWindowIndex is not 0 then",
    "      set active tab index of window restoreWindowIndex to restoreTabIndex",
    "      set index of window restoreWindowIndex to 1",
    "      activate",
    "      set focusRestored to true",
    "      set restoreReason to \"original_browser_tab\"",
    "    else",
    "      set restoreReason to \"original_browser_tab_unavailable\"",
    "    end if",
    "  end tell",
    `else if originalProcessName is not "" and originalProcessName is not "${escapedApplication}" then`,
    "  try",
    "    tell application \"System Events\" to set frontmost of application process originalProcessName to true",
    "    set focusRestored to true",
    "    set restoreReason to \"original_application\"",
    "  on error",
    "    set restoreReason to \"original_application_unavailable\"",
    "  end try",
    "else",
    "  set restoreReason to \"agent_window_was_original_focus\"",
    "end if",
    `return "transition_requested" & outputDelimiter & (changedState as text) & outputDelimiter & (nativeFullScreen as text) & outputDelimiter & (focusRestored as text) & outputDelimiter & restoreReason & outputDelimiter & "${escapedApplication}" & outputDelimiter & transitionMethod`,
  ];
}

function parseMacAgentWindowFullscreenOutput(raw) {
  const pieces = String(raw ?? "").trim().split(OUTPUT_DELIMITER);
  if (pieces.length !== 7) {
    throw new Error(`invalid macOS Agent window presentation output=${compactText(raw, 240)}`);
  }
  const [status, changedRaw, fullscreenRaw, focusRestoredRaw, restoreReason, applicationName, transitionMethod] = pieces;
  if (status !== "transition_requested") {
    throw new Error(`invalid macOS Agent window presentation state=${compactText(raw, 240)}`);
  }
  return {
    mode: "macos_native_fullscreen_space",
    status: fullscreenRaw === "true" ? "ready" : "verification_required",
    changed: changedRaw === "true",
    native_fullscreen: fullscreenRaw === "true",
    verification_required: fullscreenRaw !== "true",
    toolbar_preserved: true,
    focus_restored: focusRestoredRaw === "true",
    restore_reason: String(restoreReason ?? ""),
    application_name: String(applicationName ?? ""),
    transition_method: String(transitionMethod ?? ""),
    driver: "macos-accessibility-native-fullscreen",
  };
}

async function ensureMacAgentWindowNativeFullscreen({
  anchorTabId,
  anchorUrl,
  browserFamily,
  restoreTabId,
  timeoutMs = 15_000,
}) {
  const applicationName = applicationForBrowserFamily(browserFamily);
  const result = await runAppleScript(buildMacAgentWindowFullscreenScript({
    anchorTabId,
    anchorUrl,
    applicationName,
    restoreTabId,
  }), timeoutMs);
  ensureNativeCommandOk(result, "set exact browser67 Agent window to native macOS full screen");
  return parseMacAgentWindowFullscreenOutput(result.stdout);
}

export {
  applicationForBrowserFamily,
  buildMacAgentWindowFullscreenScript,
  ensureMacAgentWindowNativeFullscreen,
  parseMacAgentWindowFullscreenOutput,
};
