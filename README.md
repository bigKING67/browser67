# browser67

[![CI](https://github.com/bigKING67/browser67/actions/workflows/ci.yml/badge.svg)](https://github.com/bigKING67/browser67/actions/workflows/ci.yml)

browser67 is an evidence-first real-browser runtime for AI agents. It connects
Codex, Pi, and other MCP clients to a user's existing Chrome or Edge profile
through a local extension and hub, while keeping browser ownership, tab
lifecycle, transport identity, and fallback policy explicit.

The project exposes two MCP surfaces:

- `tmwd_browser` for real-browser automation, managed tabs, auth-aware flows,
  screenshots, downloads, bounded console observation, native-input fallback,
  and durable run evidence.
- `js-reverse` for script discovery, request tracing, hooks, frame-aware
  analysis, evidence recording, and rebuild bundles on the same browser runtime.

`browser67` is the canonical project, package, CLI, and Skill name. `tmwd` remains
the underlying transport/protocol name. The retired `tmwd-browser-mcp` identity
is retained only where existing CLI, runtime-home, or launchd installations need
migration compatibility.

## Why browser67

Most browser automation starts a clean browser or silently changes transport
when the preferred path fails. That is unsafe for login-state work: a fallback
may point at a different profile, tab, or account while still returning a
technically successful result.

browser67 instead provides:

- **Real-profile operation.** Use the Chrome/Edge profile that already owns the
  required session, with no direct access to browser password stores.
- **Fail-closed routing.** The default TMWD path never silently becomes remote
  CDP. Missing or ambiguous Browser Instances return explicit errors.
- **Managed ownership.** Agent-created tabs are owned and finalized by task;
  user tabs remain read-only until explicitly inspected and adopted.
- **Observable identity.** Doctor output binds the live extension service
  worker to a deterministic build revision, source digest, package version, and
  protocol revision.
- **Bounded evidence.** Compact outcomes, snapshots, network observations,
  screenshots, run logs, and job checkpoints have explicit size and retention
  policies.
- **One runtime, separate concerns.** Browser automation and JS reverse share
  transport and lifecycle state without collapsing into one tool monolith.

## Capabilities

| Area | What browser67 provides |
| --- | --- |
| Browser routing | Opaque Browser Instance selection, explicit defaults, and `(browser_instance_id, tab_id)` target identity |
| Page operation | Scan, structured extraction, semantic diff, bounded JavaScript execution, and condition-based waits |
| Lifecycle | Managed-tab creation/reuse, explicit user-tab adoption, lease suspension, scoped finalization, and guarded close |
| Auth-aware flows | Login-profile metadata, manual-required CAPTCHA/MFA/SSO/OAuth states, resume, and redacted outcomes |
| Network and files | Request observation, downloads, upload/file-chooser planning, clipboard wrappers, screenshots, and evidence bundles |
| Diagnostics | Non-persistent managed-tab console/API/exception observation with hard duration, entry-count, and character budgets |
| Durable work | Run directories, append-only events, checkpointed jobs, restart recovery, cancellation metadata, and cleanup budgets |
| JS reverse | Script/frame discovery, request initiators, hooks, network/WS sampling, evidence records, and rebuild bundles |
| Native fallback | Explicit platform diagnostics and guarded last-mile pointer/keyboard execution when browser-side automation is insufficient |
| Governance | Executable contracts, dependency/structure/performance gates, upstream review locks, and tiered verification |

All MCP results use the `browser67.tool-outcome.v3` envelope. Every browser tool
accepts `output_mode:"compact"|"full"`; compact mode reduces repeated transport
diagnostics without changing the requested content scope.

## Architecture

```text
Agent / MCP client
  |-- tmwd_browser ---------------------- browser automation surface
  |-- js-reverse ------------------------ reverse-analysis surface
  |
  +--> browser67 MCP runtime
         |-- managed-tab and Browser Instance policy
         |-- auth, jobs, runs, evidence, downloads, native fallback
         |-- transport health and fail-closed routing
         |
         +--> local hub
                |-- WebSocket: ws://127.0.0.1:18765
                |-- HTTP Link: http://127.0.0.1:18766/link
                |
                +--> Chrome/Edge unpacked extension
                       +--> selected real browser profile and tabs
```

The browser MCP owns session, scheduler, store, and lifecycle composition. The
extension owns the profile-local bridge and managed-tab overlay. Ordinary tabs
receive no browser67 badge, CSP override, dialog override, content bridge, or
network observer until managed policy is explicitly applied.

See [Architecture](docs/architecture.md) and
[Project structure](docs/project-structure.md) for module boundaries.

## Quick start

### Prerequisites

- Node.js 20 or 22.
- Chrome or Edge with permission to load an unpacked extension.
- A local agent client that supports MCP when using the tool servers.

### Install and prepare

```bash
git clone https://github.com/bigKING67/browser67.git
cd browser67
npm ci
npm run setup
```

`npm run setup` builds an install copy under the active browser67 home, normally
`~/.browser67/browser/tmwd_cdp_bridge/`, and writes local MCP registry entries.
It does not edit the browser for you. On first installation, open
`chrome://extensions` or `edge://extensions`, enable Developer Mode, and load
that exact directory as an unpacked extension.

Start the local hub and verify the live route:

```bash
npm run hub:start
npm run check:live:doctor
npm run check:live
```

A ready TMWD route requires the hub, a connected extension, and a live extension
identity that matches the current source build. Disk-current extension files
alone are not live service-worker proof.

The live gate applies a 60-second supervisor deadline to its child contract so
a stuck native window transition or shutdown cannot wait indefinitely. Override
it only for a deliberately slower host with
`npm run check:live -- --live-process-timeout-ms <milliseconds>`; a deadline
failure is reported as `stage:"live_timeout"` and does not claim fixture
cleanup succeeded.

Detailed install, reload, launchd, migration, and cleanup procedures are in
[Runtime operations](docs/runtime-operations.md).

## Agent integration

The canonical MCP entrypoints are:

```text
src/mcp/browser/server.mjs
src/mcp/js-reverse/server.mjs
```

The canonical installable Skills are:

```text
skills/browser67
skills/js-reverse
```

For Pi-67, use the explicit external-repository lifecycle:

```bash
pi-67 external install browser67
pi-67 external update browser67
pi-67 external doctor browser67 --deep
```

For direct upstream Pi package use outside Pi-67, pin a tag or commit so that
package checkout remains reproducible:

```bash
pi install git:github.com/bigKING67/browser67@<tag-or-commit>
```

MCP config remains an agent-local concern. Editing this repository does not
automatically update active Skill copies or a running agent session. Use
[Agent setup](docs/agent-setup.md) for MCP configuration and Skill installation,
and [Codex integration](docs/codex-integration.md) for tool routing, adoption,
auth, CAPTCHA, download, screenshot, and Browser Instance contracts.

## Operating model

### Real browser by default

Use `tmwd_mode=tmwd` for logged-in Chrome/Edge work. `tmwd_transport=auto` may
choose between the local WebSocket and HTTP Link transports, but it does not
authorize a different browser runtime.

Use `tmwd_mode=remote_cdp` only for an explicitly controlled debug browser, CI,
or protocol-level JS reverse work that needs the Chrome Debugger/Network/Script
source surface. A failed real-profile route must not silently fall back to it.

### Browser Instance routing

Each Chrome/Edge profile runs a separate extension service worker and receives
an opaque Browser Instance ID. With multiple active instances, callers select
one explicitly or configure a default. Ambiguity returns `AMBIGUOUS_TARGET`;
an unavailable explicit/default instance returns `BROWSER_INSTANCE_UNAVAILABLE`.

### Managed and user tabs

Active tasks should create or reuse a browser67-owned tab through
`browser_tab_lifecycle`. A user-opened tab is read-only by default. Operating on
that exact page requires `inspect_adoption` followed by `adopt_existing`;
`finalize_task` releases an adopted tab without closing the user's page.

New browser67-owned tabs default to `window_policy:"dedicated"` and
`focus_policy:"background_preferred"`: they run in a profile-local browser67
Agent window created with `focused:false`, so ordinary navigation, extraction,
waits, and scripts do not replace the user's active tab. This is still the same
Chrome/Edge Profile and therefore keeps the same approved login/session state;
it is not a second Profile or incognito context. `window_policy:"current"`
fails closed for new agent-created work; exact user tabs require the explicit
adoption flow. `focus_policy:"foreground"` requires
`confirm_foreground:true` and is only for an intentional visible handoff. On
macOS, that explicit foreground handoff also activates the
exact browser67-owned tab through the native Chromium window bridge so its Full
Screen Space becomes visible; extension focus alone is not treated as proof of
Space visibility. CAPTCHA and native input use a bounded focus lease and restore
the prior browser tab only when browser67 can prove that the user did not change
focus during the lease. Concurrent leases are rejected. If the user manually
moves an Agent tab into another window, browser67 excludes it from dedicated
reuse and never moves it back.

Managed listings return a privacy-safe summary by default, and each task scope
is capped at eight open `keep:false` tabs to stop runaway tab accumulation.
`finalize_task` closes/release only the exact managed scope and also terminalizes
its unfinished structured runs. Chrome debugger indicators remain scoped to the
whole Browser Profile; a separate Browser Instance/Profile is required to keep
that Chrome UI out of ordinary user windows.

The dedicated window uses a platform-native, toolbar-preserving presentation:
on macOS it enters its own native Full Screen Space, while Windows uses the
ordinary maximized window state. browser67 never requests Chrome's immersive
`fullscreen` window state for this purpose, because that hides the tab and
address-bar UI. The one-time macOS transition targets the exact Agent anchor
tab and restores the previously focused browser tab or application when it can
do so safely.

Normal task finalization keeps the reusable Agent window. Automated live and
release fixtures opt into `cleanup_created_agent_window:true`: cleanup succeeds
only when the scoped fixture created that exact window and the extension proves
that either its anchor is the sole remaining tab, or that the same Profile
browser-start epoch removed or replaced that exact anchor and Chrome left one
internal New Tab page, including an in-place URL replacement that keeps the same
tab ID. The epoch persists across service-worker and extension reloads, then
rotates on the next browser Profile startup. The latter state is recovered
automatically from a bounded ownership tombstone. A reused window,
identity/epoch mismatch, unowned New Tab window, or any user/content tab is
preserved. Retirement removes only the exact internal anchor/New Tab; the
window closes naturally only when that was still its last tab. A user tab that
arrives after inspection keeps the window open and has its ownership record
released, so fixture cleanup cannot close a user page through an inspection-to-
close race. If Chrome immediately replaces the removed last tab with another
browser-generated New Tab, browser67 follows that internal successor for a
bounded number of exact removals. An unresolved replacement keeps its ownership
tombstone for later recovery instead of becoming an unowned New Tab window.

User navigation, extension reconnection, or lease-generation changes suspend an
adopted tab. Re-inspect and re-adopt rather than mutating a target whose identity
may have changed.

### Local state and privacy

Runtime state lives outside the repository under `~/.browser67/` by default.
Treat browser profile data, auth metadata, screenshots, network evidence, and
reverse artifacts as sensitive local state. Do not commit `extension/config.js`,
cookies, tokens, HAR/PCAP files, or runtime directories.
The runtime tool journal stores only operation identity, status/error code,
duration, transport, and bounded counts under
`~/.browser67/runtime/tool-events.ndjson`; it excludes URLs, scripts, form
inputs, page content, cookies, and credentials. It is mode `0600`, rotates at
8 MiB, and retains one bounded backup.

## Documentation

| Document | Scope |
| --- | --- |
| [Runtime operations](docs/runtime-operations.md) | Extension install/reload, hub control, launchd, runtime home, migration, and artifact cleanup |
| [Agent setup](docs/agent-setup.md) | MCP configuration, Skill roots, active-copy boundaries, and agent readiness |
| [Codex integration](docs/codex-integration.md) | Tool routing, Browser Instances, managed/adopted tabs, auth, files, screenshots, and finalization |
| [Architecture](docs/architecture.md) | Runtime ownership, transports, safety model, and maintenance boundaries |
| [TMWebDriver SOP](docs/TMWebDriver-SOP.md) | TMWD execution guidance and protocol-oriented workflows |
| [JS reverse SOP](docs/js-reverse-SOP.md) | Reverse-analysis workflow and evidence boundaries |
| [Maintenance quality model](docs/maintenance-quality-model.md) | Complete deterministic, live, platform, upstream, and optional-proof gate inventory |
| [Release governance](docs/release-governance.md) | Clean/synced/upstream requirements and explicit commit, push, tag, and publish boundaries |
| [Naming and compatibility](docs/naming-and-compatibility.md) | Canonical browser67 names and bounded legacy aliases |
| [GenericAgent upstream review](docs/upstream/genericagent/README.md) | Audit SOP, reviewed commit, selective-absorption policy, and preserved local features |

## Development and verification

Run the deterministic repository gate for ordinary changes:

```bash
npm run check
```

Run the documentation contract directly when changing the landing page or its
navigation:

```bash
npm run check:readme
```

Run the release-grade local verification chain when the relevant live browser
environment is available:

```bash
npm run verify
```

Release readiness is intentionally separate from publishing:

```bash
npm run check:release-readiness
npm run release:ready
```

`npm run release:ready` requires a clean, origin-synced checkout and current
upstream evidence. It does not commit, push, tag, create a GitHub Release, or
publish a package. Those external actions require an explicit operator decision.
See [Release governance](docs/release-governance.md).

The verification manifest also exposes CI, live, platform, and all tiers. The
complete command inventory and evidence boundaries live in
[Maintenance quality model](docs/maintenance-quality-model.md), not in this
landing page.

## Compatibility

- Supported Node.js versions in CI: 20 and 22.
- Deterministic contracts run on Linux, Windows, and macOS.
- The real-profile path targets Chrome and Edge through the unpacked extension.
- Shared CI validates an isolated remote-CDP fixture; it does not access a
  user's real browser profile.
- Legacy `tmwd-browser-mcp` and `tmwd-browser` CLI/runtime identifiers are
  migration shims, not alternate canonical products or Skills.
- `UPSTREAM.lock.json` pins the extension sync baseline. A newer
  `UPSTREAM.review.json` may intentionally record reviewed divergence without
  changing that byte lock.

## License

browser67 is released under the [MIT License](LICENSE). Vendored or adapted
third-party material retains its own attribution and license notice in
[Third-party notices](THIRD_PARTY_NOTICES.md).

## Acknowledgements

browser67 builds on the TMWebDriver protocol and Chrome/Edge extension from
[lsdefine/GenericAgent](https://github.com/lsdefine/GenericAgent). Thanks to
lsdefine and the GenericAgent contributors for the original work.

browser67 maintains an audited fork with its own managed-tab, Browser Instance,
lifecycle, identity, and safety model. See
[Third-party notices](THIRD_PARTY_NOTICES.md),
[upstream extension lock](UPSTREAM.lock.json), and
[upstream review ledger](UPSTREAM.review.json) for provenance and review status.
