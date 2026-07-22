import { createServer } from "node:http";

const FIXTURE_HTML = `<!doctype html>
<html>
  <head>
    <title>remote-cdp-fixture</title>
    <style>body { font-family: sans-serif; } iframe { width: 320px; height: 80px; }</style>
  </head>
  <body>
    <main>
      <button id="increment" type="button">Increment</button>
      <div id="role-action" role="button" tabindex="0" aria-label="Role action">Role action</div>
      <label for="display-name">Display name</label>
      <input id="display-name" name="display_name" value="initial">
      <label for="secret">Password</label>
      <input id="secret" name="password" type="password" value="remote-secret">
      <div id="editable" contenteditable="true" aria-label="Editable note">initial note</div>
      <select id="choice" aria-label="Choice"><option value="one">One</option><option value="two">Two</option></select>
      <div id="status" role="status">idle</div>
      <div id="shadow-host"></div>
      <div id="closed-shadow-host"></div>
      <iframe id="same-frame" title="same origin frame" srcdoc="<button id='frame-action'>Frame action</button>"></iframe>
      <iframe id="cross-frame" title="cross origin frame" src="__BROWSER67_CROSS_ORIGIN_URL__"></iframe>
    </main>
    <script>
      let count = 0;
      document.querySelector('#increment').addEventListener('click', () => {
        count += 1;
        document.querySelector('#status').textContent = 'count:' + String(count);
        fetch('/slow?ms=180').then((response) => response.json()).then((payload) => {
          document.querySelector('#status').dataset.network = payload.ok ? 'complete' : 'failed';
        });
        if (!document.querySelector('#dynamic-action')) {
          const dynamic = document.createElement('button');
          dynamic.id = 'dynamic-action';
          dynamic.textContent = 'Dynamic action';
          document.querySelector('main').append(dynamic);
        }
      });
      const shadow = document.querySelector('#shadow-host').attachShadow({ mode: 'open' });
      shadow.innerHTML = '<button id="shadow-action">Shadow action</button>';
      const closedShadow = document.querySelector('#closed-shadow-host').attachShadow({ mode: 'closed' });
      closedShadow.innerHTML = '<button id="closed-shadow-action">Closed shadow action</button>';
    </script>
  </body>
</html>`;

function createFixtureServer(options = {}) {
  return createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/slow") {
      const delayMs = Math.max(0, Math.min(2_000, Number(url.searchParams.get("ms") || 0)));
      setTimeout(() => {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify({ ok: true, delay_ms: delayMs }));
      }, delayMs);
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(FIXTURE_HTML.replace(
      "__BROWSER67_CROSS_ORIGIN_URL__",
      String(options.cross_origin_url ?? "about:blank"),
    ));
  });
}

function createCrossOriginFrameServer() {
  return createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end("<!doctype html><button id='cross-origin-action'>Cross origin action</button>");
  });
}

function createReservedServer() {
  return createServer((_request, response) => {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("reserved");
  });
}

function listen(server, host = "127.0.0.1") {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, host, () => {
      server.off("error", rejectPromise);
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectPromise(new Error("server returned invalid address"));
        return;
      }
      resolvePromise(address.port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolvePromise) => {
    try {
      server.close(() => resolvePromise());
    } catch {
      resolvePromise();
    }
  });
}

async function reservePort() {
  const cdpServer = createReservedServer();
  const cdpPort = await listen(cdpServer);
  await closeServer(cdpServer);
  return cdpPort;
}

export {
  closeServer,
  createCrossOriginFrameServer,
  createFixtureServer,
  listen,
  reservePort,
};
