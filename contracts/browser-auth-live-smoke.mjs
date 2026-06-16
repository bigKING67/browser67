#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRpcClient } from "./browser-structured-mcp-contract/rpc-client.mjs";
import { firstJsonContent } from "./browser-structured-mcp-contract/rpc-content.mjs";

const FIXTURE_USERNAME = "fixture-user";
const FIXTURE_PASSWORD = "fixture-password";

function parseArgs(argv) {
  const parsed = {
    timeout_ms: 15_000,
    tmwd_mode: "tmwd",
    tmwd_transport: "auto",
    tmwd_ws_endpoint: "ws://127.0.0.1:18765",
    tmwd_link_endpoint: "http://127.0.0.1:18766/link",
    cdp_endpoint: "http://127.0.0.1:9222",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--timeout-ms") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("invalid --timeout-ms value");
      }
      parsed.timeout_ms = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--tmwd-mode") {
      parsed.tmwd_mode = String(argv[index + 1] ?? "").trim() || "tmwd";
      index += 1;
      continue;
    }
    if (token === "--tmwd-transport") {
      parsed.tmwd_transport = String(argv[index + 1] ?? "").trim() || "auto";
      index += 1;
      continue;
    }
    if (token === "--tmwd-ws-endpoint") {
      parsed.tmwd_ws_endpoint = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--tmwd-link-endpoint") {
      parsed.tmwd_link_endpoint = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--cdp-endpoint") {
      parsed.cdp_endpoint = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function readRequestBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.once("error", rejectPromise);
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
  });
}

function hasFixtureCookie(req, cookieName) {
  return String(req.headers.cookie ?? "")
    .split(";")
    .map((item) => item.trim())
    .includes(`${cookieName}=1`);
}

async function startAuthFixture() {
  const sockets = new Set();
  const cookieName = `fixture_auth_${String(Date.now())}_${String(Math.floor(Math.random() * 1_000_000))}`;
  const state = {
    login_submissions: 0,
    successful_logins: 0,
    requests: [],
  };
  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    state.requests.push({
      method: req.method,
      path: requestUrl.pathname,
      url: requestUrl.pathname + requestUrl.search,
      has_cookie: hasFixtureCookie(req, cookieName),
    });
    const redirectPath = requestUrl.searchParams.get("redirect") || "/protected";
    if (requestUrl.pathname === "/protected") {
      if (!hasFixtureCookie(req, cookieName)) {
        res.writeHead(302, {
          location: `/login?redirect=${encodeURIComponent("/protected")}`,
          "cache-control": "no-store",
        });
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>fixture protected</title></head>
<body><main id="secret">fixture secret page</main></body>
</html>`);
      return;
    }
    if (requestUrl.pathname === "/public") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>fixture public</title></head>
<body><main id="public">fixture public page</main></body>
</html>`);
      return;
    }
    if (requestUrl.pathname === "/login" && req.method === "POST") {
      state.login_submissions += 1;
      const body = await readRequestBody(req);
      const form = new URLSearchParams(body);
      const valid = form.get("username") === FIXTURE_USERNAME && form.get("password") === FIXTURE_PASSWORD;
      if (valid) {
        state.successful_logins += 1;
        res.writeHead(302, {
          "set-cookie": `${cookieName}=1; Path=/; SameSite=Lax`,
          location: redirectPath,
          "cache-control": "no-store",
        });
        res.end();
        return;
      }
      res.writeHead(401, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end("<!doctype html><title>fixture login failed</title><p>login failed</p>");
      return;
    }
    if (requestUrl.pathname === "/login") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>fixture login</title></head>
<body>
  <form method="post" action="/login?redirect=${encodeURIComponent(redirectPath)}">
    <label>Username <input id="username" name="username" autocomplete="username"></label>
    <label>Password <input id="password" name="password" type="password" autocomplete="current-password"></label>
    <button type="submit">Login</button>
  </form>
  <script>
    document.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const response = await fetch(form.action, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(new FormData(form))
      });
      if (!response.ok) {
        document.body.insertAdjacentHTML("beforeend", "<p>login failed</p>");
        return;
      }
      history.pushState({}, "", "/protected");
      document.title = "fixture protected";
      document.body.innerHTML = '<main id="secret">fixture secret page</main>';
    });
  </script>
