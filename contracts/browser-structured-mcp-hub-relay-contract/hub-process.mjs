import { spawn } from "node:child_process";

import { hubPath, repoRoot } from "./paths.mjs";
import { sleep } from "./ports.mjs";

function startHubProcess({ wsPort, linkPort }) {
  const child = spawn(process.execPath, [hubPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      TMWD_HUB_HOST: "127.0.0.1",
      TMWD_HUB_WS_PORT: String(wsPort),
      TMWD_HUB_LINK_PORT: String(linkPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = {
    stdout: "",
    stderr: "",
  };
  child.stdout.on("data", (chunk) => {
    logs.stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    logs.stderr += String(chunk);
  });
  return {
    child,
    logs,
  };
}

async function terminateHubProcess(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await sleep(100);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

function assertHubDidNotCrash(child, logs) {
  if (child.exitCode !== null && child.exitCode !== 0 && child.signalCode !== "SIGTERM") {
    throw new Error(
      `hub exited unexpectedly code=${String(child.exitCode)} signal=${String(child.signalCode)} stdout=${logs.stdout} stderr=${logs.stderr}`,
    );
  }
}

export {
  assertHubDidNotCrash,
  startHubProcess,
  terminateHubProcess,
};
