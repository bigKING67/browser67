import { createServer } from "node:http";

async function startHangingTmwdLinkServer() {
  return await new Promise((resolvePromise, rejectPromise) => {
    const sockets = new Set();
    const server = createServer((request) => {
      request.on("data", () => {});
      request.on("end", () => {
        // Intentionally keep request hanging to force client-side timeout.
      });
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => {
        sockets.delete(socket);
      });
    });
    server.once("error", (error) => {
      rejectPromise(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectPromise(new Error("failed to resolve hanging tmwd link server address"));
        return;
      }
      resolvePromise({
        endpoint: `http://127.0.0.1:${String(address.port)}/link`,
        close: async () => {
          for (const socket of sockets) {
            socket.destroy();
          }
          await new Promise((resolveClose) => {
            server.close(() => {
              resolveClose();
            });
          });
        },
      });
    });
  });
}

async function startExecuteErrorTmwdLinkServer() {
  return await new Promise((resolvePromise, rejectPromise) => {
    const sockets = new Set();
    const server = createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => {
        chunks.push(chunk);
      });
      request.on("end", () => {
        let payload = {};
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          payload = {};
        }
        const cmd = String(payload?.cmd ?? "").trim().toLowerCase();
        if (cmd === "get_all_sessions") {
          response.statusCode = 200;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({
            r: [
              {
                id: "exec_error_session_1",
                title: "ExecError Session",
                url: "https://example.invalid/exec-error",
              },
            ],
          }));
          return;
        }
        if (cmd === "execute_js") {
          response.statusCode = 200;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({
            r: {
              error: "contract-sentinel execute_js failure",
            },
          }));
          return;
        }
        response.statusCode = 200;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          r: {},
        }));
      });
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => {
        sockets.delete(socket);
      });
    });
    server.once("error", (error) => {
      rejectPromise(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectPromise(new Error("failed to resolve execute-error tmwd link server address"));
        return;
      }
      resolvePromise({
        endpoint: `http://127.0.0.1:${String(address.port)}/link`,
        close: async () => {
          for (const socket of sockets) {
            socket.destroy();
          }
          await new Promise((resolveClose) => {
            server.close(() => {
              resolveClose();
            });
          });
        },
      });
    });
  });
}

export {
  startExecuteErrorTmwdLinkServer,
  startHangingTmwdLinkServer,
};
