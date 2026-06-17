function parseArgs(argv) {
  const parsed = {
    timeout_ms: 15_000,
    chrome_bin: "",
    keep_temp: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--timeout-ms") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("invalid --timeout-ms value");
      }
      parsed.timeout_ms = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--chrome-bin") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --chrome-bin value");
      }
      parsed.chrome_bin = value;
      index += 1;
      continue;
    }
    if (token === "--keep-temp") {
      parsed.keep_temp = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

export {
  parseArgs,
};
