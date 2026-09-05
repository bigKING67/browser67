# browser67 runtime operations

This guide covers local installation and operations for the browser67 hub and
Chrome/Edge unpacked extension. It separates source state, installed files, and
the live extension service worker so operators do not treat one layer as proof
of another.

## Runtime layers

browser67 has four independently observable layers:

1. **Repository source** under the browser67 checkout.
2. **Installed extension files** under the active browser67 home.
3. **Live extension service worker** loaded by a specific Chrome/Edge profile.
4. **Hub and MCP processes** connected to that live extension instance.

`npm run setup` updates layer 2. Reloading the unpacked extension updates layer
3. Starting the hub updates layer 4. A successful file comparison does not prove
that Chrome/Edge reloaded the service worker, and a reachable hub does not prove
that the connected extension matches the current source.

## Prerequisites

- Node.js 20 or 22.
- Chrome or Edge with Developer Mode enabled for unpacked extensions.
- A local browser profile selected by the operator.

Install project dependencies once per checkout:

```bash
npm ci
```

Use `npm ci` for a lockfile-exact install. Do not commit `node_modules/` or any
generated extension configuration.

## Install the extension

### Release updates

For normal local updates, install an explicitly selected release tag, after its
version commit has passed CI. Do not install an untagged checkout under an
unchanged release version. Package and lockfile versions must be bumped before
tagging; the extension build derives its manifest version from the package.

Use a clean detached worktree at the verified annotated tag and pack there:

```bash
(
set -e
git fetch origin --tags
release_tag=v0.11.3
test "$(git cat-file -t "$release_tag")" = tag
release_sha=$(git rev-parse "$release_tag^{commit}")
test "$(git rev-parse HEAD)" = "$release_sha"
test -z "$(git status --porcelain)"
release_dir=$(mktemp -d)
git worktree add --detach "$release_dir/source" "$release_tag"
(cd "$release_dir/source" && npm pack --pack-destination "$release_dir")
npm install -g "$release_dir/browser67-${release_tag#v}.tgz"
browser67 --version
BROWSER67_EXTENSION_BUILD_REVISION="$release_sha" browser67 setup
)
```

These checks require the canonical checkout to be clean and at the selected
release commit, so its MCP entrypoints and doctor use the same release source.
If either check fails, stop and preserve the existing worktree; do not reset or
overwrite development work to satisfy it. Use a separately configured release
checkout for the Agent entrypoints and verification instead.
Retain the tarball and its SHA-256 for installation parity.
Then reload the connected extension using `npm run extension:reload-live` from
the canonical checkout, and run `npm run doctor:agent -- --check --json` there.
Restart the managed hub when its code changed; reload MCP servers through their
owning Agent hosts rather than killing unrelated sessions. Refresh only the
task's authorized target tabs when content scripts changed.

The final receipt must distinguish the selected tag, installed CLI version,
installed extension version, live extension version/revision, active Skills,
and Agent processes still awaiting reload. Setup prints the disk build identity;
it deliberately labels live state unverified until reload and doctor succeed.
`browser67 --version` reports the local package version, not whether it is the
latest remote release. Check remote tags/Release separately before making that
claim. Commit-based development installs must be reported with their commit SHA
and development status rather than presented as a newly published release.

### Development checkout installation

The following installs the current checkout, rather than selecting a release.
Do not run it after the release procedure from a different development checkout.
Prepare the canonical active-home install:

```bash
npm run setup
```

The default extension target is:

```text
~/.browser67/browser/tmwd_cdp_bridge/
```

Setup generates install-local `config.js`, build identity files, and MCP
registry entries under the active browser67 home. `extension/config.js` is not
a source file and must not be committed.

For the first installation:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer Mode.
3. Choose **Load unpacked**.
4. Select `~/.browser67/browser/tmwd_cdp_bridge/` exactly, not its parent.
5. Start the hub and run the live doctor.

To prepare a project-local extension copy instead:

```bash
npm run setup:local-extension
```

Load this exact directory:

```text
/path/to/browser67/runtime/chrome-extension/tmwd_cdp_bridge/
```

The project-local runtime directory is ignored state. It is useful for local
development but is not a source or release artifact.

## Inspect installed and live identity

Compare source with installed extension files without changing anything:

```bash
npm run extension:doctor
npm run check:extension-install-doctor
```

