import { randomUUID, createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, writeFile, rename, unlink, realpath } from "node:fs/promises";
import { join, resolve, isAbsolute, relative, dirname, basename } from "node:path";
import { run, parseJsonOutput } from "./process.mjs";
import { REMOTE, checkUpdate, resolveRelease, observeLive, readJsonIfPresent } from "./release.mjs";

async function requireDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`expected a real directory: ${path}`);
}

async function canonicalDestination(path) {
  try { return await realpath(path); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    return join(await canonicalDestination(dirname(path)), basename(path));
  }
}

function overlaps(left, right) {
  const within = (parent, child) => {
    const path = relative(parent, child);
    return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
  };
  return within(left, right) || within(right, left);
}

async function backupDirectory(source, target) {
  try { await requireDirectory(source); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  await cp(source, target, { recursive: true, dereference: false, errorOnExist: true, force: false });
  return true;
}

async function pack(source, destination, execute) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const rows = parseJsonOutput(await execute("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination],
    { cwd: source, phase: "pack" }));
  const item = rows?.[0];
  if (rows?.length !== 1 || !/^browser67-[\w.+-]+\.tgz$/.test(item?.filename ?? "") || !Array.isArray(item.files) || !item.files.length) {
    throw new Error("unexpected npm pack manifest");
  }
  return { ...item, archive: join(destination, item.filename) };
}

export async function verifyInstalledFiles(source, target, files) {
  for (const { path } of files) {
    if (typeof path !== "string" || isAbsolute(path) || path.split(/[\\/]/).some((part) => part === "..") || path.includes("\\")) {
      throw new Error("unsafe package manifest path");
    }
    const [expected, actual] = await Promise.all([readFile(join(source, path)), readFile(join(target, path))]);
    if (!expected.equals(actual)) throw new Error(`installed package differs: ${path}`);
  }
  return files.length;
}

async function acquireLocks(paths) {
  const token = randomUUID();
  const owned = [];
  async function release() {
    for (const path of owned.reverse()) {
      if (await readFile(path, "utf8").catch(() => "") === token) await unlink(path);
    }
  }
  try {
    for (const path of paths) {
      await writeFile(path, token, { flag: "wx", mode: 0o600 });
      owned.push(path);
    }
    return release;
  } catch (error) { await release(); throw error; }
}

