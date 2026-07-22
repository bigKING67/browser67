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
- **Reviewed commit**: `b8ae07db073783597b11f60fa2e900e3f9b9163f`
- **Direct import allowed**: `false`
- **Priority**: `P2`
- **Absorbable pattern**: Focused PRIMARY routing plus explicit scope, evidence-to-finding-to-path linkage, append-only timeline/workitems, browser-extension review, and external-skill supply-chain review patterns.
- **Current browser67 coverage**: `skills/js-reverse/SKILL.md` and `templates/tasks/js-reverse-task-template.json` already provide browser-scoped routing, observe-first phases, managed workspaces, `evidence.v1`, bounded artifacts, task finalization, and explicit external-reference policy; package locking, audits, and reviewed upstream ledgers cover the applicable supply-chain boundary.
- **Gap**: The reviewed v1.0.0-plus delta adds a broad security skill router and PowerShell case tooling, not a browser67 runtime capability. Non-web reverse domains, automatic tool bootstrap, and bulk field-journal loading remain outside browser67 scope. A future report schema may optionally link evidence ids to validated findings and call paths, but the current runtime already records evidence ids, confidence, request/script links, artifacts, and task timelines.
- **Target layer**: `docs/js-reverse/`, `skills/js-reverse/`, and `templates/tasks/js-reverse-task-template.json`.
- **Promotion requirement**: Reimplement only browser-specific reporting or extension-review vocabulary when a demonstrated browser67 workflow needs it; keep the focused JS reverse router, managed-tab lifecycle, and audited toolchain, and reject generic domain-pack expansion, automatic bootstrap, bulk precedent loading, or external execution semantics.
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
- **Reviewed commit**: `f45172a7b2a8d98daf29434e99baf35bc08bb959`
- **Direct import allowed**: `false`
- **Priority**: `P3`
- **Absorbable pattern**: Lightweight MCP ergonomics for page observation, hook setup, script lookup, reverse-task reporting, serialized tool execution, structured tool errors, routing evaluations, and explicit debugger-session lifecycle.
- **Current browser67 coverage**: v0.3 now provides a single JS reverse Tool Registry with Ajv runtime validation, `browser67.tool-outcome.v3` structured results, per-tab scheduling, managed-tab lifecycle, bounded evidence artifacts, and an explicit remote-CDP exception rather than implicit fallback from the real-profile TMWD path.
- **Gap**: The latest reviewed commit only changes README campaign links and introduces no tool, protocol, lifecycle, debugger, routing, or execution behavior. The single-flight, structured-error, routing-validation, and explicit debugger-boundary patterns identified in the earlier v4.0.1 review are already covered by browser67-owned v0.3 code and contracts, so no new promotion is required.
- **Target layer**: `src/js-reverse-server/`, `contracts/js-reverse-mcp-contract/`, `contracts/js-reverse-mcp-live-gate/`, `scripts/`, `docs/js-reverse/`, and `skills/js-reverse/SKILL.md`.
- **Promotion requirement**: Reopen promotion only if a future reviewed commit adds behavior not covered by browser67-owned registry, validation, scheduler, outcome, lifecycle, or explicit remote-CDP boundaries; preserve the default hook-first TMWD path and `direct_import_allowed=false`.
- **Verification**: `npm run check:js-reverse-mcp`; `npm run check:js-reverse-upstream-audit`; `npm run check:js-reverse-absorption-matrix`.
