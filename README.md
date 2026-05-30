# tmwd-browser-mcp

Standalone TMWD browser MCP server for real Chrome/Edge profile automation.

This project extracts the `browser-structured-mcp` path from `grobot`, keeps the
GenericAgent/TMWebDriver extension protocol aligned, and adds a focused runtime
for Codex, grobot, and JS reverse workflows.

## What this project owns

- MCP tools:
  - `browser_scan`
  - `browser_execute_js`
  - `browser_extract`
  - `browser_diff`
  - `browser_tab_ops`
  - `browser_native_input`
- Local TMWD hub:
  - WebSocket endpoint: `ws://127.0.0.1:18765`
  - HTTP link endpoint: `http://127.0.0.1:18766/link`
- Unpacked Chrome/Edge extension source in `extension/`
- Native input fallback for blocked browser-side automation
- Doctor/live-gate contracts for reproducible readiness checks
- JS reverse docs and skill material under `docs/js-reverse/` and `skills/js-reverse/`

## Why TMWD first

TMWD controls the user's real browser through an extension and local hub. It keeps
existing tabs, cookies, and login state. This is different from remote-debugging
CDP (`http://127.0.0.1:9222`), which can point to a separate debug browser with
no user session.

For Codex and real-profile tasks, default to:

```text
tmwd_mode=tmwd
tmwd_transport=auto
```

Use `tmwd_mode=remote_cdp` only for explicit debug Chrome, CI, or deep JS reverse
work that needs Network/Debugger/Script source.

## Install dependencies

```bash
npm install
```

## Prepare extension

```bash
npm run setup
```

Default extension target:

```text
~/.tmwd-browser-mcp/browser/tmwd_cdp_bridge/
```

Then open `chrome://extensions`, enable Developer Mode, and load that directory
as an unpacked extension. After every extension source update, reload the
extension and refresh old target tabs so content scripts are reinjected.

## Start and diagnose

```bash
npm run hub:start
npm run doctor
```

Useful machine-readable variants:

```bash
npm run doctor:json
npm run check:live:doctor
```

## Run MCP server

```bash
npm run server
```

Codex config should point directly at:

```text
/Users/gaoqian/Documents/sixseven/codeproject/tmwd-browser-mcp/src/server.mjs
```

## Quality gates

```bash
npm run check
npm run check:live:doctor
```

`npm run check` runs deterministic MCP/schema/hub-control contracts. `check:live:*`
uses the current local browser environment and can fail when the extension or hub
is not connected.

## Source alignment

Primary upstream references:

- `lsdefine/GenericAgent/TMWebDriver.py`
- `lsdefine/GenericAgent/assets/tmwd_cdp_bridge/*`
- `lsdefine/GenericAgent/memory/tmwebdriver_sop.md`
- `lsdefine/GenericAgent/memory/ljqCtrl_sop.md`

The `extension/` directory is intentionally sourced from the latest GenericAgent
extension, including `tabs.create` and `contentSettings` bridge commands.

To check or resync against the local GenericAgent checkout:

```bash
npm run extension:check
npm run extension:sync
```

Default upstream path:

```text
/Users/gaoqian/Documents/sixseven/codeproject/GenericAgent/assets/tmwd_cdp_bridge
```

`extension/config.js` is intentionally not committed. `npm run setup` writes an
install-local `config.js` with a per-install TID into
`~/.tmwd-browser-mcp/browser/tmwd_cdp_bridge/`.

## Runtime paths

Default runtime home:

```text
~/.tmwd-browser-mcp/
```

Important subpaths:

```text
~/.tmwd-browser-mcp/browser/tmwd_cdp_bridge/
~/.tmwd-browser-mcp/runtime/tmwd-hub-state.json
~/.tmwd-browser-mcp/runtime/browser-live-gate-events.jsonl
~/.tmwd-browser-mcp/mcp/servers.toml
```

Override with:

```bash
TMWD_BROWSER_MCP_HOME=/custom/path
```
