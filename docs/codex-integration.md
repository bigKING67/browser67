# Codex integration

Recommended Codex MCP block:

```toml
[mcp_servers.tmwd_browser]
command = "node"
args = ["/path/to/browser67/src/server.mjs"]

[mcp_servers.tmwd_browser.env]
BROWSER_STRUCTURED_TMWD_MODE = "tmwd"
BROWSER_STRUCTURED_TMWD_TRANSPORT = "auto"
BROWSER_STRUCTURED_TMWD_WS_ENDPOINT = "ws://127.0.0.1:18765"
BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT = "http://127.0.0.1:18766/link"

[mcp_servers.tmwd_browser.tools.browser_scan]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_execute_js]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_extract]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_diff]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_tab_ops]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_native_input]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_file_ops]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_download_ops]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_tab_lifecycle]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_auth_ops]
approval_mode = "approve"

[mcp_servers.tmwd_browser.tools.browser_clipboard_ops]
approval_mode = "approve"

[mcp_servers.js-reverse]
command = "node"
args = ["/path/to/browser67/src/js-reverse-server.mjs"]

[mcp_servers.js-reverse.env]
BROWSER_STRUCTURED_TMWD_MODE = "tmwd"
BROWSER_STRUCTURED_TMWD_TRANSPORT = "auto"
BROWSER_STRUCTURED_TMWD_WS_ENDPOINT = "ws://127.0.0.1:18765"
BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT = "http://127.0.0.1:18766/link"

[mcp_servers.js-reverse.tools.check_browser_health]
approval_mode = "approve"

[mcp_servers.js-reverse.tools.search_in_scripts]
approval_mode = "approve"

[mcp_servers.js-reverse.tools.list_network_requests]
approval_mode = "approve"

[mcp_servers.js-reverse.tools.create_hook]
approval_mode = "approve"

[mcp_servers.js-reverse.tools.inject_hook]
approval_mode = "approve"

[mcp_servers.js-reverse.tools.get_hook_data]
approval_mode = "approve"

[mcp_servers.js-reverse.tools.export_rebuild_bundle]
approval_mode = "approve"
```

## Tool routing

- `tmwd_browser`: primary path for real browser tasks, logged-in pages, existing tabs, cookies, CDP bridge, background tabs, batch actions, downloads/uploads, file chooser planning, clipboard write/paste wrappers, and managed tab lifecycle.
- `js-reverse`: primary path for page API/interface discovery, request initiator tracing, signature-chain tracing, script search, network/WS sampling, non-blocking hooks, evidence export, and local rebuild bundles. It is TMWD-backed by default, so it keeps the user's real logged-in browser context. JS reverse pages created with `new_page` are also TMWD-managed; end reverse tasks with `finalize_task` for the current `workspace_key` / `task_id` unless evidence collection requires keeping the page open.
- in-app Browser: localhost/file previews without Chrome profile state.
- Computer Use: desktop UI and pure visual pointer/keyboard actions.
- `remote_cdp`: explicit debug Chrome/CI/JS reverse protocol work, not ordinary login-state tasks.

Validate the explicit remote CDP path with `npm run check:remote-cdp`. The gate
launches an isolated headless Chrome profile and local fixture page, then runs
doctor + live checks against that temporary `remote_cdp` endpoint. Set
`CHROME_BIN=/path/to/chrome` when Chrome is not installed in a default location.

## Wrapper tools

- `browser_file_ops`: `inspect_inputs`, `set_input_files`, `upload_via_data_transfer`, `native_file_chooser_plan`. Prefer `set_input_files` for real local files; use DataTransfer only for small in-memory files; native chooser action returns a plan and should not silently upload files.
- `browser_download_ops`: `allow_automatic_downloads`, `prepare`, `wait`, `list_recent`. It tracks only the prepared per-run token / directory window and ignores partial files such as `.crdownload`.
- `browser_tab_lifecycle`: `select_or_create`, `create_managed`, `mark_keep`, `list_managed`, `prune_stale`, `close_unkept`, `finalize_task`. Prefer `select_or_create` for active work; it reuses only TMWD-owned managed tabs (`ownership_policy="tmwd_only"`) and ignores user-opened unmanaged tabs. `finalize_task` is the preferred task-end cleanup wrapper; it prunes stale registry records, closes only `keep:false` managed tabs in the requested scope, preserves `keep:true`, and ignores unmanaged user tabs.
- `browser_auth_ops`: `list_profiles`, `validate_profile`, `inspect_login_page`, `suggest_profile`, `upsert_profile`, `ensure_login`. Use after `browser_tab_lifecycle.select_or_create` when a TMWD-owned tab lands on a login page. Profiles are exact-origin allowlisted, stored only in repo-external local secret files, and outputs are redacted; unknown origins are reported as blocked and are never auto-filled. Profile lifecycle metadata is kept in a separate redacted sidecar file.
- `browser_clipboard_ops`: `write_text`, `paste_text`. It does not expose clipboard reads; prefer DOM value setting for target fields and use native paste only when the page requires a real paste event.

