# Optional live proof artifacts

`npm run check:optional-live-proofs` validates sanitized, repo-external JSON
proofs for near-100 optional gates that cannot be completed on every machine:

- Local CAPTCHA physical-input live proof.
- Linux native physical-input live proof.
- Windows native physical-input live proof.
- External OAuth popup handoff/resume live proof.
- External cross-domain SSO handoff/resume live proof.
- External MFA handoff/resume live proof.

The default proof directory is:

```text
~/.browser67/optional-live-proofs
```

Override it when needed:

```bash
TMWD_OPTIONAL_PROOF_DIR=/path/to/proofs npm run check:optional-live-proofs
```

By default the check is non-blocking and reports missing optional proofs. Use
`--strict` only for a local release gate that should fail until all optional
proofs are present:

```bash
npm run check:optional-live-proofs -- --strict
```

Print the current proof collection plan without opening Chrome, creating tabs,
moving the mouse, or writing proof files:

```bash
npm run plan:optional-live-proofs
npm run plan:optional-live-proofs -- --id idp-oauth-popup
npm run plan:optional-live-proofs -- --json
```

The plan reports each proof id, current satisfaction status, required host or
provider kind, safe commands, blockers such as macOS Accessibility permission,
the dry-run/write record commands, and the evidence fields that must be present
before a proof is accepted. JSON output includes enough state for agents and UIs
to resume collection directly from a readiness gap:

- `accepted`: accepted proof path plus `checked_at`, `expires_at`,
  `expires_in_days`, and `expires_soon` when a proof is already valid.
- `next_command`: the next safe command or host/provider handoff to run.
- `collection_steps`: a short ordered runbook for collecting that proof.
- `commands.record_replace`: the audited refresh command for replacing an
  existing canonical proof after a newer sanitized run is available.

Use `--id <proof-id>` to produce a single-proof handoff packet for a specific
host or provider owner. The filtered plan keeps the same safe defaults and
validates the proof id before printing commands.

Print an operator-facing status/checklist without executing any listed command:

```bash
npm run proof:optional-live-status
npm run proof:optional-live-status -- --id native-live-linux
npm run proof:optional-live-status -- --json
```

The status output is optimized for near-100 proof collection handoff. It groups
accepted proofs and missing checklist entries, assigns each missing item to the
required host/provider owner, repeats the dry-run/write/replace record commands,
and includes a completion policy that explicitly forbids fabricated cross-OS or
external IdP proofs. Like the plan command, it does not move the mouse, open
Chrome, create tabs, read browser private state, or write proof files.
Use `--id <proof-id>` when sending only one checklist item to an external
Linux/Windows/IdP operator.

Generate safe starter templates instead of hand-writing JSON:

```bash
npm run proof:optional-live-template
npm run proof:optional-live-template -- --id native-live-linux
npm run proof:optional-live-template -- --all --write
```

`--write` stores `*.template.json` files under the proof directory using
`ok:false` and `template_only:true`, so templates do not satisfy the audit until
the real live gate has been run and the proof is intentionally edited into a
sanitized passing artifact. Passing proofs must remove `template_only:true` and
replace any placeholder command with the exact approved command or runbook entry
that produced the sanitized evidence. The local CAPTCHA physical gate writes its
passing proof automatically after a successful run:

After a Linux/Windows host or approved external IdP live gate produces a
sanitized JSON proof, record it through the validator instead of copying files
by hand:

```bash
npm run proof:optional-live-record -- --id native-live-linux --from-json /path/to/sanitized.json
npm run proof:optional-live-record -- --id native-live-linux --from-json /path/to/sanitized.json --write
```

The default record command is dry-run only. It accepts a JSON file path, validates
the proof against the selected requirement, prints input/output SHA-256 hashes,
prints a `redaction_checklist`, and does not read environment secrets, browser
state, cookies, tokens, or clipboard data. The validator rejects obvious
sensitive key names, Bearer/JWT/cookie-like values, templates, placeholder
commands, and unredacted IdP tenant, account, email, username, phone, domain,
provider, client, org, or user identifiers. `--write` persists the canonical JSON to the
repo-external proof directory as `<proof-id>.json`; it refuses to overwrite an
existing proof unless `--replace` is also supplied for an intentional audited
refresh.

```bash
npm run check:native-pointer

TMWD_CAPTCHA_ASSIST_PHYSICAL=1 \
TMWD_CAPTCHA_ASSIST_CONFIRM=1 \
npm run check:captcha-assist-physical-live
```

The gate only counts as executable when the selected physical provider can
actually affect the browser window. The physical wrapper performs native pointer
preflight before opening the GUI fixture or creating a managed tab; if click or
drag is unavailable, it returns structured skipped/blocked output without
foregrounding Chrome or attempting physical input. On macOS, `native-os` pointer
actions depend on `cliclick`; the readiness probe treats `cliclick` as
unavailable for click and drag when its diagnostic output reports missing
Accessibility privileges for the current terminal/Codex host.
`npm run check:native-pointer` is diagnostic-only by default and does not move
the mouse; use `npm run check:native-pointer -- --require-pointer` only when a
local release gate should fail until click/drag support is genuinely available.
When macOS `cliclick` is installed but Accessibility permission is missing, the
`check:native-pointer -- --json` report, plus the affected
`check:readiness -- --json` optional gaps, include `permission_recovery` with:

