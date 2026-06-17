# tmwd-browser-mcp

Standalone TMWD browser MCP server for real Chrome/Edge profile automation.
This repository is published as `browser67` for agents that need both real
browser automation and TMWD-backed JavaScript reverse-engineering tools.

This project extracts the `browser-structured-mcp` path from `grobot`, keeps the
GenericAgent/TMWebDriver extension protocol aligned, and adds a focused runtime
for Codex, grobot, and JS reverse workflows.

## What this project owns

- MCP tools:
  - `browser_scan`
  - `browser_execute_js`
  - `browser_extract`
  - `browser_diff`
  - `browser_tab_ops`
  - `browser_file_ops`
  - `browser_download_ops`
  - `browser_tab_lifecycle`
  - `browser_auth_ops`
  - `browser_clipboard_ops`
  - `browser_native_input`
- JS reverse MCP server:
  - `check_browser_health`
  - `list_scripts` / `search_in_scripts`
  - `list_network_requests` / `get_request_initiator`
  - `create_hook` / `inject_hook` / `get_hook_data`
  - `record_reverse_evidence` / `export_rebuild_bundle`
- Local TMWD hub:
  - WebSocket endpoint: `ws://127.0.0.1:18765`
  - HTTP link endpoint: `http://127.0.0.1:18766/link`
- Unpacked Chrome/Edge extension source in `extension/`
- Native input fallback for blocked browser-side automation
- Doctor/live-gate contracts for reproducible readiness checks
- JS reverse docs and skill material under `docs/js-reverse/` and `skills/js-reverse/`
- Auth/profile lifecycle modules under `src/auth/`:
  profile storage, login/manual-required detection, DOM submit/wait logic, and
  MCP action handlers are kept separate so login behavior can evolve without a
  single long-lived auth file becoming the maintenance bottleneck. Handler
  orchestration lives under `src/auth/handlers/` and is split by action family
  (`ensure-login`, profile actions, CAPTCHA actions, registry/shared helpers).
- MCP tool JSON schemas under `src/tool-schemas/`, grouped by tool family and
  re-exported through `src/tool-schemas.mjs` to keep the public server import
  stable while avoiding a schema monolith.
- Browser tool wrappers under `src/browser-wrappers/`, grouped by execution
  surface (`file-ops`, `download-ops`, `tab-lifecycle`, `clipboard-ops`, shared
  runtime helpers) and re-exported through `src/browser-wrappers.mjs` to keep
  existing imports stable while removing the previous wrapper monolith.
- JS reverse server internals under `src/js-reverse-server/`, grouped by MCP
  tool schemas, shared utilities, TMWD adapter, managed-tab lifecycle,
  script-source discovery, and injected runtime code. `src/js-reverse-server.mjs`
  remains the executable MCP entrypoint while the long-lived implementation
  details stay modular.

## Why TMWD first

TMWD controls the user's real browser through an extension and local hub. It keeps
existing tabs, cookies, and login state. This is different from remote-debugging
CDP (`http://127.0.0.1:9222`), which can point to a separate debug browser with
no user session.

For Codex and real-profile tasks, default to:

```text
tmwd_mode=tmwd
tmwd_transport=auto
```

Use `tmwd_mode=remote_cdp` only for explicit debug Chrome, CI, or deep JS reverse
work that needs Network/Debugger/Script source.

## Install dependencies

```bash
git clone https://github.com/bigKING67/browser67.git
cd browser67
npm ci
```

For an existing checkout:

```bash
npm install
```

## Prepare extension

```bash
npm run setup
```

Default extension target:

```text
~/.tmwd-browser-mcp/browser/tmwd_cdp_bridge/
```

`npm run setup` also writes local registry entries for both
`tmwd-browser-mcp` and `js-reverse` into
`~/.tmwd-browser-mcp/mcp/servers.toml` unless `--skip-registry` is passed.

For manual Chrome extension loading from this repository, prepare the
project-local runtime copy:

```bash
npm run setup:local-extension
```

Then load exactly this directory, not its parent:

```text
/path/to/browser67/runtime/chrome-extension/tmwd_cdp_bridge/
```

Then open `chrome://extensions`, enable Developer Mode, and load that directory
as an unpacked extension. After every extension source update, reload the
extension and refresh old target tabs so content scripts are reinjected.

## Start and diagnose

```bash
npm run hub:start
npm run doctor
```

Useful machine-readable variants:

```bash
npm run doctor:json
npm run check:live:doctor
```

## Run MCP server

```bash
npm run server
```

Codex config should point directly at:

```text
/path/to/browser67/src/server.mjs
```

