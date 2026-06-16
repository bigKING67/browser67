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

[mcp_servers.tmwd_browser.tools.browser_auth_ops]
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
- `js-reverse`: primary path for page API/interface discovery, request initiator tracing, signature-chain tracing, script search, network/WS sampling, non-blocking hooks, evidence export, and local rebuild bundles. It is TMWD-backed by default, so it keeps the user's real logged-in browser context. JS reverse pages created with `new_page` are also TMWD-managed; end reverse tasks with `finalize_task` for the current `workspace_key` / `task_id` unless evidence collection requires keeping the page open.
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
- `browser_tab_lifecycle`: `select_or_create`, `create_managed`, `mark_keep`, `list_managed`, `prune_stale`, `close_unkept`, `finalize_task`. Prefer `select_or_create` for active work; it reuses only TMWD-owned managed tabs (`ownership_policy="tmwd_only"`) and ignores user-opened unmanaged tabs. `finalize_task` is the preferred task-end cleanup wrapper; it prunes stale registry records, closes only `keep:false` managed tabs in the requested scope, preserves `keep:true`, and ignores unmanaged user tabs.
- `browser_auth_ops`: `list_profiles`, `validate_profile`, `inspect_login_page`, `suggest_profile`, `upsert_profile`, `ensure_login`. Use after `browser_tab_lifecycle.select_or_create` when a TMWD-owned tab lands on a login page. Profiles are exact-origin allowlisted, stored only in repo-external local secret files, and outputs are redacted; unknown origins are reported as blocked and are never auto-filled.
- `browser_clipboard_ops`: `write_text`, `paste_text`. It does not expose clipboard reads; prefer DOM value setting for target fields and use native paste only when the page requires a real paste event.

## Login profiles

`browser_auth_ops` is a profile-driven helper layer, not a global password
autofill. It never reads Chrome password stores, cookie databases, browser
history, or unrelated tabs. It only inspects/fills the currently selected
TMWD tab when the current `location.origin` exactly matches a configured
profile. Saving credentials is explicit: only `upsert_profile` writes a
repo-external secret file, and it requires `confirm_write:true`; creating or
selecting a managed tab never saves credentials as a hidden side effect.

Default profile directory:

```text
~/.codex/secrets/tmwd-login-profiles/
```

Override for tests or isolated runs:

```bash
BROWSER_STRUCTURED_LOGIN_PROFILE_DIR=/path/to/private/profiles
```

Example profile:

```env
PROFILE_ID=datahub-groland
ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000,https://groland.52671314.xyz
USERNAME=...
PASSWORD=...
LOGIN_PATH_PATTERN=/login
USERNAME_SELECTOR=#username
PASSWORD_SELECTOR=#password
SUBMIT_SELECTOR=button[type="submit"]
SUCCESS_PATH_NOT=/login
SUCCESS_TEXT=
```

Known-site operational pattern:

1. Create/reuse a managed tab with `browser_tab_lifecycle.select_or_create`.
2. Call `browser_auth_ops.ensure_login` with `tab_id` for that managed tab
   (`session_id` is accepted only when it resolves exactly; auth ops will not
   fall back to another tab).
3. If the page is already authenticated, `ensure_login` returns `already_authenticated:true`.
4. If the page is a login page and the origin matches a profile, it fills and submits the form.
5. If no exact-origin profile matches, it returns `status:"blocked"` and does not fill anything.
6. Finish with `browser_tab_lifecycle.finalize_task` for the same `workspace_key`.

First-time site onboarding pattern:

1. Create/reuse a managed tab with `browser_tab_lifecycle.select_or_create`.
2. If it lands on login, call `browser_auth_ops.inspect_login_page` or
   `browser_auth_ops.suggest_profile` for the same `tab_id`.
3. After the user provides credentials for that site, call
   `browser_auth_ops.upsert_profile` with `confirm_write:true`, exact
   `origin`/`allowed_origins`, inferred selectors, and the provided
   username/password. The result is redacted and the saved file is mode `0600`
   when the filesystem supports POSIX modes.
4. Call `browser_auth_ops.ensure_login` for the same `tab_id`.
5. Finish with `browser_tab_lifecycle.finalize_task` for the same
   `workspace_key`.

Already-authenticated pages are a fast path: `ensure_login` inspects the page
first. If it is not a login page, it returns success with
`already_authenticated:true` and does not require or load a matching profile.

`browser_auth_ops` also recognizes the older DataHub local profile at
`~/.codex/secrets/datahub-groland-login.env` for compatibility. Prefer new
sites to use the generic profile directory above.