## Login profiles

`browser_auth_ops` is a profile-driven helper layer, not a global password
autofill. It never reads Chrome password stores, cookie databases, browser
history, or unrelated tabs. It only inspects/fills the currently selected
TMWD tab when the current `location.origin` exactly matches a configured
profile. Saving credentials is explicit: only `upsert_profile` writes a
repo-external secret file, and it requires `confirm_write:true`; creating or
selecting a managed tab never saves credentials as a hidden side effect.

Default profile directory:

```text
~/.codex/secrets/tmwd-login-profiles/
```

Each saved profile may have a non-secret lifecycle sidecar:

```text
<profile>.env       -> <profile>.meta.json
<profile>.profile   -> <profile>.meta.json
```

The sidecar records only operational metadata such as `created_at`,
`updated_at`, `last_used_at`, `last_validated_at`, `last_status`,
`last_reason`, `last_origin`, and `last_path`. It never stores username,
password, cookies, tokens, browser session data, or page content. Profile and
sidecar writes use atomic temp-file rename and mode `0600` when the filesystem
supports POSIX modes.

Override for tests or isolated runs:

```bash
BROWSER_STRUCTURED_LOGIN_PROFILE_DIR=/path/to/private/profiles
```

Example profile:

```env
PROFILE_ID=datahub-groland
ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000,https://groland.52671314.xyz
USERNAME=...
PASSWORD=...
LOGIN_PATH_PATTERN=/login
USERNAME_SELECTOR=#username
PASSWORD_SELECTOR=#password
SUBMIT_SELECTOR=button[type="submit"]
SUCCESS_PATH_NOT=/login
SUCCESS_TEXT=
```

Known-site operational pattern:

1. Create/reuse a managed tab with `browser_tab_lifecycle.select_or_create`.
2. Call `browser_auth_ops.ensure_login` with `tab_id` for that managed tab
   (`session_id` is accepted only when it resolves exactly; auth ops will not
   fall back to another tab).
3. If the page is already authenticated, `ensure_login` returns `already_authenticated:true`.
4. If the page is a login page and the origin matches a profile, it fills and submits the form.
5. If no exact-origin profile matches, it returns `status:"blocked"` and does not fill anything.
6. If CAPTCHA, MFA, SSO-only, or OAuth popup UI is detected, `ensure_login` returns
   `status:"blocked"` with `reason:"manual_required_captcha"`,
   `reason:"manual_required_mfa"`, or `reason:"manual_required_sso"` and does
   not continue guessing. OAuth popup flows keep the compatible
   `manual_required_sso` reason and use `manual_context.kind:"oauth_popup"` for
   the more specific handoff type.
7. Finish with `browser_tab_lifecycle.finalize_task` for the same `workspace_key`.

Manual-required results may include:

```json
{
  "manual_required": true,
  "manual_context": {
    "kind": "captcha|mfa|sso|oauth_popup",
    "captcha_kind": "hcaptcha|recaptcha|turnstile|cloudflare|slider|generic",
    "captcha_assist": {
      "assist_mode": "manual_or_native_physical",
      "next_step": "complete_challenge_then_ensure_login"
    },
    "tab_id": "...",
    "workspace_key": "...",
    "resume_action": "ensure_login"
  }
}
```

`manual_context` is only a non-secret recovery hint. It must not contain
username, password, cookies, tokens, browser session data, page body text, or
captured DOM content. After the user completes the manual step, call
`browser_auth_ops.ensure_login` again on the same managed tab/workspace; the
expected successful path is already-authenticated validation, not replaying
stored credentials across an external identity provider.

For CAPTCHA handoff, TMWD follows the Sophub physical-input pattern rather than
token extraction: CDP is acceptable for bringing the managed tab to the
foreground or window-scoped screenshots, but CAPTCHA widgets must not be clicked
with JS/CDP. If visual assistance is required, capture only the relevant browser
window/region before calling a vision backend; fullscreen screenshots are not
part of this policy. If a challenge escalates into
multi-round image/puzzle solving, stop and hand off to the user instead of
rapidly retrying.

