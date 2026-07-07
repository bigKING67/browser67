# Agent setup

browser67 is meant to be used by agents as a paired real-browser runtime:

- `tmwd_browser`: browser67 real Chrome/Edge profile automation tool key over
  the TMWD transport/protocol.
- `js-reverse`: browser67-backed JavaScript reverse engineering, API discovery,
  request initiator tracing, hooks, evidence export, and local rebuild bundles.

Use both together. `tmwd_browser` owns general browser automation; `js-reverse`
owns observe/capture/rebuild workflows.

## Files to wire into an agent

| Purpose | File or directory |
| --- | --- |
| MCP server config examples | `docs/codex-integration.md` |
| Codex host hard-finally adapter | `src/codex-host-finalizer.mjs` |
| Copy-ready global prompt rules | `docs/global-prompt-snippet.md` |
| Project-level prompt for this repo | `AGENTS.md` |
| browser67 skill | `skills/browser67/` |
| Legacy browser67 alias skill | `skills/tmwd-browser-mcp/` |
| JS reverse skill | `skills/js-reverse/` |
| JS reverse SOP entrypoint | `docs/js-reverse-SOP.md` |
| Generic agent descriptor | `agents/openai.yaml` |
| JS reverse agent descriptor | `skills/js-reverse/agents/openai.yaml` |
| JS reverse reference docs | `docs/js-reverse/` and `skills/js-reverse/references/` |

`docs/js-reverse/` and `skills/js-reverse/` should stay synchronized. Verify
that with:

```bash
npm run skills:check
```

## MCP config

Add both MCP servers. Replace `/path/to/browser67` with the clone path.

```toml
[mcp_servers.tmwd_browser]
command = "node"
args = ["/path/to/browser67/src/mcp/browser/server.mjs"]

[mcp_servers.tmwd_browser.env]
BROWSER_STRUCTURED_TMWD_MODE = "tmwd"
BROWSER_STRUCTURED_TMWD_TRANSPORT = "auto"
BROWSER_STRUCTURED_TMWD_WS_ENDPOINT = "ws://127.0.0.1:18765"
BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT = "http://127.0.0.1:18766/link"

[mcp_servers.js-reverse]
command = "node"
args = ["/path/to/browser67/src/mcp/js-reverse/server.mjs"]

[mcp_servers.js-reverse.env]
BROWSER_STRUCTURED_TMWD_MODE = "tmwd"
BROWSER_STRUCTURED_TMWD_TRANSPORT = "auto"
BROWSER_STRUCTURED_TMWD_WS_ENDPOINT = "ws://127.0.0.1:18765"
BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT = "http://127.0.0.1:18766/link"
```

`browser67 setup` / `npm run setup` also writes local registry entries for both
servers into the active browser67 home under `mcp/servers.toml`. That file is a helper registry, not a
replacement for the target agent's own MCP config if it does not read that path.

## Skill installation

For Pi, prefer package installation:

```bash
pi install git:github.com/bigKING67/browser67@<tag-or-commit>
```

During active local development:

```bash
pi install /path/to/browser67
```

This loads package skills from:

```text
skills/browser67
skills/tmwd-browser-mcp
skills/js-reverse
```

Do not copy these skills into `~/.pi/agent/skills` when `~/.pi/agent` is an
in-place `pi-67` checkout; keep browser67 as the source of truth.

For Codex-style skill directories, synchronize the canonical browser67 and
js-reverse skills into the user's active skill root. Copy `tmwd-browser-mcp`
only when an older agent still routes by that legacy alias. Prefer the
repo helper over hand-copying because it can diff first and creates backups
before writes:

```bash
npm run skills:active:diff -- --target ~/.agents/skills
npm run skills:active:check -- --target ~/.agents/skills
npm run skills:active:sync -- --target ~/.agents/skills
npm run skills:active:backups -- --target ~/.agents/skills
npm run skills:active:restore -- <backup-id-or-path> --target ~/.agents/skills --confirm-restore
```

Use `--target ~/.codex/skills` for Codex installations that load skills from
`~/.codex/skills`. The helper never prunes extra files unless called with
`--prune --confirm-prune`, and restore creates a new `pre-restore-*` backup of
the current active copy before writing files from the selected backup. Backups
default to `<target>/.browser67-backups`; pass `--backup-dir <backup-root>` when
an install needs a separate backup root.

