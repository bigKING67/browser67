# browser67 maintenance quality model

browser67 optimizes for quality effect, long-term maintainability, code
elegance, performance, architecture quality, project quality, and directory
governance.

## Quality effect

- Prefer evidence-first browser operations: DOM/geometry/network state,
  screenshots, run artifacts, and explicit live-gate results.
- Do not claim browser-visible behavior is fixed without a relevant browser or
  live-runtime verification path.
- Failed or skipped live proof must return a structured reason and next command.

## Long-term maintainability

- Keep TMWD browser automation and JS reverse as separate MCP surfaces sharing a
  runtime, not a single dispatch monolith.
- Keep GenericAgent/TMWebDriver upstream changes behind audit/review/lock
  commands.
- Keep docs, skills, schemas, and contracts synchronized with behavior changes.
- Keep compatibility shims explicit and documented.

## Code elegance

- Keep schema declaration, runtime validation, transport execution, and result
  formatting separate.
- Avoid silent fallback and fake success paths.
- Prefer small modules by capability boundary over catch-all helpers.
- Add comments only where the behavior is not self-evident.

## Performance

- Default to bounded output; use `output_mode:"compact"`, limits, filters, and
  artifact files for large DOM/network/script/storage payloads.
- Use `browser_wait` and transport-health probes instead of fixed sleeps.
- Keep long browser execution out of synchronous tool calls when job semantics
  are more appropriate.
- Avoid hot-path synchronous IO, unbounded caches, unbounded DOM dumps, and
  repeated large JSON serialization.

## Architecture quality

- The public MCP surfaces are `tmwd_browser` and `js-reverse`.
- TMWD runtime, hub, extension bridge, managed tabs, auth, native fallback, and
  governance checks each have an explicit home.
- Repo-external state is resolved through the browser67 runtime-home resolver,
  not scattered literal paths.

## Project quality gates

The executable verification manifest is the authority for aggregate tiers. Use
the smallest gate that proves the changed behavior, then expand by risk. A
passing deterministic contract is source-level evidence; it is not a substitute
for a live browser, target OS, external identity provider, or published artifact.

### Public aggregate gates

```bash
npm run check
npm run verify
npm run check:release-readiness
npm run release:ready
```

- `check` is deterministic and does not require a real browser profile.
- `verify` adds the configured real-profile gates and repository governance.
- `check:release-readiness` validates release metadata without requiring a clean
  and pushed checkout.
- `release:ready` adds clean/synced/current-upstream requirements but does not
  commit, push, tag, publish, or create a GitHub Release.

### Deterministic repository contracts

```bash
npm run check:readme
npm run check:mcp
npm run test:core
npm run coverage:core
npm run check:job-persistence
npm run check:js-reverse-mcp
npm run check:doctor-schema
npm run check:browser67-naming
npm run check:runtime-home
npm run check:project-structure
npm run check:change-set-contract
npm run check:change-set
npm run plan:scoped-commits
npm run check:readiness
npm run check:release-readiness
npm run check:performance-smoke
npm run check:regression-matrix
npm run check:verification-manifest
npm run check:verification-runner
npm run skills:check
git diff --check
```

`check:change-set` and `plan:scoped-commits` are planning/read-only governance;
they do not stage or commit files. Review the proposed groups and use scoped Git
paths only after commit authorization.

### Tiered verification

```bash
npm run verify:manifest
npm run coverage:contracts
npm run verify:ci
npm run verify:live
npm run verify:platform
npm run verify:local
npm run verify:all
```

- `verify:ci` runs deterministic contracts, canonical Skill parity, and npm
  dependency audit.
- `verify:live` requires the local hub and a connected real-profile extension.
- `verify:platform` runs explicit remote-CDP and native/platform diagnostics.
- `verify:local` adds strict active-Skill drift detection to the default verify
  chain.
- `verify:all` combines local verification with the isolated remote-CDP proof.

### Live browser gates

```bash
npm run check:live:doctor
npm run check:live
npm run check:managed-tab-live
npm run check:tmwd-performance-live
npm run check:screenshot-live
npm run check:file-ops-live
npm run check:console-live
npm run check:auth-live
npm run check:js-reverse-live
```

The live doctor proves transport reachability and the loaded extension service
worker's build identity. The other gates create isolated managed fixtures and
must finalize them. Their success does not prove behavior on an unrelated site
or external account.

The screenshot live gate gives screenshot operations a 25-second deadline and
keeps a separate 30-second RPC envelope so viewport cleanup and structured
timeout errors can reach the caller. `--timeout-ms` overrides the operation
deadline; the RPC envelope remains five seconds larger instead of racing the
same deadline. The gate creates its fixture with `active:false` in the dedicated
Agent window, requires `document.visibilityState="hidden"`, covers viewport and
selector mobile emulation, checks PNG dimensions and viewport restoration, and
keeps the post-emulation `Page.getLayoutMetrics` barrier inside the same atomic
debugger transaction before synchronous page probes and capture. It then proves
a later debugger-backed capture still succeeds before finalization.

