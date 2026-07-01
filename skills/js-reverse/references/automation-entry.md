# 自动化入口剧本

默认按三段式执行：

1. 页面观察
2. 运行时采样
3. 本地补环境

标准入口：

1. `check_browser_health`
2. `new_page` 或 `select_page`
3. `analyze_target`
4. iframe / 微前端 / cross-origin widget 场景先 `list_frames`
5. 微前端 / iframe / shadow DOM / sandbox 场景先 `detect_microfrontends`
6. `search_in_scripts`
7. `list_network_requests` + `get_request_initiator`
8. 如果目标涉及首屏初始化、首个请求前参数生成、页面首次执行逻辑：先 `inject_preload_script` 并检查 `preload_semantics`
9. storage 证据优先用 `get_local_storage` / `get_session_storage` / `search_storage` / `watch_storage_changes`
10. `record_reverse_evidence`，按 `evidence.v1` 写 source/confidence/request/script/artifact 关联
11. `create_hook` + `inject_hook`
12. 触发动作
13. `get_hook_data(summary)`
14. 命中后 `get_hook_data(raw)` + `record_reverse_evidence`
15. `export_evidence_bundle` 或 `export_rebuild_bundle`
16. 本地补环境复现
17. `finalize_task(workspace_key|task_id)`，除非需要保留现场并显式 `keep:true`

重试上限：2 次。

只有在 Hook 无法解释关键上下文时才进入断点路径。
如果问题出在首屏初始化，就优先走 preload 采样，不要等页面脚本跑完后再补 hook。
cross-origin frame 只作为 degraded metadata 证据；不要把不可访问 frame 内部状态当作已验证事实。