The active skill copy is only a loader-facing install artifact. Keep
`skills/browser67`, `skills/tmwd-browser-mcp`, and `skills/js-reverse` as the
version-controlled source of truth, and keep MCP configs pointed at
`src/mcp/browser/server.mjs` and `src/mcp/js-reverse/server.mjs`. See
`docs/active-skill-runtime-model.md` for the full source/runtime/active-copy
model.

For agents that consume YAML descriptors, use:

```text
/path/to/browser67/agents/openai.yaml
/path/to/browser67/skills/js-reverse/agents/openai.yaml
```

## Prompt rules to merge into global/project instructions

Do not overwrite an agent's global prompt blindly. Merge these rules into the
agent's existing global or project instructions:

For a copy-ready Chinese prompt block, use `docs/global-prompt-snippet.md`.
The compact English version is:

```text
Use browser67 real-browser MCP for real Chrome/Edge browser automation:
logged-in pages, current tabs, cookies/session-aware page inspection, CDP
bridge commands, downloads/uploads, file chooser planning, clipboard
write/paste wrappers, native fallback, managed tab lifecycle, and first-class
screenshot artifacts. The current MCP tool key remains `tmwd_browser`; `tmwd`
is only a transport/protocol term.

Use js-reverse for page API/interface discovery, request initiator tracing,
signature-chain tracing, script search, network/WS sampling, non-blocking hooks,
evidence export, and local rebuild bundles. Pages opened through js-reverse
new_page are browser67-managed too; finish reverse tasks with js-reverse
finalize_task for the same workspace_key or task_id unless the page must stay
open for evidence review.

Default login-state browser work to tmwd_mode=tmwd and tmwd_transport=auto.
Do not silently fallback to remote_cdp for login-state tasks. remote_cdp is only
for explicit debug Chrome, CI, or callframe/debugger-level work.

For active browser work, use browser_tab_lifecycle action=select_or_create with
ownership_policy=tmwd_only and a stable project/surface-level workspace_key.
User-opened unmanaged tabs are read-only by default. Do not navigate, click,
type into, close, or adopt them unless the user explicitly asks to operate on
that tab. End active browser tasks with browser_tab_lifecycle
action=finalize_task for the current workspace_key or task_id unless the user
asked to keep the page open; it closes only keep=false managed tabs, preserves
keep=true, prunes stale registry records, and ignores unmanaged user tabs.
For visual QA, call browser_screenshot_ops after browser_wait settles the page.
Use target=viewport for the baseline, target=selector or target=clip for
focused component evidence, and target=full_page only on bounded pages with an
explicit max_pixels. Screenshot artifacts are written outside the repo under
the browser67 run root and tool results return metadata only, never image base64.
Audit retained screenshot/run evidence with `npm run runtime:cleanup:dry-run`;
apply retention only with the explicit write path
`npm run runtime:cleanup -- --write`.
If a managed tab redirects to a login page, use browser_auth_ops.ensure_login
for approved sites, preferably with the managed tab_id. It first accepts
already-authenticated pages without resubmitting. On a login page it selects a
repo-external local profile by exact origin, redacts credentials from output,
and returns blocked for unknown origins instead of guessing credentials. For a
first-time site, use browser_auth_ops.suggest_profile on the managed login tab,
then explicitly save the user-provided credentials with
browser_auth_ops.upsert_profile and confirm_write=true; tab creation must never
save credentials as a hidden side effect. Saved profiles may have a redacted
<profile>.meta.json sidecar that records lifecycle timestamps/status only; it
must not contain usernames, passwords, cookies, tokens, or session data. Profile
file scans are deterministic and bounded so secret directories cannot become an
unbounded hot path.
CAPTCHA, MFA, SSO-only, and OAuth popup screens are manual-required states;
ensure_login returns blocked with manual_required_* and must not keep guessing.
OAuth popup flows keep the compatible manual_required_sso reason and use
manual_context.kind=oauth_popup. manual_context is a non-secret handoff hint
only; it must not contain credentials, cookies, tokens, browser session data, or
page content. After the user completes the manual step, call ensure_login again
on the same managed tab/workspace to validate the resumed authenticated state.
CAPTCHA handoff may include captcha_kind, captcha_assist, and captcha_router
metadata. Treat the default visible-UI path as a physical/manual flow: bring the
browser67-owned tab to the foreground if needed, capture only the browser
window/region for vision assistance, never take fullscreen screenshots, never
use JS/CDP to click CAPTCHA widgets, never extract browser CAPTCHA
tokens/cookies, wait before retrying, and hand off to the user if the challenge
becomes multi-round. Use browser_auth_ops.plan_captcha_assist for dry-run
planning and coordinate diagnostics before any physical input. It can return
candidate DOM client rects, viewport metadata, coordinate_transform screen
estimates, slider drag hints, physical-input provider selection, redacted
JFBYM/Yunma provider status, captcha_router route selection, and region-only
vision correction clips. Provider protocol routes are default-off and require
captcha_solver_mode=protocol_allowed, confirm_protocol_solver=true, and a
repo-external origin allowlist. With run_vision_correction=true it captures only the
planned viewport/region, writes a bounded temporary PNG artifact outside the
repo, returns path/sha256/clip/TTL metadata plus scroll-adjusted CDP clip
metadata when needed, and runs first-pass slider visual correction.
Same-origin iframe CAPTCHA controls are converted to top viewport coordinates
and include a frame_path. Estimates are not safe for unattended execution.
browser_auth_ops.assist_captcha requires a managed tab,
confirm_physical_input=true, and either supplied screen coordinates or
auto_screen_coordinates=true plus confirm_auto_coordinates=true, or
use_vision_corrected_coordinates=true plus confirm_corrected_coordinates=true.
For repo-external JFBYM/Yunma coordinate solving, it also supports
use_provider_coordinates=true plus confirm_provider_coordinates=true, but only
after run_vision_correction=true has captured a bounded non-fullscreen region
artifact and the current origin/kind matches the provider allowlist. Provider
results are converted through the artifact clip and refreshed viewport metrics;
tool results must not contain provider tokens, image base64, cookies, or
sitekeys.
Configure JFBYM/Yunma with `npm run setup:captcha-provider:jfbym -- --allowed-origin <origin> --write`.
The helper reads the token from `TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN`, writes only
repo-external `jfbym.env`, enforces `0700`/`0600` permissions, and prints
redacted JSON. Do not paste provider tokens into prompts, docs, source, or shell
history; use `read -r -s TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN` and unset it after
setup.
Cross-origin captcha-like iframes are degraded/manual-only: keep the iframe rect
and clipped screenshot plan, but do not infer inner controls or send physical
input into the frame.
For normal
browser67-owned tabs it uses the TMWD transport `tabs.switch` to foreground the target before
physical provider input, waits for pre_input_settle_ms, and refreshes
planner/vision coordinates against the active window before the native click or
drag. This avoids stale Chrome toolbar/content inset estimates. Explicit
window_title/window_pid/window_active_confirmed are fallbacks.
physical_input_provider=auto currently executes through native-os
unless the guarded ljq-ctrl bridge is explicitly enabled and reports the
requested action. Run `npm run check:ljqctrl` to diagnose local Python ljqCtrl
availability and click/window-region capture support without physical input.
The diagnostic output includes a compact python_candidates matrix. Use
TMWD_LJQCTRL_PYTHON for one explicit interpreter, or
TMWD_LJQCTRL_PYTHON_CANDIDATES for a system path-delimited candidate list.
TMWD_LJQCTRL_EXECUTE=1 is required before the guarded bridge may call
ljqCtrl.Click or clipped window-region capture artifact creation. Slider
challenges additionally require screen destination coordinates (explicit or
estimated) and physical drag capability, otherwise they remain manual handoff.
On macOS, native-os drag capability requires `cliclick` and Accessibility
permission for the current terminal/Codex host. The optional local physical
proof gate remains opt-in and supports bounded local-fixture retry/tuning via
`TMWD_CAPTCHA_ASSIST_MAX_ATTEMPTS`, `TMWD_CAPTCHA_ASSIST_PRE_INPUT_SETTLE_MS`,
drag overshoot/offset env vars, or exact `TMWD_CAPTCHA_ASSIST_DRAG_FROM_X/Y`
and `TMWD_CAPTCHA_ASSIST_DRAG_TO_X/Y` screen coordinates; this does not weaken
real-site CAPTCHA handoff boundaries.
Use npm run check:managed-tabs-clean as a registry-only hygiene gate when
auditing whether finalizers were missed. The full npm run verify flow writes a
temporary managed-tab baseline and fails only on newly leaked unkept records, so
unrelated pre-existing workspaces stay visible but do not make repository
verification flaky. Managed tab creation results include finalize_hint; treat
finalize_hint.required=true as a task-end cleanup obligation unless the user
explicitly asked to keep the page open.

If the host can run a turn-end finally block, wire
src/codex-host-finalizer.mjs into the MCP client layer. Register every MCP tool
result with createCodexFinalizerTracker(), then dispatch plan().calls in the
host finally path before the final response or handoff. The planner refuses
automatic scope=all cleanup and only emits scoped finalize_task calls.

For JS reverse tasks, observe first, prefer hooks over breakpoints, record
runtime evidence, and rebuild locally only after identifying the target request,
initiator, relevant scripts, and runtime samples.

Do not commit extension/config.js, runtime evidence, cookies, tokens,
localStorage/sessionStorage values, HAR/PCAP captures, or .env files.
```

