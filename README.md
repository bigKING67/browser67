# browser67

browser67 is a real-browser agent runtime for Chrome/Edge automation,
browser67-backed JavaScript reverse workflows, evidence-first browser
operations, and long-term agent tooling. The current real-browser
transport/protocol is TMWD.

The old `tmwd-browser-mcp` name is now a compatibility alias for the
`tmwd_browser` MCP surface and legacy package/bin/runtime paths. New docs,
commands, and project identity use `browser67`. The repo keeps the
GenericAgent/TMWebDriver extension protocol aligned, but browser67 owns its own
runtime, contracts, skills, docs, and agent integration surface.

## What this project owns

- `tmwd_browser` MCP tools:
  - `browser_scan`
  - `browser_execute_js`
  - `browser_wait`
  - `browser_transport_health`
  - `browser_run_ops`
  - `browser_job_ops`
  - `browser_extract`
  - `browser_diff`
  - `browser_tab_ops`
  - `browser_file_ops`
  - `browser_download_ops`
  - `browser_tab_lifecycle`
  - `browser_auth_ops`
  - `browser_clipboard_ops`
  - `browser_native_input`
- `js-reverse` MCP server:
  - `check_browser_health`
  - `list_scripts` / `search_in_scripts`
  - `list_frames`
  - `list_network_requests` / `get_request_initiator`
  - `create_hook` / `inject_hook` / `get_hook_data`
  - `record_reverse_evidence` / `export_rebuild_bundle`
- Local browser67 hub for the TMWD transport:
  - WebSocket endpoint: `ws://127.0.0.1:18765`
  - HTTP link endpoint: `http://127.0.0.1:18766/link`
- Unpacked Chrome/Edge extension source in `extension/`
- Native input fallback for blocked browser-side automation
- Doctor/live-gate contracts for reproducible readiness checks
- JS reverse docs and skill material under `docs/js-reverse/` and `skills/js-reverse/`
- Canonical naming, compatibility, runtime-home, and quality-governance docs:
  `docs/naming-and-compatibility.md`, `docs/migration-browser67.md`,
  `docs/migration-v0.3.md`, `docs/project-structure.md`, and
  `docs/maintenance-quality-model.md`
- Auth/profile lifecycle modules under `src/auth/`:
  profile storage, login/manual-required detection, DOM submit/wait logic, and
  MCP action handlers are kept separate so login behavior can evolve without a
  single long-lived auth file becoming the maintenance bottleneck. Handler
  orchestration lives under `src/auth/handlers/` and is split by action family
  (`ensure-login`, profile actions, CAPTCHA actions, registry/shared helpers).
- MCP tool JSON schemas under `src/tool-schemas/`, grouped by tool family and
  exported through `src/tool-schemas/index.mjs` as the public server import
  stable while avoiding a schema monolith.
- Browser tool wrappers under `src/browser-wrappers/`, grouped by execution
  surface (`file-ops`, `download-ops`, `tab-lifecycle`, `clipboard-ops`, shared
  runtime helpers) and exported through `src/browser-wrappers/index.mjs` to keep
  existing imports stable while removing the previous wrapper monolith.
- JS reverse server internals under `src/js-reverse-server/`, grouped by MCP
  tool schemas, shared utilities, TMWD adapter, managed-tab lifecycle,
  script-source discovery, and injected runtime code. `src/mcp/js-reverse/server.mjs`
  is the canonical executable MCP entrypoint; `src/js-reverse-server.mjs`
  remains a compatibility shim.

## Why browser67 uses the TMWD transport first

browser67 controls the user's real browser through the TMWD extension transport
and local hub. It keeps existing tabs, cookies, and login state. This is
different from remote-debugging CDP (`http://127.0.0.1:9222`), which can point
to a separate debug browser with no user session.

For Codex and real-profile tasks, default to:

```text
tmwd_mode=tmwd
tmwd_transport=auto
```

Use `tmwd_mode=remote_cdp` only for explicit debug Chrome, CI, or deep JS reverse
work that needs Network/Debugger/Script source.

## v0.3 execution model

- Both MCP surfaces return `browser67.tool-outcome.v3` envelopes. Outcomes now
  expose a top-level `page` summary when one exact tab is confirmed; otherwise
  `page` is `null`.
- Every `tmwd_browser` tool accepts `output_mode:"full"|"compact"`. The mode
  controls repeated diagnostics, not scan/extract/screenshot content limits.
- `browser_execute_js` and `browser_job_ops.start` accept `script`; the legacy
  `code` aliases are removed.
