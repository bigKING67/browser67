# Active skill and runtime model

browser67 has four related but separate surfaces. Keep them distinct when
debugging setup, reviewing upstream changes, or explaining agent behavior.

## 1. Routing policy

Routing policy lives in global or project agent instructions, such as:

```text
AGENTS.md
docs/global-prompt-snippet.md
docs/codex-integration.md
```

These files tell an agent when to use browser67, `tmwd_browser`, or
`js-reverse`. They do not execute browser operations and they are not the active
skill install copy.

## 2. Version-controlled skill source

The canonical skill source is committed in this repository:

```text
skills/browser67
skills/tmwd-browser-mcp
skills/js-reverse
```

These directories are the source of truth for reviews, commits, releases, and
package installs. Do not make long-lived manual edits directly in an active
skill install directory and treat those edits as canonical.

## 3. Active skill install copy

Some agents load skills from an install directory outside this repository. On
this machine the shared active root is commonly:

```text
~/.agents/skills
```

For example:

```text
~/.agents/skills/browser67/SKILL.md
~/.agents/skills/tmwd-browser-mcp/SKILL.md
~/.agents/skills/js-reverse/SKILL.md
```

This active copy is what a newly started skill loader reads. Editing
`skills/js-reverse/SKILL.md` in this repository does not automatically update
`~/.agents/skills/js-reverse/SKILL.md`.

Use the repo helper instead of hand-copying:

```bash
npm run skills:active:diff
npm run skills:active:check
npm run skills:active:sync -- --target ~/.agents/skills
```

- `skills:active:diff` is read-only and reports drift.
- `skills:active:check` is read-only and exits non-zero on drift.
- `skills:active:sync` writes the active copy after creating a timestamped
  backup under the target root.
- Extra target files are not deleted unless `--prune --confirm-prune` is passed.

Use `npm run verify:local` when local acceptance should include the strict
active skill drift check. The default `npm run verify` keeps active skill drift
visible but non-fatal so repository checks do not depend on a specific user's
home directory.

After syncing active skills, start a fresh agent session when you need to prove
that the loader is reading the updated skill text.

## 4. MCP runtime entrypoints

MCP runtime entrypoints are executable servers. They are separate from skill
text:

```text
src/mcp/browser/server.mjs
src/mcp/js-reverse/server.mjs
```

The MCP config keys should remain:

```text
tmwd_browser
js-reverse
```

Check the live config with:

```bash
codex mcp list
```

Expected browser67-backed paths:

```text
tmwd_browser -> /path/to/browser67/src/mcp/browser/server.mjs
js-reverse   -> /path/to/browser67/src/mcp/js-reverse/server.mjs
```

If `~/.agents/skills/js-reverse` is stale but `codex mcp list` points at
`src/mcp/js-reverse/server.mjs`, then the runtime is correctly registered and
only the skill playbook copy is stale. If `codex mcp list` points at another
repository, then the runtime registration is stale.

## External JS reverse references

External JS reverse repositories are audited references, not implementation
upstreams:

```text
docs/upstream/js-reverse/references.json
npm run js-reverse:upstream-audit -- --json
npm run check:js-reverse-upstream-audit
```

Reference repositories may contain useful patterns, case studies, or playbook
ideas, but they must not be direct-imported into runtime code without an
explicit promotion plan, contract coverage, and browser67 ownership review.

## Common mistakes

- Do not treat `~/.agents/skills/js-reverse` as the source of truth. It is an
  installed copy.
- Do not treat a stale skill copy as a broken MCP runtime. Verify with
  `codex mcp list`.
- Do not sync active skills by hand. Use `skills:active:sync` so backups and
  drift checks remain auditable.
- Do not make symlinks the default install model. Copy plus backup plus drift
  checks is the safer product path for shared agent roots.
- Do not promote an old standalone `js-reverse` checkout into the active runtime
  unless the MCP config explicitly points to it and the repository is reviewed.

## Quick diagnosis table

| Symptom | Check | Likely fix |
| --- | --- | --- |
| Agent follows old playbook text | `npm run skills:active:diff` | Run `npm run skills:active:sync -- --target ~/.agents/skills`, then start a fresh agent session |
| `js-reverse` tools are missing | `codex mcp list` | Fix MCP config to point at `src/mcp/js-reverse/server.mjs` |
| Repo checks pass but active skills are stale | `npm run skills:active:check` | Use `npm run verify:local` for local acceptance |
| Duplicate or stale skill roots are suspected | inspect active root and package installs | Audit before syncing other roots; do not blindly copy into every agent directory |
