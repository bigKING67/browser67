---
name: tmwd-browser-mcp
description: >-
  Use for TMWD real-browser automation through tmwd_browser MCP: logged-in
  Chrome/Edge pages, current tabs, cookies/session-aware page inspection, CDP
  bridge commands, background tab actions, downloads/uploads, file chooser
  planning, clipboard write/paste wrappers, managed tab lifecycle, and native
  fallback planning. For page API/interface discovery, request initiator
  tracing, signature-chain tracing, script search, network/WS sampling, hooks,
  and rebuild bundles, hand off to the js-reverse MCP/skill backed by this same
  TMWD runtime.
---

# TMWD Browser MCP

Use this skill for real Chrome/Edge automation through `tmwd_browser`.

## Core workflow

1. Check readiness:
   - run `npm run doctor` in `/path/to/browser67`, or
   - call `browser_tab_ops` / `browser_scan` with `tmwd_mode="tmwd"`.
2. For login-state tasks, keep `tmwd_mode="tmwd"` and `tmwd_transport="auto"`.
3. Use `browser_scan` for current page/tabs/text.
4. Use `browser_execute_js` for JS, bridge commands, CDP batch, cookies, and controlled navigation.
5. Use `browser_tab_ops` for list/switch/current/session selection.
6. Use `browser_file_ops` for upload inputs and native chooser planning.
7. Use `browser_download_ops` for per-run download prepare/wait/list flows.
8. Use `browser_tab_lifecycle` with `action="select_or_create"` for active work tabs. It reuses only TMWD-owned managed tabs; user-opened unmanaged tabs are read-only by default and must not be navigated, mutated, or closed.
   - Use stable `workspace_key` values at the project/surface level, for example `datahub-special-report`, not one-off subsection keys.
   - End active browser tasks with `action="finalize_task"` for the current `workspace_key` or `task_id` unless the user asked to keep the page open. `finalize_task` prunes stale registry records, closes only `keep:false` managed tabs in scope, preserves `keep:true`, and ignores unmanaged user tabs.
9. Use `browser_auth_ops.ensure_login` after selecting/creating a managed tab. It first checks whether the page is already authenticated; if the tab is on a login page, it only uses exact-origin local profiles from repo-external secret files, redacts outputs, and blocks unknown origins instead of guessing credentials. For a first-time site, use `suggest_profile` then explicit `upsert_profile` with user-provided credentials and `confirm_write:true`.
10. Use `browser_clipboard_ops` for write/paste only; it intentionally does not read clipboard.
11. Use `browser_native_input` only when browser-side automation is blocked.
12. Use `js-reverse` MCP for page API discovery and reverse-specific
   observe/capture/rebuild work instead of overloading the generic
   `tmwd_browser` tools.

## Bridge command examples

```json
{"cmd":"tabs"}
{"cmd":"tabs","method":"create","url":"https://example.test","active":true}
{"cmd":"tabs","method":"get","tabId":123}
{"cmd":"tabs","method":"list","includeUnscriptable":true}
{"cmd":"cookies"}
{"cmd":"cdp","method":"Runtime.evaluate","params":{"expression":"document.title"}}
{"cmd":"batch","commands":[{"cmd":"tabs"},{"cmd":"cdp","method":"Runtime.evaluate","params":{"expression":"document.URL"}}]}
{"cmd":"contentSettings","type":"automaticDownloads","pattern":"https://*/*","setting":"allow"}
```

## Routing rules

- Use TMWD for the user's current browser, logged-in pages, cookies, and visible tab state.
- Use TMWD wrappers for downloads/uploads/file chooser planning/clipboard write-paste/managed tab lifecycle.
- When the user is already using a page, do not take over that unmanaged tab for active work. Create or reuse a TMWD-owned tab instead:
  `browser_tab_lifecycle({action:"select_or_create", url, ownership_policy:"tmwd_only", reuse_scope:"origin_path", workspace_key})`.
- Use `create_managed` only when a fresh TMWD-owned tab is explicitly needed; use `fresh:true` or `reuse:false` as the escape hatch.
- Managed tab registry is outside the repo by default: `~/.tmwd-browser-mcp/tab-workspace/managed-tabs.json`; use `BROWSER_STRUCTURED_TAB_REGISTRY_PATH` for isolated test/workspace runs.
- `create_managed` / `select_or_create` wait for new tabs to become visible by default (`wait_until:"listed"`). Use `wait_until:"none"` only when the caller will do its own readiness wait.
- `list_managed` is live-only by default and limits large arrays. Use
  `summary_only:true`, `max_items`, or `max_stale_items` for bounded
  diagnostics; pass `include_disconnected:true` or `history:true` only when you
  explicitly need disconnected session history.
