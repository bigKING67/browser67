# TMWD Browser MCP for JS reverse

This project provides the real-browser side of JS reverse workflows.

## Primary path

Use `tmwd_browser` when the task needs:

- the user's logged-in Chrome/Edge profile
- existing tabs and cookies
- HttpOnly cookie evidence through the bridge command
- CDP bridge commands against the real browser tab
- background tab screenshots or DOM/CDP actions
- pre-reverse sampling before switching to JSReverser-MCP / remote CDP

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

## Boundary with JSReverser-MCP

- TMWD is for real-browser state, cookies, page-visible runtime evidence, and CDP bridge operations.
- JSReverser-MCP / remote CDP is for Network initiator, Debugger, Script source, preload hooks, AST/VMP, and rebuild bundles.
- If remote CDP opens a separate profile, do not assume it has the user's logged-in cookies. First sample with TMWD, then decide whether to log in to debug Chrome or port non-sensitive evidence.

## File upload strategy

- In-memory synthetic file: DataTransfer API can be enough.
- Real local file path: use CDP `DOM.setFileInputFiles`, preferably in the same batch that discovers the input node.
- Native file chooser / isTrusted blocks: use `browser_native_input` dry-run first, then execute only when the task requires it.