For a CAPTCHA dry-run, call `browser_auth_ops` with
`action:"plan_captcha_assist"` and the same managed `tab_id`/`workspace_key`.
It returns a non-mutating plan plus candidate `getBoundingClientRect()` data in
viewport CSS pixels, viewport/DPR metadata, native input capability status,
physical-input provider selection (`native-os` plus planned `ljq-ctrl`
integration), and the policy gates needed before any physical input. It also
returns a
`coordinate_transform` object with estimated screen pixels and a
`vision_correction_plan` that is limited to browser window/region screenshot
clips. Add `run_vision_correction:true` only when you need executable
coordinate correction: it captures the planned viewport/region with CDP, stores
a bounded temporary PNG artifact outside the repo, returns artifact metadata
(`path`, `sha256`, dimensions, clip, TTL, `fullscreen:false`, and the
scroll-adjusted CDP clip when needed), and runs a first-pass local slider
detector. Same-origin iframe CAPTCHA controls are converted back to top
viewport coordinates and include a `frame_path`. Cross-origin captcha-like
iframes are degraded to manual handoff: the planner returns the iframe rect,
clipped screenshot plan, `degraded_mode:true`, and
`manual_handoff_required:true`; `assist_captcha` must block instead of inferring
inner controls or sending physical input into the frame. Treat those estimates as review material:
browser chrome, OS scaling,
iframe offsets, DPR, and multi-monitor layout can shift the final physical
pixels, so unattended execution remains disabled.

`action:"assist_captcha"` is intentionally stricter: it only runs on a
TMWD-owned managed tab, requires `confirm_physical_input:true`, requires a
foreground window, and requires either caller-supplied screen coordinates or
`auto_screen_coordinates:true` plus `confirm_auto_coordinates:true`, or
`use_vision_corrected_coordinates:true` plus
`confirm_corrected_coordinates:true`. For normal
TMWD-owned tabs, it foregrounds the target with TMWD `tabs.switch` before
physical provider input, waits for `pre_input_settle_ms`, then refreshes the
planner/vision coordinates against the now-active window before sending native
input. This post-activation refresh avoids stale Chrome toolbar/content inset
estimates. `window_title`, `window_pid`, and
`window_active_confirmed:true` are fallbacks for unusual window-manager cases.
`physical_input_provider:"auto"` currently executes through `native-os` unless
the guarded `ljq-ctrl` bridge is explicitly enabled and reports the needed
action. `ljq-ctrl` probe results are TTL-cached to avoid repeated Python startup
on planner/assist chains. Run `npm run check:ljqctrl` for a diagnostic-only
probe of the local Python `ljqCtrl` import, click support, and window-region
capture support; the doctor does not activate windows, click, drag, capture
screenshots, or access clipboard. It reports a compact `python_candidates`
matrix so agents can see when one Python exists but cannot import `ljqCtrl`.
Set `TMWD_LJQCTRL_PYTHON=/path/to/python` for one explicit interpreter, or
`TMWD_LJQCTRL_PYTHON_CANDIDATES` to a system path-delimited candidate list when
`ljqCtrl` is installed outside the default Python path. `TMWD_LJQCTRL_EXECUTE=1`
is required before the guarded bridge may call `ljqCtrl.Click` or clipped
window-region capture artifact creation. It does not use JS/CDP to click a CAPTCHA widget and does not read
CAPTCHA tokens/cookies. Slider CAPTCHA planning returns a viewport-space drag
hint and estimated screen start/end coordinates; execution requires physical `drag` support
plus explicit or estimated `screen_x`/`screen_y` and
`screen_to_x`/`screen_to_y`. If those are missing, it returns a manual handoff
instead of guessing. The optional `check:captcha-assist-physical-live` local
fixture gate may use up to three bounded attempts when explicitly enabled:
attempt 1 uses vision-corrected coordinates, retry attempts use prior
diagnostics plus conservative overshoot/settle timing, and all attempts retain
the 5s post-input wait. Tune only that local proof path with
`TMWD_CAPTCHA_ASSIST_MAX_ATTEMPTS`, `TMWD_CAPTCHA_ASSIST_PRE_INPUT_SETTLE_MS`,
`TMWD_CAPTCHA_ASSIST_DRAG_OVERSHOOT_X`, `TMWD_CAPTCHA_ASSIST_DRAG_*_OFFSET_*`,
or exact `TMWD_CAPTCHA_ASSIST_DRAG_FROM_X/Y` and
`TMWD_CAPTCHA_ASSIST_DRAG_TO_X/Y` screen coordinates.

