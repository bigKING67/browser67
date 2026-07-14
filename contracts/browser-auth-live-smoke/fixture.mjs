import { createServer } from "node:http";

export const FIXTURE_USERNAME = "fixture-user";
export const FIXTURE_PASSWORD = "fixture-password";

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

export async function startAuthFixture() {
  const sockets = new Set();
  const cookieName = `fixture_auth_${String(Date.now())}_${String(Math.floor(Math.random() * 1_000_000))}`;
  const state = {
    login_submissions: 0,
    captcha_completed: false,
    captcha_submissions: 0,
    mfa_completed: false,
    mfa_submissions: 0,
    sso_completed: false,
    sso_submissions: 0,
    oauth_completed: false,
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
    if (requestUrl.pathname === "/captcha-complete" && req.method === "POST") {
      state.captcha_completed = true;
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ ok: true, captcha_completed: true }));
      return;
    }
    if (requestUrl.pathname === "/captcha-login" && req.method === "POST") {
      state.captcha_submissions += 1;
      if (!state.captcha_completed) {
        res.writeHead(400, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end("<!doctype html><title>fixture captcha blocked</title><p>captcha should not submit automatically</p>");
        return;
      }
      const body = await readRequestBody(req);
      const form = new URLSearchParams(body);
      const valid = form.get("username") === FIXTURE_USERNAME && form.get("password") === FIXTURE_PASSWORD;
      if (valid) {
        state.successful_logins += 1;
        res.writeHead(302, {
          "set-cookie": `${cookieName}=1; Path=/; SameSite=Lax`,
          location: "/protected",
          "cache-control": "no-store",
        });
        res.end();
        return;
      }
      res.writeHead(401, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end("<!doctype html><title>fixture captcha login failed</title><p>login failed</p>");
      return;
    }
    if (requestUrl.pathname === "/captcha-login") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      const captchaBlock = state.captcha_completed
        ? '<p id="captcha-completed">captcha completed</p>'
        : '<div id="captcha-box" class="h-captcha" data-sitekey="fixture-site-key">captcha required</div>';
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>fixture captcha login</title></head>
<body>
  <form method="post" action="/captcha-login">
    <label>Username <input id="captcha-username" name="username" autocomplete="username"></label>
    <label>Password <input id="captcha-password" name="password" type="password" autocomplete="current-password"></label>
    ${captchaBlock}
    <button type="submit">Login</button>
  </form>
</body>
</html>`);
      return;
    }
    if (requestUrl.pathname === "/mfa-login" && req.method === "POST") {
      state.mfa_submissions += 1;
      res.writeHead(400, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end("<!doctype html><title>fixture mfa blocked</title><p>mfa should not submit automatically</p>");
      return;
    }
    if (requestUrl.pathname === "/mfa-complete" && req.method === "POST") {
      state.mfa_completed = true;
      state.successful_logins += 1;
      res.writeHead(200, {
        "set-cookie": `${cookieName}=1; Path=/; SameSite=Lax`,
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ ok: true, mfa_completed: true }));
      return;
    }
    if (requestUrl.pathname === "/mfa-login") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>fixture mfa login</title></head>
<body>
  <form method="post" action="/mfa-login">
    <label>Username <input id="mfa-username" name="username" autocomplete="username"></label>
    <label>Password <input id="mfa-password" name="password" type="password" autocomplete="current-password"></label>
    <label>Verification code <input id="mfa-code" name="otp" autocomplete="one-time-code"></label>
    <button type="submit">Login</button>
  </form>
</body>
</html>`);
      return;
    }
    if (requestUrl.pathname === "/sso-login" && req.method === "POST") {
      state.sso_submissions += 1;
      res.writeHead(400, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end("<!doctype html><title>fixture sso blocked</title><p>sso should not submit automatically</p>");
      return;
    }
    if (requestUrl.pathname === "/sso-complete" && req.method === "POST") {
      state.sso_completed = true;
      state.successful_logins += 1;
      res.writeHead(200, {
        "set-cookie": `${cookieName}=1; Path=/; SameSite=Lax`,
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ ok: true, sso_completed: true }));
      return;
    }
    if (requestUrl.pathname === "/sso-login") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>fixture sso login</title></head>
<body>
  <main>
    <p>Single sign-on required</p>
    <button type="button">Continue with SSO</button>
  </main>
</body>
</html>`);
      return;
    }
    if (requestUrl.pathname === "/sso-role-button") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>fixture role button sso</title></head>
<body><main><div role="button" tabindex="0">Google</div></main></body>
</html>`);
      return;
    }
    if (requestUrl.pathname === "/confirm-existing-account") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>fixture existing account continuation</title></head>
<body><main><h1>找到现有账户</h1><button type="button">使用 X 登录</button></main></body>
</html>`);
      return;
    }
    if (requestUrl.pathname === "/i/oauth2/authorize") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>fixture oauth authorization</title></head>
<body><main><button type="button">授权应用</button><button type="button">取消</button></main></body>
</html>`);
      return;
    }
    if (requestUrl.pathname === "/authenticated-sso-noise") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="user-login" content="fixture"><title>fixture authenticated</title></head>
<body class="logged-in"><nav aria-label="Account menu"><a href="/logout">Sign out</a></nav><button type="button">Continue with Google</button></body>
</html>`);
      return;
    }
    if (requestUrl.pathname === "/delayed-popup-parent") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>fixture delayed popup parent</title></head>
<body><main>delayed popup target monitor <button id="popup-trigger" type="button">Open provider</button></main></body>
</html>`);
      return;
    }
    if (requestUrl.pathname === "/delayed-popup-child") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end("<!doctype html><title>fixture delayed popup child</title><p>popup ready</p>");
      return;
    }
    if (requestUrl.pathname === "/oauth-login") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>fixture oauth login</title></head>
<body>
  <main>
    <p>OAuth popup required</p>
    <button type="button" data-oauth-popup="true" onclick="window.open('/oauth-popup', 'fixture-oauth')">Continue with OAuth Popup</button>
  </main>
</body>
</html>`);
      return;
    }
    if (requestUrl.pathname === "/oauth-popup") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end("<!doctype html><title>fixture oauth popup</title><p>manual oauth step</p>");
      return;
    }
    if (requestUrl.pathname === "/oauth-callback") {
      state.oauth_completed = true;
      state.successful_logins += 1;
      res.writeHead(302, {
        "set-cookie": `${cookieName}=1; Path=/; SameSite=Lax`,
        location: "/protected",
        "cache-control": "no-store",
      });
      res.end();
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
    cookieName,
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
