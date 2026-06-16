# Global prompt snippet

Copy this section into an agent's global or project instructions when the agent
should use browser67's TMWD and JS reverse MCP tools. Replace
`/path/to/browser67` with the local clone path if you keep path references in
your prompt.

```markdown
## 页面和浏览器操作

1. 真实 Chrome/Edge 登录态、当前 tab、cookie/session 感知读取、TMWD CDP bridge batch、后台 tab、下载/上传、file chooser 规划、clipboard 写入/粘贴 wrapper、managed tab lifecycle 优先使用 `tmwd_browser` MCP；登录态任务默认 `tmwd_mode=tmwd`，禁止静默 fallback 到 remote-debugging CDP。
2. TMWD 主动操作网页时默认使用 `browser_tab_lifecycle action=select_or_create` 创建或复用 TMWD-owned managed tab，并使用稳定 `workspace_key`（项目/页面级，不用一次性小节名）；用户自己打开的 unmanaged tab 默认只读观察，不导航、不点击、不输入、不关闭、不接管。任务结束且用户未要求保留页面时，默认对当前 `workspace_key` 或 `task_id` 执行 `browser_tab_lifecycle action=finalize_task`，只关闭 `keep:false` 的 TMWD managed tabs，保留 `keep:true`，不关闭 unmanaged 用户标签页；跨 workspace 或 `scope=all` 清理前说明范围并确认。若工具返回 `finalize_hint.required:true`，按 `finalize_hint.suggested_arguments` 收尾。
3. TMWD managed tab 若落到登录页，优先用 `browser_auth_ops.ensure_login`；它会先判断页面是否已登录，已登录则不重复提交；登录页只使用 repo 外本机 login profile，要求 current origin exact-match allowlist，输出 redacted，未知 origin 不自动填凭据。新网站首次拿到用户提供的账号密码时，用 `browser_auth_ops.suggest_profile` 推断 selector，再用显式 `browser_auth_ops.upsert_profile(confirm_write:true)` 保存到 repo 外 profile，不能把保存凭据做成 tab 创建的隐式副作用。profile 可带 repo 外 `<profile>.meta.json` 生命周期 sidecar，但只能记录非敏感时间戳/状态；CAPTCHA/MFA/SSO-only 页面返回 `manual_required_*`，不继续猜测或提交。
4. 页面 API/接口发现、请求 initiator 追踪、签名链路定位、脚本搜索、网络/WS 采样、Hook、证据导出、本地补环境包优先使用 `js-reverse` MCP，并遵循 `/path/to/browser67/docs/codex-integration.md` 与 `js-reverse` skill。`js-reverse new_page` 打开的页面同样是 TMWD-managed；逆向任务结束默认对同一 `workspace_key`/`task_id` 执行 `js-reverse finalize_task`，除非需要保留页面做证据复核；若 `new_page` 返回 `finalize_hint.required:true`，交付前必须处理。
5. Chrome profile 是用户私有运行态：不查看 cookies、密码、session stores、无关历史、无关标签页、无关账号数据；外部可见动作按危险操作确认。
6. CDP 只用于 Runtime、Network、Performance、DOM 精确状态、下载/file chooser、自动化断言；普通点击/观察不用 CDP。
7. 涉及用户可见页面、交互、表单、登录态、下载、上传、导航、响应式、动画或性能体验的改动，交付前尽量浏览器验证。
```

Recommended companion references:

- `docs/codex-integration.md` for MCP configuration.
- `docs/agent-setup.md` for complete agent setup.
- `skills/tmwd-browser-mcp/SKILL.md` for TMWD browser tool routing.
- `skills/js-reverse/SKILL.md` for JS reverse workflows.
