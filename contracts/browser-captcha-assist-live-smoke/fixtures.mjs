import { createServer } from "node:http";

function sliderFixtureHtml(options = {}) {
  const spacer = options.spacer === true ? "<div style=\"height: 900px\" aria-hidden=\"true\"></div>" : "";
  const embedded = options.embedded === true;
  const gray = options.gray === true;
  const canvas = options.canvas === true;
  const zoom = Number.isFinite(Number(options.zoom)) ? Number(options.zoom) : 1;
  const title = embedded ? "fixture slider captcha frame" : "fixture slider captcha login";
  const handleStyle = gray
    ? "background: #6b7280; color: white;"
    : "background: #2b6cb0; color: white;";
  const sliderControl = canvas
    ? `<canvas id="slider-captcha" class="slider-captcha canvas-captcha" data-captcha="slider" aria-label="slide to verify captcha" width="320" height="52"></canvas>`
    : `<div id="slider-captcha" class="slider-captcha" data-captcha="slider" aria-label="slide to verify captcha">
      <div id="slider-handle" class="slider-handle" role="button" aria-label="drag slider handle">||</div>
      <span class="slider-label">slide to verify</span>
    </div>`;
  const drawCanvas = canvas
    ? `
    const canvas = document.getElementById("slider-captcha");
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f4f4f4";
    ctx.fillRect(0, 0, 320, 52);
    ctx.strokeStyle = "#888";
    ctx.strokeRect(0.5, 0.5, 319, 51);
    ctx.fillStyle = "${gray ? "#6b7280" : "#2b6cb0"}";
    ctx.fillRect(2, 2, 48, 48);
    ctx.fillStyle = "#ffffff";
    ctx.font = "16px sans-serif";
    ctx.fillText("||", 18, 31);
    ctx.fillStyle = "#333333";
    ctx.font = "14px sans-serif";
    ctx.fillText("slide to verify", 68, 31);
    `
    : "";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: sans-serif; margin: ${embedded ? "8px" : "48px"}; zoom: ${zoom}; }
    .slider-captcha { width: 320px; height: 52px; border: 1px solid #888; border-radius: 8px; position: relative; user-select: none; background: #f4f4f4; }
    canvas.slider-captcha { box-sizing: border-box; display: block; }
    .slider-handle { width: 48px; height: 48px; margin: 2px; border-radius: 6px; ${handleStyle} display: flex; align-items: center; justify-content: center; cursor: grab; }
    .slider-label { position: absolute; left: 68px; top: 16px; color: #333; pointer-events: none; }
  </style>
</head>
<body>
  ${spacer}
  <form method="post" action="/slider-login">
    <label>Username <input id="slider-username" name="username" autocomplete="username"></label>
    <label>Password <input id="slider-password" name="password" type="password" autocomplete="current-password"></label>
    ${sliderControl}
    <p id="slider-status">pending</p>
    <button type="submit">Login</button>
  </form>
  <script>
    ${drawCanvas}
    const root = document.getElementById("slider-captcha");
    const handle = document.getElementById("slider-handle") || root;
    const status = document.getElementById("slider-status");
    let startX = null;
    let tracking = false;
    const clientX = (event) => event.clientX ?? (event.touches && event.touches[0] ? event.touches[0].clientX : 0);
    const begin = (event) => {
      tracking = true;
      startX = clientX(event);
      document.body.dataset.sliderStarted = "true";
    };
    const end = (event) => {
      if (!tracking) return;
      tracking = false;
      const delta = clientX(event) - startX;
      document.body.dataset.sliderDelta = String(Math.round(delta));
      if (delta >= 180) {
        document.body.dataset.sliderCompleted = "true";
        status.textContent = "completed";
      }
    };
    handle.addEventListener("pointerdown", begin);
    handle.addEventListener("mousedown", begin);
    window.addEventListener("pointerup", end);
    window.addEventListener("mouseup", end);
    root.addEventListener("dragstart", (event) => event.preventDefault());
  </script>
</body>
</html>`;
}

function sliderIframeHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>fixture iframe slider captcha login</title>
  <style>
    body { font-family: sans-serif; margin: 36px; }
    iframe { width: 430px; height: 190px; border: 1px solid #bbb; border-radius: 8px; }
  </style>
</head>
<body>
  <p>embedded same-origin slide to verify captcha</p>
  <iframe id="captcha-frame" title="same origin slider captcha" src="/slider-frame"></iframe>
</body>
</html>`;
}

function crossOriginSliderIframeHtml(crossOrigin) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>fixture cross origin iframe slider captcha login</title>
  <style>
    body { font-family: sans-serif; margin: 36px; }
    iframe { width: 430px; height: 190px; border: 1px solid #bbb; border-radius: 8px; }
  </style>
</head>
<body>
  <p>embedded cross-origin slide to verify captcha</p>
  <iframe id="captcha-frame" title="cross origin slider captcha challenge" src="${crossOrigin}/cross-origin-slider-frame"></iframe>
</body>
</html>`;
}

function checkboxFixtureHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>fixture checkbox captcha login</title>
  <style>
    body { font-family: sans-serif; margin: 48px; }
    .cf-turnstile { width: 300px; height: 74px; border: 1px solid #9ca3af; border-radius: 8px; display: flex; align-items: center; gap: 12px; padding: 12px; background: #f9fafb; }
    .fake-box { width: 28px; height: 28px; border: 2px solid #6b7280; border-radius: 4px; background: white; }
  </style>
</head>
<body>
  <form method="post" action="/checkbox-turnstile">
    <label>Username <input id="checkbox-username" name="username" autocomplete="username"></label>
    <label>Password <input id="checkbox-password" name="password" type="password" autocomplete="current-password"></label>
    <div id="turnstile-captcha" class="cf-turnstile" data-sitekey="fixture-site-key" data-captcha="turnstile" role="button" aria-label="verify you are human">
      <span class="fake-box" aria-hidden="true"></span>
      <span>Verify you are human</span>
    </div>
    <button type="submit">Login</button>
  </form>
</body>
</html>`;
}

function sliderFixtureOptions(pathname) {
  return {
    spacer: pathname === "/slider-login-scroll",
    embedded: pathname === "/slider-frame",
    gray: pathname === "/slider-login-gray",
    canvas: pathname === "/slider-login-canvas",
    zoom: pathname === "/slider-login-zoom" ? 1.25 : 1,
  };
}

async function startSliderFixture() {
  const sockets = new Set();
  const crossOriginSockets = new Set();
  const state = {
    requests: [],
  };
  const crossOriginServer = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    state.requests.push({
      method: req.method,
      path: requestUrl.pathname,
      url: requestUrl.pathname + requestUrl.search,
      origin: "cross-origin",
    });
    if (requestUrl.pathname === "/cross-origin-slider-frame") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(sliderFixtureHtml({ embedded: true }));
      return;
    }
    res.writeHead(404, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end("not found");
  });
  crossOriginServer.keepAliveTimeout = 1_000;
  crossOriginServer.on("connection", (socket) => {
    crossOriginSockets.add(socket);
    socket.once("close", () => crossOriginSockets.delete(socket));
  });
  await new Promise((resolvePromise, rejectPromise) => {
    crossOriginServer.once("error", rejectPromise);
    crossOriginServer.listen(0, "127.0.0.1", resolvePromise);
  });
  const crossOriginAddress = crossOriginServer.address();
  if (!crossOriginAddress || typeof crossOriginAddress === "string") {
    throw new Error("cross-origin fixture server did not expose a TCP port");
  }
  const crossOrigin = `http://127.0.0.1:${String(crossOriginAddress.port)}`;
  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    state.requests.push({
      method: req.method,
      path: requestUrl.pathname,
      url: requestUrl.pathname + requestUrl.search,
    });
    if (
      requestUrl.pathname === "/slider-login"
      || requestUrl.pathname === "/slider-login-scroll"
      || requestUrl.pathname === "/slider-login-gray"
      || requestUrl.pathname === "/slider-login-canvas"
      || requestUrl.pathname === "/slider-login-zoom"
      || requestUrl.pathname === "/slider-frame"
    ) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(sliderFixtureHtml(sliderFixtureOptions(requestUrl.pathname)));
      return;
    }
    if (requestUrl.pathname === "/slider-login-iframe") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(sliderIframeHtml());
      return;
    }
    if (requestUrl.pathname === "/slider-login-cross-origin-iframe") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(crossOriginSliderIframeHtml(crossOrigin));
      return;
    }
    if (requestUrl.pathname === "/checkbox-turnstile") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(checkboxFixtureHtml());
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
    cross_origin: crossOrigin,
    state,
    close: () => new Promise((resolvePromise) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      for (const socket of crossOriginSockets) {
        socket.destroy();
      }
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      if (typeof crossOriginServer.closeAllConnections === "function") {
        crossOriginServer.closeAllConnections();
      }
      server.close(() => {
        crossOriginServer.close(resolvePromise);
      });
    }),
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

function envEnabled(name) {
  return String(process.env[name] ?? "").trim() === "1";
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export {
  envEnabled,
  envNumber,
  startSliderFixture,
  waitFor,
};