`extension:doctor` ignores install-local `config.js` and reports conditions such
as `needs_setup`, `needs_clean_setup`, and
`needs_browser_extension_reload`. The generated build identity includes package
and manifest versions, Git revision and dirty state, deterministic source digest,
and extension handshake protocol revision.

`installed_current` is content-semantic: an otherwise identical canonical
bundle remains current when its revision, dirty-checkout state, or
`build_revision_source` provenance changes. `installed_byte_current` and
`byte_changed` preserve strict file-level evidence, while
`identity_provenance_variant:true` and `provenance_mismatches` explain why no
setup/reload is required. Source digest, product/manifest version, protocol, or
non-canonical identity mismatches remain actionable drift.

After changing extension or generated build inputs:

```bash
npm run setup
npm run extension:reload-live
npm run check:live:doctor
```

`extension:reload-live` is appropriate only when an existing browser67
extension is loaded and connected. A first install, disabled extension, or
disconnected bridge still requires a manual reload from the browser extension
page. Refresh existing target tabs after reload so content scripts reinject.

The decisive doctor fields are the live TMWD runtime checks. A current service
worker reports `extension_identity_ok` and `identity_match:true` for the
WebSocket or HTTP Link route. Installed file equality alone is not sufficient.

## Hub control

Start, inspect, and stop the local hub:

```bash
npm run hub:start
npm run hub:status
npm run hub:stop
```

Default endpoints:

```text
WebSocket  ws://127.0.0.1:18765
HTTP Link http://127.0.0.1:18766/link
```

Run a compact live readiness check:

```bash
npm run check:live:doctor
```

Use machine-readable diagnosis when readiness fails:

```bash
npm run doctor:json
```

A refused remote-CDP endpoint at `127.0.0.1:9222` does not make the default TMWD
route unhealthy. Remote CDP is a separate, explicit debug/CI mode.

## User-level launchd service

On macOS, install the hub as a user LaunchAgent:

```bash
npm run launchd:install
```

The canonical plist is:

```text
~/Library/LaunchAgents/com.browser67.tmwd-hub.plist
```

Remove only the canonical service:

```bash
npm run launchd:uninstall
```

Remove canonical and known legacy browser67/TMWD services:

```bash
npm run launchd:uninstall -- --all
```

Installation may stop known legacy labels before starting the canonical service
so only one hub owns the default ports. Review the command and active service
state before removing user-level launchd configuration.

## Runtime home

The canonical runtime home is:

```text
~/.browser67/
```

Important paths include:

```text
~/.browser67/browser/tmwd_cdp_bridge/
~/.browser67/mcp/servers.toml
~/.browser67/runtime/tmwd-hub-state.json
~/.browser67/runtime/runs/
~/.browser67/optional-live-proofs/
```

Override the home for an isolated environment with:

```bash
BROWSER67_HOME=/custom/path npm run doctor:json
```

Keep runtime state outside the repository. Do not point `BROWSER67_HOME` at the
checkout or a broad directory such as the user's home.

## Migrate a legacy home

Inspect the copy plan first:

```bash
browser67 migrate-home --dry-run
```

Copy legacy state to the canonical home:

```bash
browser67 migrate-home --write
```

Migration is copy-only. It does not delete `~/.tmwd-browser-mcp/`, read browser
password/cookie stores, or move unrelated files. After migration:

1. Run `npm run setup`.
2. Reload the unpacked extension from the canonical active-home path.
3. Refresh target tabs.
4. Run `npm run check:live:doctor`.

See [browser67 migration](migration-browser67.md) for compatibility labels and
the legacy cleanup boundary.

## Runtime artifact retention

Runs, screenshots, logs, and evidence are repo-external by default under:

```text
~/.browser67/runtime/runs/
```

Use `browser_run_ops action:"inspect", summary_only:true` for a global read-only
audit without group names. It reports indexed and untracked run-directory
counts, status totals, legacy-schema totals, current-versus-legacy running/stale
splits, oldest/newest timestamps, and running runs older than
`stale_running_after_minutes` (120 by default). Add
`include_storage:true` only when a recursive scan is useful; it separates
indexed-run bytes from run-like directories that have no `run.json`. Use
`action:"list", summary_only:true` for one group's count without returning run
titles or rows. Missing-group reads do not create group directories or empty
indexes. Similarly, `browser_job_ops action:"list", summary_only:true`
returns status/durability/result counts without job titles, errors, ids, or
rows. A browser job without `run_id` owns its auto-prepared run and terminalizes
it with `finished_at`; a caller-supplied job run remains caller-owned and reports
`run_requires_finish:true`. A screenshot without an explicit `run_id` creates and terminalizes its
own run after the PNG is written. A caller-supplied `run_id` keeps caller-owned
lifecycle semantics; inspect `run_requires_finish` and finish that run
explicitly when it remains `running`.

