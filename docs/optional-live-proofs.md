# Optional live proof artifacts

`npm run check:optional-live-proofs` validates sanitized, repo-external JSON
proofs for near-100 optional gates that cannot be completed on every machine:

- Linux native physical-input live proof.
- Windows native physical-input live proof.
- External OAuth popup handoff/resume live proof.
- External cross-domain SSO handoff/resume live proof.
- External MFA handoff/resume live proof.

The default proof directory is:

```text
~/.tmwd-browser-mcp/optional-live-proofs
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
that produced the sanitized evidence.

Proof files must be sanitized. The validator rejects keys whose names look like
credentials, cookies, tokens, secrets, or session material. Do not store browser
cookies, IdP tokens, screenshots with private data, passwords, authorization
headers, or raw profile/session state in proof files.

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
    "fullscreen_screenshot": false
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