</body>
</html>`);
      return;
    }
    if (requestUrl.pathname === "/captcha-login") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>fixture captcha login</title></head>
<body>
  <form method="post" action="/captcha-login">
    <label>Username <input id="captcha-username" name="username" autocomplete="username"></label>
    <label>Password <input id="captcha-password" name="password" type="password" autocomplete="current-password"></label>
    <div id="captcha-box">captcha required</div>
    <button type="submit">Login</button>
  </form>
</body>
</html>`);
      return;
    }
    res.writeHead(404, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end("not found");
  });
  server.keepAliveTimeout = 1_000;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fixture server did not expose a TCP port");
  }
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    state,
    close: () => new Promise((resolvePromise) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      server.close(resolvePromise);
    }),
  };
}

function commonArgs(cli) {
  return {
    tmwd_mode: cli.tmwd_mode,
    tmwd_transport: cli.tmwd_transport,
    tmwd_ws_endpoint: cli.tmwd_ws_endpoint,
    tmwd_link_endpoint: cli.tmwd_link_endpoint,
    cdp_endpoint: cli.cdp_endpoint,
    timeout_ms: cli.timeout_ms,
  };
}

async function waitFor(condition, timeoutMs, pollMs = 150) {
  const startedAt = Date.now();
  const poll = async (latest) => {
    if (Date.now() - startedAt > timeoutMs) {
      return latest ?? { ok: false, reason: "timeout" };
    }
    const current = await condition();
    if (current?.ok === true) {
      return current;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
    return poll(current);
  };
  return poll();
}

function assertNoSecretLeak(payload, label) {
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes(FIXTURE_USERNAME), false, `${label} leaked username`);
  assert.equal(serialized.includes(FIXTURE_PASSWORD), false, `${label} leaked password`);
}

