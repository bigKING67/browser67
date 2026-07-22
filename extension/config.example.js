// Runtime install writes extension/config.js with a per-install TID.
// Do not load this source directory directly; run `npm run setup` and load
// ~/.browser67/browser/tmwd_cdp_bridge/ as the canonical unpacked extension.
globalThis.__browser67TID = "__tmwd_browser_mcp_replace_during_setup";
