import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { run, parseJsonOutput } from "./process.mjs";

export const REMOTE = "https://github.com/bigKING67/browser67.git";
const API = "https://api.github.com/repos/bigKING67/browser67/releases";
export const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export async function resolveRelease(tag, dependencies = {}) {
  if (tag && !TAG_PATTERN.test(tag)) throw new Error("--tag must be a stable version such as v0.11.3");
  const response = await (dependencies.fetch ?? fetch)(tag ? `${API}/tags/${tag}` : `${API}/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "browser67-update" },
    signal: AbortSignal.timeout(15_000), redirect: "error",
  });
  if (!response.ok) throw new Error(`GitHub release query failed: HTTP ${response.status}`);
  const release = await response.json();
  if (release.draft !== false || release.prerelease !== false || !TAG_PATTERN.test(release.tag_name)
    || (tag && release.tag_name !== tag)) throw new Error("expected a published stable GitHub Release");
  const selectedTag = release.tag_name;
  const refs = await (dependencies.run ?? run)("git", ["ls-remote", "--tags", REMOTE,
    `refs/tags/${selectedTag}`, `refs/tags/${selectedTag}^{}`], { phase: "resolve_tag", timeout: 30_000 });
  const rows = new Map(refs.split(/\r?\n/).filter(Boolean).map((line) => {
    const [sha, ref] = line.split(/\s+/); return [ref, sha];
  }));
  const tagObject = rows.get(`refs/tags/${selectedTag}`);
  const commit = rows.get(`refs/tags/${selectedTag}^{}`);
  if (!/^[a-f0-9]{40}$/.test(tagObject ?? "") || !/^[a-f0-9]{40}$/.test(commit ?? "") || tagObject === commit) {
    throw new Error("release must resolve to an annotated tag and peeled commit");
  }
  return { tag: selectedTag, version: selectedTag.slice(1), tag_object: tagObject, commit,
    url: `https://github.com/bigKING67/browser67/releases/tag/${selectedTag}` };
}

export async function readJsonIfPresent(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export async function observeLive(root, execute = run) {
  try {
    const result = parseJsonOutput(await execute(process.execPath, [resolve(root, "contracts/browser67-live-gate.mjs"),
      "--doctor-only", "--tmwd-mode", "tmwd", "--no-ensure-tmwd-hub", "--allow-empty-tabs", "--disable-event-log"],
    { cwd: root, phase: "observe_live", timeout: 30_000, allowFailure: true }));
    const checks = result.doctor?.checks ?? {};
    const transports = [["ws", checks.tmwd_ws_runtime], ["link", checks.tmwd_link_runtime]];
    const [transport, runtime] = transports.find(([, item]) => item?.extension_connected && item?.observed_browser_instances?.length) ?? [null, null];
    return { status: runtime?.extension_connected ? "connected" : "unavailable", transport,
      instances: (runtime?.observed_browser_instances ?? []).map((item) => ({
        id: item.browser_instance_id, version: item.extension_version, commit: item.build_revision,
        identity_match: item.identity_match === true,
      })) };
  } catch { return { status: "unavailable", instances: [] }; }
}

export async function checkUpdate(options, dependencies = {}) {
  const release = await resolveRelease(options.tag, dependencies);
  const pkg = await readJsonIfPresent(resolve(options.root, "package.json"));
  const extension = await readJsonIfPresent(resolve(options.home, "browser/tmwd_cdp_bridge/browser67/build-identity.json"));
  const live = await (dependencies.observeLive ?? observeLive)(options.root, dependencies.run ?? run);
  return { schema: "browser67.update.v1", mode: "check", ok: true, release,
    local: { cli_version: pkg?.version ?? null, extension_version: extension?.extension_version ?? null,
      extension_commit: extension?.build_revision ?? null }, live,
    version_matches: pkg?.version === release.version,
    version_match_is_content_proof: false,
    host_action: "Reload MCP sessions and restart a changed hub through their owning hosts; source-backed checkouts and host configs are not changed." };
}
