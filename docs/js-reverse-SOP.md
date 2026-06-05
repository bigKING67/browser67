# js-reverse SOP

This file is the explicit SOP entrypoint for agents or users searching for the
JavaScript reverse-engineering workflow. The canonical agent skill is still:

- `skills/js-reverse/SKILL.md` for installable agent skill content.
- `docs/js-reverse/SKILL.md` for the synchronized documentation mirror.

Keep this file as an index and operating summary. Do not duplicate all skill
content here; update `skills/js-reverse/` and run `npm run skills:check` when
the actual playbook changes.

## Required wiring

Register both MCP servers. `tmwd_browser` owns real-browser automation, while
`js-reverse` owns observe/capture/rebuild workflows.

```toml
[mcp_servers.tmwd_browser]
command = "node"
args = ["/path/to/browser67/src/server.mjs"]

[mcp_servers.js-reverse]
command = "node"
args = ["/path/to/browser67/src/js-reverse-server.mjs"]
```

For TMWD-backed browser state, set the same hub environment on both servers:

```toml
BROWSER_STRUCTURED_TMWD_MODE = "tmwd"
BROWSER_STRUCTURED_TMWD_TRANSPORT = "auto"
BROWSER_STRUCTURED_TMWD_WS_ENDPOINT = "ws://127.0.0.1:18765"
BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT = "http://127.0.0.1:18766/link"
```

See `docs/codex-integration.md` and `docs/agent-setup.md` for full config.

## Default operating rules

1. Observe first. Start from live page/runtime evidence, not checked-in source
   guesses.
2. Prefer hooks over breakpoints. Hooks keep the page running and avoid
   debugger/anti-debug side effects.
3. Use `tmwd_browser` for logged-in Chrome/Edge tabs, managed tab lifecycle,
   downloads/uploads, clipboard wrappers, and browser-visible workflows.
4. Use `js-reverse` for API/interface discovery, request initiator tracing,
   scripts, Network/WS sampling, runtime hooks, evidence export, and local
   rebuild bundles.
5. Do not export cookies, passwords, unrelated session stores, unrelated
   history, unrelated tabs, or personal account data.
6. Rebuild locally only after the target request, initiator, relevant scripts,
   and runtime samples are known.

## Standard workflow

### Phase 1: Observe

Goal: prove what is executing now.

- `check_browser_health`
- `analyze_target`
- `list_network_requests`
- `list_scripts`
- `search_in_scripts`
- `get_dom_structure`
- `get_storage` only when scoped and necessary

### Phase 2: Trace

Goal: connect the interesting request or parameter to code.

- `get_network_request`
- `get_request_initiator`
- `find_in_script`
- `collect_code`
- `detect_crypto`
- `understand_code`

### Phase 3: Hook

Goal: capture runtime inputs, outputs, call order, and evidence.

- `create_hook`
- `inject_hook`
- `hook_function`
- `trace_function`
- `break_on_xhr`
- `get_hook_data`

If a hook misses first-page initialization, return to the entry page and use
`inject_preload_script` before retrying.

### Phase 4: Rebuild

Goal: reproduce the decisive transform locally.

- `export_rebuild_bundle`
- `diff_env_requirements`
- `docs/js-reverse/references/env-patching.md`
- `docs/js-reverse/references/node-env-rebuild.md`
- `docs/js-reverse/references/local-rebuild.md`

Patch environment gaps by reading proxy/env logs and finding the first
divergence. Do not guess a large browser environment without evidence.

### Phase 5: Reduce

Goal: turn the captured browser-dependent path into maintainable code.

- Extract the core signing/encryption function.
- Replace broad browser shims with narrow adapters.
- Verify local output against runtime samples.
- Keep original, captured, and reduced artifacts separate.

### Phase 6: Report

Every completed reverse task should include:

- Target endpoint and signature fields.
- Function path and script/source URL.
- Request-to-initiator evidence.
- Hook records or runtime samples.
- Input/output examples.
- Local rebuild status.
- Patch log and rollback steps.
- Confidence and remaining uncertainty.
- Task artifact path.

## Reference map

- `skills/js-reverse/SKILL.md`: full installable skill/playbook.
- `docs/js-reverse/SKILL.md`: synchronized docs mirror.
- `docs/js-reverse/references/tool-catalog.md`: tool reference.
- `docs/js-reverse/references/automation-entry.md`: task entry sequence.
- `docs/js-reverse/references/mcp-task-template.md`: structured task template.
- `docs/js-reverse/references/task-input-template.md`: scoped input contract.
- `docs/js-reverse/references/env-patching.md`: environment patching rules.
- `docs/js-reverse/references/node-env-rebuild.md`: Node rebuild details.
- `docs/js-reverse/references/output-contract.md`: final output format.
- `docs/js-reverse/references/task-artifacts.md`: artifact directory layout.
- `docs/js-reverse/references/cases/`: reusable case templates.

## Verification

After editing js-reverse playbook material:

```bash
npm run skills:check
npm run check:js-reverse-mcp
```

For a live local browser profile:

```bash
npm run hub:start
npm run check:js-reverse-live
```
