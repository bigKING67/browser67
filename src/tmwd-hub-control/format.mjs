function formatStatusHuman(payload) {
  const rows = [];
  rows.push(`tmwd_hub running=${payload.running ? "yes" : "no"} managed=${payload.managed ? "yes" : "no"}`);
  rows.push(`ws_tcp=${payload.checks.ws_tcp.reachable ? "up" : "down"} ${payload.checks.ws_tcp.endpoint}`);
  rows.push(`link_tcp=${payload.checks.link_tcp.reachable ? "up" : "down"} ${payload.checks.link_tcp.endpoint}`);
  rows.push(`link_http=${payload.checks.link_http.ok ? "ok" : "fail"} status=${String(payload.checks.link_http.status ?? "null")}`);
  rows.push(`link_cmd=${payload.checks.link_cmd.ok ? "ok" : "fail"} sessions=${String(payload.checks.link_cmd.session_count ?? 0)}`);
  rows.push(`tmwd_signature=${payload.tmwd_signature_ok ? "yes" : "no"} conflict_suspected=${payload.conflict_suspected ? "yes" : "no"}`);
  if (Number.isFinite(Number(payload.state?.pid ?? NaN))) {
    rows.push(`pid=${String(payload.state.pid)} source=${payload.pid_source} alive=${payload.pid_alive ? "yes" : "no"}`);
  } else {
    rows.push("pid=unknown");
  }
  rows.push(`state_file=${payload.state_file}`);
  return rows.join("\n");
}

export {
  formatStatusHuman,
};
