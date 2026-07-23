# Changelog

## Unreleased

- Add a deterministic extension build identity containing the package and
  manifest version, Git revision and dirty state, generated source digest, and
  protocol revision; report it from both `ext_ready` and `tabs_update`.
- Add Hub runtime-info probes over WebSocket and HTTP Link, retain the connected
  extension identity, and require the live identity to match a fresh build from
  the current source before the TMWD doctor reports ready.
- Report active-home and project-local installed identity candidates in the
  live doctor so a stale Chrome-loaded unpacked extension path is observable
  instead of being mistaken for a successful setup or reload.
- Run the browser live contract in a scoped browser67-owned managed fixture tab,
  finalize it before reporting success, and include the contract in the
  verification manifest's live and verify tiers without operating on user tabs.
- Refresh the GenericAgent review ledger through `4086d5c` after manual commit
  comparisons confirmed that `7fede5a..4086d5c` only changes GenericAgent
  model-reload handling and working-memory guidance, without touching
  `assets/tmwd_cdp_bridge` or adding a browser67 capability to absorb.

## 0.4.0 - 2026-07-23

- Add top-level confirmed page context to `browser67.tool-outcome.v3`, including
  page title, redacted URL, tab id, and managed/adopted policy state.
- Add `full`/`compact` output mode to all 17 `tmwd_browser` tools while keeping
  content-scope parameters independent; compact repeated session/transport
  diagnostics and add deterministic response-size/serialization benchmarks.
- Make browser MCP composition own session, WebSocket, transport-health,
  scheduler, snapshot, download, network-observation, run, job, and adoption
  lifecycle state while retaining explicit compatibility defaults for direct
  imports and legacy contracts.
- Add a `node:test` core runtime suite with an enforced 85% line/function/
  statement and 80% branch coverage floor for bounded stores, scheduling,
  page serialization, and structured batch references.
- Remove 21 root-level compatibility or catch-all modules and move active
  imports to capability-local auth, wrapper, CDP, TMWD, session, tab-workspace,
  schema, evidence, run, native, and runtime-error surfaces; reduce the root
  module budget from 26 to 5. Remove the unused MCP error-result formatter
  instead of retaining another compatibility facade.
- Teach the native dependency doctor to unwrap `browser67.tool-outcome.v3`
  before evaluating supported actions and installer prerequisites, avoiding a
  false not-ready result when the native capability probe is actually ready.
- Pin isolated remote-CDP live checks to the exact fixture target across scan
  and execution, revalidate target ID/URL/title after startup-tab cleanup, and
  fail explicitly on target or URL drift instead of accepting `about:blank`.
- Add an installed Agent integration doctor that separates repository/release
  readiness from machine-local MCP, extension, active-skill, AGENTS route, and
  live-runtime readiness.
- Document and align the external frontend `planned_browser_lifecycle` policy
  and runtime receipt boundary for managed-tab creation, explicit user-tab
  adoption, scoped finalization, and login-state fail-closed behavior.
- Align project/global Agent guidance with v0.3 user-tab adoption and the
  deterministic connected-extension reload path.
- Add a real TMWD hot-path performance gate with cold and p50/p95/p99 budgets
  for extension transport, managed execution, actionable snapshots, and
  selector waits.
- Skip the extension's 200 ms new-tab grace period when execution explicitly
  disables monitoring, including read-only scan, extraction, and wait paths;
  preserve that policy across both Hub WebSocket and HTTP Link relay paths.
- Tighten the real TMWD performance guardrails so the previous fixed 200 ms
  per-execution regression cannot silently return.
- Add a deterministic connected-extension self-reload command so installed
  bridge updates no longer depend on extension-page coordinate clicks.
- Move `native-live-linux` out of the default self-use readiness/release proof
  set while retaining the Linux desktop provider, gate, templates, record
  validation, and explicit on-demand audit path.
- Refresh the two moved JS reverse reference-only ledgers after manual diff
  review; retain browser67 as canonical, record that v0.3 already covers the
  applicable MCP runtime patterns, and promote no external code.

## 0.3.0 - 2026-07-21

