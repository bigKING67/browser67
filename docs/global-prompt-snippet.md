# Global prompt snippet

Copy this section into an agent's global or project instructions when the agent
should use browser67's TMWD and JS reverse MCP tools. Replace
`/path/to/browser67` with the local clone path if you keep path references in
your prompt.

```markdown
## 页面和浏览器操作

1. 真实 Chrome/Edge 登录态、当前 tab、cookie/session 感知读取、TMWD CDP bridge batch、后台 tab、下载/上传、file chooser 规划、clipboard 写入/粘贴 wrapper、managed tab lifecycle 优先使用 `tmwd_browser` MCP；登录态任务默认 `tmwd_mode=tmwd`，禁止静默 fallback 到 remote-debugging CDP。
2. TMWD 主动操作网页时默认使用 `browser_tab_lifecycle action=select_or_create` 创建或复用 TMWD-owned managed tab，并使用稳定 `workspace_key`（项目/页面级，不用一次性小节名）；用户自己打开的 unmanaged tab 默认只读观察，不导航、不点击、不输入、不关闭、不接管。任务结束且用户未要求保留页面时，默认对当前 `workspace_key` 或 `task_id` 执行 `browser_tab_lifecycle action=finalize_task`，只关闭 `keep:false` 的 TMWD managed tabs，保留 `keep:true`，不关闭 unmanaged 用户标签页；跨 workspace 或 `scope=all` 清理前说明范围并确认。若工具返回 `finalize_hint.required:true`，按 `finalize_hint.suggested_arguments` 收尾。
3. TMWD managed tab 若落到登录页，优先用 `browser_auth_ops.ensure_login`；它会先判断页面是否已登录，已登录则不重复提交；登录页只使用 repo 外本机 login profile，要求 current origin exact-match allowlist，输出 redacted，未知 origin 不自动填凭据。新网站首次拿到用户提供的账号密码时，用 `browser_auth_ops.suggest_profile` 推断 selector，再用显式 `browser_auth_ops.upsert_profile(confirm_write:true)` 保存到 repo 外 profile，不能把保存凭据做成 tab 创建的隐式副作用。profile 可带 repo 外 `<profile>.meta.json` 生命周期 sidecar，但只能记录非敏感时间戳/状态；CAPTCHA/MFA/SSO-only/OAuth popup 页面返回 `manual_required_*`，OAuth popup 兼容使用 `manual_required_sso` 且 `manual_context.kind=oauth_popup`；`manual_context` 只作非敏感 handoff/resume 提示，不包含凭据/cookie/token/session/page content，不继续猜测或提交。CAPTCHA `manual_context` 可含 `captcha_kind`/`captcha_assist`；按物理/人工流程处理：可先用 `browser_auth_ops.plan_captcha_assist` dry-run 获取候选 DOM client rect/slider drag hint/viewport/native/physical-provider 能力、`coordinate_transform` 屏幕像素估算和区域化 vision 校正计划，不点击、不截图；需要真实校正时加 `run_vision_correction:true`，只截取计划区域并把临时 PNG artifact 写到 repo 外，返回 path/sha256/clip/TTL、scroll-adjusted CDP clip、same-origin iframe `frame_path` 和 first-pass 滑块/复选框坐标校正，复选框优先使用 left-biased `checkbox_click_hint` 和 vision-corrected hotspot；cross-origin captcha-like iframe 必须 degraded/manual-only：保留 iframe rect 和 clipped screenshot plan，但不推断内部控件、不向 iframe 发送物理输入；只有 TMWD-owned managed tab、显式 `confirm_physical_input:true`，并提供 screen 坐标、或显式 `auto_screen_coordinates:true` + `confirm_auto_coordinates:true`、或 `use_vision_corrected_coordinates:true` + `confirm_corrected_coordinates:true` 时，才可用 `browser_auth_ops.assist_captcha` 走 physical provider input；正常 TMWD-owned tab 由工具先用 TMWD tabs.switch 前台化、按 `pre_input_settle_ms` settle 后刷新 planner/vision 坐标，再发送 physical provider input，`window_title/window_pid/window_active_confirmed` 只是异常窗口管理 fallback；`physical_input_provider:auto` 当前通过 `native-os` 执行，除非 guarded `ljq-ctrl` bridge 显式启用且报告可执行目标 action；真实 physical gate 前先跑 `npm run check:native-pointer` 做不移动鼠标的 click/drag readiness 检查；`npm run check:captcha-assist-physical-live` 只有显式物理 gate 允许时才运行真实拖拽/点击 fixture，且会先做 native pointer preflight，缺 click/drag 时在打开 GUI fixture 或创建 managed tab 前返回 structured skipped/blocked；成功后默认把 sanitized proof 写到 repo 外 optional-live-proofs；外部 Linux/Windows/IdP proof 先用 `npm run plan:optional-live-proofs` 查看 runbook，再用 `npm run proof:optional-live-record -- --id <proof-id> --from-json <sanitized.json>` dry-run 校验，只有加 `--write` 才持久化；用 `npm run check:ljqctrl` 诊断本机 Python `ljqCtrl` import 和 click/window-region capture 能力，该诊断默认不激活窗口、不点击、不拖拽、不截图，并输出 `python_candidates` 候选矩阵；`TMWD_LJQCTRL_PYTHON` 可指定一个 Python，`TMWD_LJQCTRL_PYTHON_CANDIDATES` 可指定系统路径分隔符分隔的多个候选，`TMWD_LJQCTRL_EXECUTE=1` 才允许 guarded bridge 调用 `ljqCtrl.Click` 或 clipped window-region capture artifact；滑块还要求目标 screen 坐标（显式、估算或 vision-corrected）和 physical drag 支持；macOS `native-os` drag 还要求 `cliclick` 且当前 terminal/Codex host 已授予 Accessibility 权限。禁止全屏截图，不用 JS/CDP 点击 CAPTCHA，不提取 token/cookie，失败后等待并在多轮图片/拼图等不可安全执行场景转人工。
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