Run the TMWD-backed JS reverse MCP server with:

```bash
npm run js-reverse:server
```

Codex `js-reverse` config should point directly at:

```text
/path/to/browser67/src/js-reverse-server.mjs
```

## Agent prompts and configs

This repository includes the runtime, MCP config examples, skills, and prompt
material needed by other agents:

- `docs/codex-integration.md`: full `tmwd_browser` and `js-reverse` MCP config.
- `docs/global-prompt-snippet.md`: copy-ready global prompt section for page
  and browser operations.
- `docs/js-reverse-SOP.md`: explicit js-reverse SOP entrypoint and reference
  map for agents/users searching by SOP.
- `AGENTS.md`: project-level operating rules for agents working inside this
  repository.
- `skills/tmwd-browser-mcp/`: skill/playbook for real-browser TMWD tasks.
- `skills/js-reverse/`: skill/playbook for JavaScript reverse-engineering tasks.
- `agents/openai.yaml` and `skills/js-reverse/agents/openai.yaml`: portable
  agent metadata/prompts for agent systems that consume YAML descriptors.
- `docs/agent-setup.md`: setup guide for copying the prompts/skills into another
  agent environment.

Do not replace another user's global prompt blindly. Merge the routing and
security rules from `docs/agent-setup.md` into that agent's own global/project
instructions.

## Login profile lifecycle

`browser_auth_ops` handles opt-in, exact-origin login profiles for managed tabs:

- `ensure_login` first inspects the selected TMWD tab. If it is already logged
  in, it returns `already_authenticated:true` and does not resubmit a form.
- If the tab is on a login page, credentials are used only when the current
  origin exactly matches a repo-external local profile.
- Unknown origins return `status:"blocked"` and are never auto-filled with a
  guessed or unrelated profile.
- First-time site onboarding is explicit: call `suggest_profile`, then
  `upsert_profile(confirm_write:true)` with the user-provided credentials.

Profiles live outside the repository by default:

```text
~/.codex/secrets/tmwd-login-profiles/
```

Profile scans are deterministic by filename and bounded to avoid unbounded
secret-directory work in long-lived agent sessions.

Each saved profile can have a non-secret lifecycle sidecar:

```text
<profile>.env -> <profile>.meta.json
```

The sidecar records timestamps, last status/reason, and last origin/path only.
It never stores usernames, passwords, cookies, tokens, or browser session data.
CAPTCHA, MFA, SSO-only, and OAuth popup flows are reported as
`manual_required_*` and block automatic submission/continuation. These blocked
states include a non-secret `manual_context` with the manual flow kind and
`resume_action:"ensure_login"`; it is a handoff hint, not a credential/session
container. CAPTCHA contexts may include a `captcha_kind` and `captcha_assist`
policy. The default policy is human/manual or native physical input only:
bring the managed tab to the foreground, use window-scoped screenshots if
vision is needed, and avoid JS/CDP clicks on CAPTCHA widgets, token/cookie
extraction, fullscreen screenshots, and rapid retries.