- TMWD raw execution and NodeRef mutations require an agent-created or
  explicitly adopted managed tab. A user-opened logged-in tab can be adopted in
  place and released without closing it.
- Adopted-tab navigation uses a short-lived one-shot extension authorization.
  A user/manual navigation or connection/lease change during the adopted lease
  suspends the tab; the Agent must run `inspect_adoption -> adopt_existing`
  again before continuing mutations.
- Ordinary tabs keep native CSP/dialog behavior and receive no browser67 badge,
  marker, content bridge, or network observer.
- `browser_extract`/`browser_diff` use actionable snapshot and semantic diff
  v2; `network_idle` uses request lifecycle tracking and the old heuristic is
  named `resource_quiet`.
- Raw scripts and structured NodeRef operations can opt into bounded
  `network_observation`; snapshots declare opaque cross-origin frames, closed
  shadow-root limits, document-scoped marker lifetime, and bounded retention.
- `tmwd_mode=auto` never turns a failed login-state TMWD route into an implicit
  remote-CDP permission. Only explicit `tmwd_mode=remote_cdp`/`cdp` can bypass
  managed-tab ownership for isolated debug or CI browsers.

See `docs/migration-v0.3.md` for the exact adoption, runtime-store migration,
extension reload, and consumer-output changes.

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

## Install as a Pi package

For Pi, install the repository as a package so its skills are loaded from the
package checkout instead of being copied into `~/.pi/agent/skills`:

```bash
pi install git:github.com/bigKING67/browser67@<tag-or-commit>
```

During active local development, install the checkout path:

```bash
pi install /path/to/browser67
```

The package manifest exposes:

```text
skills/browser67
skills/tmwd-browser-mcp
skills/js-reverse
```

MCP servers are still configured in the target agent's MCP config. For Pi,
`~/.pi/agent/mcp.json` should point at the installed package checkout or the
local development checkout.

## Active Codex skill copies

The version-controlled canonical skill sources live in this repository:

```text
skills/browser67
skills/tmwd-browser-mcp
skills/js-reverse
```

Codex/Agents may load active skills from a separate install directory such as
`~/.agents/skills`. That active copy is what the skill loader reads during a
session; it is not automatically updated by editing this repository. The
`js-reverse` MCP runtime should still point at browser67's server entrypoint
(`src/mcp/js-reverse/server.mjs`), while the `js-reverse` skill is the playbook
text loaded from the active skill directory.

Check active-copy drift without writing files:

```bash
npm run skills:active:diff
```

Fail a local gate when the active copy drifts:

```bash
npm run skills:active:check
```

Synchronize only after intentionally updating the active agent environment:

```bash
npm run skills:active:sync -- --target ~/.agents/skills
```

List and restore active-skill backups:

```bash
npm run skills:active:backups -- --target ~/.agents/skills
npm run skills:active:restore -- <backup-id-or-path> --target ~/.agents/skills --confirm-restore
```

Audit browser67-managed skills across common active/private roots without
writing files:

```bash
npm run skills:roots:audit
npm run check:skills-roots-audit
```

The roots audit checks `~/.agents/skills`, `~/.codex/skills`, and
`~/.pi/agent/skills` by default. Treat `~/.agents/skills` as the shared active
root unless a caller explicitly selects another root. Other roots are audit-only
until you prove an agent loader actually reads them; do not blindly sync
browser67 skills into every root. The default npm command prints a compact
operator summary and marks non-selected roots as
`audit_only_not_actionable`; use `node scripts/skills-roots-audit.mjs --json`
only when a caller needs per-skill diagnostics for audit-only roots.

The sync command creates a timestamped backup under the target backup root
before copying files. The default backup root is `<target>/.browser67-backups`;
override it with `--backup-dir <backup-root>` when needed. It does not delete
extra target files unless explicitly run with `--prune --confirm-prune`.
Restore also creates a fresh `pre-restore-*` backup under the same backup root
before copying the selected backup into place. The deterministic offline
contract is:

```bash
npm run check:active-skill-sync
npm run check:skills-roots-audit
```

See `docs/active-skill-runtime-model.md` for the exact boundary between
AGENTS routing rules, version-controlled skill source, active skill copies, MCP
runtime entrypoints, and external JS reverse reference repositories.

## Prepare extension

```bash
browser67 setup
```

Default extension target:

```text
~/.browser67/browser/tmwd_cdp_bridge/
```

`npm run setup` is equivalent. Setup also writes local registry entries for
both `tmwd_browser` and `js-reverse` into the active browser67 home under
`mcp/servers.toml` unless `--skip-registry` is passed. Existing legacy installs
under `~/.tmwd-browser-mcp` stay supported; run `browser67 migrate-home --dry-run`
to inspect a non-destructive copy migration to `~/.browser67`.

