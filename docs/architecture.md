# Architecture

```text
Codex / MCP client
  -> src/server.mjs
  -> src/tmwd-runtime.mjs
  -> src/tmwd-hub.mjs
  -> extension/background.js
  -> Chrome/Edge tab
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

