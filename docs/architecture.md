# Architecture

```text
Codex / MCP client
  -> src/server.mjs
  -> src/tmwd-runtime.mjs
  -> src/tmwd-hub.mjs
     -> src/tmwd-hub/{config,sessions,relay,ws-server,link-server,shutdown}.mjs
  -> extension/background.js
  -> Chrome/Edge tab

Codex / MCP client
  -> src/js-reverse-server.mjs
  -> src/tmwd-runtime.mjs
  -> src/tmwd-hub.mjs
     -> src/tmwd-hub/{config,sessions,relay,ws-server,link-server,shutdown}.mjs
  -> extension/background.js
  -> Chrome/Edge tab
  -> window.__TMWD_JS_REVERSE__ runtime hooks
```

Fallback paths:

```text
remote_cdp mode -> src/cdp-runtime.mjs -> http://127.0.0.1:9222
native fallback -> src/native-input.mjs -> macOS/Windows/Linux OS input backend
```

## Key design decisions

1. Keep TMWD user browser as the default for profile-sensitive work.
2. Keep remote CDP explicit and visible.
3. Keep extension source vendored and reproducible.
4. Keep runtime artifacts under `~/.tmwd-browser-mcp`.
5. Keep deterministic contracts separate from live browser gates.
6. Keep GenericAgent provenance explicit in `UPSTREAM.lock.json`.
7. Keep JS reverse MCP capabilities TMWD-backed and hook-first; debugger/callframe
   workflows must stay explicit instead of silently pretending support.
8. Keep JS reverse docs and mounted skill content synchronized by script.
9. Keep the hub optionally managed by user-level launchd, not a hidden global service.

## Maintenance boundaries

- `extension/` is source-controlled and mirrors GenericAgent's extension except
  install-local `config.js`.
- `~/.tmwd-browser-mcp/browser/tmwd_cdp_bridge/` is the Chrome/Edge unpacked
  extension install target.
- `~/.tmwd-browser-mcp/runtime/` is runtime state and logs. Run directories live
  under `runtime/runs` and are governed by `npm run runtime:cleanup:dry-run`
  / `npm run runtime:cleanup -- --write` so screenshot evidence stays outside
  the repo without growing indefinitely.
- `runtime/js-reverse/` is ignored local evidence, reports, and rebuild bundles
  produced by `src/js-reverse-server.mjs`.
- `~/Library/LaunchAgents/com.browser67.tmwd-browser-mcp.plist` is optional
  user-level autostart state created by `npm run launchd:install`.
- `src/tmwd-hub.mjs` and `src/tmwd-hub-control.mjs` are thin executable
  entrypoints. Hub state, session TTL, WS relay, link HTTP commands, shutdown,
  endpoint parsing, probing, and state-file IO live in sibling module folders.
