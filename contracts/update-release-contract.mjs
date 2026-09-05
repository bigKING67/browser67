import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, access, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, formatReport } from "../scripts/update-release.mjs";
import { resolveRelease, checkUpdate, observeLive } from "../scripts/update-release/release.mjs";
import { installRelease, verifyInstalledFiles } from "../scripts/update-release/install.mjs";
import { npmInvocation } from "../scripts/update-release/process.mjs";

const release = { tag: "v1.2.3", version: "1.2.3", commit: "a".repeat(40), tag_object: "b".repeat(40) };
const remoteDependencies = {
  fetch: async () => ({ ok: true, json: async () => ({ tag_name: release.tag, draft: false, prerelease: false }) }),
  run: async () => `${release.tag_object}\trefs/tags/${release.tag}\n${release.commit}\trefs/tags/${release.tag}^{}\n`,
};
assert.throws(() => parseArgs([]), /explicit --tag/);
assert.throws(() => parseArgs(["--tag", "v1.2.3;echo"]), /stable version/);
assert.throws(() => parseArgs(["--tag", "--json"]), /missing/);
assert.equal(parseArgs(["--check"]).check, true);
assert.equal((await resolveRelease(undefined, remoteDependencies)).commit, release.commit);
await assert.rejects(resolveRelease(release.tag, { ...remoteDependencies, run: async () => "" }), /annotated tag/);
await assert.rejects(resolveRelease(release.tag, { ...remoteDependencies,
  fetch: async () => ({ ok: true, json: async () => ({ tag_name: release.tag, draft: false, prerelease: true }) }),
}), /published stable/);
assert.throws(() => npmInvocation([], { platform: "win32", env: {}, execPath: "/missing/node" }), /npm-cli/);
const linkOnly = await observeLive("/unused", async () => JSON.stringify({ doctor: { checks: {
  tmwd_ws_runtime: { extension_connected: false },
  tmwd_link_runtime: { extension_connected: true, observed_browser_instances: [{ browser_instance_id: "link", extension_version: "1.2.3" }] },
} } }));
assert.equal(linkOnly.transport, "link");
assert.equal(linkOnly.instances[0].id, "link");

async function json(path, value) { await writeFile(path, JSON.stringify(value)); }
async function fixture(mode) {
  const directory = await mkdtemp(join(tmpdir(), "browser67-update-contract-"));
  const root = join(directory, "global", "browser67");
  const source = join(directory, "release-source");
  const home = join(directory, "home");
  const skillsRoot = join(directory, "skills");
  const extension = join(home, "browser", "tmwd_cdp_bridge");
  const files = ["package.json", "package-lock.json", "scripts/setup-extension.mjs",
    "scripts/active-skill-sync.mjs", "scripts/reload-extension-live.mjs"];
  for (const path of [join(source, "scripts"), root, extension, join(skillsRoot, "browser67"), join(skillsRoot, "js-reverse")]) {
    await mkdir(path, { recursive: true });
  }
  await json(join(source, "package.json"), { name: "browser67", version: release.version });
  await json(join(source, "package-lock.json"), { version: release.version, packages: { "": { version: release.version } } });
  for (const path of files.slice(2)) await writeFile(join(source, path), "// fixture only\n");
  await json(join(root, "package.json"), { name: "browser67", version: "1.2.2" });
  await writeFile(join(extension, "config.js"), "PRIVATE_FIXTURE_CONFIG");
  await writeFile(join(skillsRoot, "browser67", "SKILL.md"), "previous skill");
  const commands = [];
  const options = { root, home, skillsRoot, tag: release.tag };
  const dependencies = {
    checkUpdate: async () => ({ release, live: { transport: mode === "link_only" ? "link" : "ws", instances: mode === "ambiguous"
      ? [{ id: "one" }, { id: "two" }] : [{ id: "one" }] }, host_action: "host reload required" }),
    resolveRelease: async () => mode === "moved" ? { ...release, commit: "c".repeat(40) } : release,
    observeLive: async () => ({ instances: [{ id: "one", version: release.version, commit: release.commit, identity_match: mode !== "stale" }] }),
    delay: async () => {},
    run: async (command, args, config = {}) => {
      commands.push(config.phase);
      if (mode === config.phase) throw new Error(`injected ${mode}`);
      if (config.phase === "locate_global_package") return join(directory, "global");
      if (config.phase === "fetch_release") { await cp(source, args.at(-1), { recursive: true }); return ""; }
      if (config.phase === "verify_commit") return release.commit;
      if (config.phase === "verify_tag") return release.tag_object;
      if (config.phase === "pack") {
        assert.ok(args.includes("--ignore-scripts"));
        const pkg = JSON.parse(await readFile(join(config.cwd, "package.json"), "utf8"));
        const filename = `browser67-${pkg.version}.tgz`;
        await writeFile(join(args.at(-1), filename), "archive fixture");
        return JSON.stringify([{ filename, files: files.map((path) => ({ path })) }]);
      }
      if (config.phase === "install_package") {
        assert.ok(args.includes("--ignore-scripts"));
        await cp(source, root, { recursive: true }); return "";
      }
      if (config.phase === "setup_extension") {
        assert.ok(args.includes("--skip-registry"));
        await mkdir(join(extension, "browser67"), { recursive: true });
        await json(join(extension, "browser67/build-identity.json"), { extension_version: release.version, build_revision: release.commit });
        await json(join(extension, "manifest.json"), { version: release.version });
      }
      if (config.phase === "sync_skills") {
        assert.ok(args.includes("--check"));
        return JSON.stringify({ ok: mode !== "skill_drift" });
      }
      return "";
    },
  };
  return { directory, options, dependencies, commands, extension };
}

