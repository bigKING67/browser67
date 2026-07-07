# js-reverse upstream and reference policy

This directory tracks external JavaScript reverse-engineering references for
browser67. These references are design input only unless a future lock/review
process explicitly promotes one into an implementation upstream.

## Canonical local implementation

The browser67 repo is the canonical implementation for `js-reverse`:

- `src/mcp/js-reverse/server.mjs`
- `src/js-reverse-server/`
- `skills/js-reverse/`
- `docs/js-reverse/`
- `docs/js-reverse-SOP.md`
- `templates/tasks/js-reverse-task-template.json`
- `contracts/js-reverse-mcp-contract/`
- `contracts/js-reverse-mcp-live-gate/`

The canonical path is browser67-backed: it uses the browser67 real-browser
runtime, browser67-owned managed tabs, `finalize_task`, bounded artifacts, and
`record_reverse_evidence` normalized to `evidence.v1`.

## Legacy local snapshots

Sibling local `js-reverse` skill directories, such as `../js-reverse`, are legacy
local snapshot material unless they are Git repositories with a reviewed remote
and lock. They are not implementation upstreams and must not override the
browser67 canonical `skills/js-reverse/` or `docs/js-reverse/` content.

A sibling local `js-reverse` directory was observed as a non-git standalone skill
snapshot from 2026-04. It predates browser67-backed managed-tab lifecycle,
`evidence.v1`, frame-aware discovery, scoped storage evidence, and
`finalize_task` guidance.

## External reference candidates

These repositories are reference only:

| Reference | Reviewed commit | Role |
| --- | --- | --- |
| `zhaoxuya520/reverse-skill` | `9ec60377bfdcafa0b317ed3612acc6c46270be78` | reverse/security/CTF skill router pack |
| `NoOne-hub/JSReverser-MCP` | `65e2e3cb70c10a79dfd1ba4410a2c876113e676c` | external JS reverse MCP reference candidate |
| `zhizhuodemao/js-reverse-mcp` | `0e19693f496b4600dbc9381e76293d7afa96c001` | external JS reverse MCP reference candidate |

Machine-readable details live in `references.json`.

## Absorbable ideas

Useful ideas may be translated into browser67 tools, contracts, SOPs, templates,
or reference docs:

- Reverse-task routing matrix.
- Tool-index / bootstrap organization concepts, without importing automatic
  installation behavior.
- Field-journal / case-library organization.
- `jshookmcp` / `anything-analyzer` as external fallback framing.
- APK, binary, CTF, Burp, Kali, and mobile references as an external reading map.
- JS reverse MCP tool-surface design for future comparison.
- Report, artifact, and rebuild-bundle format ideas.
- Hook, debugger, sourcemap, and AST deobfuscation workflow ideas.

## Non-goals

Do not:

- Replace the browser67-backed `js-reverse` implementation or skill.
- Import external auto-execution or "execute immediately after reading" semantics.
- Automatically read external precedent journals.
- Automatically install tools or write MCP configuration.
- Copy a whole external skill pack into browser67.
- Promote `jshookmcp`, `anything-analyzer`, Playwright, or Puppeteer into the
  default browser67 entrypoint.
- Let legacy local snapshots override browser67 canonical content.
- Take over unmanaged user tabs.

## Future review matrix

Use this matrix before promoting any external reference beyond reference-only
status.

| Dimension | browser67 baseline | External review focus |
| --- | --- | --- |
| Browser ownership | browser67-owned managed tabs | Does it take over unmanaged user tabs? |
| Runtime | Real Chrome/Edge profile through browser67 | Does it require a self-managed Chrome or remote CDP? |
| Lifecycle | `workspace_key`, `task_id`, `finalize_task` | Does it have a cleanup model? |
| Evidence | `record_reverse_evidence`, `evidence.v1` | Does it produce structured evidence bundles? |
| Frames | `list_frames`, frame-aware first pass | Does it support iframe and microfrontend boundaries? |
| Storage | Scoped storage helpers | Does it avoid broad storage dumps by default? |
| Hook | Non-blocking hook preferred | Does it make breakpoints the default and risk anti-debug issues? |
| Rebuild | `export_rebuild_bundle` | Can it export a reproducible local rebuild project? |
| Anti-bot | Native fallback is last-mile evidence | Does it bypass browser67 boundaries by default? |
| Install side effects | No automatic install or config write | Does it auto-write local configuration or install tools? |
