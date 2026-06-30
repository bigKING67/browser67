# TMWD Browser MCP for JS reverse

This project provides the real-browser side of JS reverse workflows.

## Primary path

Use `tmwd_browser` when the task needs:

- the user's logged-in Chrome/Edge profile
- existing tabs and cookies
- HttpOnly cookie evidence through the bridge command
- CDP bridge commands against the real browser tab
- background tab screenshots or DOM/CDP actions
- generic real-browser automation before switching to reverse-specific tooling
- transport health checks with `browser_transport_health`
- first-class readiness waits with `browser_wait`
- repo-external task run artifacts with `browser_run_ops`
- repo-external PNG screenshot artifacts with `browser_screenshot_ops`
- long-running browser JS through `browser_job_ops` when synchronous results would be brittle

Use `js-reverse` when the task needs:

- signature-chain tracing
- script search and code collection
- fetch/xhr/websocket/eval/timer/cookie/function hooks
- runtime evidence recording
- frame tree listing with `list_frames`
- local Node rebuild bundle export

Default arguments:

```json
{
  "tmwd_mode": "tmwd",
  "tmwd_transport": "auto"
}
```

## Bridge command samples

```json
{"cmd":"tabs"}
{"cmd":"cookies"}
{"cmd":"cdp","method":"Runtime.evaluate","params":{"expression":"document.title"}}
{"cmd":"batch","commands":[{"cmd":"tabs"},{"cmd":"cookies"}]}
```

## Boundary with js-reverse MCP and remote CDP

- `tmwd_browser` is for real-browser state, cookies, page-visible runtime evidence, and CDP bridge operations.
- `js-reverse` is for observe-first reverse workflows on the same TMWD-backed real browser: scripts, performance resources, runtime hooks, evidence, and rebuild bundles.
- Use `browser_execute_js output_mode:"compact"` with explicit `max_return_chars` when collecting large DOM/network payloads for reverse tasks.
- Use `browser_screenshot_ops` instead of hand-written `Page.captureScreenshot`
  calls when visual evidence matters; it supports `viewport`, `selector`,
  `clip`, and bounded `full_page`, writes PNGs outside the repo, and returns
  artifact metadata rather than base64. Use `npm run runtime:cleanup:dry-run`
  to audit retained run/screenshot artifacts before applying `--write`.
- `browser_job_ops` is intentionally in-process (`durable:false`); `cancel` records intent but does not preempt page-side JS.
- `record_reverse_evidence` is normalized to `evidence.v1`; include source/confidence/request/script/artifact links whenever known.
- `list_frames` lists same-origin descendants recursively and degrades cross-origin frames to element metadata. Do not infer inner DOM for inaccessible frames.
- Persistent `Debugger.pause`, callframe stepping, and breakpoint state are intentionally explicit remote CDP/debug-browser work. If remote CDP opens a separate profile, do not assume it has the user's logged-in cookies. First sample with TMWD, then decide whether to log in to debug Chrome or port non-sensitive evidence.

## File upload strategy

- In-memory synthetic file: DataTransfer API can be enough.
- Real local file path: use CDP `DOM.setFileInputFiles`, preferably in the same batch that discovers the input node.
- Native file chooser / isTrusted blocks: use `browser_native_input` dry-run first, then execute only when the task requires it.
