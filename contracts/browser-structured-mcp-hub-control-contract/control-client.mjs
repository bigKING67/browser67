import { hubControlPath } from "./paths.mjs";
import { parseLastJsonLine, runNodeScript } from "./process.mjs";

function buildControlArgs(command, baseArgs) {
  return [
    command,
    "--json",
    "--wait-ms", "5000",
    "--timeout-ms", "1000",
    "--tmwd-ws-endpoint", baseArgs.tmwdWsEndpoint,
    "--tmwd-link-endpoint", baseArgs.tmwdLinkEndpoint,
    "--state-file", baseArgs.stateFilePath,
  ];
}

function callControl(command, baseArgs) {
  const result = runNodeScript(hubControlPath, buildControlArgs(command, baseArgs));
  if (result.error) {
    throw result.error;
  }
  const payload = parseLastJsonLine(result.stdout);
  if (!payload || typeof payload !== "object") {
    throw new Error(`hub-control invalid output command=${command} stdout=${result.stdout} stderr=${result.stderr}`);
  }
  return {
    exitCode: Number.isFinite(Number(result.status)) ? Number(result.status) : 1,
    payload,
  };
}

export {
  callControl,
};
