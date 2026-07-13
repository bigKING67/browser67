# browser67 release governance

browser67 release work must preserve quality effect, long-term maintainability,
code elegance, performance, architecture quality, project quality, and directory
governance. Release automation is intentionally conservative: it proves local
readiness and prints blockers, but it does not publish or tag without an
explicit operator decision.

## Release gates

Run the non-strict release metadata gate during development:

```bash
npm run check:release-readiness
```

Run the strict local release gate only after all intended changes are committed
and pushed:

```bash
npm run release:ready
```

`npm run release:ready` executes `npm run verify`, then requires:

- `package.json` and `package-lock.json` versions to match.
- `CHANGELOG.md` to contain the current package version.
- release governance docs and README to mention the release gate.
- canonical and legacy CLI bins to exist.
- change-set grouping to cover all changed paths.
- the worktree to be clean.
- the checkout to be synced with `origin/main`.
- the GenericAgent review ledger to match current remote `main`.
- every JS reverse external reference to match its manually reviewed commit.
- a non-empty `CHANGELOG.md` `Unreleased` section when commits exist after the
  current package version was introduced.

The strict freshness portion is equivalent to:

```bash
node scripts/release-readiness.mjs --require-current-upstreams
```

Normal `npm run check:release-readiness` stays network-light. Release
declaration is the boundary that turns moved upstreams into blockers.

Use the strict optional-proof gate only when a local release policy explicitly
requires every optional live proof:

```bash
npm run release:ready:strict
```

This adds the same hard requirement as:

```bash
npm run check:optional-live-proofs -- --strict
```

In non-strict release readiness, missing optional live proofs are reported as
advisories rather than warnings, because they require external target hosts or
approved IdP tenants and are not local-release blockers.

## Verification tiers

The machine-readable tier map is available through:

```bash
npm run verify:manifest
```

- `npm run verify:ci`: deterministic contracts, docs/skills, dependency, and release metadata gates.
- `npm run coverage:contracts`: deterministic source/script coverage baseline and JSON summary.
- `npm run verify:live`: real TMWD browser, auth, managed-tab, JS reverse, and screenshot gates.
- `npm run verify:platform`: isolated remote CDP and native/platform diagnostics.
- `npm run verify:local`: default full verification plus active skill drift.
- `npm run verify:all`: local verification plus isolated remote CDP.

Repository CI runs deterministic contracts on Linux, Windows, and macOS, plus
an isolated Ubuntu remote-CDP job and a separate coverage-summary job.
Real-profile TMWD live gates remain local or self-hosted because shared CI must
not access a user's browser profile.

## Optional live proofs

Optional live proofs are not faked or downgraded into required local checks;
the phrase `optional live proofs` is used consistently in release gates so
agents can match the policy text without interpreting prose.
They require the real target environment:

- Linux GUI host for `native-live-linux`.
- Windows GUI host for `native-live-win32`.
- Approved external IdP tenants for OAuth popup, cross-domain SSO, and MFA.

The Linux/Windows hosts may be physical machines or desktop VMs, but they must
have an unlocked interactive GUI session, a visible Chrome/Edge window, the
browser67 extension and hub, and real system pointer input. Headless CI, SSH-only
Linux, containers without a desktop, and locked/disconnected Windows sessions do
not satisfy these proofs.

Use:

```bash
npm run plan:optional-live-proofs
npm run proof:optional-live-status
npm run check:native-live
```

On each matching Linux/Windows GUI host, run the no-input readiness command
first, then explicitly opt into `npm run proof:native-live -- --write`. The gate
records canonical sanitized `native-live-*.json` proof automatically. See
`docs/native-live-linux.md` and `docs/native-live-windows.md`.

Collected proofs must be sanitized JSON and stored under the active browser67
home, not the repository:

```text
~/.browser67/optional-live-proofs/
```

## Pi package pin

After pushing a browser67 release or release-candidate commit, update the Pi
package pin to the exact browser67 commit:

```bash
pi install git:github.com/bigKING67/browser67@<tag-or-commit>
```

For the maintained pi-67 checkout, update `settings.json` with the exact commit,
then run:

```bash
bash /Users/gaoqian/.pi/agent/scripts/pi67-doctor.sh --deep-mcp --mcp-timeout-ms 5000 --json
bash /Users/gaoqian/.pi/agent/scripts/pi67-report.sh --operation browser67-pin-commit --doctor-deep-mcp --mcp-timeout-ms 5000
bash /Users/gaoqian/.pi/agent/scripts/pi67-status.sh --json
```

Commit only the scoped Pi pin change and push it after the doctor reports
`READY`.

## Tagging and publishing boundary

Do not publish or tag from automated maintenance work by default.

Tagging, GitHub release creation, npm publish, package registry publish, or any
other external release action requires an explicit operator decision after:

```bash
npm run release:ready
```

If strict cross-OS or external IdP proof is part of that release's acceptance
criteria, run:

```bash
npm run release:ready:strict
```

## Version bump policy

- Patch: docs, compatibility shims, validation-only gates, or bug fixes that do
  not change public MCP semantics.
- Minor: canonical identity shifts, new MCP tool surfaces, new runtime
  capabilities, new governance gates, or material browser behavior changes.
- Major: breaking MCP schema/tool changes, removed compatibility aliases, or
  changed default runtime semantics.