The TMWD performance live gate complements the deterministic performance smoke
with cold and warm p50/p95/p99 measurements for extension transport, managed
execution, actionable extraction, and selector waits against an isolated local
fixture. It verifies that scoped finalization leaves no managed registry records.
Default p95 guardrails are 100 ms for transport, execution, and selector waits
plus 150 ms for a 120-node actionable snapshot; the complete fixture must finish
within 5 seconds. Environment overrides remain available for slower target
hosts.

### Extension and GenericAgent upstream gates

Inspect install state and build behavior:

```bash
npm run extension:doctor
npm run check:extension-install-doctor
npm run extension:check
npm run extension:check:strict  # only when exact upstream byte alignment is intended
npm run check:extension-build
npm run check:extension-managed-runtime
```

The default `extension:check` and `extension:check:strict` compare the local fork
with the immutable `reviewed_source_files` hashes in `UPSTREAM.review.json`, not
with a mutable sibling checkout. Pass `-- --source /path/to/bridge` only when an
explicit checkout is the intended comparison. Synchronization still reads real
source files and retains its explicit reviewed-sync guard.

Audit provenance and upstream drift:

```bash
npm run upstream:audit
npm run upstream:audit:latest
npm run upstream:review-refresh-plan
npm run check:upstream-audit
npm run check:upstream-lock
npm run check:upstream-review
npm run check:upstream-review-refresh-plan
npm run upstream:check
npm run upstream:lock
```

`upstream:audit:latest` is read-only and uses a temporary checkout. A stale
review ledger requires a manual commit/file comparison before the explicit
`upstream:review-refresh-plan -- --write --confirm-reviewed` path. A current
ledger may intentionally preserve `safe_to_direct_sync:false` and a historical
`UPSTREAM.lock.json`; current review is not byte parity.
`upstream:check` resolves the lock's declared commit from Git objects and hashes
that tree directly. It does not require the sibling GenericAgent worktree HEAD
to equal the historical sync baseline and does not checkout or modify that repo.

JS reverse references have an independent review ledger:

```bash
npm run js-reverse:upstream-audit
npm run check:js-reverse-upstream-audit
npm run check:js-reverse-upstream
npm run check:js-reverse-absorption-matrix
```

### Skill and agent-installation gates

```bash
npm run skills:active:diff
npm run skills:active:check
npm run skills:active:backups
npm run skills:active:restore
npm run skills:roots:audit
npm run check:active-skill-sync
npm run check:skills-roots-audit
npm run doctor:agent -- --check --json
```

The repository Skill is source truth; an active Skill root is machine-local
runtime state. Diff and doctor commands are observational. Sync, restore, prune,
or active-root changes require an explicit operator decision and a fresh agent
session to prove discovery.

### CAPTCHA, native input, and optional proofs

Deterministic and synthetic gates:

```bash
npm run check:captcha-assist-live
npm run check:captcha-router
npm run check:captcha-provider-jfbym
npm run check:captcha-provider-jfbym-setup
npm run check:captcha-provider-jfbym-coordinate
npm run check:native-pointer
npm run check:native-live
npm run check:ljqctrl
```

Optional-proof planning and records:

```bash
npm run check:optional-live-proofs
npm run plan:optional-live-proofs
npm run proof:optional-live-status
npm run proof:optional-live-template
npm run proof:optional-live-record
npm run proof:native-live
```

Planning, readiness, synthetic fixtures, or a template with `ok:false` are not
physical-input or external-provider evidence. Target-OS GUI, local physical
CAPTCHA, and approved OAuth/SSO/MFA proofs must be collected on the real scoped
environment and stored as sanitized repo-external artifacts.
CAPTCHA/native physical proofs additionally bind the normalized
`physical-input-v1` behavior-source digest. Date-valid historical proofs do not
cover later native/focus/runtime changes and are reported as optional gaps.

## Evidence boundaries

- **Source:** lint, type, unit, contract, structure, dependency, performance
  smoke, and documentation gates.
- **Live runtime:** exact connected extension identity, managed fixture behavior,
  TMWD/Link health, and runtime cleanup receipts.
- **Platform:** isolated remote CDP or native input on the named OS/GUI host.
- **External optional:** approved IdP/provider behavior and sanitized proof
  records; absence remains visible.
- **Release:** clean and origin-synced Git state plus current upstream review.
- **Publish:** tag, release, registry upload, or other external mutation; never
  implied by release readiness.
