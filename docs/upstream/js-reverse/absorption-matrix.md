# js-reverse upstream absorption matrix

This matrix turns external JS reverse references into auditable browser67
promotion decisions. External repositories remain reference-only inputs unless a
future reviewed change promotes a specific pattern into browser67-owned docs,
skills, tools, contracts, or runtime code.

## Contract rules

- Every reference in `docs/upstream/js-reverse/references.json` must have one
  section below.
- `Direct import allowed` must remain `false` for every section.
- P0/P1 items must state a concrete target layer, promotion requirement, and
  verification command.
- A promotion updates browser67-owned artifacts first; it never imports external
  runtime code wholesale.

## Reference entries

### `zhaoxuya520/reverse-skill`

- **Reference**: `zhaoxuya520/reverse-skill`
- **Reviewed commit**: `9ec60377bfdcafa0b317ed3612acc6c46270be78`
- **Direct import allowed**: `false`
- **Priority**: `P1`
- **Absorbable pattern**: Task-router taxonomy for reverse, security, CTF, mobile, binary, and web investigation modes.
- **Current browser67 coverage**: `skills/js-reverse/SKILL.md` already defines browser67-backed web/API/signature workflows, evidence capture, frame-aware discovery, storage boundaries, and local rebuild bundles.
- **Gap**: The current skill has workflow depth but no per-mode promotion ledger that maps non-web reverse domains to browser67-owned target docs or rejects them explicitly.
- **Target layer**: `skills/js-reverse/SKILL.md`, `docs/js-reverse/`, and `templates/tasks/js-reverse-task-template.json`.
- **Promotion requirement**: Translate only durable routing vocabulary into browser67-specific guidance; reject auto-execution, bulk precedent loading, and external tool-install semantics.
- **Verification**: `npm run check:js-reverse-mcp`; `npm run check:js-reverse-upstream`; `npm run check:js-reverse-absorption-matrix`.

### `NoOne-hub/JSReverser-MCP`

- **Reference**: `NoOne-hub/JSReverser-MCP`
- **Reviewed commit**: `65e2e3cb70c10a79dfd1ba4410a2c876113e676c`
- **Direct import allowed**: `false`
- **Priority**: `P1`
- **Absorbable pattern**: MCP tool-surface organization for JS reverse sessions, environment patching, task indexes, and reproducible reverse bundles.
- **Current browser67 coverage**: `src/mcp/js-reverse/server.mjs`, `src/js-reverse-server/`, `contracts/js-reverse-mcp-contract/`, and `contracts/js-reverse-mcp-live-gate/` provide browser67-owned RPC tools, managed-tab lifecycle, evidence recording, frame discovery, scoped storage reads, hooks, and rebuild bundle export.
- **Gap**: Future tool additions should compare against this reference before promotion, especially for env-patching ergonomics and task-index discoverability, while keeping real Chrome/Edge profile as the default browser boundary.
- **Target layer**: `src/js-reverse-server/`, `contracts/js-reverse-mcp-contract/`, `docs/js-reverse/`, and `skills/js-reverse/SKILL.md`.
- **Promotion requirement**: Reimplement any accepted tool semantics inside browser67 with managed-tab ownership, bounded artifacts, `finalize_task`, and `evidence.v1`; do not depend on a self-managed Puppeteer browser as the default path.
- **Verification**: `npm run check:js-reverse-mcp`; `npm run check:js-reverse-live`; `npm run check:js-reverse-absorption-matrix`.

### `zhizhuodemao/js-reverse-mcp`

- **Reference**: `zhizhuodemao/js-reverse-mcp`
- **Reviewed commit**: `0e19693f496b4600dbc9381e76293d7afa96c001`
- **Direct import allowed**: `false`
- **Priority**: `P2`
- **Absorbable pattern**: Lightweight MCP ergonomics for page observation, hook setup, script lookup, and reverse-task reporting.
- **Current browser67 coverage**: browser67 already exposes the richer real-browser path through `tmwd_browser`, js-reverse MCP contracts, bounded evidence artifacts, and canonical skill guidance.
- **Gap**: Candidate ergonomic shortcuts need case-by-case review so they do not bypass browser67 tab ownership, storage minimization, or evidence normalization.
- **Target layer**: `skills/js-reverse/SKILL.md`, `docs/js-reverse/`, and `contracts/js-reverse-mcp-contract/`.
- **Promotion requirement**: Accept only small UX/API clarity improvements that preserve browser67 ownership, repo-local contracts, and `direct_import_allowed=false`.
- **Verification**: `npm run check:js-reverse-mcp`; `npm run check:js-reverse-upstream-audit`; `npm run check:js-reverse-absorption-matrix`.
