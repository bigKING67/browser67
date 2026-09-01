import assert from "node:assert/strict";

async function runForegroundVisibilityCase(context) {
  if (context.cli.foreground_visibility !== true) {
    return {
      requested: false,
      status: "not_requested",
    };
  }
  const path = `/tmwd-managed-foreground-visibility-${String(Date.now())}`;
  const url = `${context.fixture.origin}${path}`;
  const result = await context.callTool("browser_tab_lifecycle", {
    ...context.baseArgs,
    action: "select_or_create",
    url,
    workspace_key: context.workspaceKey,
    task_id: "foreground-visibility-live",
    focus_policy: "foreground",
    confirm_foreground: true,
    window_policy: "dedicated",
    reuse: false,
    fresh: true,
    wait_until: "listed",
    wait_timeout_ms: 5_000,
    wait_poll_ms: 100,
  });
  const tabId = String(result?.managed_tab?.tab_id ?? "");
  assert.ok(tabId, "foreground visibility case did not return a managed tab id");
  context.openedTabIds.add(tabId);
  assert.equal(result.presentation?.focus_policy, "foreground");
  assert.equal(result.presentation?.window_policy, "dedicated");
  if (process.platform === "darwin") {
    assert.equal(result.focus_transition?.native_foreground?.status, "foregrounded");
    assert.equal(
      result.focus_transition?.native_foreground?.space_activation,
      "exact_tab_native_activation",
    );
  }
  const visibility = await context.readPage(tabId, `
return await new Promise((resolve) => {
  let settled = false;
  let frameCount = 0;
  const finish = () => {
    if (settled) return;
    settled = true;
    resolve({
      visibility: document.visibilityState,
      frame_count: frameCount,
      pathname: location.pathname,
    });
  };
  const onFrame = () => {
    frameCount += 1;
    if (frameCount >= 2) finish();
    else requestAnimationFrame(onFrame);
  };
  requestAnimationFrame(onFrame);
  setTimeout(finish, 1200);
});`);
  assert.equal(visibility?.visibility, "visible", `foreground page remained ${String(visibility?.visibility)}`);
  assert.equal(visibility?.frame_count >= 2, true, "foreground page requestAnimationFrame did not advance");
  assert.equal(visibility?.pathname, path);

  const cleanup = await context.callTool("browser_tab_lifecycle", {
    ...context.baseArgs,
    action: "finalize_task",
    workspace_key: context.workspaceKey,
    task_id: "foreground-visibility-live",
    prune_stale: false,
    cleanup_created_agent_window: true,
  });
  assert.equal(cleanup.status, "success", "foreground visibility cleanup did not succeed");
  context.openedTabIds.delete(tabId);
  return {
    requested: true,
    status: "passed",
    tab_id: tabId,
    native_foreground: result.focus_transition?.native_foreground,
    document_visibility: visibility.visibility,
    raf_frames: visibility.frame_count,
    cleanup_status: cleanup.status,
  };
}

export {
  runForegroundVisibilityCase,
};