- Replace browser tool dispatch with Ajv-validated registries and a shared
  `browser67.tool-outcome.v3` envelope on both browser and JS reverse MCP
  surfaces.
- Add explicit user-tab adoption with expiring capability tokens, renewable
  leases, release-by-default finalization, and separate two-stage adopted-tab
  close confirmation.
- Guard adopted-tab navigation with short-lived one-shot extension
  authorizations; suspend on user/out-of-band navigation, connection changes,
  lease changes, or missing managed policy until a fresh re-adoption.
- Add `browser67.actionable-snapshot.v2`, document-scoped NodeRef operations,
  sensitive-value redaction, cross-origin/closed-shadow limitation metadata,
  bounded marker/snapshot policy, and `browser67.semantic-diff.v2`.
- Add request-lifecycle `network_idle`, retain the old resource-entry heuristic
  as `resource_quiet`, add filtered `dom_stable`, and make main-only scanning a
  single page pass. Raw scripts and structured operations can attach the same
  bounded request observation.
- Isolate ordinary tabs from CSP, dialog, badge, marker, content-bridge, and
  network-observer side effects; generate managed behavior through the
  browser67 extension overlay.
- Add TMWD push-session caching, last-known-good transport routing, bounded
  endpoint backoff, and per-tab execution scheduling.
- Replace linear run/job recovery with atomic run checkpoints, append-only
  group indexes, bounded NDJSON tail reads, active-job indexes, cleanup-time
  compaction, and an explicit runtime-store migration command.
- Remove the `browser_execute_js.code` and `browser_job_ops.code` aliases;
  bridge commands now require strict JSON and TMWD raw execution requires an
  agent-created or explicitly adopted managed tab. Automatic transport routing
  does not treat a CDP fallback as explicit remote-CDP authorization.
- Add Biome, scoped JavaScript type checking, dependency-cycle/boundary gates,
  hot-path performance baselines, and a single executable verification
  manifest with fast/check/CI/live/platform/release tiers.

- Refresh GenericAgent and JS reverse reference review ledgers against current upstream commits while preserving browser67 as the canonical implementation.
- Add strict release-time upstream freshness checks and require non-empty Unreleased notes for commits made after the current package version anchor.
- Add run-backed browser job checkpoints, restart recovery to explicit `interrupted` results, and accurate non-preemptive cancellation metadata.
- Add additive capability flags for durable jobs, debugger availability, and CAPTCHA protocol-solver apply support.
- Add tiered verification commands, a machine-readable verification manifest, and cross-platform deterministic GitHub CI with isolated remote-CDP coverage.
- Add a separate c8 coverage-baseline CI job that uploads a machine-readable summary without imposing an invented initial threshold.
- Add p95/p99 run-event latency observations to the deterministic performance smoke gate.
- Add a default 500-run retention ceiling alongside age and total-size cleanup budgets.
- Add dedicated Linux/Windows GUI native-live proof gates that verify native window geometry plus physical drag/click and automatically record sanitized target-OS proof JSON.
- Harden Windows physical pointer execution with foreground HWND verification, `SendInput`, cursor-position readback, and bounded drag/click telemetry.
- Resolve managed Chrome windows by the active tab title and verify the Win32 foreground HWND before Windows physical CAPTCHA input.

## 0.2.0 - 2026-07-01

- Promote `browser67` as the canonical project/package/CLI/runtime identity.
- Keep `tmwd-browser-mcp` and `tmwd-browser` as explicit compatibility aliases.
- Move the default runtime home to `~/.browser67` while preserving
  `~/.tmwd-browser-mcp` as copy-only migration compatibility.
- Add canonical MCP entrypoints under `src/mcp/browser/` and
  `src/mcp/js-reverse/` while retaining legacy server shims.
- Normalize setup registry output to canonical MCP server paths.
- Add release-readiness governance for version metadata, changelog coverage,
  clean/synced release checks, Pi package pin follow-up, and optional live proof
  boundaries.
- Keep GenericAgent/TMWebDriver provenance explicit through upstream lock and
  review gates.
