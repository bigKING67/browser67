import { Socket } from "node:net";

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function isPortReachable(host, port, timeoutMs = 200) {
  return new Promise((resolvePromise) => {
    const socket = new Socket();
    let settled = false;
    const finish = (reachable) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolvePromise(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function pickFreePortPair(attempts = 32) {
  if (attempts <= 0) {
    throw new Error("unable to find free port pair: tmwd hub relay contract");
  }
  const wsPort = 34000 + Math.floor(Math.random() * 8000);
  const linkPort = wsPort + 1;
  const [wsBusy, linkBusy] = await Promise.all([
    isPortReachable("127.0.0.1", wsPort),
    isPortReachable("127.0.0.1", linkPort),
  ]);
  if (!wsBusy && !linkBusy) {
    return { wsPort, linkPort };
  }
  return pickFreePortPair(attempts - 1);
}

function waitForPort(host, port, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let timer = null;
  return new Promise((resolvePromise, rejectPromise) => {
    const probe = () => {
      if (Date.now() >= deadline) {
        rejectPromise(new Error(`port did not become reachable: ${host}:${String(port)}`));
        return;
      }
      isPortReachable(host, port, 100)
        .then((reachable) => {
          if (reachable) {
            resolvePromise();
            return;
          }
          timer = setTimeout(probe, 50);
        })
        .catch((error) => rejectPromise(error));
    };
    probe();
  }).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export {
  isPortReachable,
  pickFreePortPair,
  sleep,
  waitForPort,
};
