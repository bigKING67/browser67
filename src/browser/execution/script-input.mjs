function resolveExecuteJsScriptInput(args = {}) {
  if (Object.prototype.hasOwnProperty.call(args, "script")) {
    return { source: "script", value: args.script };
  }
  return { missing: true, source: "missing", value: "" };
}

export { resolveExecuteJsScriptInput };