Screenshot metadata separates evidence freshness from storage retention:
`evidence_valid_until` is 24 hours after capture and says when the visual sample
should be refreshed before reuse. It does not schedule deletion. Deletion is
governed by the run-retention plan below; `retention_delete_after` stays `null`
until that plan selects the run.

Audit old nonterminal run records before changing them:

```bash
npm run runtime:terminalize-stale:dry-run -- --json
```

After reviewing the exact candidates, mark only those stale `running` records
as `interrupted` (no files or artifacts are deleted):

```bash
npm run runtime:terminalize-stale -- --write --json
```

Old index-only group directories use a separate deletion boundary:

```bash
npm run runtime:prune-empty-groups:dry-run -- --json
npm run runtime:prune-empty-groups -- --write --json
```

The apply command removes only direct child group directories that have no run
directories, no unknown entries, and at most empty `index.ndjson` and
zero-count `index.meta.json` files. It rechecks each target before removal.

Audit owner-only runtime permissions without changing them:

```bash
npm run runtime:permissions:dry-run -- --json
```

After reviewing the exact mismatch paths, apply mode `0700` to
`~/.browser67`, runtime and managed-tab registry directories, and `0600` to
runtime/registry files without following symlinks:

```bash
npm run runtime:permissions -- --write --json
```

The audit covers `~/.browser67/runtime/` plus
`~/.browser67/tab-workspace/`; it does not recursively rewrite extension or
provider configuration trees. On Windows it reports
`platform_supported:false` and performs no `chmod`; this POSIX-mode audit does
not claim to harden Windows ACLs. New `tmwd_browser` and `js-reverse` MCP server processes set process umask
`077`; run, job, screenshot, journal, hub-state, live-gate event, and managed-tab
registry writers also enforce private modes at their own boundaries. An MCP
server that was already running before this version keeps its loaded writer code
until the owning Agent session restarts.

Preview cleanup before allowing deletion:

```bash
npm run runtime:cleanup:dry-run
```

Apply the displayed plan only after review:

```bash
npm run runtime:cleanup -- --write
```

The default policy keeps the latest 50 runs, preserves recently updated running
runs, and considers age, total size, and a 500-run ceiling. The cleanup helper
refuses dangerous roots such as `/`, `$HOME`, repository paths, and paths that
do not look like run roots. Tune policy through its `--max-age-days`,
`--max-total-mb`, `--max-run-count`, and `--keep-latest` options or the matching
`TMWD_RUNTIME_CLEANUP_*` environment variables.

`browser_run_ops.inspect` is an operational inventory, not a deletion plan.
`runtime:cleanup:dry-run` remains authoritative for retention candidates and
may also recognize run-like directories without `run.json`; applying that plan
still requires the explicit `--write` action after review.

## Troubleshooting sequence

When the real-browser route is unavailable, check the earliest uncertain layer:

1. `npm run extension:doctor` - source versus installed files.
2. Browser extension page - enabled state and exact unpacked path.
3. `npm run hub:status` - hub process and endpoint ownership.
4. `npm run doctor:json` - connected Browser Instances and transport health.
5. `npm run check:live:doctor` - live identity and readiness contract.

If extension source changed, do not loop on the doctor without performing the
required setup/reload/target-tab refresh steps. If no extension source changed,
do not reinstall blindly; inspect the structured failure and the connected
Browser Instance identity first.

## Security boundary

- Do not commit `config.js`, tokens, cookies, browser profile files, screenshots,
  network captures, optional-proof payloads, or runtime logs.
- Do not inspect unrelated browser profiles or tabs while diagnosing a route.
- Do not treat remote CDP as a fallback for a missing real-profile connection.
- Do not delete legacy runtime homes or run artifacts without reviewing a
  dry-run plan and obtaining the applicable operator confirmation.
