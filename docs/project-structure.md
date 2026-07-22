# browser67 project structure

browser67 is maintained as a long-lived agent browser runtime. New code must
make the target surface obvious and keep runtime, MCP, native, and governance
concerns separated.

## Current canonical surfaces

- `tmwd_browser`: browser67 real Chrome/Edge profile automation over the TMWD
  transport/protocol.
- `js-reverse`: browser67-backed reverse workflow surface.
- TMWD transport runtime, hub, and extension bridge.
- Repo-external runtime artifacts and evidence.
- Governance contracts, doctors, readiness checks, and upstream audits.

## Current source layout

The current implementation still preserves several compatibility entrypoints:

- `src/mcp/browser/server.mjs`: browser67 `tmwd_browser` MCP entrypoint.
- `src/mcp/js-reverse/server.mjs`: `js-reverse` MCP entrypoint.
- `src/server.mjs` and `src/js-reverse-server.mjs`: compatibility shims for
  existing MCP configs.
- `src/server/`: browser MCP protocol, dispatch, and browser-core tools.
- `src/js-reverse-server/`: JS reverse protocol, tools, hooks, network, frames,
  scripts, artifacts, and lifecycle.
- `src/tmwd-runtime/` and `src/tmwd-runtime.mjs`: TMWD transport runtime.
- `src/tmwd-hub/`, `src/tmwd-hub.mjs`, `src/tmwd-hub-control/`: local hub and
  operator control.
- `src/auth/`: login profiles, lifecycle sidecars, manual-required states, and
  CAPTCHA planning.
- `src/browser-wrappers/`, `src/browser-screenshot/`, `src/tab-workspace/`:
  browser operation wrappers and managed-tab ownership.
- `src/native-*`, `src/native-*/*`, `src/physical-input/`: native fallback and
  physical-input provider planning.
- `src/runtime/paths/home.mjs`: canonical browser67 runtime-home resolution.
- `src/runtime/config/`, `src/runtime/storage/`, `src/runtime/runs/`, and
  `src/runtime/jobs/`: bounded configuration, atomic storage, indexed run
  records, and job recovery indexes.
- `src/browser/content/`, `src/browser/execution/`, and `src/browser/network/`:
  actionable snapshots/diffs, managed execution policy, and network lifecycle
  observation.
- `extension/browser67/`: browser67-owned managed-tab overlay; upstream root
  extension files remain provenance-tracked inputs to the generated install.

## Target structure direction

Future refactors should move toward:

```text
src/mcp/browser/
src/mcp/js-reverse/
src/runtime/tmwd/
src/runtime/hub/
src/runtime/artifacts/
src/browser/auth/
src/browser/tabs/
src/browser/captcha/
src/native/
src/governance/
```

Move in batches and keep old entrypoint shims until downstream MCP configs and
contracts have migrated.

## Directory rules

- Do not add new top-level generic directories such as `utils`, `helpers`,
  `misc`, `new`, `tmp`, or `experimental`.
- Do not create shared abstractions until at least two independent call sites
  need them.
- New externally visible MCP capabilities need tool schema, runtime validation,
  deterministic contract coverage, docs/skill updates, and either live proof or
  an explicit skipped/blocked reason.
- Runtime artifacts must live outside the repository under the active browser67
  home or an explicit test override.
- Large browser outputs must be bounded or written as artifacts with
  path/hash/count metadata.
- The root `src/*.mjs` compatibility allowlist has a non-increasing budget. New
  implementation modules must go under a capability directory; future
  migrations should remove root entries and reduce the budget rather than
  replacing them with new catch-all modules.

## Executable structure gate

Run the deterministic structure audit before accepting directory or entrypoint
changes:

```bash
npm run check:project-structure
```

The gate is read-only and checks tracked files only. It verifies canonical
top-level directories, canonical MCP entrypoints, runtime-home source location,
legacy shim boundaries, `.gitignore` runtime/evidence exclusions, and a guarded
allowlist for root-level `src/*.mjs` compatibility modules. If a future refactor
adds a new root source module, either move it under a domain directory or update
the migration plan. The allowlist budget may decrease but must not increase.
