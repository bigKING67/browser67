# browser67 项目规范

目标：把 GenericAgent/TMWebDriver 的真实浏览器控制能力抽成可长期维护的 browser67 MCP/tooling 项目，服务 Codex、grobot 和 JS 逆向任务。

## 设计边界

- `browser67` 是 canonical project/package/CLI/runtime umbrella；`tmwd-browser-mcp` 只作为 legacy compatibility alias，不再作为新文档或新配置的项目主称呼。
- 默认路径是 browser67 用户真实浏览器：Chrome/Edge 扩展 + 本地 hub + MCP server；底层 transport/protocol 仍称 `tmwd`。
- `tmwd_mode=tmwd` 是登录态任务默认值；不要静默 fallback 到 remote-debugging CDP。
- `tmwd_mode=remote_cdp` 仅用于 CI、受控 debug Chrome、JS 逆向需要 Network/Debugger/Script source 的场景。
- 扩展源码放在 `extension/`，安装目标默认是 `~/.browser67/browser/tmwd_cdp_bridge/`；legacy `~/.tmwd-browser-mcp/browser/tmwd_cdp_bridge/` 仅作迁移兼容。
- `extension/config.js` 是安装态生成文件；源码只保留 `extension/config.example.js`，避免把上游/本机 TID 当作项目配置提交。
- 运行态和日志默认放在 `~/.browser67/runtime/`；legacy `~/.tmwd-browser-mcp/runtime/` 只作迁移兼容，不要写入项目源码目录。

## 页面和浏览器操作

1. 真实 Chrome/Edge 登录态、当前 tab、cookie/session 感知读取、CDP bridge batch、后台 tab、下载/上传、file chooser 规划、clipboard 写入/粘贴 wrapper、managed tab lifecycle 优先使用 browser67 real-browser MCP（当前工具 key 是 `tmwd_browser`）；登录态任务默认 `tmwd_mode=tmwd`，禁止静默 fallback 到 remote-debugging CDP。
2. browser67 主动操作网页时默认使用 `browser_tab_lifecycle action=select_or_create` 创建或复用 browser67-owned managed tab；用户自己打开的 unmanaged tab 默认只读观察，不导航、不点击、不输入、不关闭。仅当用户明确要求操作该 exact tab 时，执行 `inspect_adoption -> adopt_existing`，不要重新打开页面或重复登录；`finalize_task` 只释放 adopted tab 而不关闭用户页面。用户/外部导航、扩展重连或 lease generation 变化导致 suspended 后，必须重新 inspection/adoption。
3. 页面 API/接口发现、请求 initiator 追踪、签名链路定位、脚本搜索、网络/WS 采样、Hook、证据导出、本地补环境包优先使用 `js-reverse` MCP，并遵循 `docs/codex-integration.md` 与 `js-reverse` skill。
4. Chrome profile 是用户私有运行态：不查看 cookies、密码、session stores、无关历史、无关标签页、无关账号数据；外部可见动作按危险操作确认。
5. CDP 只用于 Runtime、Network、Performance、DOM 精确状态、下载/file chooser、自动化断言；普通点击/观察不用 CDP。
6. 涉及用户可见页面、交互、表单、登录态、下载、上传、导航、响应式、动画或性能体验的改动，交付前尽量浏览器验证。

## 质量要求

- 修改核心 MCP/Hub/扩展代码后至少运行：
  - `npm run check`
  - `npm run check:live:doctor`
- 修改 JS reverse MCP、逆向 runtime 或逆向契约后至少运行：
  - `npm run check:js-reverse-mcp`
  - `npm run check:js-reverse-live`
- 修改 live gate / doctor schema 后运行：
  - `npm run check:doctor-schema`
- 修改扩展后运行：
  - `npm run extension:check`
  - `npm run setup`
  - 已有 bridge 连接时运行 `npm run extension:reload-live`
  - bridge 未连接时再从浏览器扩展页 reload unpacked extension（显示名可能仍为 `TMWD CDP Bridge`）
  - 刷新目标 tab，让 content script 重新注入
  - `npm run check:live:doctor`
  - 确认 `tmwd_ws_runtime` 或 `tmwd_link_runtime` 为 `extension_identity_ok`，不能只用磁盘文件一致代替 live service-worker 身份证明
- 修改 browser67/tmwd-browser-mcp skill 或 Agent 安装规则后运行：
  - `npm run check:active-skill-sync`
  - `npm run skills:active:diff -- --target ~/.agents/skills`
  - 仅在明确更新当前 active root 时运行 `npm run skills:active:sync -- --target ~/.agents/skills`，随后用新 Agent 会话验证 skill discovery
  - `npm run doctor:agent -- --check --json`
- 同步 GenericAgent 上游扩展后运行：
  - `npm run extension:sync`
  - `npm run extension:check`
  - `npm run upstream:lock`
  - `npm run check`
- 常规提交前优先运行：
  - `npm run verify`

## 目录职责

- `src/`：MCP server、browser67 runtime、hub、native fallback。
- `extension/`：browser67 unpacked extension source（upstream/protocol provenance 仍可保留 `TMWD CDP Bridge` 名称）。
- `contracts/`：可执行契约测试和 live gate。
- `scripts/`：安装、同步、配置辅助脚本。
- `docs/`：browser67、JS reverse、Codex 集成文档。
- `skills/`：可挂载到 Codex/agents 的 skill 内容。
- `UPSTREAM.lock.json`：GenericAgent 上游 commit 和扩展文件 hash 的可审计锁定。

## 安全与隐私

- 不主动读取无关 cookies、密码、账号页、历史记录或 session store。
- cookies/CDP/文件上传/下载/真实点击等动作只在任务需要时使用。
- 配置文件只写路径、端口、非敏感默认值，不写真实凭据。