For CAPTCHA diagnostics, `browser_auth_ops.plan_captcha_assist` is a dry-run
planner. It inspects the selected tab, returns non-secret challenge metadata,
candidate DOM client rectangles, viewport coordinates, native input capability
status, physical-input provider selection (`native-os` plus guarded `ljq-ctrl`
metadata/execution bridge), `coordinate_transform` screen-pixel estimates, a window/region
`vision_correction_plan`, and a replay plan without clicking or taking
screenshots. Set `run_vision_correction:true` to capture only the planned
browser viewport/region via CDP, write a bounded temporary PNG artifact under
the OS temp directory, and return first-pass corrected slider or checkbox
coordinates with a confidence gate. Checkbox-style widgets also expose a
left-biased `checkbox_click_hint` so physical clicks target the visible checkbox
hotspot instead of the center of the whole Turnstile/hCaptcha-style widget. The
artifact metadata includes path, sha256, dimensions, clip, TTL,
`fullscreen:false`, and the actual CDP capture clip when scroll offset had to be
applied, but never base64 image data. Same-origin iframe targets are
reported with top-viewport coordinates plus a `frame_path`. Cross-origin
captcha-like iframes are degraded safely: the planner returns the iframe
bounding rect, a clipped screenshot plan, `degraded_mode:true`, and
`manual_handoff_required:true`; `assist_captcha` blocks with
`cross_origin_frame_handoff_required` instead of sending a click/drag. The
estimates are explicitly not safe for unattended execution:
browser chrome, OS scaling, iframe nesting, DPR, and multi-monitor placement can
shift final physical pixels.
`browser_auth_ops.assist_captcha` is the guarded execution entry: it requires a
TMWD-owned managed `tab_id`, `confirm_physical_input:true`, and either
caller-supplied screen coordinates, `auto_screen_coordinates:true` plus
`confirm_auto_coordinates:true`, or `use_vision_corrected_coordinates:true` plus
`confirm_corrected_coordinates:true`. It uses TMWD `tabs.switch` to foreground the
managed tab/window before physical provider input; `window_title`, `window_pid`,
and `window_active_confirmed:true` are fallbacks for unusual window-manager
cases. `physical_input_provider:"auto"` prefers `ljq-ctrl` once it becomes
executable and otherwise selects `native-os`; the `ljq-ctrl` provider is
diagnostic/planning metadata by default and only executes through its guarded
bridge when explicitly enabled. Run `npm run check:ljqctrl` to probe the local
Python `ljqCtrl` import and report click/capture capability without moving the
mouse or taking screenshots. The doctor includes a compact
`python_candidates` matrix so a connected driver can be mapped to the right
interpreter. Set `TMWD_LJQCTRL_PYTHON=/path/to/python` for one explicit
interpreter, or `TMWD_LJQCTRL_PYTHON_CANDIDATES` for a system path-delimited
candidate list when the module is installed outside the default Python path;
`TMWD_LJQCTRL_EXECUTE=1` is required before the guarded bridge can use
`ljqCtrl.Click` or clipped window-region capture. For slider
CAPTCHA, planning returns a viewport-space drag hint and estimated screen
start/end coordinates; execution also requires destination coordinates
(explicit or estimated) plus physical `drag` capability. If those gates are
missing, it hands off instead of guessing. Checkbox-style CAPTCHA planning
returns a left-biased click hint and can use vision-corrected coordinates for
the visible checkbox hotspot. The optional local physical live gate keeps real
input opt-in and now uses a bounded local-fixture retry path:
`TMWD_CAPTCHA_ASSIST_MAX_ATTEMPTS` is clamped to 1-3, retry attempts are slower,
wait at least 5 seconds between attempts via `assist_captcha`, and can be tuned
with `TMWD_CAPTCHA_ASSIST_PRE_INPUT_SETTLE_MS`,
`TMWD_CAPTCHA_ASSIST_DRAG_OVERSHOOT_X`, `*_OFFSET_X/Y`, or exact
`TMWD_CAPTCHA_ASSIST_DRAG_FROM_X/Y` and `TMWD_CAPTCHA_ASSIST_DRAG_TO_X/Y`
screen coordinates. These knobs are for the local proof fixture only; real
site challenges still use explicit confirmation and manual handoff boundaries.

## Quality gates

```bash
npm run verify
npm run check:syntax
npm run check:change-set
npm run plan:scoped-commits
npm run check:readiness
npm run check
npm run check:live:doctor
npm run check:auth-live
npm run check:captcha-assist-live
npm run check:captcha-assist-physical-live
npm run check:native-pointer
npm run check:ljqctrl
npm run check:optional-live-proofs
npm run plan:optional-live-proofs
npm run proof:optional-live-status
npm run proof:optional-live-template
npm run proof:optional-live-record
npm run check:js-reverse-mcp
npm run check:js-reverse-live
```