async function run() {
  const cli = parseArgs(process.argv.slice(2));
  const registryDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-auth-live-registry-"));
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-auth-live-profiles-"));
  const previousRegistryPath = process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
  const previousProfileDir = process.env.BROWSER_STRUCTURED_LOGIN_PROFILE_DIR;
  process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = path.join(registryDir, "managed-tabs.json");
  process.env.BROWSER_STRUCTURED_LOGIN_PROFILE_DIR = profileDir;

  const fixture = await startAuthFixture();
  const rpc = createRpcClient();
  const workspaceKey = `auth-live-${String(Date.now())}`;

  const callTool = async (name, args) => {
    const response = await rpc.call("tools/call", { name, arguments: args }, cli.timeout_ms);
    if (response?.result?.isError === true) {
      const payload = firstJsonContent(response.result);
      throw new Error(`${name} failed: ${String(payload?.error ?? payload?.message ?? "tool error")}`);
    }
    const payload = firstJsonContent(response.result);
    return payload;
  };

  try {
    const init = await rpc.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "browser-auth-live-smoke",
        version: "1.0.0",
      },
    }, cli.timeout_ms);
    assert.equal(init?.result?.serverInfo?.name, "browser-structured-mcp");
    rpc.notify("notifications/initialized", {});

    const unknownDryRun = await callTool("browser_auth_ops", {
      ...commonArgs(cli),
      action: "ensure_login",
      url: "http://unknown.example/login",
      dry_run: true,
    });
    assert.equal(unknownDryRun.status, "blocked");
    assert.equal(unknownDryRun.reason, "no_matching_login_profile");
    assertNoSecretLeak(unknownDryRun, "unknown dry-run auth result");

    const managed = await callTool("browser_tab_lifecycle", {
      ...commonArgs(cli),
      action: "select_or_create",
      url: `${fixture.origin}/login?redirect=${encodeURIComponent("/protected")}`,
      workspace_key: workspaceKey,
      active: false,
      wait_until: "listed",
      wait_timeout_ms: 5_000,
      wait_poll_ms: 100,
    });
    const managedTabId = String(managed?.managed_tab?.tab_id ?? "");
    assert.ok(managedTabId, "managed lifecycle create did not return tab id");
    assert.equal(managed.created, true, "auth live smoke should create an isolated managed tab");

    const loginPage = await waitFor(async () => {
      const inspected = await callTool("browser_auth_ops", {
        ...commonArgs(cli),
        action: "inspect_login_page",
        tab_id: managedTabId,
      });
      return {
        ok: inspected.pathname === "/login"
          && inspected.login_detected === true
          && inspected.password_input_count === 1
          && inspected.username_like_input_count === 1,
        inspected,
      };
    }, 5_000);
    assert.equal(
      loginPage.ok,
      true,
      `managed tab did not settle on the login page: ${JSON.stringify(loginPage.inspected)}`,
    );
    assertNoSecretLeak(loginPage.inspected, "login page inspection result");

    const blockedWithoutProfile = await callTool("browser_auth_ops", {
      ...commonArgs(cli),
      action: "ensure_login",
      tab_id: managedTabId,
    });
    assert.equal(blockedWithoutProfile.status, "blocked", "login page without a profile should block");
    assert.equal(blockedWithoutProfile.reason, "no_matching_login_profile");
    assert.equal(blockedWithoutProfile.login_detected, true);
    assertNoSecretLeak(blockedWithoutProfile, "blocked auth result");

    const suggested = await callTool("browser_auth_ops", {
      ...commonArgs(cli),
      action: "suggest_profile",
      tab_id: managedTabId,
      profile_id: "fixture-live",
    });
    assert.equal(suggested.status, "success", "suggest_profile should inspect the live login page");
    assert.equal(suggested.profile?.profile_id, "fixture-live");
    assert.equal(suggested.profile?.allowed_origins?.[0], fixture.origin);
    assert.equal(suggested.profile?.username_selector, "#username");
    assert.equal(suggested.profile?.password_selector, "#password");
    assert.equal(suggested.profile?.has_username, false);
    assert.equal(suggested.profile?.has_password, false);
    assertNoSecretLeak(suggested, "suggest_profile result");

    const upserted = await callTool("browser_auth_ops", {
      ...commonArgs(cli),
      action: "upsert_profile",
      profile_id: "fixture-live",
      origin: fixture.origin,
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      login_path_pattern: "/login",
      username_selector: suggested.profile?.username_selector,
      password_selector: suggested.profile?.password_selector,
      submit_selector: suggested.profile?.submit_selector,
      success_path_not: "/login",
      success_text: "fixture secret page",
      confirm_write: true,
    });
    assert.equal(upserted.status, "success", "upsert_profile should save the fixture profile");
    assert.equal(upserted.created, true);
    assert.equal(upserted.updated, false);
    assert.equal(upserted.profile?.file_mode, "600");
    assert.equal(upserted.profile?.insecure_file_permissions, false);
    assertNoSecretLeak(upserted, "upsert_profile result");
    const fixtureProfileStat = await stat(path.join(profileDir, "fixture-live.env"));
    assert.equal((fixtureProfileStat.mode & 0o777).toString(8).padStart(3, "0"), "600");

    const auth = await callTool("browser_auth_ops", {
      ...commonArgs(cli),
      action: "ensure_login",
      tab_id: managedTabId,
    });
    assert.equal(
      auth.status,
      "success",
      `ensure_login should authenticate the fixture: ${JSON.stringify({ auth, fixture_state: fixture.state })}`,
    );
    assert.equal(auth.submitted, true, "ensure_login should submit the login form");
    assert.equal(auth.final_path, "/protected", "ensure_login should land on protected page");
    assert.equal(auth.success_text_matched, true, "ensure_login should observe protected page success text");
    assert.equal(fixture.state.login_submissions, 1, "fixture did not receive exactly one login submission");
    assert.equal(fixture.state.successful_logins, 1, "fixture did not receive exactly one successful login");
    assertNoSecretLeak(auth, "ensure_login result");

    const alreadyAuthenticated = await callTool("browser_auth_ops", {
      ...commonArgs(cli),
      action: "ensure_login",
      tab_id: managedTabId,
    });
    assert.equal(alreadyAuthenticated.status, "success", "already authenticated page should be accepted");
    assert.equal(alreadyAuthenticated.already_authenticated, true);
    assert.equal(alreadyAuthenticated.submitted, false);
    assert.equal(fixture.state.login_submissions, 1, "already authenticated ensure_login should not resubmit");
    assertNoSecretLeak(alreadyAuthenticated, "already authenticated result");

    const profilesAfterAuth = await callTool("browser_auth_ops", {
      ...commonArgs(cli),
      action: "list_profiles",
    });
    const liveProfileAfterAuth = profilesAfterAuth?.profiles?.find((entry) => entry?.profile_id === "fixture-live");
    assert.equal(liveProfileAfterAuth?.lifecycle?.last_status, "success", "successful auth should update lifecycle metadata");
    assert.equal(liveProfileAfterAuth?.lifecycle?.last_reason, "already_authenticated");
    assert.equal(typeof liveProfileAfterAuth?.lifecycle?.last_used_at, "string");
    assert.equal(typeof liveProfileAfterAuth?.lifecycle?.last_validated_at, "string");
    assertNoSecretLeak(profilesAfterAuth, "profile lifecycle result");

    const captchaProfile = await callTool("browser_auth_ops", {
      ...commonArgs(cli),
      action: "upsert_profile",
      profile_id: "fixture-captcha",
      origin: fixture.origin,
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      login_path_pattern: "/captcha-login",
      username_selector: "#captcha-username",
      password_selector: "#captcha-password",
      submit_selector: "button[type=\"submit\"]",
      success_path_not: "/captcha-login",
      confirm_write: true,
    });
    assert.equal(captchaProfile.status, "success");
    assertNoSecretLeak(captchaProfile, "captcha upsert result");

    const captchaManaged = await callTool("browser_tab_lifecycle", {
      ...commonArgs(cli),
      action: "select_or_create",
      url: `${fixture.origin}/captcha-login`,
      workspace_key: workspaceKey,
      fresh: true,
      active: false,
      wait_until: "listed",
      wait_timeout_ms: 5_000,
      wait_poll_ms: 100,
    });
    const captchaTabId = String(captchaManaged?.managed_tab?.tab_id ?? "");
    assert.ok(captchaTabId, "captcha managed tab did not return tab id");
    const captchaBlocked = await callTool("browser_auth_ops", {
      ...commonArgs(cli),
      action: "ensure_login",
      profile_id: "fixture-captcha",
      tab_id: captchaTabId,
    });
    assert.equal(captchaBlocked.status, "blocked", "captcha page should require manual intervention");
    assert.equal(captchaBlocked.reason, "manual_required_captcha");
    assert.equal(captchaBlocked.submitted, false, "captcha page should block before submit");
    assert.equal(fixture.state.login_submissions, 1, "captcha block should not submit credentials");
    assertNoSecretLeak(captchaBlocked, "captcha block result");

    const pageState = await callTool("browser_execute_js", {
      ...commonArgs(cli),
      tab_id: managedTabId,
      script: "return { url: location.href, path: location.pathname, text: document.body.innerText };",
    });
    assert.equal(pageState?.js_return?.path, "/protected");
    assert.equal(String(pageState?.js_return?.text ?? "").includes("fixture secret page"), true);

    const finalize = await callTool("browser_tab_lifecycle", {
      ...commonArgs(cli),
      action: "finalize_task",
      workspace_key: workspaceKey,
      prune_stale: false,
    });
    assert.equal(finalize.status, "success", "auth live finalize_task did not succeed");
    assert.equal(
      finalize.close_unkept.closed.some((row) => String(row?.tab_id ?? "") === managedTabId && row.closed === true),
      true,
      "auth live finalize_task did not close the managed tab",
    );

    return {
      ok: true,
      auth_status: auth.status,
      auth_reason: auth.reason,
      submitted: auth.submitted,
      final_path: auth.final_path,
      suggested_profile: suggested.profile?.profile_id,
      upsert_created: upserted.created,
      already_authenticated: alreadyAuthenticated.already_authenticated,
      lifecycle_metadata_updated: liveProfileAfterAuth?.lifecycle?.last_status === "success",
      manual_required_captcha: captchaBlocked.reason === "manual_required_captcha",
      login_submissions: fixture.state.login_submissions,
      successful_logins: fixture.state.successful_logins,
      unknown_origin_blocked: unknownDryRun.status === "blocked",
      secrets_redacted: true,
      finalized_closed: finalize.close_unkept.closed.length,
    };
  } finally {
    try {
      await callTool("browser_tab_lifecycle", {
        ...commonArgs(cli),
        action: "finalize_task",
        workspace_key: workspaceKey,
        prune_stale: false,
      });
    } catch {
      // Best effort cleanup only.
    }
    await rpc.close();
    await fixture.close();
    if (previousRegistryPath === undefined) {
      delete process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
    } else {
      process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = previousRegistryPath;
    }
    if (previousProfileDir === undefined) {
      delete process.env.BROWSER_STRUCTURED_LOGIN_PROFILE_DIR;
    } else {
      process.env.BROWSER_STRUCTURED_LOGIN_PROFILE_DIR = previousProfileDir;
    }
    await rm(registryDir, { recursive: true, force: true });
    await rm(profileDir, { recursive: true, force: true });
  }
}

try {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser-auth-live-smoke failed: ${message}\n`);
  process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
}
