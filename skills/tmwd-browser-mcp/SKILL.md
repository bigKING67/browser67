---
name: tmwd-browser-mcp
description: >-
  Use for TMWD real-browser automation through tmwd_browser MCP: logged-in
  Chrome/Edge pages, current tabs, cookies/session-aware page inspection, CDP
  bridge commands, background tab actions, downloads/uploads, file chooser
  planning, clipboard write/paste wrappers, managed tab lifecycle, and native
  fallback planning. For signature-chain tracing, script search, network/WS
  sampling, hooks, and rebuild bundles, hand off to the js-reverse MCP/skill
  backed by this same TMWD runtime.
---

# TMWD Browser MCP

Use this skill for real Chrome/Edge automation through `tmwd_browser`.

## Core workflow

1. Check readiness:
   - run `npm run doctor` in `/Users/gaoqian/Documents/sixseven/codeproject/tmwd-browser-mcp`, or
   - call `browser_tab_ops` / `browser_scan` with `tmwd_mode="tmwd"`.
2. For login-state tasks, keep `tmwd_mode="tmwd"` and `tmwd_transport="auto"`.
3. Use `browser_scan` for current page/tabs/text.
4. Use `browser_execute_js` for JS, bridge commands, CDP batch, cookies, and controlled navigation.
5. Use `browser_tab_ops` for list/switch/current/session selection.
6. Use `browser_file_ops` for upload inputs and native chooser planning.
7. Use `browser_download_ops` for per-run download prepare/wait/list flows.
8. Use `browser_tab_lifecycle` only for tabs it created; unmanaged user tabs must not be closed.
9. Use `browser_clipboard_ops` for write/paste only; it intentionally does not read clipboard.
10. Use `browser_native_input` only when browser-side automation is blocked.
11. Use `js-reverse` MCP for reverse-specific observe/capture/rebuild work instead
   of overloading the generic `tmwd_browser` tools.

## Bridge command examples

```json
{"cmd":"tabs"}
{"cmd":"tabs","method":"create","url":"https://example.test","active":true}
{"cmd":"cookies"}
{"cmd":"cdp","method":"Runtime.evaluate","params":{"expression":"document.title"}}
{"cmd":"batch","commands":[{"cmd":"tabs"},{"cmd":"cdp","method":"Runtime.evaluate","params":{"expression":"document.URL"}}]}
{"cmd":"contentSettings","type":"automaticDownloads","pattern":"https://*/*","setting":"allow"}
```

## Routing rules

- Use TMWD for the user's current browser, logged-in pages, cookies, and visible tab state.
- Use TMWD wrappers for downloads/uploads/file chooser planning/clipboard write-paste/managed tab lifecycle.
- Use `js-reverse` for signatures, anti-bot parameters, hook sampling, and local
  rebuild bundles; it uses this same TMWD transport by default.
- Use `remote_cdp` only when the user explicitly wants a debug Chrome/CI/JS reverse protocol path.
- Validate that explicit path with `npm run check:remote-cdp`; set `CHROME_BIN`
  if Chrome is not installed in a default location.
- Do not silently fallback from TMWD login-state tasks to remote CDP.
- For localhost/file previews that do not need profile state, use in-app Browser instead.
- For desktop windows, native file chooser, or pure visual input, use Computer Use or TMWD native fallback.

## Important pitfalls

- After extension updates, reload the unpacked extension and refresh old tabs.
- `await` in `browser_execute_js` must explicitly `return` to expose values.
- For CDP coordinate clicks, warm up debugger attachment before measuring coordinates.
- For real local file upload, prefer same-batch `DOM.getDocument -> DOM.querySelector -> DOM.setFileInputFiles`; DataTransfer is only suitable for in-memory files.
- `browser_download_ops` only observes the prepared token/directory window; do not read Chrome history DB.
- `browser_tab_lifecycle.close_unkept` must never close unmanaged existing user tabs.
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