`npm run check` runs deterministic MCP/schema/hub-control contracts. `check:live:*`
uses the current local browser environment and can fail when the extension or hub
is not connected. `check:captcha-assist-live` is planning-only by default and now
also validates region-only screenshot artifact creation, scroll-adjusted CDP
clips, same-origin iframe coordinate conversion, first-pass slider vision
and checkbox vision correction, synthetic slider visual movement, and cross-origin iframe
degraded/manual handoff behavior.
`check:captcha-assist-physical-live` is the optional hard physical gate. It is
skipped by default and only runs the local physical slider drag plus checkbox
click fixtures when both
`TMWD_CAPTCHA_ASSIST_PHYSICAL=1` and `TMWD_CAPTCHA_ASSIST_CONFIRM=1` are set;
use `TMWD_CAPTCHA_ASSIST_REQUIRE_PHYSICAL=1` when a local machine gate should
fail instead of skip. Skipped/blocked default paths explicitly report
`physical_input_executed:false` and `pointer_moved:false` plus the exact
`physical_gate_command`, so operator UIs must not present them as real drags.
Before opening the GUI fixture or creating a managed tab, the wrapper now runs
the same native pointer preflight as
`npm run check:native-pointer`; if click/drag requirements are missing, it
returns a structured skipped/blocked result without foregrounding Chrome or
attempting physical input. The physical branch foregrounds its own TMWD-managed
fixture tab before dragging/clicking only after that preflight passes. Native pointer
actions must be genuinely available: run `npm run check:native-pointer` first to
verify whether the current OS provider can actually click/drag without moving
the mouse. On macOS, `cliclick` is treated as pointer-capable only when its
diagnostic probe does not report missing Accessibility privileges for the
current terminal/Codex host. When the physical branch passes, it asserts both
the slider completion/visible movement (`slider_visual_offset` /
`handle_transform`) and checkbox inside-hotspot completion, then writes a
sanitized repo-external proof under
`~/.tmwd-browser-mcp/optional-live-proofs`
or `TMWD_OPTIONAL_PROOF_DIR`; set `TMWD_CAPTCHA_ASSIST_WRITE_PROOF=0` to disable
that proof write, or `TMWD_CAPTCHA_ASSIST_REQUIRE_PROOF=1` to make proof-write
failure fail the gate.
`check:native-pointer` is diagnostic-only by default and exits successfully when
requirements are missing; use `npm run check:native-pointer -- --require-pointer`
only as a local hard gate after installing OS dependencies and granting the
required permissions. On macOS, when `cliclick` is installed but Accessibility
permission is missing, the report includes a `permission_recovery` plan with the
System Settings path, a copyable `open` command, explicit verification command,
and the physical CAPTCHA gate command to run only after pointer readiness passes.
`check:ljqctrl` is diagnostic-only by default: it probes the local Python
`ljqCtrl` module and reports whether click/window-region capture would be
available, but it does not activate windows, click, drag, capture screenshots,
or access clipboard. Use `TMWD_LJQCTRL_REQUIRE=1`,
`TMWD_LJQCTRL_REQUIRE_EXECUTE=1`, or `TMWD_LJQCTRL_REQUIRE_CAPTURE=1` only for a
machine-local hard gate.
`check:optional-live-proofs` validates sanitized JSON proof artifacts under
`~/.tmwd-browser-mcp/optional-live-proofs` or `TMWD_OPTIONAL_PROOF_DIR`. It is
non-blocking by default and exists for optional local CAPTCHA physical proof,
cross-OS native-input proof, and approved external IdP live coverage; use
`--strict` only when a local release gate should require every optional proof.
Use `plan:optional-live-proofs` to print the current proof collection runbook:
per-proof status, required host/platform, safe commands, blockers, and evidence
requirements. The plan also surfaces accepted proof freshness
(`expires_at`/`expires_in_days`), `next_command`, `collection_steps`, and
`commands.record_replace` so agents can continue from readiness gaps without
recomputing the collection path. Add `--id <proof-id>` to print a single-proof
handoff packet for one Linux/Windows/IdP operator. Use
`proof:optional-live-status` for the
operator-facing summary: accepted proofs, missing checklist, owner/host, next
command, record/write commands, validation command, optional `--id <proof-id>`
filtering, and the non-negotiable
completion policy. Use `proof:optional-live-template` to generate safe
`ok:false` starter templates before recording real external proofs. Use
`proof:optional-live-record -- --id <proof-id> --from-json <sanitized.json>` to
dry-run validate a collected proof without writing it; its output includes a
`redaction_checklist` and rejects obvious Bearer/JWT/cookie-like values plus
unredacted IdP tenant/account/provider identifiers. Add `--write` to persist the
canonical proof under the repo-external proof directory, and `--replace` only
for an intentional audited refresh of an existing proof. See
`docs/optional-live-proofs.md`.

