# Global prompt snippet

Copy this section into an agent's global or project instructions when the agent
should use browser67's TMWD and JS reverse MCP tools. Replace
`/path/to/browser67` with the local clone path if you keep path references in
your prompt.

```markdown
## 页面和浏览器操作

1. 真实 Chrome/Edge 登录态、当前 tab、cookie/session 感知读取、TMWD CDP bridge batch、后台 tab、下载/上传、file chooser 规划、clipboard 写入/粘贴 wrapper、managed tab lifecycle 优先使用 `tmwd_browser` MCP；登录态任务默认 `tmwd_mode=tmwd`，禁止静默 fallback 到 remote-debugging CDP。
2. TMWD 主动操作网页时默认使用 `browser_tab_lifecycle action=select_or_create` 创建或复用 TMWD-owned managed tab；用户自己打开的 unmanaged tab 默认只读观察，不导航、不点击、不输入、不关闭、不接管。
3. 页面 API/接口发现、请求 initiator 追踪、签名链路定位、脚本搜索、网络/WS 采样、Hook、证据导出、本地补环境包优先使用 `js-reverse` MCP，并遵循 `/path/to/browser67/docs/codex-integration.md` 与 `js-reverse` skill。
4. Chrome profile 是用户私有运行态：不查看 cookies、密码、session stores、无关历史、无关标签页、无关账号数据；外部可见动作按危险操作确认。
5. CDP 只用于 Runtime、Network、Performance、DOM 精确状态、下载/file chooser、自动化断言；普通点击/观察不用 CDP。
6. 涉及用户可见页面、交互、表单、登录态、下载、上传、导航、响应式、动画或性能体验的改动，交付前尽量浏览器验证。
```

Recommended companion references:

- `docs/codex-integration.md` for MCP configuration.
- `docs/agent-setup.md` for complete agent setup.
- `skills/tmwd-browser-mcp/SKILL.md` for TMWD browser tool routing.
- `skills/js-reverse/SKILL.md` for JS reverse workflows.
