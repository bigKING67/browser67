# Changelog

## Unreleased

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