## Readiness checks for agents

Before relying on the tools:

```bash
cd /path/to/browser67
npm ci
npm run setup
npm run hub:start
npm run doctor
npm run check:live:doctor
npm run check:js-reverse-live
```

Deterministic checks that do not require a live browser profile:

```bash
npm run check
npm run skills:check
```

`check:live:*` requires the local hub and unpacked extension to be connected to
Chrome/Edge. If those fail, inspect `npm run doctor:json` before changing code.
After auth/profile changes, run `npm run check:auth-live`; it uses an isolated
local profile directory and managed tabs, verifies first-time profile suggestion
and upsert, login submission, already-authenticated no-resubmit behavior,
lifecycle sidecar updates, CAPTCHA/MFA/SSO/OAuth-popup manual-required blocking,
manual CAPTCHA/MFA/SSO/OAuth-popup completion resume, unknown-origin blocking,
redaction, manual handoff context, and finalizer cleanup.
After CAPTCHA assist changes, run `npm run check:captcha-assist-live`; it
validates normal, scrolled, same-origin iframe, and synthetic visual-movement
slider fixtures, and is planning-only. Use
`npm run check:captcha-router`, `npm run check:captcha-provider-jfbym`, and
`npm run check:captcha-provider-jfbym-setup`, and
`npm run check:captcha-provider-jfbym-coordinate` after CAPTCHA router/provider
changes; these validate default-off protocol routing, provider config redaction,
repo-external setup permissions, coordinate parsing, artifact-to-screen
conversion, and malformed/low-confidence blocking without requiring a real
provider token.
Use
`npm run check:captcha-assist-physical-live` for the optional
local GUI gate; it is skipped unless both TMWD_CAPTCHA_ASSIST_PHYSICAL=1 and
TMWD_CAPTCHA_ASSIST_CONFIRM=1 are set, and can be made fail-on-skip with
TMWD_CAPTCHA_ASSIST_REQUIRE_PHYSICAL=1. Native pointer actions must be genuinely
available; skipped/blocked paths include physical_input_executed=false and
pointer_moved=false, and the physical wrapper runs native pointer preflight
before opening the GUI fixture or creating a managed tab. Missing click/drag
requirements return structured skipped/blocked output without foregrounding
Chrome or attempting physical input. Run `npm run check:native-pointer` first for a
no-input readiness check. On macOS, missing Accessibility permission keeps
`cliclick` click/drag capability disabled. A successful physical run writes a
sanitized repo-external local CAPTCHA proof by default; set
TMWD_CAPTCHA_ASSIST_WRITE_PROOF=0 to disable that persistence.
For near-100 external coverage, run `npm run check:optional-live-proofs` after
collecting sanitized local CAPTCHA physical, Linux/Windows native-input, or
approved OAuth/SSO/MFA proof JSON under
`~/.browser67/optional-live-proofs`; use `--strict` only when those
optional proofs are required for a local release gate. Use
`npm run proof:optional-live-template` for safe `ok:false` starter templates,
then `npm run proof:optional-live-record -- --id <proof-id> --from-json <sanitized.json>`
to dry-run validate a real sanitized proof before adding `--write`.

## Operating boundary

- Keep runtime artifacts under the active browser67 home, canonically
  `~/.browser67/`, or another `BROWSER67_HOME` path. Legacy
  `TMWD_BROWSER_MCP_HOME` paths remain compatibility inputs.
- Keep screenshot/run artifact retention explicit: start with
  `npm run runtime:cleanup:dry-run`, then add `-- --write` only when the
  planned old run directories should be deleted.
- Keep the browser extension installed from the active browser67 home,
  canonically `~/.browser67/browser/tmwd_cdp_bridge/`, or the documented local
  runtime copy.
- Reload the unpacked extension after extension source changes.
- Refresh old target tabs after extension reload so content scripts reinject.
- Treat all browser profile data and JS reverse evidence as sensitive local
  runtime data.
