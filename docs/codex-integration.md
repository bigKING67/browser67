# Codex integration

Recommended Codex MCP block:

```toml
[mcp_servers.tmwd_browser]
command = "node"
args = ["/path/to/browser67/src/server.mjs"]

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
args = ["/path/to/browser67/src/js-reverse-server.mjs"]

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
- `js-reverse`: primary path for page API/interface discovery, request initiator tracing, signature-chain tracing, script search, network/WS sampling, non-blocking hooks, evidence export, and local rebuild bundles. It is TMWD-backed by default, so it keeps the user's real logged-in browser context.
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
- `browser_tab_lifecycle`: `select_or_create`, `create_managed`, `mark_keep`, `list_managed`, `prune_stale`, `close_unkept`. Prefer `select_or_create` for active work; it reuses only TMWD-owned managed tabs (`ownership_policy="tmwd_only"`) and ignores user-opened unmanaged tabs. `close_unkept` only closes managed tabs and ignores unmanaged user tabs.
- `browser_clipboard_ops`: `write_text`, `paste_text`. It does not expose clipboard reads; prefer DOM value setting for target fields and use native paste only when the page requires a real paste event.

## Tab ownership policy

- User-opened tabs are `user_unmanaged`: scan/read-only by default. Do not navigate, type, click, close, or adopt them unless the user explicitly asks to operate on the current tab.
- TMWD work tabs are `tmwd_managed`: create them through `browser_tab_lifecycle`.
- Managed tab registry is stored outside the repo at `~/.tmwd-browser-mcp/tab-workspace/managed-tabs.json` by default. Override with `BROWSER_STRUCTURED_TAB_REGISTRY_PATH` for tests or isolated runs.
- `list_managed` returns live sessions by default. Pass `include_disconnected:true` or `history:true` only when you need historical disconnected sessions.
- `create_managed` / `select_or_create` wait for the created tab to be visible by default (`wait_until:"listed"`, `wait_timeout_ms:3000`). Use `wait_until:"none"` only for fire-and-forget workflows.
- Default active-work entry:

```json
{
  "action": "select_or_create",
  "url": "http://localhost:3000/example",
  "workspace_key": "project-localhost",
  "ownership_policy": "tmwd_only",
  "reuse_scope": "origin_path"
}
```

- Use `fresh:true` or `reuse:false` only when a new TMWD-owned tab is required, such as OAuth/popup flows, before/after comparisons, or clean lifecycle checks.
- Use `keep:true` for a warm workspace tab that should survive `close_unkept`; otherwise task cleanup may close it.
- Use `prune_stale` or `list_managed` with `prune_stale:true` to remove registry records for managed tabs that no longer exist. This never closes unmanaged user tabs.
- `close_unkept` requires `workspace_key` or `task_id` by default. To intentionally clean every managed workspace, pass `scope:"all"` or `all:true` / `confirm_all:true`; unmanaged user tabs are still ignored.
- Extension bridge supports `tabs.get` and `tabs.list` with `includeUnscriptable:true` for debugging visible `about:blank` / internal tabs. Default tab lists remain HTTP/HTTPS-only to avoid exposing unrelated browser state.
- One-shot Node helpers that import `src/tmwd-runtime.mjs` directly should call `await disposeTmwdRuntime()` in `finally`; MCP servers are long-lived, but shell helpers should close the TMWD websocket explicitly to avoid successful actions ending with a command timeout.
- Run `npm run check:managed-tab-live` for a real-browser open/reuse/close lifecycle smoke. After editing extension files, reload the unpacked extension before expecting new bridge capabilities in a running Chrome/Edge profile.

## JS reverse boundary

The bundled `js-reverse` MCP focuses on observe-first, hook-preferred workflows:

- supported: page health, tab selection, page API/interface discovery, request
  initiator tracing, scripts, DOM snapshot, performance resources,
  fetch/xhr/websocket/eval/timer/cookie/function hooks, evidence recording,
  report export, and minimal Node rebuild bundle export.
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
cd /path/to/browser67
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
/path/to/browser67/runtime/chrome-extension/tmwd_cdp_bridge/
```

Before committing maintenance changes:

```bash
npm run verify
```
