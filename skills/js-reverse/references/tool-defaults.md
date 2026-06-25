# 工具参数默认值
- search_in_scripts: sign|token|nonce|encrypt|hmac|sha|md5|cookie|h5st
- get_hook_data: view=summary, maxRecords=80
- 首轮 Hook: fetch + xhr
- list_frames: iframe / 微前端 / cross-origin widget 场景默认先跑；cross-origin 只使用 degraded metadata
- record_reverse_evidence: channel=runtime-evidence, schema=evidence.v1
- export_rebuild_bundle: 优先导出 env/entry.js + env/env.js + env/polyfills.js + env/capture.json
- browser_execute_js 大输出: output_mode=compact, max_return_chars 显式设置
- browser_job_ops: in-process only, durable=false, cancel 不抢占页面 JS
- 断点默认禁用，只有兜底时启用
