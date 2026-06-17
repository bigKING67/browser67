import { spawn } from "node:child_process";

const TIMEOUT_MS = 45_000;

function createMcpClient(serverPath) {
  const proc = spawn("node", [serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let nextId = 1;
  let buffer = "";
  const pending = new Map();
  let processClosed = false;
  let processFailure = null;

  proc.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx < 0) {
        break;
      }
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (!message.id || !pending.has(message.id)) {
        continue;
      }
      const { resolve } = pending.get(message.id);
      pending.delete(message.id);
      resolve(message);
    }
  });

  proc.stderr.on("data", () => {
    // keep silent; this script reports structured output
  });

  proc.on("error", (error) => {
    processFailure = error;
    for (const { reject } of pending.values()) {
      reject(new Error(`mcp process error: ${String(error?.message ?? error)}`));
    }
    pending.clear();
  });

  proc.on("close", (code) => {
    processClosed = true;
    if (code === 0) {
      return;
    }
    if (!processFailure) {
      processFailure = new Error(`mcp process exited code=${String(code)}`);
    }
    for (const { reject } of pending.values()) {
      reject(new Error(`mcp process closed: ${String(processFailure?.message ?? processFailure)}`));
    }
    pending.clear();
  });

  function request(method, params, timeoutMs = TIMEOUT_MS) {
    if (processFailure) {
      return Promise.reject(new Error(`mcp unavailable: ${String(processFailure?.message ?? processFailure)}`));
    }
    if (processClosed) {
      return Promise.reject(new Error(`mcp unavailable: process closed method=${method}`));
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      try {
        proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      } catch (error) {
        reject(new Error(`mcp write failed method=${method}: ${String(error?.message ?? error)}`));
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`mcp timeout method=${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  async function toolCall(name, args) {
    const response = await request("tools/call", { name, arguments: args });
    if (response.error) {
      throw new Error(`tool_call_error ${name}: ${JSON.stringify(response.error)}`);
    }
    const content = response?.result?.content;
    if (!Array.isArray(content)) {
      throw new Error(`tool_call_bad_payload ${name}: missing content`);
    }
    const jsonPayload = content
      .map((item) => {
        if (item?.type === "json" && typeof item.json === "object" && item.json !== null) {
          return item.json;
        }
        if (item?.type === "text" && typeof item.text === "string") {
          try {
            const parsed = JSON.parse(item.text);
            return typeof parsed === "object" && parsed !== null ? parsed : null;
          } catch {
            return null;
          }
        }
        return null;
      })
      .find(Boolean);
    if (!jsonPayload) {
      throw new Error(`tool_call_bad_payload ${name}: missing JSON payload`);
    }
    return jsonPayload;
  }

  async function close() {
    proc.kill("SIGTERM");
  }

  return {
    request,
    toolCall,
    close,
  };
}

export {
  createMcpClient,
};