`npm run check:change-set` is a read-only review hygiene gate for large refactors.
It groups the current `git status --porcelain` paths by architecture area and
fails only when a changed path has no review/commit bucket. Use it before
splitting scoped commits; it does not stage, commit, delete, or rewrite files.
`npm run plan:scoped-commits` uses the same grouping contract to print a dry-run
commit plan with exact `git add <paths...>` commands, suggested commit messages,
risk notes, and per-slice verification commands. It is also plan-only and never
stages files.
`npm run check:readiness` turns the near-100 quality target into a deterministic
readiness audit: it verifies required governance/docs/skill gates, reports a
score, and lists optional hardening gaps such as pending scoped commits,
unconfigured or invalid `ljqCtrl`, unavailable native pointer actions, local
physical CAPTCHA proof states, cross-OS native live proof, and provider-specific
OAuth/SSO/MFA live gates. The
`ljqCtrl` readiness row is platform-aware and based on the same diagnostic-only
Python capability probe as `npm run check:ljqctrl`, not just the presence of
environment variables. The bundled GenericAgent `ljqCtrl` implementation is
Windows-oriented; on non-Windows hosts, default absence is informational while
explicitly configured interpreters are still validated and can fail as invalid.
An importable driver becomes an informational execution-gated row until
`TMWD_LJQCTRL_EXECUTE=1` is explicitly supplied. The local auth smoke
already covers OAuth popup, SSO, and MFA manual handoff/resume fixtures; the
remaining IdP gap is explicitly about approved external provider coverage. The
readiness audit also consumes `check:optional-live-proofs` results so collected
local physical/cross-OS/provider evidence can remove those optional gaps without
storing secrets in the repository. Accepted proof evidence includes expiry
freshness when available, so readiness output can show when a physical or IdP
proof needs refresh. When local CAPTCHA proof is missing, it distinguishes
"native pointer is not ready", "physical gate was not run", and "physical gate
appears runnable but no accepted proof was persisted". If macOS Accessibility
blocks `cliclick`, the native-pointer and CAPTCHA-blocked JSON gaps also carry
the same structured `permission_recovery` plan exposed by `check:native-pointer`,
so callers can render the exact Settings path and copyable recovery commands
without a second probe. Optional proof gaps also include a compact `proof_plan`
pointer with `npm run plan:optional-live-proofs -- --json`, the active proof
directory, and the missing proof ids, so callers can render the next collection
command without recomputing the audit. It is read-only; use `--strict` when a
local release gate should fail on optional gaps too.

`npm run verify` is the local full gate for maintenance changes. It checks
GenericAgent extension alignment, upstream provenance, JS reverse docs/skill sync,
all `.mjs` syntax, change-set grouping, readiness scoring, deterministic
contracts, live doctor readiness, JS reverse live readiness, auth-profile
onboarding/lifecycle/live smoke (including manual CAPTCHA, MFA, SSO, and OAuth
popup resume paths), diagnostic-only `ljqCtrl` probing, and npm audit.
It also runs the optional proof audit in non-blocking mode so missing external
proofs stay visible in the full local gate, prints the optional proof collection
plan, and prints the operator status checklist. For managed-tab hygiene, `verify`
captures a temporary baseline before live checks and then fails only on newly
leaked unkept records; `npm run check:managed-tabs-clean` remains the strict
global audit for all currently registered TMWD workspaces.

## Source alignment

Primary upstream references:

- `lsdefine/GenericAgent/TMWebDriver.py`
- `lsdefine/GenericAgent/assets/tmwd_cdp_bridge/*`
- `lsdefine/GenericAgent/memory/tmwebdriver_sop.md`
- `lsdefine/GenericAgent/memory/ljqCtrl_sop.md`

The `extension/` directory is intentionally sourced from the latest GenericAgent
extension, including `tabs.create` and `contentSettings` bridge commands.

To check or resync against the local GenericAgent checkout:

```bash
npm run upstream:check
npm run extension:check
npm run extension:sync
npm run upstream:lock
```

Default upstream path:

```text
../GenericAgent/assets/tmwd_cdp_bridge
```

Use `node scripts/sync-genericagent-extension.mjs --source <path>` when your
GenericAgent checkout lives somewhere else.

`extension/config.js` is intentionally not committed. `npm run setup` writes an
install-local `config.js` with a per-install TID into
`~/.tmwd-browser-mcp/browser/tmwd_cdp_bridge/`.

`UPSTREAM.lock.json` records the exact GenericAgent commit and extension file
hashes used by this project. After intentionally updating GenericAgent and
running `npm run extension:sync`, refresh the lock with `npm run upstream:lock`.

## User-level launchd service

Install TMWD hub as a user LaunchAgent:

```bash
npm run launchd:install
```

This writes:

```text
~/Library/LaunchAgents/com.browser67.tmwd-browser-mcp.plist
```

and runs the hub from:

```text
/path/to/browser67/src/tmwd-hub.mjs
```

If you previously installed an older pre-browser67 LaunchAgent, stop or
uninstall that old service before installing this one so only one hub claims the
default ports.

Uninstall:

```bash
npm run launchd:uninstall
```

## Runtime paths

Default runtime home:

```text
~/.tmwd-browser-mcp/
```

Important subpaths:

```text
~/.tmwd-browser-mcp/browser/tmwd_cdp_bridge/
~/.tmwd-browser-mcp/runtime/tmwd-hub-state.json
~/.tmwd-browser-mcp/runtime/browser-live-gate-events.jsonl
~/.tmwd-browser-mcp/mcp/servers.toml
```

Override with:

```bash
TMWD_BROWSER_MCP_HOME=/custom/path
```
