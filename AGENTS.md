# tmwd-browser-mcp 项目规范

目标：把 GenericAgent/TMWebDriver 的真实浏览器控制能力抽成可长期维护的独立 MCP 项目，服务 Codex、grobot 和 JS 逆向任务。

## 设计边界

- 默认路径是 TMWD 用户真实浏览器：Chrome/Edge 扩展 + 本地 hub + MCP server。
- `tmwd_mode=tmwd` 是登录态任务默认值；不要静默 fallback 到 remote-debugging CDP。
- `tmwd_mode=remote_cdp` 仅用于 CI、受控 debug Chrome、JS 逆向需要 Network/Debugger/Script source 的场景。
- 扩展源码放在 `extension/`，安装目标默认是 `~/.tmwd-browser-mcp/browser/tmwd_cdp_bridge/`。
- `extension/config.js` 是安装态生成文件；源码只保留 `extension/config.example.js`，避免把上游/本机 TID 当作项目配置提交。
- 运行态和日志默认放在 `~/.tmwd-browser-mcp/runtime/`，不要写入项目源码目录。

## 质量要求

- 修改核心 MCP/Hub/扩展代码后至少运行：
  - `npm run check`
  - `npm run check:live:doctor`
- 修改 live gate / doctor schema 后运行：
  - `npm run check:doctor-schema`
- 修改扩展后运行：
  - `npm run extension:check`
  - `npm run setup`
  - 浏览器扩展页 reload `TMWD CDP Bridge`
  - 刷新目标 tab，让 content script 重新注入
- 同步 GenericAgent 上游扩展后运行：
  - `npm run extension:sync`
  - `npm run extension:check`
  - `npm run check`

## 目录职责

- `src/`：MCP server、TMWD runtime、hub、native fallback。
- `extension/`：TMWD CDP Bridge unpacked extension source。
- `contracts/`：可执行契约测试和 live gate。
- `scripts/`：安装、同步、配置辅助脚本。
- `docs/`：TMWD、JS reverse、Codex 集成文档。
- `skills/`：可挂载到 Codex/agents 的 skill 内容。

## 安全与隐私

- 不主动读取无关 cookies、密码、账号页、历史记录或 session store。
- cookies/CDP/文件上传/下载/真实点击等动作只在任务需要时使用。
- 配置文件只写路径、端口、非敏感默认值，不写真实凭据。