Check whether the installed unpacked extension matches this repository before
assuming the running browser has current bridge code:

```bash
npm run extension:doctor
npm run check:extension-install-doctor
```

`extension:doctor` is read-only. It compares `extension/` with the installed
target, ignores the install-local generated `config.js`, and reports
`needs_setup`, `needs_clean_setup`, and `needs_browser_extension_reload`.
When drift is reported, run `npm run setup`, reload the unpacked extension from
the reported target directory, then refresh old target tabs so content scripts
are reinjected.

For an already loaded and connected browser67 extension, use the deterministic
self-reload path instead of relying on an extension-page coordinate click:

```bash
npm run extension:reload-live
npm run check:live:doctor
```

The command reloads only the connected browser67 extension. First installation,
a disabled extension, or a disconnected bridge still requires loading/reloading
the reported unpacked directory from `chrome://extensions` or
`edge://extensions`.

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

## Structured task templates

Reusable task templates live under `templates/tasks/` and can be checked or
rendered without touching a browser:

```bash
npm run tasks:templates
npm run check:task-templates
node scripts/task-template.mjs render --template browser-run --task-id demo --workspace-key demo --json
node scripts/task-template.mjs render --template js-reverse-task --task-id demo --workspace-key demo --json
```

The browser template uses `browser_run_ops`, `browser_transport_health`,
`browser_wait`, `browser_job_ops`, and `browser_tab_lifecycle.finalize_task`.
Run-backed jobs persist checkpoints under the run's `jobs/` directory. After an
MCP restart, terminal jobs remain queryable and in-flight jobs recover as an
explicit `interrupted` result instead of disappearing. `abort_supported:false`
still means an already-running `Runtime.evaluate` call cannot be preempted;
`cancel_outcome` distinguishes intent-only cancellation from a task prevented
before execution.
The JS reverse template uses `new_page`, `analyze_target`, `list_frames`,
`record_reverse_evidence`, and `finalize_task`.

## Run MCP server

```bash
npm run server
```

Codex config should point directly at:

```text
/path/to/browser67/src/mcp/browser/server.mjs
```

Run the browser67-backed JS reverse MCP server with:

```bash
npm run js-reverse:server
```

Codex `js-reverse` config should point directly at:

