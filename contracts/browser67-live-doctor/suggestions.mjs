import {
  isCdpReadyPath,
  isRemoteCdpMode,
  isTmwdReadyPath,
} from "../browser67-live-gate/modes.mjs";

function buildSuggestions(cli, readiness) {
  const suggestions = [
    "For TMWD path, run: npm run hub:start",
    "Install or enable the TMWD browser extension, then keep a Chrome/Edge tab open.",
  ];
  if (readiness.reason === "tmwd_extension_identity_unverified") {
    suggestions.push(
      "Run npm run setup, restart the browser67 Hub, then run npm run extension:reload-live.",
      "Re-run npm run check:live:doctor and confirm tmwd_ws_runtime or tmwd_link_runtime reports extension_identity_ok.",
    );
  }
  if (isRemoteCdpMode(cli.tmwd_mode)) {
    return [
      "For remote-debugging CDP path, launch Chrome with --remote-debugging-port=9222",
      "Use --allow-empty-tabs when checking connectivity only (without active tabs/sessions).",
      "Then run live contract: npm run check:live",
    ];
  }
  if (cli.tmwd_mode === "auto" && !isTmwdReadyPath(readiness) && !isCdpReadyPath(readiness)) {
    suggestions.push("For remote-debugging CDP path, launch Chrome with --remote-debugging-port=9222");
  }
  suggestions.push(
    "Use --allow-empty-tabs when checking connectivity only (without active tabs/sessions).",
    "Then run live contract: npm run check:live",
  );
  return suggestions;
}

export {
  buildSuggestions,
};