## Tab ownership policy

- User-opened tabs are `user_unmanaged`: scan/read-only by default. Do not navigate, type, click, close, or adopt them unless the user explicitly asks to operate on the current tab.
- TMWD work tabs are `tmwd_managed`: create them through `browser_tab_lifecycle`.
- Managed tab registry is stored outside the repo at `~/.tmwd-browser-mcp/tab-workspace/managed-tabs.json` by default. Override with `BROWSER_STRUCTURED_TAB_REGISTRY_PATH` for tests or isolated runs.
- `list_managed` returns live sessions by default and limits large arrays. Use `summary_only:true`, `max_items`, or `max_stale_items` for bounded diagnostics. Pass `include_disconnected:true` or `history:true` only when you need historical disconnected sessions.
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
- End active browser tasks with `finalize_task` for the current `workspace_key` or `task_id` unless the user asked to keep the page open. Use stable workspace keys such as `<project>-<surface>` (`datahub-special-report`, not `datahub-special-report-footnotes`) so reuse and cleanup stay scoped and predictable.
- `create_managed` / `select_or_create` / `js-reverse new_page` responses include `finalize_hint`. Treat `finalize_hint.required:true` as a visible reminder to run the suggested `finalize_task` call before final response or handoff.
- `close_unkept` requires `workspace_key` or `task_id` by default. To intentionally clean every managed workspace, pass `scope:"all"` or `all:true` / `confirm_all:true`; unmanaged user tabs are still ignored.
- Use `npm run check:managed-tabs-clean` as a registry-only hygiene gate. It fails when unkept managed tab records remain, which catches missing finalizers even when no live browser action is needed.
- Extension bridge supports `tabs.get` and `tabs.list` with `includeUnscriptable:true` for debugging visible `about:blank` / internal tabs. Default tab lists remain HTTP/HTTPS-only to avoid exposing unrelated browser state.
- One-shot Node helpers that import `src/tmwd-runtime.mjs` directly should call `await disposeTmwdRuntime()` in `finally`; MCP servers are long-lived, but shell helpers should close the TMWD websocket explicitly to avoid successful actions ending with a command timeout.
- Run `npm run check:managed-tab-live` for a real-browser open/reuse/close lifecycle smoke. After editing extension files, reload the unpacked extension before expecting new bridge capabilities in a running Chrome/Edge profile.
- Run `npm run check:auth-live` after auth/profile changes. It opens a temporary managed tab, uses an isolated local profile, verifies `ensure_login` submits and reaches a protected page, asserts unknown origins are blocked, and finalizes the managed tab.

## Codex host hard-finally contract

Wrapper-level cleanup is not a substitute for a host/runtime turn finalizer. A
Codex-style host that wants hard-finally semantics should treat every MCP tool
result as a possible cleanup signal and register any returned
`finalize_hint.required:true` before the assistant turn ends.

Use `src/codex-host-finalizer.mjs` as the repo-side contract adapter:

```js
import { createCodexFinalizerTracker } from "/path/to/browser67/src/codex-host-finalizer.mjs";

const finalizer = createCodexFinalizerTracker({
  default_arguments: {
    tmwd_mode: "tmwd",
    tmwd_transport: "auto",
    timeout_ms: 20000,
  },
});

// After each MCP tool result:
finalizer.addToolResult({
  source_server: "tmwd_browser",
  source_tool: "browser_tab_lifecycle",
  result: mcpToolResult,
});

// In the host turn-end finally block:
const plan = finalizer.plan();
for (const call of plan.calls) {
  // Dispatch call.server + call.tool with call.arguments through the host MCP client.
}
```

Host policy:

- Run this from a real `finally` path that executes before the final user-facing
  response, handoff, or interrupted-turn checkpoint.
- De-duplicate by `call.key`; each call is already scoped by `workspace_key` and
  / or `task_id`.
- Never auto-run `scope:"all"`, `all:true`, or `confirm_all:true`; the planner
  returns those hints under `ignored` with `reason:"auto_scope_all_blocked"`.
- Preserve `keep:true`: hints for kept tabs are `required:false`, and
  `finalize_task` preserves kept managed tabs even if called for the same scope.
- Log `pending_count`, `ignored_count`, `scope_all_blocked_count`, closed tabs,
  remaining tabs, and finalizer errors. Do not silently swallow cleanup failure.
- On process restart or a fresh turn, use `npm run check:managed-tabs-clean` or a
  registry-backed recovery pass to detect missed finalizers.

Validate the adapter with:

```bash
npm run check:codex-host-finalizer
```

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
