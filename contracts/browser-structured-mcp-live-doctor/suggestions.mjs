import {
  isCdpReadyPath,
  isRemoteCdpMode,
  isTmwdReadyPath,
} from "../browser-structured-mcp-live-gate/modes.mjs";

function buildSuggestions(cli, readiness) {
  const suggestions = [
    "For TMWD path, run: npm run hub:start",
    "Install or enable the TMWD browser extension, then keep a Chrome/Edge tab open.",
  ];
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