- `settings_path`: the exact System Settings pane to open.
- `open_settings_command`: a copyable macOS `open` command.
- `manual_steps`: the verify command and explicit physical-gate command.
- `safe_defaults`: confirmation that the readiness report does not move the
  mouse, open Chrome, create managed tabs, or read browser private state.

Readiness optional proof gaps also include a compact `proof_plan` object with
the active proof directory, missing proof ids, and the copyable
`npm run plan:optional-live-proofs -- --json` command. This keeps agent/UI
callers on the same collection path as the CLI without embedding the full plan
in every readiness response.

Set `TMWD_CAPTCHA_ASSIST_WRITE_PROOF=0` to disable that automatic proof write, or
`TMWD_CAPTCHA_ASSIST_REQUIRE_PROOF=1` to fail the gate if the sanitized proof
cannot be persisted.

Proof files must be sanitized. The validator rejects keys whose names look like
credentials, cookies, tokens, secrets, or session material. Do not store browser
cookies, IdP tokens, screenshots with private data, passwords, authorization
headers, or raw profile/session state in proof files.
For external IdP proofs, tenant, account, email, username, phone, domain,
provider, client, org, and user identifiers must be represented only as redacted,
anonymous, hashed, synthetic, fixture, or test-tenant/test-provider values.

The audit reports JSON parse failures as `invalid_file_count`. The plan/status
commands separately report rejected proof candidates as `rejected_candidate_count`
when a JSON proof targets the right requirement but still fails validation, for
example when a generated `*.template.json` file is present, when a placeholder
command remains, when a proof is expired, when required click/drag actions are
missing, or when evidence does not explicitly state the safe boundaries.
Rejected candidates remain visible for cleanup, but they do not block completion
when every requirement already has a separate accepted proof. A passing proof
must be explicit about these invariants:

- Native proofs include both `click` and `drag` actions.
- Native proofs set `evidence.managed_tab_only:true`.
- Native proofs set `evidence.fullscreen_screenshot:false`.
- Native and IdP proofs set `evidence.secrets_redacted:true`.
- Local CAPTCHA physical proofs set `evidence.browser_private_state_access:false`.
- Local CAPTCHA physical proofs include visible slider movement evidence:
  `evidence.slider_visual_offset`, `evidence.slider_delta_live`, and
  `evidence.handle_transform`. The validator rejects local CAPTCHA proofs unless
  both movement fields are at least `180` pixels and the transform is
  `translateX(...px)`.
- Local CAPTCHA physical proofs include checkbox click evidence:
  `checkbox_completed:true` and `evidence.checkbox_click_inside:true`.

Accepted proofs expose freshness metadata through `check:optional-live-proofs`,
`plan:optional-live-proofs`, and `check:readiness`. This lets callers distinguish
fresh accepted proof, soon-expiring proof, expired proof, and missing proof
without reading or storing any browser private state.

## Local CAPTCHA physical proof example

```json
{
  "type": "captcha_physical_live",
  "ok": true,
  "platform": "darwin",
  "provider_id": "native-os",
  "actions": ["drag", "click"],
  "checked_at": "2026-06-17T00:00:00.000Z",
  "expires_at": "2026-09-17T00:00:00.000Z",
  "command": "TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1 npm run check:captcha-assist-physical-live",
  "managed_tab_only": true,
  "fixture": "local TMWD-owned managed tab",
  "slider_completed": true,
  "checkbox_completed": true,
  "fullscreen_screenshot": false,
  "js_cdp_widget_click": false,
  "secrets_redacted": true,
  "evidence": {
    "assist_target": "slider",
    "assist_targets": ["slider", "checkbox"],
    "slider_visual_offset": 260,
    "slider_delta_live": "260",
    "handle_transform": "translateX(260px)",
    "checkbox_click_inside": true,
    "checkbox_status_text": "completed",
    "browser_private_state_access": false
  }
}
```

The `platform` must match the current host that runs `check:readiness`; stale or
cross-host local CAPTCHA proofs do not satisfy the local physical gate.

## Native proof example

```json
{
  "type": "native_live",
  "ok": true,
  "platform": "linux",
  "provider_id": "native-os",
  "actions": ["get_window_rect", "click", "drag"],
  "checked_at": "2026-06-17T00:00:00.000Z",
  "expires_at": "2026-09-17T00:00:00.000Z",
  "command": "npm run check:captcha-assist-physical-live",
  "evidence": {
    "fixture": "local TMWD-owned managed tab",
    "managed_tab_only": true,
    "fullscreen_screenshot": false,
    "secrets_redacted": true
  }
}
```

Create a separate file for Windows with `"platform": "win32"`.

## External IdP proof example

```json
{
  "type": "idp_live",
  "ok": true,
  "provider_kind": "oauth_popup",
  "checked_at": "2026-06-17T00:00:00.000Z",
  "expires_at": "2026-09-17T00:00:00.000Z",
  "command": "npm run check:idp-oauth-popup-live",
  "manual_required_verified": true,
  "resume_verified": true,
  "evidence": {
    "approved_provider": "redacted test tenant",
    "profile_scope": "repo-external exact-origin profile",
    "secrets_redacted": true
  }
}
```

Valid `provider_kind` values are:

- `oauth_popup`
- `cross_domain_sso`
- `mfa`

These proofs do not replace deterministic local contracts. They only let the
readiness audit distinguish "not implemented" from "implemented locally but not
yet proven against approved external providers or other operating systems".
