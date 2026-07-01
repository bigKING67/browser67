# Task Artifacts

每个逆向任务都应写入一个 task artifact 目录，例如：

`artifacts/tasks/<taskId>/`

推荐最少包含：

- `task.json`
- `timeline.jsonl`
- `network.jsonl`
- `scripts.jsonl`
- `runtime-evidence.jsonl`
- `frames.jsonl` 或 frame tree section（有 iframe / 微前端 / cross-origin widget 时）
- `cookies.json`
- `env/entry.js`
- `env/env.js`
- `env/polyfills.js`
- `env/capture.json`
- `report.md`

这些产物用于：

- 给 Codex / Claude / Gemini 续做同一个任务
- 回看页面观察证据
- 对齐本地补环境状态
- 复核 `evidence.v1` 的 source/confidence/request/script/artifact 关联
- 需要交接或复现时运行 `export_evidence_bundle`；默认结构包含 `summary.json`、`network.ndjson`、`hooks/`、`storage-redacted.json`、`replay/README.md`
- storage 只保留 redacted metadata；需要具体值时回到 live 页面使用 scoped helper 获取
- 进入后续 AST 去混淆或 VMP 深挖