for (const mode of ["success", "ambiguous", "link_only", "moved", "install_package", "reload_extension", "stale", "skill_drift"]) {
  const f = await fixture(mode);
  try {
    if (mode === "success") {
      const receipt = await installRelease(f.options, f.dependencies);
      assert.equal(receipt.ok, true);
      assert.equal(receipt.files_verified, 5);
      assert.equal(receipt.live.identity_match, true);
      assert.equal(await readFile(join(receipt.recovery.extension_backup, "config.js"), "utf8"), "PRIVATE_FIXTURE_CONFIG");
      assert.ok(!JSON.stringify(receipt).includes("PRIVATE_FIXTURE_CONFIG"));
      assert.match(formatReport(receipt), /v1.2.3/);
      assert.ok(f.commands.indexOf("install_package") > f.commands.lastIndexOf("pack"));
    } else {
      let failure;
      await assert.rejects(installRelease(f.options, f.dependencies), (error) => { failure = error; return true; });
      if (["ambiguous", "link_only"].includes(mode)) {
        assert.equal(failure.receipt, undefined);
        assert.equal(f.commands.length, 0);
      } else {
        assert.equal(failure.receipt.status, "failed");
        assert.equal(failure.receipt.ok, false);
        await access(failure.receipt.recovery.previous_package);
        assert.equal(failure.receipt.mutation_started, mode !== "moved");
        if (mode === "moved") assert.ok(!f.commands.includes("install_package"));
      }
    }
    await assert.rejects(access(join(f.options.home, "runtime/updates/install.lock")));
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}

const f = await fixture("success");
try {
  for (const override of [{ home: f.options.root }, { home: join(f.options.root, "nested", "home") },
    { skillsRoot: join(f.directory, "global") }]) {
    await assert.rejects(installRelease({ ...f.options, ...override }, f.dependencies), /must not overlap/);
    assert.ok(!f.commands.includes("fetch_release"));
    assert.ok(!f.commands.includes("install_package"));
  }
  await assert.rejects(access(join(f.options.root, "runtime")));
  await assert.rejects(access(join(f.options.root, "nested")));
  for (const ancestor of ["runtime", "browser"]) {
    const linkedHome = join(f.directory, `linked-${ancestor}`);
    await mkdir(linkedHome);
    await symlink(f.options.root, join(linkedHome, ancestor), "junction");
    await assert.rejects(installRelease({ ...f.options, home: linkedHome }, f.dependencies), /must not overlap/);
    assert.ok(!f.commands.includes("fetch_release"));
    await assert.rejects(access(join(f.options.root, "updates")));
    await assert.rejects(access(join(f.options.root, "tmwd_cdp_bridge")));
  }
  await mkdir(join(f.options.home, "runtime/updates"), { recursive: true });
  await writeFile(join(f.options.home, "runtime/updates/install.lock"), "other owner");
  await assert.rejects(installRelease(f.options, f.dependencies), /EEXIST/);
  assert.equal(await readFile(join(f.options.home, "runtime/updates/install.lock"), "utf8"), "other owner");
  await writeFile(join(f.directory, "global/.browser67-update.lock"), "global owner");
  await assert.rejects(installRelease({ ...f.options, home: join(f.directory, "another-home") }, f.dependencies), /EEXIST/);
  assert.equal(await readFile(join(f.directory, "global/.browser67-update.lock"), "utf8"), "global owner");
  await assert.rejects(verifyInstalledFiles(f.options.root, f.options.root, [{ path: "../escape" }]), /unsafe/);
  const absentHome = join(f.directory, "absent-home");
  const checked = await checkUpdate({ ...f.options, home: absentHome }, { ...remoteDependencies,
    observeLive: async () => ({ status: "unavailable", instances: [] }) });
  assert.equal(checked.mode, "check");
  await assert.rejects(access(absentHome));
} finally { await rm(f.directory, { recursive: true, force: true }); }
console.log(JSON.stringify({ ok: true, check: "update-release-contract", cases: 9,
  read_only_check: true, tag_pinning: true, recovery: true, concurrent_install_blocked: true }));
