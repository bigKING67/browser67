# Global prompt snippet

Copy this section into an agent's global or project instructions when the agent
should use browser67 real-browser tools and JS reverse tools. Replace
`/path/to/browser67` with the local clone path if you keep path references in
your prompt.

```markdown
## 页面和浏览器操作

1. 真实 Chrome/Edge 登录态、当前 tab、cookie/session 感知读取、CDP bridge batch、后台 tab、下载/上传、file chooser 规划、clipboard 写入/粘贴 wrapper、managed tab lifecycle、run lifecycle、transport health、first-class wait 和 run-backed browser jobs 优先使用 browser67 real-browser MCP；当前 MCP 工具 key 保持 `tmwd_browser`，`tmwd` 只作为 transport/protocol 术语。登录态任务默认 `tmwd_mode=tmwd`，禁止静默 fallback 到 remote-debugging CDP。大 DOM/网络 payload 用 `browser_execute_js output_mode:"compact"` + `max_return_chars`；页面 readiness 用 `browser_wait`，不要用固定 sleep 当证明；多步任务用 `browser_run_ops` 在 repo 外的 active browser67 home 记录 `run.json`/`events.ndjson`/`artifacts`/`logs`；长任务可用 `browser_job_ops`，有效 run-backed job 会持久化 checkpoint，MCP 重启后未完成任务显式恢复为 `interrupted`，但 `abort_supported:false` 表示已在执行的页面 JS 仍不能被抢占。截图和证据 bundle 用 `browser_screenshot_ops` / `browser_evidence_bundle_ops` 写 repo 外 artifact，不返回 base64。
2. browser67 主动操作网页时默认使用 `browser_tab_lifecycle action=select_or_create` 创建或复用 browser67-owned managed tab，并使用稳定 `workspace_key`（项目/页面级，不用一次性小节名）；用户自己打开的 unmanaged tab 默认只读观察，不导航、不点击、不输入、不关闭。仅当用户明确要求操作某个已打开、已登录的 exact tab 时，执行 `inspect_adoption -> adopt_existing`，不要重新打开页面或重复登录；任务结束时 `finalize_task` 释放 adopted lease 而不关闭用户 tab。用户/外部导航、扩展重连或 ownership/lease generation 变化导致 suspended 后，必须重新 inspection/adoption。其他 managed tab 在任务结束且用户未要求保留页面时，默认对当前 `workspace_key` 或 `task_id` 执行 `browser_tab_lifecycle action=finalize_task`，只关闭 `keep:false` 的 browser67 managed tabs，保留 `keep:true`，不关闭 unmanaged 用户标签页；跨 workspace 或 `scope=all` 清理前说明范围并确认。若工具返回 `finalize_hint.required:true`，按 `finalize_hint.suggested_arguments` 收尾。
3. browser67 managed tab 若落到登录页，优先用 `browser_auth_ops.ensure_login`；它会先判断页面是否已登录，已登录则不重复提交。登录/profile metadata、CAPTCHA/MFA/SSO/OAuth popup、provider config、optional live proof 都必须写 repo 外且输出 redacted；未知 origin blocked；manual required 不自动提交；物理输入、provider 坐标或 protocol solver 必须走显式确认链路。详细 auth/CAPTCHA 生命周期合同见 `/path/to/browser67/docs/codex-integration.md`。
4. 页面 API/接口发现、请求 initiator 追踪、签名链路定位、脚本搜索、frame listing、网络/WS 采样、Hook、证据导出、本地补环境包优先使用 `js-reverse` MCP，并遵循 `/path/to/browser67/docs/codex-integration.md` 与 `js-reverse` skill。复杂 iframe/微前端先用 `list_frames` 建 frame tree：same-origin frame 可继续递归观察，cross-origin frame 只信 element metadata/rect/sandbox/name 等 degraded 证据，不推断内部 DOM。`inject_preload_script` 不等于保证 true `document_start`，需区分 current document eval、next navigation preload、extension-level content script 和 remote CDP preload。`record_reverse_evidence` 输出统一按 `evidence.v1` 归档。`js-reverse new_page` 打开的页面同样是 browser67-managed；逆向任务结束默认对同一 `workspace_key`/`task_id` 执行 `js-reverse finalize_task`，除非需要保留页面做证据复核；若 `new_page` 返回 `finalize_hint.required:true`，交付前必须处理。
5. Chrome profile 是用户私有运行态：不查看 cookies、密码、session stores、无关历史、无关标签页、无关账号数据；外部可见动作按危险操作确认。
6. CDP 只用于 Runtime、Network、Performance、DOM 精确状态、下载/file chooser、自动化断言；普通点击/观察不用 CDP。
7. 涉及用户可见页面、交互、表单、登录态、下载、上传、导航、响应式、动画或性能体验的改动，交付前尽量浏览器验证。
```

Recommended companion references:

- `docs/codex-integration.md` for MCP configuration.
- `docs/agent-setup.md` for complete agent setup.
- `skills/browser67/SKILL.md` for browser67 project/runtime routing.
- `skills/tmwd-browser-mcp/SKILL.md` remains the legacy browser67 routing alias.
- `skills/js-reverse/SKILL.md` for JS reverse workflows.
