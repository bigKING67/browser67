# Codex integration

Recommended Codex MCP block:

```toml
[mcp_servers.tmwd_browser]
command = "node"
args = ["/Users/gaoqian/Documents/sixseven/codeproject/tmwd-browser-mcp/src/server.mjs"]

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
```

## Tool routing

- `tmwd_browser`: high-frequency real browser tasks, logged-in pages, cookies, CDP bridge, background tabs, batch actions, JS reverse sampling.
- `open_browser_use`: official generic Chrome automation and handoff/deliverable tabs.
- in-app Browser: localhost/file previews without Chrome profile state.
- Computer Use: desktop UI and pure visual pointer/keyboard actions.
- `remote_cdp`: explicit debug Chrome/CI/JS reverse protocol work, not ordinary login-state tasks.

## Failure policy

For login-state tasks, fail closed if TMWD is unavailable. Do not silently use
remote-debugging CDP because it may be a separate profile.

## Maintenance checks

When GenericAgent changes its TMWebDriver extension, resync this standalone
project from the local upstream checkout:

```bash
cd /Users/gaoqian/Documents/sixseven/codeproject/tmwd-browser-mcp
npm run extension:sync
npm run extension:check
npm run check
```

After extension source changes, run `npm run setup`, reload the unpacked
extension from `~/.tmwd-browser-mcp/browser/tmwd_cdp_bridge/`, then refresh old
tabs so content scripts are reinjected.