First-time site onboarding pattern:

1. Create/reuse a managed tab with `browser_tab_lifecycle.select_or_create`.
2. If it lands on login, call `browser_auth_ops.inspect_login_page` or
   `browser_auth_ops.suggest_profile` for the same `tab_id`.
3. After the user provides credentials for that site, call
   `browser_auth_ops.upsert_profile` with `confirm_write:true`, exact
   `origin`/`allowed_origins`, inferred selectors, and the provided
   username/password. The result is redacted and the saved file is mode `0600`
   when the filesystem supports POSIX modes.
4. Call `browser_auth_ops.ensure_login` for the same `tab_id`.
5. Finish with `browser_tab_lifecycle.finalize_task` for the same
   `workspace_key`.

Already-authenticated pages are a fast path: `ensure_login` inspects the page
first. If it is not a login page, it returns success with
`already_authenticated:true` and does not require a matching profile or resubmit
a form. If an exact-origin profile is available, it updates that profile's
non-secret sidecar with `last_reason:"already_authenticated"` so later
`list_profiles` calls show the current lifecycle state.

`browser_auth_ops` also recognizes the older DataHub local profile at
`~/.codex/secrets/datahub-groland-login.env` for compatibility. Prefer new
sites to use the generic profile directory above.

## Tab ownership policy

- User-opened tabs are `user_unmanaged`: scan/read-only by default. Do not navigate, type, click, close, or adopt them unless the user explicitly asks to operate on the current tab.
- TMWD work tabs are `tmwd_managed`: create them through `browser_tab_lifecycle`.
- Managed tab registry is stored outside the repo at `~/.tmwd-browser-mcp/tab-workspace/managed-tabs.json` by default. Override with `BROWSER_STRUCTURED_TAB_REGISTRY_PATH` for tests or isolated runs.
- `list_managed` returns live sessions by default and limits large arrays. Use `summary_only:true`, `max_items`, or `max_stale_items` for bounded diagnostics. Pass `include_disconnected:true` or `history:true` only when you need historical disconnected sessions.
- `create_managed` / `select_or_create` wait for the created tab to be visible by default (`wait_until:"listed"`, `wait_timeout_ms:3000`). Use `wait_until:"none"` only for fire-and-forget workflows.
- Default active-work entry:

```json
{
  "action": "select_or_create",
  "url": "http://localhost:3000/example",
  "workspace_key": "project-localhost",
  "ownership_policy": "tmwd_only",
  "reuse_scope": "origin_path"
}
```

