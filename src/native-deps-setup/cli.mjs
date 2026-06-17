function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  return {
    install: flags.has("--install"),
    yes: flags.has("--yes"),
    json: flags.has("--json"),
    quiet: flags.has("--quiet"),
  };
}

function emit(payload, options = {}) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (options.quiet) {
    return;
  }
  if (typeof payload === "object" && payload !== null) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${String(payload)}\n`);
}

export {
  emit,
  parseArgs,
};