```text
/path/to/browser67/src/mcp/js-reverse/server.mjs
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
- `skills/browser67/`: canonical skill/playbook for browser67 runtime tasks.
- `skills/tmwd-browser-mcp/`: legacy skill alias for browser67 real-browser tasks.
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

- `ensure_login` first inspects the selected browser67 managed tab. If it is already logged
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
container. Provider controls include native links/buttons and `[role="button"]`;
same-tab existing-account/authorization/consent pages remain SSO handoffs, while
popup classification requires explicit `_blank`, `window.open`, popup text, or
`data-oauth-popup` evidence. Authenticated-page markers suppress stale SSO
button noise only when no password/MFA surface or auth continuation is active.
CAPTCHA contexts may include a `captcha_kind`, `captcha_assist`
policy, and `captcha_router` plan. The default route is still human/manual or
native physical input for visible UI challenges, but the policy is now hybrid:
bounded DOM/vision/provider coordinate planning can be used for checkbox,
slider, rotate, and image-click style challenges, and an optional repo-external
provider protocol route can be planned only for explicitly allowlisted origins.
Even in protocol mode, the default remains disabled until the caller sets
`captcha_solver_mode:"protocol_allowed"` and `confirm_protocol_solver:true`.
browser67 still avoids JS/CDP clicks on CAPTCHA widgets, browser token/cookie
extraction, fullscreen screenshots, and rapid retries.

For CAPTCHA diagnostics, `browser_auth_ops.plan_captcha_assist` is a dry-run
planner. It inspects the selected tab, returns non-secret challenge metadata,
candidate DOM client rectangles, viewport coordinates, native input capability
status, physical-input provider selection (`native-os` plus guarded `ljq-ctrl`
metadata/execution bridge), `coordinate_transform` screen-pixel estimates, a window/region
`vision_correction_plan`, `captcha_policy`, `captcha_router`, redacted
`captcha_providers` status, and a replay plan without clicking or taking
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
browser67-owned managed `tab_id`, `confirm_physical_input:true`, and either
caller-supplied screen coordinates, `auto_screen_coordinates:true` plus
`confirm_auto_coordinates:true`, or `use_vision_corrected_coordinates:true` plus
`confirm_corrected_coordinates:true`, or `use_provider_coordinates:true` plus
`confirm_provider_coordinates:true` after `run_vision_correction:true` has
created a bounded region artifact for an allowlisted provider route. It uses the TMWD transport `tabs.switch` to foreground the
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

Optional JFBYM/Yunma provider planning is configured outside the repository at
the active browser67 home under `captcha-providers/jfbym.env` or an explicit
`captcha_provider_config_dir`. The planner redacts provider secrets and only
reports whether the token is configured. Example keys:

Use the setup helper instead of pasting a token into source, docs, or shell
history. It reads the token from the environment, writes only the repo-external
config file, chmods the directory/file to `0700`/`0600`, and prints redacted
JSON:

```bash
read -r -s TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN
export TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN
npm run setup:captcha-provider:jfbym -- --allowed-origin https://dy.feigua.cn --write
unset TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN
```

Use `--overwrite` only for an intentional provider config refresh.

```text
TMWD_CAPTCHA_PROVIDER_JFBYM_ENABLED=1
TMWD_CAPTCHA_PROVIDER_JFBYM_BASE_URL=https://api.jfbym.com/api/YmServer/customApi
TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN=<secret>
TMWD_CAPTCHA_PROVIDER_JFBYM_TIMEOUT_MS=60000
TMWD_CAPTCHA_PROVIDER_JFBYM_MAX_ATTEMPTS=1
TMWD_CAPTCHA_PROVIDER_JFBYM_MIN_CONFIDENCE=0.65
TMWD_CAPTCHA_PROVIDER_JFBYM_ALLOWED_ORIGINS=https://dy.feigua.cn
TMWD_CAPTCHA_PROVIDER_JFBYM_ALLOWED_KINDS=checkbox,slider,image_click,rotate,hcaptcha,recaptcha,turnstile
TMWD_CAPTCHA_PROVIDER_JFBYM_COORDINATE_SOLVER=1
TMWD_CAPTCHA_PROVIDER_JFBYM_PROTOCOL_SOLVER=0
TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_CHECKBOX=30009
TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_SLIDER=20110
TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_HCAPTCHA=30009
TMWD_CAPTCHA_PROVIDER_JFBYM_SLIDER_RESULT_MODE=target_x
```

Coordinate solving is still a visible-UI physical-input path: the provider only
returns coordinates from the bounded PNG artifact, TMWD converts them through
the artifact clip and refreshed viewport metrics, and native click/drag remains
guarded by `confirm_physical_input:true`. Provider coordinates are origin
allowlist gated, never use fullscreen screenshots, and do not expose image
base64, token, cookies, or sitekeys in tool results.
Keep `TMWD_CAPTCHA_PROVIDER_JFBYM_PROTOCOL_SOLVER=0` unless a target origin has
an approved protocol-solver contract. The current `assist_captcha` executor
does not inject provider protocol responses; it blocks such routes with
`protocol_solver_apply_not_implemented` until an explicit apply contract is
added. Capability discovery and CAPTCHA policy output therefore report
`supports_protocol_solver_apply:false` /
`protocol_solver_apply_supported:false`; callers must not interpret a planned
protocol route as executable.

## Quality gates

```bash
npm run verify
npm run gate -- --tier fast
npm run gate -- --tier check --changed
npm run verify:manifest
npm run test:core
npm run coverage:core
npm run coverage:contracts
npm run verify:ci
npm run verify:live
npm run verify:platform
npm run verify:all
npm run check:syntax
npm run check:job-persistence
npm run check:run-store
npm run lint
npm run type-check
npm run check:dependency-boundaries
npm run check:project-structure
npm run check:performance-smoke
npm run check:tmwd-performance-live
npm run check:task-templates
npm run check:regression-matrix
npm run check:change-set
npm run plan:scoped-commits
npm run check:readiness
npm run upstream:audit
npm run check:upstream-review
npm run check
npm run check:live:doctor
npm run check:auth-live
npm run check:captcha-assist-live
npm run check:captcha-assist-physical-live
npm run check:captcha-router
npm run check:captcha-provider-jfbym
npm run check:captcha-provider-jfbym-setup
npm run check:captcha-provider-jfbym-coordinate
npm run check:native-pointer
npm run check:native-live
npm run check:ljqctrl
npm run check:optional-live-proofs
npm run plan:optional-live-proofs
npm run proof:optional-live-status
npm run proof:optional-live-template
npm run proof:optional-live-record
npm run proof:native-live
npm run check:js-reverse-mcp
npm run check:js-reverse-live
```

Audit existing run/job state with `npm run runtime:migrate -- --check --json`.
Use `--write` only after reviewing the repo-external runtime root.

`npm run check` runs deterministic MCP/schema/hub-control contracts plus the
project-structure, performance smoke, task-template, and regression-matrix
gates. `check:live:*`
uses the current local browser environment and can fail when the extension or hub
is not connected. `check:tmwd-performance-live` creates an isolated local
managed fixture, records cold and p50/p95/p99 latency for real extension
`tabs.get`, managed execution, actionable extraction, and selector waits, then
verifies scoped cleanup. Its default guardrails are intentionally below the old
200 ms per-execution grace-period regression while retaining substantial local
machine headroom; all budgets can be overridden with the
`BROWSER67_TMWD_PERF_*` environment variables. `check:captcha-assist-live`
is planning-only by default and now
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
attempting physical input. The physical branch foregrounds its own browser67-managed
fixture tab before dragging/clicking only after that preflight passes. Native pointer
actions must be genuinely available: run `npm run check:native-pointer` first to
verify whether the current OS provider can actually click/drag without moving
the mouse. On macOS, `cliclick` is treated as pointer-capable only when its
diagnostic probe does not report missing Accessibility privileges for the
current terminal/Codex host. When the physical branch passes, it asserts both
the slider completion/visible movement (`slider_visual_offset` /
`handle_transform`) and checkbox inside-hotspot completion, then writes a
sanitized repo-external proof under
`~/.browser67/optional-live-proofs`
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
`check:native-live` is the no-input readiness entrypoint for Windows GUI proof
hosts and on-demand Linux desktop proof hosts. Linux headless/SSH servers do not
need native GUI proof. On macOS and other non-target platforms it reports
`not_applicable`; on Linux/Windows it reports whether an interactive desktop is
ready for the explicit physical run. The physical path requires both target-OS
environment confirmations and `--write`, then creates only browser67-managed
local fixture tabs, forces the `native-os` provider, verifies
`get_window_rect`, drag, and click, finalizes its tabs, and records sanitized
`native_live` JSON through the existing proof validator:

```bash
TMWD_NATIVE_LIVE_PHYSICAL=1 \
TMWD_NATIVE_LIVE_CONFIRM=1 \
npm run proof:native-live -- --write --json
```

Use PowerShell `$env:TMWD_NATIVE_LIVE_* = "1"` assignments on Windows. See
`docs/native-live-linux.md` and `docs/native-live-windows.md` for complete VM,
desktop-session, extension, hub, proof-transfer, and troubleshooting runbooks.
`check:ljqctrl` is diagnostic-only by default: it probes the local Python
`ljqCtrl` module and reports whether click/window-region capture would be
available, but it does not activate windows, click, drag, capture screenshots,
or access clipboard. Use `TMWD_LJQCTRL_REQUIRE=1`,
`TMWD_LJQCTRL_REQUIRE_EXECUTE=1`, or `TMWD_LJQCTRL_REQUIRE_CAPTURE=1` only for a
machine-local hard gate. On macOS it also reports an informational
`macljqctrl` section for the upstream `macljqCtrl` reference dependencies and
`CropToScreen` physical-coordinate model; this does not make AX or screenshot
paths default execution providers.
`check:captcha-router` validates the deterministic hybrid route contract:
default protocol solving remains disabled, unknown/degraded challenges route to
manual handoff, coordinate-only mode cannot select a protocol route, and
allowlisted provider protocol planning still requires explicit confirmation.
`check:captcha-provider-jfbym` validates repo-external JFBYM/Yunma config
loading, origin/kind allowlists, and redaction; it uses fake contract secrets
and never requires or prints a real provider token.
`check:captcha-provider-jfbym-coordinate` validates provider coordinate parsing,
bounded artifact-to-viewport-to-screen conversion, slider target interpretation,
origin allowlist blocking, malformed/low-confidence response blocking, and
redaction of fake tokens/image base64.
`check:optional-live-proofs` validates sanitized JSON proof artifacts under
`~/.browser67/optional-live-proofs` or `TMWD_OPTIONAL_PROOF_DIR`. Its default
self-use acceptance set is the local CAPTCHA physical proof, Windows native
proof, and approved external IdP coverage. Linux desktop native proof is
`release_scope:"on_demand"` and is omitted from default audit/readiness/release
counts; headless Linux servers do not need it. Use `--strict` only when a local
release gate should require every default optional proof, or add
`--include-on-demand` when an actual Linux desktop deployment also requires its
native proof.
Use `plan:optional-live-proofs` to print the current proof collection runbook:
per-proof status, required host/platform, safe commands, blockers, and evidence
requirements. The plan also surfaces accepted proof freshness
(`expires_at`/`expires_in_days`), `next_command`, `collection_steps`, and
`commands.record_replace` so agents can continue from readiness gaps without
recomputing the collection path. The default plan/status omits
`native-live-linux`; add `--id native-live-linux` to produce its on-demand
desktop handoff packet. Other `--id <proof-id>` values produce a single-proof
handoff for one Windows/IdP operator. Use
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
`npm run check:project-structure` is the read-only directory-governance gate.
It audits tracked files for canonical top-level directories, forbidden generic
top-level directories, repo-tracked runtime/evidence/secret artifacts,
canonical MCP entrypoints, legacy shim boundaries, `.gitignore` runtime
exclusions, and new root-level `src/*.mjs` sprawl. If a refactor needs a new
root source module, update `docs/project-structure.md` and the audit allowlist
with a migration rationale; otherwise place new code under the owning domain
directory.
`npm run plan:scoped-commits` uses the same grouping contract to print a dry-run
commit plan with exact `git add <paths...>` commands, suggested commit messages,
risk notes, and per-slice verification commands. It is also plan-only and never
stages files.
`npm run check:readiness` turns the near-100 quality target into a deterministic
readiness audit: it verifies required governance/docs/skill gates, reports a
score, prints a `score_breakdown`, and lists optional hardening gaps such as
pending scoped commits, unconfigured or invalid `ljqCtrl`, unavailable native
pointer actions, local physical CAPTCHA proof states, default Windows native
live proof, and provider-specific OAuth/SSO/MFA live gates. On-demand Linux
desktop proof never creates a default readiness deduction. The
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
The headline `score` uses the default self-use optional-proof set; on-demand
Linux desktop proof is excluded unless explicitly audited. The
`score_breakdown` additionally separates `local_release_score` from
`external_optional_score`, and reports whether `external_proofs_required` and
`blocking` are true. Normal local release work should read
`local_release_score=100.000` with `external_proofs_required=false` as local
release-ready even when default Windows or approved-IdP proof collection remains
open. Linux desktop proof is evaluated only when explicitly requested.

`npm run check:release-readiness` validates release metadata and release
governance without requiring a clean worktree. It checks package/package-lock
version consistency, current `CHANGELOG.md` coverage, release docs, canonical
and legacy bin entries, `verify` coverage, change-set grouping, and optional
proof status as a compact advisory. Add
`-- --show-optional-proof-detail` when you intentionally want the missing proof
ids, proof directory, and status/plan commands in the text output. Use
`npm run release:ready` after committing and pushing; it runs
`npm run verify`, then requires the worktree to be clean and synced with
`origin/main`, requires GenericAgent and JS reverse reference reviews to match
their current remotes, and requires non-empty `Unreleased` notes when commits
exist after the current package-version anchor. Use
`npm run release:ready:strict` only when the default Windows native and approved
external IdP optional live proofs are part of the release acceptance criteria.
For a real Linux desktop deployment, additionally run
`npm run check:optional-live-proofs -- --include-on-demand --strict`. See
`docs/release-governance.md`.

`npm run verify:manifest` prints the machine-readable verification tier model;
`scripts/verification/manifest.mjs` is the single command source of truth used
by `check`, `verify`, CI/live/platform aliases, and `gate --changed`.
Use `coverage:core` for the bounded runtime/serializer unit suite. It enforces
85% line/function/statement coverage and 80% branch coverage and writes its
machine-readable report under ignored `runtime/coverage-core/`.
Use `coverage:contracts` to generate the broader deterministic `src/`/`scripts/`
coverage baseline under ignored `runtime/coverage/`; that whole-repository
baseline remains observability rather than an invented global threshold. Use
`verify:ci` for deterministic cross-platform CI, `verify:live` for real TMWD
browser behavior including screenshot live proof, `verify:platform` for
isolated remote CDP/native diagnostics, `verify:local` for active-skill parity,
and `verify:all` for the broadest current-host gate. Shared CI never receives a
user browser profile; real-profile TMWD gates remain local or self-hosted.

`npm run upstream:audit` is the safe entrypoint for GenericAgent absorption
work. It compares `UPSTREAM.lock.json`, the local GenericAgent checkout, remote
`main`, the extension bridge feature matrix, and a per-file merge classifier.
Use `npm run upstream:audit:latest` to audit a temporary latest upstream
checkout without changing local files. If either command reports
`safe_to_direct_sync:false`, do not run a blind `extension:sync`; manually
cherry-pick useful upstream changes and preserve local bridge features such as
`handleTabs`, `tabs.get`, `tabs.close`, `includeUnscriptable`, and guarded
numeric `tabId` validation. The classifier also separates no-behavior
formatting drift such as final-newline-only changes from real behavior changes.
`UPSTREAM.review.json` records the latest manually reviewed upstream remote
commit and the keep-local/selective-merge decision, so repeated audits can
distinguish already-reviewed drift from a genuinely new upstream commit.
`npm run check:upstream-review` validates that ledger against
`docs/schemas/upstream-review.schema.json` and asserts that the local bridge
features which must survive a manual merge are still recorded. Audit JSON also
reports `upstream_review.status`, `upstream_review.stale`, and
`upstream_review.next_command`; `status=stale` means remote `main` has moved
past the reviewed commit and the ledger must be refreshed after a new manual
absorption review.
`npm run upstream:review-refresh-plan` automates the no-write refresh plan for
that manual-review ledger. It runs the latest-temp upstream audit, prints the
reviewed remote commit, merge mode, changed files, preserve-feature checklist,
and the exact confirmation command. Use `-- --json` for machine-readable plans,
`-- --print-review` to inspect the proposed `UPSTREAM.review.json` body, and
only use `-- --write --confirm-reviewed` after the upstream diff has been
manually reviewed. Follow a write with `npm run check:upstream-review` and, for
remote-main drift, `npm run upstream:audit:latest`.
`npm run check:upstream-audit` exercises deterministic fixture scenarios for
aligned sources, changed files, final-newline-only drift, missing local bridge
features, missing source, latest-temp local clones, reviewed remote drift, and
stale review-ledger detection.

`npm run js-reverse:upstream-audit -- --json` checks the external JS reverse
reference ledger in `docs/upstream/js-reverse/references.json` against each
reference's remote `HEAD` / `refs/heads/main` without importing any code. It
reports `status=current` when every reviewed commit is still current and
`status=review_needed` when a reference repo has moved. Add `--require-current`
when a local gate should fail on newly moved external references. The
deterministic fixture gate is `npm run check:js-reverse-upstream-audit`; it
keeps this audit behavior offline-testable.

`npm run verify` is the local full gate for maintenance changes. It checks
GenericAgent extension alignment, local and latest-temp upstream provenance,
the upstream review ledger schema, JS reverse docs/skill sync, all `.mjs`
syntax, change-set grouping, readiness scoring, deterministic
contracts, performance smoke, task-template validation, regression-matrix
availability, active-skill sync tooling, JS reverse upstream-reference
freshness, live doctor readiness, JS reverse live readiness, auth-profile
onboarding/lifecycle/live smoke (including manual CAPTCHA, MFA, SSO, and OAuth
popup resume paths), diagnostic-only `ljqCtrl` probing, and npm audit.
It also runs the optional proof audit in non-blocking mode so missing external
proofs stay visible in the full local gate, prints the optional proof collection
plan, and prints the operator status checklist. For managed-tab hygiene, `verify`
captures a temporary baseline before live checks and then fails only on newly
leaked unkept records; `npm run check:managed-tabs-clean` remains the strict
global audit for all currently registered TMWD workspaces. The strict audit
also groups leaked tabs by cleanup scope, reports duplicate URL groups, marks
old unkept records, and prints scoped `finalize_task` suggestions so operators
do not need to guess which workspace or task leaked tabs.
Use `npm run verify:local` when the active `~/.agents/skills` install must also
match the version-controlled `skills/` source; it runs `verify` and then fails on
active skill drift via `npm run skills:active:check`.

## Runtime artifact retention

TMWD run artifacts and `browser_screenshot_ops` PNG files are repo-external by
default under the active browser67 home (`~/.browser67/runtime/runs` for new
installs) unless
`BROWSER_STRUCTURED_RUN_ROOT` points to a different dedicated run root. They are
not source files and should not be committed into this repository.

Use the retention helper to keep screenshot and run evidence from growing
without bound:

```bash
npm run runtime:cleanup:dry-run
npm run runtime:cleanup -- --write
```

The dry-run mode is the default and prints the exact run directories that would
be deleted. `--write` is required before any deletion happens. The default
policy keeps the latest 50 runs, preserves recently updated `running` runs, and
plans cleanup for runs older than 30 days, when the run root exceeds 1024 MB,
or when it exceeds 500 run directories. Tune it with `--max-age-days`,
`--max-total-mb`, `--max-run-count`, and `--keep-latest`, or the
matching `TMWD_RUNTIME_CLEANUP_*` environment variables. The helper refuses
dangerous roots such as `/`, `$HOME`, repository paths, and non-`runs`-like
directories, and it deletes only complete run directories under the run root.

## Source alignment

Primary upstream references:

- `lsdefine/GenericAgent/TMWebDriver.py`
- `lsdefine/GenericAgent/assets/tmwd_cdp_bridge/*`
- `lsdefine/GenericAgent/memory/tmwebdriver_sop.md`
- `lsdefine/GenericAgent/memory/ljqCtrl_sop.md`
- `lsdefine/GenericAgent/memory/macljqCtrl.py`

The `extension/` directory is sourced from GenericAgent but is not blindly
overwritten by the latest upstream checkout. This fork owns extra managed-tab
bridge features used by TMWD lifecycle and JS reverse isolation; newer upstream
changes must be audited and selectively absorbed.

To check or resync against the local GenericAgent checkout:

```bash
npm run upstream:audit
npm run upstream:review-refresh-plan
npm run check:upstream-audit
npm run check:upstream-review
npm run check:upstream-review-refresh-plan
npm run js-reverse:upstream-audit -- --json
npm run check:js-reverse-upstream-audit
npm run check:js-reverse-absorption-matrix
npm run upstream:check
npm run extension:check
npm run extension:doctor
npm run check:extension-install-doctor
npm run extension:sync
npm run upstream:lock
```

Default upstream path:

```text
../GenericAgent/assets/tmwd_cdp_bridge
```

Use `node scripts/sync-genericagent-extension.mjs --source <path>` when your
GenericAgent checkout lives somewhere else.

Use `npm run upstream:audit -- --source <path>` when comparing against a fresh
latest upstream checkout rather than the default sibling checkout.

Use `npm run upstream:audit:latest` for a no-write temporary clone of upstream
`main`; it prints `extension_review.recommended_merge_mode` and per-file
`recommended_action` entries so future updates can be selectively absorbed, plus
`upstream_review.status/stale/next_command` so callers can tell whether the
review ledger is current or stale.
Use `npm run upstream:review-refresh-plan` immediately after that manual
latest-temp review when the ledger is stale. It is preview-only by default;
`-- --json` preserves the complete plan for tooling, `-- --print-review` prints
the proposed ledger body, and `-- --write --confirm-reviewed` is the explicit
write path for `UPSTREAM.review.json`.
When remote `main` has already been reviewed, `UPSTREAM.review.json` suppresses
the pending-review warning while still keeping `safe_to_direct_sync:false` for
known keep-local bridge drift.
For local mirrors or tests, pass a different repo/ref:

```bash
npm run upstream:audit:latest -- --latest-repo /path/to/GenericAgent --latest-ref main --json
```

Audited reference code and notes from upstream live under:

```text
docs/upstream/genericagent/
```

`extension/config.js` is intentionally not committed. `npm run setup` writes an
install-local `config.js` with a per-install TID into
the active browser67 home, canonically `~/.browser67/browser/tmwd_cdp_bridge/`.

`UPSTREAM.lock.json` records the exact GenericAgent commit and extension file
hashes used by this project. After intentionally updating GenericAgent and
running `npm run extension:sync`, refresh the lock with `npm run upstream:lock`.
`UPSTREAM.review.json` is separate: it records the latest audited upstream
commit and decision even when the extension lock intentionally stays on the
older sync baseline. `npm run check:upstream-review` validates the ledger shape
and required preserve-feature decisions before audit tooling treats the review
as authoritative.

## User-level launchd service

Install TMWD hub as a user LaunchAgent:

```bash
npm run launchd:install
```

This writes:

```text
~/Library/LaunchAgents/com.browser67.tmwd-hub.plist
```

and runs the hub from:

```text
/path/to/browser67/src/tmwd-hub.mjs
```

If you previously installed an older pre-browser67 LaunchAgent, `launchd:install`
will boot out known legacy labels before starting the canonical service so only
one hub claims the default ports.

Uninstall canonical LaunchAgent:

```bash
npm run launchd:uninstall
```

Uninstall canonical and legacy LaunchAgents:

```bash
npm run launchd:uninstall -- --all
```

## Runtime paths

Canonical runtime home:

```text
~/.browser67/
```

Important subpaths:

```text
~/.browser67/browser/tmwd_cdp_bridge/
~/.browser67/runtime/tmwd-hub-state.json
~/.browser67/runtime/browser-live-gate-events.jsonl
~/.browser67/mcp/servers.toml
```

Override with:

```bash
BROWSER67_HOME=/custom/path
```

Legacy `TMWD_BROWSER_MCP_HOME` and `~/.tmwd-browser-mcp/` remain supported. Use
`browser67 migrate-home --dry-run` and then `browser67 migrate-home --write` to
copy legacy runtime state into `~/.browser67`; migration never deletes the
legacy source.
