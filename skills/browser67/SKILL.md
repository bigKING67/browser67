---
name: browser67
description: >-
  Use for browser67 real-browser agent runtime work: tmwd_browser MCP setup and
  operation, Chrome/Edge profile automation, managed tabs, auth lifecycle,
  screenshots/evidence, downloads/uploads, native fallback planning, runtime
  home migration, project governance, and the paired js-reverse MCP surface.
---

# browser67

Use this skill for browser67, the canonical real-browser agent runtime. It owns
two paired MCP surfaces:

- `tmwd_browser`: browser67 real Chrome/Edge profile automation tool key.
- `js-reverse`: browser67-backed API discovery, hooks, network/WS sampling, evidence
  export, and local rebuild workflows.

## Naming

- Use `browser67` for the project, package, CLI, docs, and runtime umbrella.
- Keep `tmwd_browser` and `js-reverse` as MCP config keys.
- Treat `tmwd-browser-mcp` as a legacy compatibility alias only.
- Runtime home is resolved through `BROWSER67_HOME`, legacy
  `TMWD_BROWSER_MCP_HOME`, existing `~/.browser67`, existing
  `~/.tmwd-browser-mcp`, then fresh default `~/.browser67`.

## Core workflow

1. Check readiness with `browser67 doctor` or `npm run doctor`.
2. For setup, use `browser67 setup`; it writes under the active browser67 home.
3. For legacy runtime migration, run `browser67 migrate-home --dry-run` before
   `browser67 migrate-home --write`.
4. For real browser work, select/create browser67-owned managed tabs and finalize
   the current `workspace_key`/`task_id` before handoff; report the returned
   `delivery_summary` so tab cleanup state is visible.
5. For JS reverse work, use the `js-reverse` MCP and finalize pages opened by
   `js-reverse new_page`.
6. For Linux/Windows portability proof, run `npm run check:native-live` on the
   matching interactive GUI host first. Run `proof:native-live` only with the
   explicit physical/confirm environment flags and `--write`; never fabricate a
   target-OS proof on another platform.
7. For explicitly confirmed physical CAPTCHA assist on macOS, require the
   exact managed Chrome/Edge tab id before `cliclick`, with its redacted URL only
   as a fallback. Use logical screen-point window bounds, prefer a detected
   slider track over the handle-only rect, and keep CAPTCHA screenshots
   region-bounded.

## Quality bar

- Keep browser-visible claims backed by live browser evidence or a clear skipped
  reason; responsive screenshots must include viewport/PNG dimension verification
  before treating a mobile artifact as valid evidence.
- Keep large outputs bounded; write screenshots, run records, and rebuild
  bundles as repo-external artifacts with path/hash/count metadata.
- Do not silently fallback from browser67 login-state tasks to remote CDP.
- Treat headless CI, SSH-only Linux, and locked/disconnected Windows sessions as
  insufficient for `native-live-linux` / `native-live-win32` proof.
- Keep docs, skills, schemas, and contracts synchronized for externally visible
  behavior changes.
- Run `npm run check:mcp`, `npm run check:js-reverse-mcp`,
  `npm run check:browser67-naming`, `npm run check:runtime-home`, and
  `npm run skills:check` after naming/runtime/tooling changes.
