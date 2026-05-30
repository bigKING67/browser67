---
name: tmwd-browser-mcp
description: Use for TMWD real-browser automation through tmwd_browser MCP: logged-in Chrome/Edge pages, current tabs, cookies/session-aware page inspection, CDP bridge commands, background tab actions, native fallback planning, and JS reverse browser sampling. Prefer this over generic browser tools when the task needs the user's current browser state and TMWD is configured.
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
6. Use `browser_native_input` only when browser-side automation is blocked.

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
- Use `remote_cdp` only when the user explicitly wants a debug Chrome/CI/JS reverse protocol path.
- Do not silently fallback from TMWD login-state tasks to remote CDP.
- For localhost/file previews that do not need profile state, use in-app Browser instead.
- For desktop windows, native file chooser, or pure visual input, use Computer Use or TMWD native fallback.

## Important pitfalls

- After extension updates, reload the unpacked extension and refresh old tabs.
- `await` in `browser_execute_js` must explicitly `return` to expose values.
- For CDP coordinate clicks, warm up debugger attachment before measuring coordinates.
- For real local file upload, prefer same-batch `DOM.getDocument -> DOM.querySelector -> DOM.setFileInputFiles`; DataTransfer is only suitable for in-memory files.