- Use `fresh:true` or `reuse:false` only when a new TMWD-owned tab is required, such as OAuth/popup flows, before/after comparisons, or clean lifecycle checks.
- Use `keep:true` for a warm workspace tab that should survive `close_unkept`; otherwise task cleanup may close it.
- Use `prune_stale` or `list_managed` with `prune_stale:true` to remove registry records for managed tabs that no longer exist. This never closes unmanaged user tabs.
- End active browser tasks with `finalize_task` for the current `workspace_key` or `task_id` unless the user asked to keep the page open. Use stable workspace keys such as `<project>-<surface>` (`datahub-special-report`, not `datahub-special-report-footnotes`) so reuse and cleanup stay scoped and predictable.
- `create_managed` / `select_or_create` / `js-reverse new_page` responses include `finalize_hint`. Treat `finalize_hint.required:true` as a visible reminder to run the suggested `finalize_task` call before final response or handoff.
- `close_unkept` requires `workspace_key` or `task_id` by default. To intentionally clean every managed workspace, pass `scope:"all"` or `all:true` / `confirm_all:true`; unmanaged user tabs are still ignored.
- Use `npm run check:managed-tabs-clean` as a registry-only hygiene gate. It fails when unkept managed tab records remain, which catches missing finalizers even when no live browser action is needed. The full `npm run verify` gate records a managed-tab baseline first and then fails only on newly leaked unkept records, so unrelated pre-existing TMWD workspaces do not make repository verification flaky.
- Extension bridge supports `tabs.get` and `tabs.list` with `includeUnscriptable:true` for debugging visible `about:blank` / internal tabs. Default tab lists remain HTTP/HTTPS-only to avoid exposing unrelated browser state.
- One-shot Node helpers that import `src/tmwd-runtime.mjs` directly should call `await disposeTmwdRuntime()` in `finally`; MCP servers are long-lived, but shell helpers should close the TMWD websocket explicitly to avoid successful actions ending with a command timeout.
- Run `npm run check:managed-tab-live` for a real-browser open/reuse/close lifecycle smoke. After editing extension files, reload the unpacked extension before expecting new bridge capabilities in a running Chrome/Edge profile.
- Run `npm run check:auth-live` after auth/profile changes. It opens temporary managed tabs, uses an isolated local profile, verifies first-time suggestion/upsert, login submission, already-authenticated no-resubmit, lifecycle sidecar updates, CAPTCHA/MFA/SSO/OAuth-popup manual-required blocking, CAPTCHA assist dry-run planning, manual CAPTCHA/MFA/SSO/OAuth-popup completion resume, unknown-origin blocking, redaction, manual handoff context, and finalizer cleanup.
- Run `npm run check:captcha-assist-live` after CAPTCHA assist changes. It opens isolated local slider fixtures, validates dry-run coordinate transforms, region-only screenshot artifact creation, scroll-adjusted CDP clips, same-origin iframe coordinate conversion, cross-origin iframe degraded/manual handoff, first-pass slider vision correction, synthetic slider visual movement, and finalizes the managed tabs. It is planning-only.
- Run `npm run check:captcha-assist-physical-live` only for the optional local GUI gate. It is skipped by default and runs the physical slider drag only when `TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1` are set. Add `TMWD_CAPTCHA_ASSIST_REQUIRE_PHYSICAL=1` when the local gate should fail instead of skip. The wrapper performs native pointer preflight before opening the GUI fixture or creating a managed tab; missing click/drag requirements return structured skipped/blocked output without foregrounding Chrome or attempting physical input. Native pointer actions must be genuinely available; run `npm run check:native-pointer` first for a no-input readiness check. On macOS, `cliclick` is treated as pointer-capable only when its diagnostic probe does not report missing Accessibility privileges for the current terminal/Codex host. A passing physical branch must report both the completion flag and visible slider movement (`slider_visual_offset` / `handle_transform`) before it writes a sanitized local CAPTCHA proof under `~/.tmwd-browser-mcp/optional-live-proofs` or `TMWD_OPTIONAL_PROOF_DIR`; set `TMWD_CAPTCHA_ASSIST_WRITE_PROOF=0` to disable that write or `TMWD_CAPTCHA_ASSIST_REQUIRE_PROOF=1` to fail if proof persistence fails.
- Run `npm run check:native-pointer` after native provider or local OS permission changes. It is diagnostic-only by default, does not move the mouse, and reports whether the current provider supports `click` and `drag`; add `-- --require-pointer` only for a local hard gate. On macOS, when `cliclick` is installed but Accessibility permission is missing, its JSON/text output includes a `permission_recovery` plan with the System Settings path, a copyable `open` command, the verification command, and the explicit physical CAPTCHA gate command to run after readiness passes.
- Run `npm run check:ljqctrl` after `ljq-ctrl` provider changes. It is a diagnostic-only default gate and exits successfully when the local driver is not configured; use `TMWD_LJQCTRL_REQUIRE=1`, `TMWD_LJQCTRL_REQUIRE_EXECUTE=1`, or `TMWD_LJQCTRL_REQUIRE_CAPTURE=1` for machine-local hard gates.
- Run `npm run check:readiness` for the near-100 governance score. Its `ljqCtrl` row is platform-aware and uses the same diagnostic-only Python capability probe as `check:ljqctrl`; it distinguishes non-Windows not-applicable defaults, Windows/default not-configured, invalid configured interpreter, importable-but-execution-gated, and execution-bridge-available states without clicking, dragging, activating windows, capturing screenshots, reading cookies, or touching clipboard. It also reports an informational native pointer row when the OS provider lacks click/drag capability or required permissions, and the local CAPTCHA physical-proof row separately distinguishes native pointer blocked, not executed, and proof-missing states. When macOS Accessibility blocks `cliclick`, the affected readiness JSON gaps include the same structured `permission_recovery` plan as `check:native-pointer`, so callers can show the Settings path and copyable recovery commands directly. Optional proof gaps also include a compact `proof_plan` with the plan command, proof directory, and missing proof ids.
- Run `npm run check:optional-live-proofs` when collecting near-100 optional evidence from the local CAPTCHA physical gate, Linux/Windows native-input hosts, or approved external OAuth/SSO/MFA providers. Proof files live outside the repo by default under `~/.tmwd-browser-mcp/optional-live-proofs`, must be sanitized, and are documented in `docs/optional-live-proofs.md`. Use `npm run plan:optional-live-proofs` for a no-input, no-browser proof collection runbook with per-proof status, accepted proof freshness, host/provider requirements, blockers, `next_command`, `collection_steps`, commands, and evidence fields. Use `npm run proof:optional-live-status` for an operator-facing accepted/missing checklist with owner, next command, record/write/replace commands, validation command, and the no-fabricated-proof completion policy. Use `npm run proof:optional-live-template` to generate safe `ok:false` starter templates instead of hand-writing proof JSON; after a real host/provider gate produces sanitized JSON, use `npm run proof:optional-live-record -- --id <proof-id> --from-json <sanitized.json>` for dry-run validation, add `--write` only to persist canonical proof repo-externally, and add `--replace` only for an intentional audited refresh of an existing proof.