export async function installRelease(options, dependencies = {}) {
  if (!options.tag) throw new Error("installation requires an explicit --tag; use --check to discover a release");
  const execute = dependencies.run ?? run;
  const inspect = dependencies.checkUpdate ?? checkUpdate;
  const before = await inspect(options, dependencies);
  const release = before.release;
  if (before.live.transport !== "ws") throw new Error("installation requires a connected WS bridge for safe reload; Link-only inspection is supported by --check");
  const instances = before.live.instances;
  const selected = options.browserInstanceId
    ? instances.find((item) => item.id === options.browserInstanceId)
    : instances.length === 1 ? instances[0] : null;
  if (!selected) throw new Error("connected Browser Instance required; multiple instances require --browser-instance-id");
  const globalPath = await execute("npm", ["root", "--global"], { phase: "locate_global_package" });
  if (!isAbsolute(globalPath) || /[\r\n]/.test(globalPath)) throw new Error("invalid npm global root");
  const globalRoot = await realpath(globalPath);
  const installedRoot = join(globalRoot, "browser67");
  await requireDirectory(installedRoot); // Never overwrite a checkout linked with npm link.
  for (const path of [options.home, join(options.home, "runtime", "updates"),
    join(options.home, "browser", "tmwd_cdp_bridge"), join(options.skillsRoot, "browser67"), join(options.skillsRoot, "js-reverse")]) {
    if (overlaps(installedRoot, await canonicalDestination(path))) throw new Error("update home/Skill destinations must not overlap the global package");
  }
  if ((await readJsonIfPresent(join(installedRoot, "package.json")))?.name !== "browser67") throw new Error("global browser67 package unavailable");
  const updatesRoot = join(options.home, "runtime", "updates");
  await mkdir(updatesRoot, { recursive: true, mode: 0o700 });
  await requireDirectory(updatesRoot);
  const lock = join(updatesRoot, "install.lock");
  const releaseLocks = await acquireLocks([join(globalRoot, ".browser67-update.lock"), lock]);
  let receipt;
  let receiptPath;
  async function save() {
    await writeFile(`${receiptPath}.tmp`, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    await rename(`${receiptPath}.tmp`, receiptPath);
  }
  try {
    const directory = await mkdtemp(join(updatesRoot, "update-"));
    receiptPath = join(directory, "receipt.json");
    receipt = { schema: "browser67.update.v1", mode: "install", ok: false, release,
      phase: "prepare", status: "running", receipt_path: receiptPath,
      installed_root: installedRoot, browser_instance_id: selected.id,
      mutation_started: false, recovery: {}, host_action: before.host_action };
    await save();
    const source = join(directory, "source");
    await execute("git", ["clone", "--quiet", "--depth", "1", "--branch", release.tag, "--single-branch", REMOTE, source],
      { phase: "fetch_release" });
    const commit = await execute("git", ["rev-parse", "HEAD"], { cwd: source, phase: "verify_commit" });
    const tagObject = await execute("git", ["rev-parse", `refs/tags/${release.tag}`], { cwd: source, phase: "verify_tag" });
    if (commit !== release.commit || tagObject !== release.tag_object) throw new Error("tag changed while preparing update");
    const pkg = await readJsonIfPresent(join(source, "package.json"));
    const lockfile = await readJsonIfPresent(join(source, "package-lock.json"));
    if (pkg?.name !== "browser67" || pkg.version !== release.version || lockfile?.version !== release.version
      || lockfile?.packages?.[""]?.version !== release.version) throw new Error("release package/lock version mismatch");
    for (const script of ["setup-extension.mjs", "active-skill-sync.mjs", "reload-extension-live.mjs"]) {
      const stat = await lstat(join(source, "scripts", script));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`release helper unavailable: ${script}`);
    }
    const candidate = await pack(source, join(directory, "candidate"), execute);
    receipt.archive_sha256 = createHash("sha256").update(await readFile(candidate.archive)).digest("hex");
    receipt.phase = "backup";
    const previous = await pack(installedRoot, join(directory, "previous"), execute);
    receipt.recovery.previous_package = previous.archive;
    const extension = join(options.home, "browser", "tmwd_cdp_bridge");
    const extensionBackup = join(directory, "previous-extension");
    if (await backupDirectory(extension, extensionBackup)) receipt.recovery.extension_backup = extensionBackup;
    receipt.recovery.skills = [];
    for (const skill of ["browser67", "js-reverse"]) {
      const target = join(options.skillsRoot, skill);
      const backup = join(directory, "previous-skills", skill);
      if (await backupDirectory(target, backup)) receipt.recovery.skills.push({ target, backup });
    }
    receipt.recovery.instructions = "Reinstall previous_package with npm install --global --ignore-scripts; restore the recorded extension/skill backups, then reload the extension and verify. Recovery is manual; no automatic rollback or host-config edits.";
    await save();
    const currentRelease = await (dependencies.resolveRelease ?? resolveRelease)(release.tag, dependencies);
    if (currentRelease.commit !== release.commit || currentRelease.tag_object !== release.tag_object) throw new Error("remote tag moved before installation");
    receipt.phase = "install_package";
    receipt.mutation_started = true;
    await save();
    await execute("npm", ["install", "--global", "--ignore-scripts", candidate.archive], { phase: receipt.phase });
    await requireDirectory(installedRoot);
    receipt.files_verified = await verifyInstalledFiles(source, installedRoot, candidate.files);
    const environment = { ...process.env, BROWSER67_HOME: options.home, BROWSER67_EXTENSION_BUILD_REVISION: release.commit };
    receipt.phase = "setup_extension";
    await save();
    await execute(process.execPath, [join(installedRoot, "scripts/setup-extension.mjs"), "--skip-registry", "--json"],
      { cwd: installedRoot, env: environment, phase: receipt.phase });
    receipt.phase = "sync_skills";
    await save();
    const skillsReport = parseJsonOutput(await execute(process.execPath,
      [join(installedRoot, "scripts/active-skill-sync.mjs"), "--write", "--check", "--json", "--target", options.skillsRoot],
      { cwd: installedRoot, env: environment, phase: receipt.phase, allowFailure: true }));
    if (skillsReport.ok !== true) throw new Error("active Skills still differ after sync; extra files are preserved, not silently pruned");
    const diskIdentity = await readJsonIfPresent(join(extension, "browser67/build-identity.json"));
    const manifest = await readJsonIfPresent(join(extension, "manifest.json"));
    if (diskIdentity?.extension_version !== release.version || diskIdentity?.build_revision !== release.commit
      || manifest?.version !== release.version) throw new Error("installed extension version mismatch");
    receipt.local = { cli_version: release.version, extension_version: diskIdentity.extension_version,
      extension_commit: diskIdentity.build_revision, skills: "synced" };
    receipt.phase = "reload_extension";
    await save();
    await execute(process.execPath, [join(installedRoot, "scripts/reload-extension-live.mjs"), "--browser-instance-id", selected.id, "--json"],
      { cwd: installedRoot, env: environment, phase: receipt.phase });
    receipt.phase = "verify_live";
    await save();
    const observer = dependencies.observeLive ?? observeLive;
    for (let attempt = 0; attempt < 6; attempt++) {
      const live = await observer(installedRoot, execute);
      const instance = live.instances.find((item) => item.id === selected.id);
      receipt.live = instance ?? null;
      if (instance?.version === release.version && instance?.commit === release.commit && instance?.identity_match) break;
      if (attempt < 5) await (dependencies.delay ?? ((ms) => new Promise((done) => setTimeout(done, ms))))(1000);
    }
    if (receipt.live?.version !== release.version || receipt.live?.commit !== release.commit || !receipt.live?.identity_match) throw new Error("live extension did not confirm the selected release");
    receipt.ok = true;
    receipt.status = "completed";
    receipt.phase = "complete";
    receipt.agent_sessions = "reload_required; source-backed checkouts and host configurations unchanged";
    await save();
    return receipt;
  } catch (error) {
    if (receipt) {
      receipt.status = "failed";
      receipt.error = String(error.message);
      await save();
      error.receipt = receipt;
    }
    throw error;
  } finally {
    await releaseLocks();
  }
}
