# Agent setup

This repository is meant to be used by agents as a paired toolkit:

- `tmwd_browser`: real Chrome/Edge profile automation through TMWD.
- `js-reverse`: TMWD-backed JavaScript reverse engineering, API discovery,
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
| TMWD browser skill | `skills/tmwd-browser-mcp/` |
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
args = ["/path/to/browser67/src/server.mjs"]

[mcp_servers.tmwd_browser.env]
BROWSER_STRUCTURED_TMWD_MODE = "tmwd"
BROWSER_STRUCTURED_TMWD_TRANSPORT = "auto"
BROWSER_STRUCTURED_TMWD_WS_ENDPOINT = "ws://127.0.0.1:18765"
BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT = "http://127.0.0.1:18766/link"

[mcp_servers.js-reverse]
command = "node"
args = ["/path/to/browser67/src/js-reverse-server.mjs"]

[mcp_servers.js-reverse.env]
BROWSER_STRUCTURED_TMWD_MODE = "tmwd"
BROWSER_STRUCTURED_TMWD_TRANSPORT = "auto"
BROWSER_STRUCTURED_TMWD_WS_ENDPOINT = "ws://127.0.0.1:18765"
BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT = "http://127.0.0.1:18766/link"
```

`npm run setup` also writes local registry entries for both servers into
`~/.tmwd-browser-mcp/mcp/servers.toml`. That file is a helper registry, not a
replacement for the target agent's own MCP config if it does not read that path.

## Skill installation

For Codex-style skill directories, copy both skills into the user's skill root:

```bash
mkdir -p ~/.codex/skills
cp -R /path/to/browser67/skills/tmwd-browser-mcp ~/.codex/skills/
cp -R /path/to/browser67/skills/js-reverse ~/.codex/skills/
```

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
Use tmwd_browser for real Chrome/Edge browser automation: logged-in pages,
current tabs, cookies/session-aware page inspection, CDP bridge commands,
downloads/uploads, file chooser planning, clipboard write/paste wrappers,
native fallback, and managed tab lifecycle.

Use js-reverse for page API/interface discovery, request initiator tracing,
signature-chain tracing, script search, network/WS sampling, non-blocking hooks,
evidence export, and local rebuild bundles. Pages opened through js-reverse
new_page are TMWD-managed too; finish reverse tasks with js-reverse
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
CAPTCHA handoff may include captcha_kind and captcha_assist metadata. Treat it
as a physical/manual flow: bring the TMWD-owned tab to the foreground if needed,
capture only the browser window/region for vision assistance, never take
fullscreen screenshots, never use JS/CDP to click CAPTCHA widgets, never extract
CAPTCHA tokens/cookies, wait before retrying, and hand off to the user if the
challenge becomes multi-round. Use browser_auth_ops.plan_captcha_assist for
dry-run planning and coordinate diagnostics before any physical input. It can
return candidate DOM client rects, viewport metadata, coordinate_transform screen
estimates, slider drag hints, physical-input provider selection, and region-only
vision correction clips. With run_vision_correction=true it captures only the
planned viewport/region, writes a bounded temporary PNG artifact outside the
repo, returns path/sha256/clip/TTL metadata plus scroll-adjusted CDP clip
metadata when needed, and runs first-pass slider visual correction.
Same-origin iframe CAPTCHA controls are converted to top viewport coordinates
and include a frame_path. Estimates are not safe for unattended execution.
browser_auth_ops.assist_captcha requires a managed tab,
confirm_physical_input=true, and either supplied screen coordinates or
auto_screen_coordinates=true plus confirm_auto_coordinates=true, or
use_vision_corrected_coordinates=true plus confirm_corrected_coordinates=true.
Cross-origin captcha-like iframes are degraded/manual-only: keep the iframe rect
and clipped screenshot plan, but do not infer inner controls or send physical
input into the frame.
For normal
TMWD-owned tabs it uses TMWD tabs.switch to foreground the target before
physical provider input; explicit window_title/window_pid/window_active_confirmed
are fallbacks. physical_input_provider=auto currently executes through native-os
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
validates normal, scrolled, and same-origin iframe slider fixtures, is
planning-only. Use `npm run check:captcha-assist-physical-live` for the optional
local GUI gate; it is skipped unless both TMWD_CAPTCHA_ASSIST_PHYSICAL=1 and
TMWD_CAPTCHA_ASSIST_CONFIRM=1 are set, and can be made fail-on-skip with
TMWD_CAPTCHA_ASSIST_REQUIRE_PHYSICAL=1.
For near-100 external coverage, run `npm run check:optional-live-proofs` after
collecting sanitized Linux/Windows native-input or approved OAuth/SSO/MFA proof
JSON under `~/.tmwd-browser-mcp/optional-live-proofs`; use `--strict` only when
those optional proofs are required for a local release gate. Use
`npm run proof:optional-live-template` for safe `ok:false` starter templates.

## Operating boundary

- Keep runtime artifacts under `~/.tmwd-browser-mcp/` or another
  `TMWD_BROWSER_MCP_HOME` path.
- Keep the browser extension installed from
  `~/.tmwd-browser-mcp/browser/tmwd_cdp_bridge/` or the documented local runtime
  copy.
- Reload the unpacked extension after extension source changes.
- Refresh old target tabs after extension reload so content scripts reinject.
- Treat all browser profile data and JS reverse evidence as sensitive local
  runtime data.