## Codex host hard-finally contract

Wrapper-level cleanup is not a substitute for a host/runtime turn finalizer. A
Codex-style host that wants hard-finally semantics should treat every MCP tool
result as a possible cleanup signal and register any returned
`finalize_hint.required:true` before the assistant turn ends.

Use `src/codex-host-finalizer.mjs` as the repo-side contract adapter:

```js
import { createCodexFinalizerTracker } from "/path/to/browser67/src/codex-host-finalizer.mjs";

const finalizer = createCodexFinalizerTracker({
  default_arguments: {
    tmwd_mode: "tmwd",
    tmwd_transport: "auto",
    timeout_ms: 20000,
  },
});

// After each MCP tool result:
finalizer.addToolResult({
  source_server: "tmwd_browser",
  source_tool: "browser_tab_lifecycle",
  result: mcpToolResult,
});

// In the host turn-end finally block:
const plan = finalizer.plan();
for (const call of plan.calls) {
  // Dispatch call.server + call.tool with call.arguments through the host MCP client.
}
```

Host policy:

- Run this from a real `finally` path that executes before the final user-facing
  response, handoff, or interrupted-turn checkpoint.
- De-duplicate by `call.key`; each call is already scoped by `workspace_key` and
  / or `task_id`.
- Never auto-run `scope:"all"`, `all:true`, or `confirm_all:true`; the planner
  returns those hints under `ignored` with `reason:"auto_scope_all_blocked"`.
- Preserve `keep:true`: hints for kept tabs are `required:false`, and
  `finalize_task` preserves kept managed tabs even if called for the same scope.
- Log `pending_count`, `ignored_count`, `scope_all_blocked_count`, closed tabs,
  remaining tabs, and finalizer errors. Do not silently swallow cleanup failure.
- On process restart or a fresh turn, use `npm run check:managed-tabs-clean` or a
  registry-backed recovery pass to detect missed finalizers.

Validate the adapter with:

```bash
npm run check:codex-host-finalizer
```

## JS reverse boundary

The bundled `js-reverse` MCP focuses on observe-first, hook-preferred workflows:

- supported: page health, tab selection, page API/interface discovery, request
  initiator tracing, scripts, DOM snapshot, performance resources,
  fetch/xhr/websocket/eval/timer/cookie/function hooks, evidence recording,
  report export, and minimal Node rebuild bundle export.
- intentionally not full debugger yet: persistent `Debugger.pause`, callframe
  stepping, and breakpoint state currently return `not_supported` with hook-based
  fallbacks. Use a dedicated remote CDP debug browser only when callframe-level
  debugging is required.

## Failure policy

For login-state tasks, fail closed if TMWD is unavailable. Do not silently use
remote-debugging CDP because it may be a separate profile.

## Maintenance checks

When GenericAgent changes its TMWebDriver extension, resync this standalone
project from the local upstream checkout:

```bash
cd /path/to/browser67
npm run extension:sync
npm run extension:check
npm run upstream:lock
npm run check
npm run check:js-reverse-live
```

After extension source changes, run `npm run setup`, reload the unpacked
extension from `~/.tmwd-browser-mcp/browser/tmwd_cdp_bridge/`, then refresh old
tabs so content scripts are reinjected. If manually loading from the standalone
project, run `npm run setup:local-extension` and load exactly:

```text
/path/to/browser67/runtime/chrome-extension/tmwd_cdp_bridge/
```

Before committing maintenance changes:

```bash
npm run verify
```
