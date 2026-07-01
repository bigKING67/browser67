# 输出契约
必须包含：
- 目标接口与字段
- frame tree / frame_path 证据（当 iframe、微前端、验证码 widget、嵌入登录或 cross-origin shell 影响目标）
- microfrontend / shadow DOM / sandbox hook scope 判断（涉及时）
- 函数路径
- 运行时证据（hook 记录 + request 关联，按 `evidence.v1` 标注 source/confidence）
- scoped storage 证据或 redacted storage policy（涉及时）
- evidence bundle 路径；bundle 至少包含 `summary.json`、`network.ndjson`、`hooks/`、`storage-redacted.json`、`replay/README.md`
- 输入输出样例
- 补丁与回滚步骤
- 置信度与不确定性
- task artifact 路径
- targetContext（至少包含 `targetActionDescription` 或其他目标边界）
- 本地补环境状态（已补/未补）
