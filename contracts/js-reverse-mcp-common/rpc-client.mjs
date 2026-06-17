import { spawn } from "node:child_process";

import { jsReverseServerPath, repoRoot } from "./paths.mjs";

function createJsReverseRpcClient(options = {}) {
  const idPrefix = String(options?.idPrefix ?? "js_reverse_rpc").replace(/[^a-zA-Z0-9_:-]/g, "_");
  const defaultTimeoutMs = Number.isFinite(Number(options?.defaultTimeoutMs))
    ? Math.max(500, Math.floor(Number(options.defaultTimeoutMs)))
    : 12_000;
  const child = spawn(process.execPath, [jsReverseServerPath], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let nextId = 1;
  const pending = new Map();
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let closed = false;

  const rejectAll = (message) => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timeoutHandle);
      entry.reject(new Error(message));
    }
    pending.clear();
  };

  if (child.stdout) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      while (true) {
        const newlineIndex = stdoutBuffer.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const id = parsed?.id;
        if (!pending.has(id)) {
          continue;
        }
        const entry = pending.get(id);
        pending.delete(id);
        clearTimeout(entry.timeoutHandle);
        entry.resolve(parsed);
      }
    });
  }

  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk;
    });
  }

  child.on("error", (error) => {
    rejectAll(`js-reverse process error: ${String(error)}`);
  });

  child.on("close", (code, signal) => {
    closed = true;
    rejectAll(
      `js-reverse exited code=${String(code)} signal=${String(signal)} stderr=${stderrBuffer}`,
    );
  });

  const call = (method, params = {}, timeoutMs = defaultTimeoutMs) => {
    if (closed || !child.stdin) {
      return Promise.reject(new Error("js-reverse process is not available"));
    }
    const id = `${idPrefix}_${String(nextId++)}`;
    return new Promise((resolvePromise, rejectPromise) => {
      const timeoutHandle = setTimeout(() => {
        pending.delete(id);
        rejectPromise(
          new Error(`rpc timeout method=${method} id=${id} timeout_ms=${String(timeoutMs)}`),
        );
      }, timeoutMs);
      pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timeoutHandle,
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };

  const notify = (method, params = {}) => {
    if (closed || !child.stdin) {
      return;
    }
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  };

  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    rejectAll("js-reverse closing");
    child.kill("SIGTERM");
    await new Promise((resolveClose) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 1_000);
      child.once("close", () => {
        clearTimeout(timer);
        resolveClose();
      });
    });
  };

  return { call, notify, close };
}

export {
  createJsReverseRpcClient,
};
