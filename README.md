# tmwd-browser-mcp

Standalone TMWD browser MCP server for real Chrome/Edge profile automation.
This repository is published as `browser67` for agents that need both real
browser automation and TMWD-backed JavaScript reverse-engineering tools.

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
  - `browser_file_ops`
  - `browser_download_ops`
  - `browser_tab_lifecycle`
  - `browser_clipboard_ops`
  - `browser_native_input`
- JS reverse MCP server:
  - `check_browser_health`
  - `list_scripts` / `search_in_scripts`
  - `list_network_requests` / `get_request_initiator`
  - `create_hook` / `inject_hook` / `get_hook_data`
  - `record_reverse_evidence` / `export_rebuild_bundle`
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
git clone https://github.com/bigKING67/browser67.git
cd browser67
npm ci
```

For an existing checkout:

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

`npm run setup` also writes local registry entries for both
`tmwd-browser-mcp` and `js-reverse` into
`~/.tmwd-browser-mcp/mcp/servers.toml` unless `--skip-registry` is passed.

For manual Chrome extension loading from this repository, prepare the
project-local runtime copy:

```bash
npm run setup:local-extension
```

Then load exactly this directory, not its parent:

```text
/path/to/browser67/runtime/chrome-extension/tmwd_cdp_bridge/
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
/path/to/browser67/src/server.mjs
```

Run the TMWD-backed JS reverse MCP server with:

```bash
npm run js-reverse:server
```

Codex `js-reverse` config should point directly at:

```text
/path/to/browser67/src/js-reverse-server.mjs
```

## Quality gates

```bash
npm run verify
npm run check:syntax
npm run check
npm run check:live:doctor
npm run check:js-reverse-mcp
npm run check:js-reverse-live
```

`npm run check` runs deterministic MCP/schema/hub-control contracts. `check:live:*`
uses the current local browser environment and can fail when the extension or hub
is not connected.

`npm run verify` is the local full gate for maintenance changes. It checks
GenericAgent extension alignment, upstream provenance, JS reverse docs/skill sync,
all `.mjs` syntax, deterministic contracts, live doctor readiness, JS reverse
live readiness, and npm audit.

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
npm run upstream:check
npm run extension:check
npm run extension:sync
npm run upstream:lock
```

Default upstream path:

```text
../GenericAgent/assets/tmwd_cdp_bridge
```

Use `node scripts/sync-genericagent-extension.mjs --source <path>` when your
GenericAgent checkout lives somewhere else.

`extension/config.js` is intentionally not committed. `npm run setup` writes an
install-local `config.js` with a per-install TID into
`~/.tmwd-browser-mcp/browser/tmwd_cdp_bridge/`.

`UPSTREAM.lock.json` records the exact GenericAgent commit and extension file
hashes used by this project. After intentionally updating GenericAgent and
running `npm run extension:sync`, refresh the lock with `npm run upstream:lock`.

## User-level launchd service

Install TMWD hub as a user LaunchAgent:

```bash
npm run launchd:install
```

This writes:

```text
~/Library/LaunchAgents/com.browser67.tmwd-browser-mcp.plist
```

and runs the hub from:

```text
/path/to/browser67/src/tmwd-hub.mjs
```

If you previously installed an older pre-browser67 LaunchAgent, stop or
uninstall that old service before installing this one so only one hub claims the
default ports.

Uninstall:

```bash
npm run launchd:uninstall
```

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
