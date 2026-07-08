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

## Optional live proofs

Optional live proofs are not faked or downgraded into required local checks;
the phrase `optional live proofs` is used consistently in release gates so
agents can match the policy text without interpreting prose.
They require the real target environment:

- Linux GUI host for `native-live-linux`.
- Windows GUI host for `native-live-win32`.
- Approved external IdP tenants for OAuth popup, cross-domain SSO, and MFA.

Use:

```bash
npm run plan:optional-live-proofs
npm run proof:optional-live-status
```

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
