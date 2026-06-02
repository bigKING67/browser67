# Codex integration

Recommended Codex MCP block:

```toml
[mcp_servers.tmwd_browser]
command = "node"
args = ["/Users/gaoqian/Documents/sixseven/codeproject/tmwd-browser-mcp/src/server.mjs"]

[mcp_servers.tmwd_browser.env]
BROWSER_STRUCTURED_TMWD_MODE = "tmwd"
BROWSER_STRUCTURED_TMWD_TRANSPORT = "auto"
BROWSER_STRUCTURED_TMWD_WS_ENDPOINT = "ws://127.0.0.1:18765"
BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT = "http://127.0.0.1:18766/link"

[mcp_servers.tmwd_browser.tools.browser_scan]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_execute_js]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_extract]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_diff]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_tab_ops]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_native_input]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_file_ops]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_download_ops]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_tab_lifecycle]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_clipboard_ops]
approval_mode = "approve"

[mcp_servers.js-reverse]
command = "node"
args = ["/Users/gaoqian/Documents/sixseven/codeproject/tmwd-browser-mcp/src/js-reverse-server.mjs"]

[mcp_servers.js-reverse.env]
BROWSER_STRUCTURED_TMWD_MODE = "tmwd"
BROWSER_STRUCTURED_TMWD_TRANSPORT = "auto"
BROWSER_STRUCTURED_TMWD_WS_ENDPOINT = "ws://127.0.0.1:18765"
BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT = "http://127.0.0.1:18766/link"

[mcp_servers.js-reverse.tools.check_browser_health]
approval_mode = "approve"

[mcp_servers.js-reverse.tools.search_in_scripts]
approval_mode = "approve"

[mcp_servers.js-reverse.tools.list_network_requests]
approval_mode = "approve"

[mcp_servers.js-reverse.tools.create_hook]
approval_mode = "approve"

[mcp_servers.js-reverse.tools.inject_hook]
approval_mode = "approve"

[mcp_servers.js-reverse.tools.get_hook_data]
approval_mode = "approve"

[mcp_servers.js-reverse.tools.export_rebuild_bundle]
approval_mode = "approve"
```

## Tool routing

- `tmwd_browser`: primary path for real browser tasks, logged-in pages, existing tabs, cookies, CDP bridge, background tabs, batch actions, downloads/uploads, file chooser planning, clipboard write/paste wrappers, and managed tab lifecycle.
- `js-reverse`: primary path for signature-chain tracing, script search, network/WS sampling, non-blocking hooks, evidence export, and local rebuild bundles. It is TMWD-backed by default, so it keeps the user's real logged-in browser context.
- in-app Browser: localhost/file previews without Chrome profile state.
- Computer Use: desktop UI and pure visual pointer/keyboard actions.
- `remote_cdp`: explicit debug Chrome/CI/JS reverse protocol work, not ordinary login-state tasks.

Validate the explicit remote CDP path with `npm run check:remote-cdp`. The gate
launches an isolated headless Chrome profile and local fixture page, then runs
doctor + live checks against that temporary `remote_cdp` endpoint. Set
`CHROME_BIN=/path/to/chrome` when Chrome is not installed in a default location.

## Wrapper tools

- `browser_file_ops`: `inspect_inputs`, `set_input_files`, `upload_via_data_transfer`, `native_file_chooser_plan`. Prefer `set_input_files` for real local files; use DataTransfer only for small in-memory files; native chooser action returns a plan and should not silently upload files.
- `browser_download_ops`: `allow_automatic_downloads`, `prepare`, `wait`, `list_recent`. It tracks only the prepared per-run token / directory window and ignores partial files such as `.crdownload`.
- `browser_tab_lifecycle`: `create_managed`, `mark_keep`, `list_managed`, `close_unkept`. `close_unkept` only closes tabs created by this wrapper and ignores unmanaged user tabs.
- `browser_clipboard_ops`: `write_text`, `paste_text`. It does not expose clipboard reads; prefer DOM value setting for target fields and use native paste only when the page requires a real paste event.

## JS reverse boundary

The bundled `js-reverse` MCP focuses on observe-first, hook-preferred workflows:

- supported: page health, tab selection, scripts, DOM snapshot, performance
  resources, fetch/xhr/websocket/eval/timer/cookie/function hooks, evidence
  recording, report export, and minimal Node rebuild bundle export.
- intentionally not full debugger yet: persistent `Debugger.pause`, callframe
  stepping, and breakpoint state currently return `not_supported` with hook-based
  fallbacks. Use a dedicated remote CDP debug browser only when callframe-level
  debugging is required.

## Failure policy

For login-state tasks, fail closed if TMWD is unavailable. Do not silently use
remote-debugging CDP because it may be a separate profile.

## Maintenance checks

When GenericAgent changes its TMWebDriver extension, resync this standalone
project from the local upstream checkout:

```bash
cd /Users/gaoqian/Documents/sixseven/codeproject/tmwd-browser-mcp
npm run extension:sync
npm run extension:check
npm run upstream:lock
npm run check
npm run check:js-reverse-live
```

After extension source changes, run `npm run setup`, reload the unpacked
extension from `~/.tmwd-browser-mcp/browser/tmwd_cdp_bridge/`, then refresh old
tabs so content scripts are reinjected. If manually loading from the standalone
project, run `npm run setup:local-extension` and load exactly:

```text
/Users/gaoqian/Documents/sixseven/codeproject/tmwd-browser-mcp/runtime/chrome-extension/tmwd_cdp_bridge/
```

Before committing maintenance changes:

```bash
npm run verify
```
