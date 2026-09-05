import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { firstJsonContent } from "./rpc-content.mjs";

async function assertListManagedScopeContract({ registryPath, rpc, timeoutMs }) {
  const now = new Date().toISOString();
  const rows = [
    ["scope-a", "task-a", "instance-a", "shared-tab"],
    ["scope-a", "task-b", "instance-a", "other-tab"],
    ["scope-b", "task-a", "instance-a", "third-tab"],
    ["scope-a", "task-a", "instance-b", "shared-tab"],
  ].map(([workspace_key, task_id, browser_instance_id, tab_id]) => ({
    workspace_key, task_id, browser_instance_id, tab_id,
    owner: "tmwd", source: "contract", status: "open", keep: false,
    url: "http://scope-contract.example/", title: "Scope fixture",
    origin: "http://scope-contract.example", path_scope: "/",
    created_at: now, updated_at: now, last_used_at: now,
  }));
  await writeFile(registryPath, JSON.stringify({ version: 3, updated_at: now, managed_tabs: rows }));
  const cases = [
    [{}, 4],
    [{ workspace_key: "scope-a" }, 3],
    [{ task_id: "task-a" }, 3],
    [{ browser_instance_id: "instance-a" }, 3],
    [{ workspace_key: "scope-a", task_id: "task-a" }, 2],
    [{ workspace_key: "scope-a", task_id: "task-a", browser_instance_id: "instance-b" }, 1],
    [{ workspace_key: "missing" }, 0],
    [{ workspace_key: "scope-b", browser_instance_id: "instance-b" }, 0],
  ];
  for (const [filters, count] of cases) {
    for (const historyFlag of ["history", "include_disconnected"]) {
      for (const summaryOnly of [true, false]) {
        const response = await rpc.call("tools/call", {
          name: "browser_tab_lifecycle",
          arguments: { action: "list_managed", ...filters, [historyFlag]: true, summary_only: summaryOnly },
        }, timeoutMs);
        assert.equal(response.result?.isError, undefined);
        const data = firstJsonContent(response.result);
        const label = JSON.stringify({ filters, historyFlag, summaryOnly });
        const expected = rows.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
        assert.equal(data.summary.registry_count, count, label);
        assert.equal(data.summary.managed_total_count, count, label);
        assert.equal(data.summary.groups_total_count, new Set(expected.map((r) => r.workspace_key)).size, label);
        assert.equal(data.live_filter.before_count, count, label);
        assert.equal(data.live_filter.after_count, count, label);
        assert.deepEqual(data.managed_tabs.map((r) => r.session_key).sort(), summaryOnly ? []
          : expected.map((r) => `${r.browser_instance_id}:${r.tab_id}`).sort(), label);
        assert.ok(data.groups.every((g) => expected.some((r) => r.workspace_key === g.workspace_key)), label);
        for (const field of ["sessions", "live_sessions", "disconnected_sessions"]) {
          assert.ok(data[field].every((r) => expected.some((e) => `${e.browser_instance_id}:${e.tab_id}` === r.id)), label);
        }
        for (const field of ["active_session_id", "default_session_id", "latest_session_id"]) {
          assert.ok(data[field] === null || expected.some((e) => `${e.browser_instance_id}:${e.tab_id}` === data[field]), label);
        }
      }
    }
  }
  // A fresh process binds the isolated registry before module initialization.
  // Seed populated session pointers so these assertions are not vacuous.
  const listModule = new URL("../../src/browser-wrappers/tab-lifecycle-list.mjs", import.meta.url).href;
  await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { listManagedTabs } from ${JSON.stringify(listModule)};
    const { pruneStaleManagedTabs } = await import(${JSON.stringify(new URL("../../src/browser-wrappers/tab-lifecycle-close.mjs", import.meta.url).href)});
    const sessions = ${JSON.stringify(rows)}.map(r => ({
      ...r, id: r.browser_instance_id + ":" + r.tab_id, active: true,
    }));
    sessions.push({ id: "instance-b:unmanaged", tab_id: "unmanaged", browser_instance_id: "instance-b", active: true });
    const sessionStore = {
      list: () => sessions,
      sessionPointers: () => ({
        active_session_id: "instance-a:shared-tab",
        default_session_id: "instance-b:unmanaged",
        latest_session_id: "instance-b:shared-tab",
        active_browser_instance_id: "instance-a",
        default_browser_instance_id: "instance-b",
      }),
    };
    for (const summaryOnly of [true, false]) {
      const result = await listManagedTabs({
        workspace_key: "scope-a", task_id: "task-a", browser_instance_id: "instance-b",
        history: true, summary_only: summaryOnly,
      }, { runtime: { sessionStore } });
      assert.equal(result.summary.live_session_count, 1);
      assert.equal(result.summary.disconnected_session_count, 0);
      assert.deepEqual(result.sessions.map(r => r.id), summaryOnly ? [] : ["instance-b:shared-tab"]);
      assert.deepEqual(result.live_sessions.map(r => r.id), summaryOnly ? [] : ["instance-b:shared-tab"]);
      assert.equal(result.active_session_id, null);
      assert.equal(result.default_session_id, null);
      assert.equal(result.latest_session_id, "instance-b:shared-tab");
      assert.equal(result.active_browser_instance_id, null);
      assert.equal(result.default_browser_instance_id, null);
    }
    const emptyPruned = await listManagedTabs({
      workspace_key: "missing", task_id: "missing", browser_instance_id: "missing",
      prune_stale: true, dry_run: true, summary_only: false,
    }, { runtime: { sessionStore }, pruneStaleManagedTabs });
    assert.equal(emptyPruned.summary.registry_count, 0);
    for (const key of ["active_session_id", "default_session_id", "latest_session_id", "active_browser_instance_id", "default_browser_instance_id"]) {
      assert.equal(emptyPruned[key], null);
      assert.equal(emptyPruned.prune_stale[key], null, "nested prune pointer leaked scope: " + key);
    }
  `], { env: { ...process.env, BROWSER_STRUCTURED_TAB_REGISTRY_PATH: registryPath }, timeout: timeoutMs });
  const emptyLive = firstJsonContent((await rpc.call("tools/call", {
    name: "browser_tab_lifecycle",
    arguments: { action: "list_managed", workspace_key: "missing", summary_only: false },
  }, timeoutMs)).result);
  assert.equal(emptyLive.summary.registry_count, 0);
  assert.deepEqual(emptyLive.live_filter.stale, []);
}

export { assertListManagedScopeContract };
