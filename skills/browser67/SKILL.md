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

- `tmwd_browser`: real Chrome/Edge profile automation through TMWD.
- `js-reverse`: TMWD-backed API discovery, hooks, network/WS sampling, evidence
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
4. For real browser work, select/create TMWD-owned managed tabs and finalize
   the current `workspace_key`/`task_id` before handoff.
5. For JS reverse work, use the `js-reverse` MCP and finalize pages opened by
   `js-reverse new_page`.

## Quality bar

- Keep browser-visible claims backed by live browser evidence or a clear skipped
  reason.
- Keep large outputs bounded; write screenshots, run records, and rebuild
  bundles as repo-external artifacts with path/hash/count metadata.
- Do not silently fallback from TMWD login-state tasks to remote CDP.
- Keep docs, skills, schemas, and contracts synchronized for externally visible
  behavior changes.
- Run `npm run check:mcp`, `npm run check:js-reverse-mcp`,
  `npm run check:browser67-naming`, `npm run check:runtime-home`, and
  `npm run skills:check` after naming/runtime/tooling changes.
