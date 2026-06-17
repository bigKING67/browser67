import { Socket } from "node:net";

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

async function pickFreePortPair(attempts = 24) {
  if (attempts <= 0) {
    throw new Error("unable to find free port pair: tmwd-hub-control contract");
  }
  const wsPort = 24000 + Math.floor(Math.random() * 10000);
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

export {
  isPortReachable,
  pickFreePortPair,
};
