function parseWindowSelector(args) {
  const title = String(args?.window_title ?? "").trim();
  const pidParsed = Number(args?.window_pid);
  const pid = Number.isInteger(pidParsed) && pidParsed > 0 ? pidParsed : null;
  return { title, pid };
}

export {
  parseWindowSelector,
};
