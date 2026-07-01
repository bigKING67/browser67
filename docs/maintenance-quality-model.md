# browser67 maintenance quality model

browser67 optimizes for quality effect, long-term maintainability, code
elegance, performance, architecture quality, project quality, and directory
governance.

## Quality effect

- Prefer evidence-first browser operations: DOM/geometry/network state,
  screenshots, run artifacts, and explicit live-gate results.
- Do not claim browser-visible behavior is fixed without a relevant browser or
  live-runtime verification path.
- Failed or skipped live proof must return a structured reason and next command.

## Long-term maintainability

- Keep TMWD browser automation and JS reverse as separate MCP surfaces sharing a
  runtime, not a single dispatch monolith.
- Keep GenericAgent/TMWebDriver upstream changes behind audit/review/lock
  commands.
- Keep docs, skills, schemas, and contracts synchronized with behavior changes.
- Keep compatibility shims explicit and documented.

## Code elegance

- Keep schema declaration, runtime validation, transport execution, and result
  formatting separate.
- Avoid silent fallback and fake success paths.
- Prefer small modules by capability boundary over catch-all helpers.
- Add comments only where the behavior is not self-evident.

## Performance

- Default to bounded output; use `output_mode:"compact"`, limits, filters, and
  artifact files for large DOM/network/script/storage payloads.
- Use `browser_wait` and transport-health probes instead of fixed sleeps.
- Keep long browser execution out of synchronous tool calls when job semantics
  are more appropriate.
- Avoid hot-path synchronous IO, unbounded caches, unbounded DOM dumps, and
  repeated large JSON serialization.

## Architecture quality

- The public MCP surfaces are `tmwd_browser` and `js-reverse`.
- TMWD runtime, hub, extension bridge, managed tabs, auth, native fallback, and
  governance checks each have an explicit home.
- Repo-external state is resolved through the browser67 runtime-home resolver,
  not scattered literal paths.

## Project quality gates

Fast deterministic gates:

```bash
npm run check:mcp
npm run check:js-reverse-mcp
npm run check:doctor-schema
npm run check:browser67-naming
npm run check:runtime-home
npm run check:release-readiness
npm run skills:check
git diff --check
```

Broad local gate:

```bash
npm run check
npm run verify
npm run release:ready
```

Live gates when browser/runtime behavior changes:

```bash
npm run check:live:doctor
npm run check:managed-tab-live
npm run check:js-reverse-live
```

Extension/upstream gates when bridge files change:

```bash
npm run extension:check
npm run upstream:audit
npm run upstream:audit:latest
npm run upstream:lock
```