- Use `prune_stale` to remove registry records for managed tabs that no longer exist; it never closes unmanaged user tabs.
- `finalize_task` is the preferred task-end cleanup wrapper and requires `workspace_key` or `task_id` unless explicitly using `scope:"all"` / `all:true` / `confirm_all:true`. Use `close_unkept` only when you need the lower-level close action without the finalizer summary.
- `create_managed` / `select_or_create` / `js-reverse new_page` responses include `finalize_hint`; if `finalize_hint.required` is true, run the suggested `finalize_task` call before the final response or handoff.
- If the managed tab redirects to login, call `browser_auth_ops.ensure_login` with the same `tab_id` (or exact `session_id`). Profiles live in `~/.codex/secrets/tmwd-login-profiles/` by default and must exact-match the current origin. Unknown origins are `blocked`; do not manually try unrelated credentials.
- For a new site with credentials supplied by the user, use `browser_auth_ops.suggest_profile` on the managed login tab, then `browser_auth_ops.upsert_profile` with exact `origin`/`allowed_origins`, selectors, username/password, and `confirm_write:true`; then call `ensure_login`. Profile writes are explicit and repo-external only. If the page is already logged in, `ensure_login` returns `already_authenticated:true` and does not require a profile or resubmit a form.
- Use `js-reverse` for page API/interface discovery, request initiator tracing,
  signatures, anti-bot parameters, hook sampling, and local rebuild bundles; it
  uses this same TMWD transport by default. Pages opened by `js-reverse new_page`
  are also TMWD-managed; run `js-reverse finalize_task` for the same
  `workspace_key` or `task_id` before final response unless evidence collection
  requires keeping the page open.
- Use `remote_cdp` only when the user explicitly wants a debug Chrome/CI/JS reverse protocol path.
- Validate that explicit path with `npm run check:remote-cdp`; set `CHROME_BIN`
  if Chrome is not installed in a default location.
- Do not silently fallback from TMWD login-state tasks to remote CDP.
- For localhost/file previews that do not need profile state, use in-app Browser instead.
- For desktop windows, native file chooser, or pure visual input, use Computer Use or TMWD native fallback.

## Important pitfalls

- After extension updates, reload the unpacked extension and refresh old tabs.
- If Chrome visibly shows `about:blank` but `tabs.list` does not, use `tabs.list` with `includeUnscriptable:true` or `tabs.get`; default tab lists intentionally hide non-HTTP(S) pages.
- For lifecycle regressions, run `npm run check:managed-tab-live`; it opens only temporary local fixture pages and closes the TMWD-owned tabs it creates.
- For ad-hoc one-shot Node scripts that directly import `src/tmwd-runtime.mjs`, call `await disposeTmwdRuntime()` in `finally`; otherwise an open TMWD websocket can keep the shell process alive after the browser action has already succeeded.
- `await` in `browser_execute_js` must explicitly `return` to expose values.
- For CDP coordinate clicks, warm up debugger attachment before measuring coordinates.
- For real local file upload, prefer same-batch `DOM.getDocument -> DOM.querySelector -> DOM.setFileInputFiles`; DataTransfer is only suitable for in-memory files.
- `browser_download_ops` only observes the prepared token/directory window; do not read Chrome history DB.
- `browser_tab_lifecycle.close_unkept` must never close unmanaged existing user tabs; it only closes TMWD-owned managed tabs that are not marked `keep:true`.
- `browser_tab_lifecycle.finalize_task` is the normal finalizer for Codex tasks that used TMWD managed tabs. Run it before final response/handoff for the current `workspace_key` or `task_id`, and report whether tabs were closed or intentionally kept.
- `npm run check:managed-tabs-clean` is a registry-only hygiene gate for missed finalizers; run it after lifecycle changes or when diagnosing tab buildup.
- `browser_tab_lifecycle` dry-runs are planning-only: do not depend on dry-run calls to select, persist, touch, or clean managed tabs.
- `browser_clipboard_ops` has no clipboard-read action by design.
- OpenAI tool registration rejects top-level JSON Schema composition keywords
  such as `anyOf`/`oneOf`; keep required alternates as runtime validation and
  rerun `npm run check:mcp` after schema edits.
- Codex MCP tool results must use standard MCP text content. Encode structured
  payloads as `type: "text"` with JSON text, not non-standard `type: "json"`;
  `npm run check:mcp` asserts this for representative success/error paths.
- If a Codex thread already captured an invalid MCP tool schema, fixing source
  files is not enough for that old thread; start a fresh thread or restart Codex
  so the Responses state is rebuilt from the current MCP `tools/list`.
