import assert from "node:assert/strict";
import test from "node:test";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {cp, link, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {nativeFixture} from "./helpers/continuation-fixture.mjs";
import {preparedAuthorityDigest, readPreparedConfig} from "../dist/configured.js";
import {registryForConfig} from "../dist/tool-registry.js";
import {openRunBudget} from "../dist/run-limits.js";
import * as privateState from "../dist/private-state.js";

// The launcher refuses linked journal and run-state paths, so fixtures use the
// canonical temporary directory (macOS /var is itself a link).
process.env.TMPDIR = await realpath(tmpdir());
const checkout = fileURLToPath(new URL("..", import.meta.url));
const original = "ORIGINAL_SYNTHETIC_HOST_FILE\n";
const absent = path => lstat(path).then(() => false, error => {if (error.code === "ENOENT") return true; throw error;});
const leftovers = async directory => (await readdir(directory)).filter(name => name.startsWith(".chio-") && name.endsWith(".tmp"));

/** The protected launcher accepts only an installed artifact. Copy the built
 * package under node_modules/@chio-protocol/pi-plugin, where npm installs it, and
 * link its dependencies from this checkout. Other locations exercise refusal. */
async function installedLauncher(root, scope = "@chio-protocol", name = "pi-plugin") {
  const modules = join(root, "node_modules"), installed = join(modules, scope, name);
  await mkdir(installed, {recursive: true}); await mkdir(join(modules, "@chio"), {recursive: true});
  await cp(join(checkout, "dist"), join(installed, "dist"), {recursive: true});
  await cp(join(checkout, "package.json"), join(installed, "package.json"));
  for (const entry of await readdir(join(checkout, "node_modules"))) if (entry !== "@chio" && entry !== scope) await symlink(join(checkout, "node_modules", entry), join(modules, entry));
  await symlink(join(checkout, "node_modules", "@chio", "bridge"), join(modules, "@chio", "bridge"));
  return join(installed, "dist", "protected-cli.js");
}

test("protected launcher accepts only the installed layout of its own package name", async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "chio-installed-layout-")));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const runtimePath = join(directory, "runtime.json"); await writeFile(runtimePath, "{}", {mode: 0o600});
  const launch = cli => promisify(execFile)(process.execPath, [cli, "--config", join(directory, "missing-config.json"), "--profile", join(directory, "profile"), "--cwd", join(directory, "cwd"),
    "--provider", "openai", "--model", "gpt-4.1-mini", "--prompt", "synthetic task", ...(process.platform === "linux" ? ["--linux-runtime", runtimePath] : [])],
  {env: {PATH: process.env.PATH, OPENAI_API_KEY: "synthetic-placeholder-not-a-credential"}, timeout: 60000})
    .then(result => ({code: 0, ...result}), error => ({code: error.code, stdout: error.stdout, stderr: error.stderr}));
  const layout = /Protected launcher requires the installed artifact, not a source checkout/;
  for (const [label, cli] of [
    ["source checkout", join(checkout, "dist", "protected-cli.js")],
    ["pre-0.2.0 @chio scope", await installedLauncher(join(directory, "previous-scope"), "@chio")],
    ["another package name", await installedLauncher(join(directory, "other-name"), "@chio-protocol", "other-plugin")],
  ]) {
    const result = await launch(cli);
    assert.equal(result.code, 1, label); assert.match(result.stderr, layout, label);
  }
  // The npm layout passes this check and stops later, at the missing configuration.
  const installed = await launch(await installedLauncher(join(directory, "installed")));
  assert.equal(installed.code, 1); assert.doesNotMatch(installed.stderr, layout); assert.match(installed.stderr, /missing-config\.json/);
  assert.equal(await absent(join(directory, "profile")), true); assert.equal(await absent(join(directory, "cwd")), true);
});

test("parent guest-file publication refuses links before touching their targets", async () => {
  assert.equal(typeof privateState.publishGuestFile, "function");
  const directory = await realpath(await mkdtemp(join(tmpdir(), "chio-guest-publication-")));
  try {
    const profile = join(directory, "profile"); await mkdir(profile, {mode: 0o700});
    const sentinel = join(directory, "outside-sentinel"); await writeFile(sentinel, original, {mode: 0o600});
    const target = join(profile, "gateway-transport.json");
    await privateState.publishGuestFile(target, "first");
    const first = await lstat(target);
    assert.equal(await readFile(target, "utf8"), "first"); assert.equal(first.mode & 0o777, 0o600); assert.equal(first.nlink, 1);
    await privateState.publishGuestFile(target, "second");
    assert.equal(await readFile(target, "utf8"), "second"); assert.notEqual((await lstat(target)).ino, first.ino);
    for (const [name, plant] of [
      ["escaping symlink", () => symlink(sentinel, target)],
      ["contained symlink", async () => {await writeFile(join(profile, "inside"), original, {mode: 0o600}); await symlink("inside", target);}],
      ["hardlink", () => link(sentinel, target)],
      ["directory", () => mkdir(target, {mode: 0o700})],
    ]) {
      await rm(target, {recursive: true, force: true}); await plant();
      const before = await lstat(target), linked = before.isSymbolicLink() ? await readlink(target) : undefined;
      await assert.rejects(privateState.publishGuestFile(target, "SYNTHETIC_NEW_PROXY_TOKEN"), /link|special/, name);
      const after = await lstat(target);
      assert.deepEqual([after.ino, after.dev, after.mode, after.nlink], [before.ino, before.dev, before.mode, before.nlink], name);
      if (linked) assert.equal(await readlink(target), linked, name);
      assert.equal(await readFile(sentinel, "utf8"), original, name);
      if (name === "contained symlink") assert.equal(await readFile(join(profile, "inside"), "utf8"), original);
      assert.deepEqual(await leftovers(profile), [], name);
    }
    const linkedParent = join(directory, "linked-profile"); await symlink(profile, linkedParent);
    await assert.rejects(privateState.publishGuestFile(join(linkedParent, "other.json"), "x"), /private directory|link/);
    assert.equal(await absent(join(profile, "other.json")), true);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test("protected launch refuses guest-controlled profile links before any parent mutation", async t => {
  const f = await nativeFixture();
  try {
    // Only one launcher may own the native gateway journal.
    await f.native.close();
    const cli = await installedLauncher(join(f.directory, "installed"));
    const prepared = await readPreparedConfig(f.configPath); const registry = registryForConfig(prepared);
    const limits = {maxRequests: 1, maxOutputTokens: 16, maxTotalOutputTokens: 16, providerTimeoutMs: 1000, maxResponseBytes: 4096, wallMs: 30000, killGraceMs: 100};
    const limitsPath = join(f.directory, "limits.json"); await writeFile(limitsPath, JSON.stringify(limits), {mode: 0o600});
    // Linux pins are validated only when the guest is prepared, after publication.
    const runtimePath = join(f.directory, "runtime.json"); await writeFile(runtimePath, "{}", {mode: 0o600});
    const budgetRoot = join(f.config.journalDir, "pi-run-limits"); await mkdir(budgetRoot, {mode: 0o700});
    /** A previously launched profile: private marker and its original parent
     * accounting, with the single request already spent so no outcome of this
     * test can submit a provider request. */
    const resumed = async profile => {
      await mkdir(profile, {mode: 0o700});
      await writeFile(join(profile, ".chio-pi-profile.json"), JSON.stringify({schema: "chio.pi.profile.v2", sessionId: f.config.execution.sessionId, registryDigest: registry.digest, piVersion: "1.0.2", governanceProfile: "execution-only"}), {mode: 0o600});
      const budget = await openRunBudget(join(budgetRoot, privateState.sha256(profile)), {binding: {authorityDigest: preparedAuthorityDigest(prepared, registry), registryDigest: registry.digest, profileIdentity: profile, governanceProfile: "execution-only"}, limits, provider: "openai", model: "gpt-4.1-mini", create: true});
      await budget.reserveRequest({}); await budget.close();
      return profile;
    };
    const launch = (profile, cwd, options = {}) => promisify(execFile)(process.execPath, [cli, "--config", f.configPath, "--profile", profile, "--cwd", cwd, "--provider", "openai", "--model", "gpt-4.1-mini", "--prompt", "synthetic task", "--limits", options.limits ?? limitsPath,
      ...(process.platform === "linux" ? ["--linux-runtime", options.runtime ?? runtimePath] : [])], {env: {PATH: process.env.PATH, OPENAI_API_KEY: "synthetic-placeholder-not-a-credential", ...options.env}, timeout: 60000})
      .then(result => ({code: 0, ...result}), error => ({code: error.code, stdout: error.stdout, stderr: error.stderr}));
    const cases = {
      // The reviewed reproduction: a confined guest leaves this link behind.
      "escaping transport symlink": async base => {
        const profile = await resumed(join(base, "profile")), sentinel = join(base, "outside-sentinel");
        await writeFile(sentinel, original, {mode: 0o600}); await symlink(sentinel, join(profile, "gateway-transport.json"));
        return {profile, protect: [sentinel], refusal: /Guest profile refused before parent mutation: .*escaping link/, expect: async () => assert.equal(await readlink(join(profile, "gateway-transport.json")), sentinel)};
      },
      "contained transport symlink": async base => {
        const profile = await resumed(join(base, "profile"));
        await symlink(".chio-pi-profile.json", join(profile, "gateway-transport.json"));
        return {profile, protect: [join(profile, ".chio-pi-profile.json")], refusal: /Guest publication path is a link or special file/};
      },
      "transport hardlink": async base => {
        const profile = await resumed(join(base, "profile")), sentinel = join(base, "outside-sentinel");
        await writeFile(sentinel, original, {mode: 0o600}); await link(sentinel, join(profile, "gateway-transport.json"));
        return {profile, protect: [sentinel], refusal: /Guest publication path is a link or special file/, expect: async () => assert.equal((await lstat(sentinel)).nlink, 2)};
      },
      "escaping temporary symlink": async base => {
        const profile = await resumed(join(base, "profile")), outside = join(base, "outside-directory");
        await mkdir(outside, {mode: 0o700}); await symlink(outside, join(profile, "tmp"));
        return {profile, protect: [], refusal: /Guest profile refused before parent mutation: .*escaping link/, expect: async () => {assert.deepEqual(await readdir(outside), []); assert.equal(await absent(join(profile, "gateway-transport.json")), true);}};
      },
      // A macOS guest can remove its writable profile root and leave a link.
      "replaced profile root": async base => {
        const actual = await resumed(join(base, "elsewhere")), requested = join(base, "profile"); await symlink(actual, requested);
        const listing = (await readdir(actual)).sort();
        return {profile: requested, protect: [join(actual, ".chio-pi-profile.json")], refusal: /Profile path must name the private directory itself, not a link/, expect: async () => assert.deepEqual((await readdir(actual)).sort(), listing)};
      },
      "workspace inside guest profile": async base => {
        const profile = await resumed(join(base, "profile"));
        return {profile, cwd: join(profile, "work"), protect: [], refusal: /Disposable workspace cannot overlap guest profile state/, expect: async () => {assert.equal(await absent(join(profile, "work")), true); assert.equal(await absent(join(profile, "gateway-transport.json")), true);}};
      },
    };
    for (const [name, setup] of Object.entries(cases)) await t.test(name, async () => {
      const base = join(f.directory, name.replaceAll(" ", "-")); await mkdir(base, {mode: 0o700});
      const selected = await setup(base);
      const before = await Promise.all(selected.protect.map(path => readFile(path, "utf8")));
      const result = await launch(selected.profile, selected.cwd ?? join(base, "cwd"));
      assert.deepEqual(await Promise.all(selected.protect.map(path => readFile(path, "utf8"))), before, "outside or marker bytes unchanged");
      await selected.expect?.();
      assert.doesNotMatch(result.stdout, /chio_protected_runtime/, "no guest launch");
      assert.equal(result.code, 1, result.stderr);
      assert.match(result.stderr, /^Chio Pi protected launch refused: /);
      assert.match(result.stderr, selected.refusal);
    });
    // Task 8 area C (C-M5): operator pins must not be guest-writable files.
    const pinCases = {"limits inside the guest profile": "profile", "limits inside the disposable workspace": "cwd", ...(process.platform === "linux" ? {"runtime pins inside the guest profile": "runtime"} : {})};
    for (const [name, where] of Object.entries(pinCases)) await t.test(`C-M5: ${name}`, async () => {
      const base = join(f.directory, `pin-${where}`); await mkdir(base, {mode: 0o700});
      const profile = await resumed(join(base, "profile")), cwd = join(base, "cwd"); await mkdir(cwd, {mode: 0o700});
      const pin = join(where === "cwd" ? cwd : profile, where === "runtime" ? "runtime.json" : "limits.json");
      await writeFile(pin, where === "runtime" ? "{}" : JSON.stringify(limits), {mode: 0o600});
      const marker = await readFile(join(profile, ".chio-pi-profile.json"), "utf8");
      const result = await launch(profile, cwd, where === "runtime" ? {runtime: pin} : {limits: pin});
      assert.doesNotMatch(result.stdout, /chio_protected_runtime/, "no guest launch");
      assert.equal(result.code, 1, result.stderr);
      assert.match(result.stderr, /Run limits and Linux runtime pins must remain outside guest paths/);
      assert.equal(await readFile(join(profile, ".chio-pi-profile.json"), "utf8"), marker);
      assert.equal(await absent(join(profile, "gateway-transport.json")), true);
    });
    // Task 8 area C (C-M4): the ownership marker follows the run record and is
    // published atomically; a guest-controlled marker is read bounded.
    const reached = result => process.platform === "darwin" ? /chio_protected_runtime/.test(result.stdout) : /Actual architecture-pinned Linux runtime manifest required/.test(result.stderr);
    const budgetPath = profile => join(budgetRoot, privateState.sha256(profile), "run.json");
    await t.test("C-M4: an early refusal on an empty profile leaves it launchable", async () => {
      const base = join(f.directory, "early-refusal"); await mkdir(base, {mode: 0o700});
      const profile = join(base, "profile"); await mkdir(profile, {mode: 0o700});
      const refused = await launch(profile, join(profile, "work"));
      assert.match(refused.stderr, /Disposable workspace cannot overlap guest profile state/);
      assert.deepEqual(await readdir(profile), [], "no marker without its run record");
      const result = await launch(profile, join(base, "cwd"));
      assert.equal(reached(result), true, result.stderr);
      const marker = await lstat(join(profile, ".chio-pi-profile.json"));
      assert.equal(marker.isFile(), true); assert.equal(marker.nlink, 1); assert.equal(marker.mode & 0o777, 0o600);
      assert.equal(JSON.parse(await readFile(join(profile, ".chio-pi-profile.json"), "utf8")).schema, "chio.pi.profile.v2");
      assert.deepEqual(await leftovers(profile), []);
    });
    await t.test("C-M4: a guest that empties its profile resumes the original accounting", async () => {
      const base = join(f.directory, "emptied"); await mkdir(base, {mode: 0o700});
      const profile = join(base, "profile"); await mkdir(profile, {mode: 0o700});
      assert.equal(reached(await launch(profile, join(base, "cwd"))), true);
      const record = await readFile(budgetPath(profile), "utf8");
      for (const name of await readdir(profile)) await rm(join(profile, name), {recursive: true, force: true});
      const result = await launch(profile, join(base, "cwd"));
      assert.doesNotMatch(result.stderr, /EEXIST/);
      assert.equal(reached(result), true, result.stderr);
      assert.equal(await readFile(budgetPath(profile), "utf8"), record, "accounting retained, never recreated");
      if (process.platform === "darwin") assert.equal(JSON.parse(result.stdout.split("\n")[0]).deadline, JSON.parse(record).deadline);
      assert.equal((await lstat(join(profile, ".chio-pi-profile.json"))).nlink, 1);
    });
    for (const [name, plant] of [
      ["oversized marker", async marker => {const value = JSON.parse(await readFile(marker, "utf8")); await writeFile(marker, JSON.stringify(value) + " ".repeat(2 * 1024 * 1024), {mode: 0o600});}],
      ["hardlinked marker", async (marker, base) => link(marker, join(base, "outside-marker-link"))],
    ]) await t.test(`C-M4: ${name} is refused by a bounded private read`, async () => {
      const base = join(f.directory, name.replaceAll(" ", "-")); await mkdir(base, {mode: 0o700});
      const profile = await resumed(join(base, "profile")); await plant(join(profile, ".chio-pi-profile.json"), base);
      const result = await launch(profile, join(base, "cwd"));
      assert.equal(result.code, 1, result.stderr);
      assert.match(result.stderr, /Existing profile lacks a private Chio ownership marker/);
      assert.doesNotMatch(result.stdout, /chio_protected_runtime/);
    });
    // Task 8 area C (C-M7): the parent's control directory does not outlive it.
    await t.test("C-M7: the parent control directory is removed after launch", async () => {
      const base = join(f.directory, "control"); await mkdir(base, {mode: 0o700});
      const temporary = join(base, "t"); await mkdir(temporary, {mode: 0o700});
      const profile = await resumed(join(base, "profile"));
      const result = await launch(profile, join(base, "cwd"), {env: {TMPDIR: temporary}});
      assert.equal(reached(result), true, result.stderr);
      assert.deepEqual(await readdir(temporary), []);
      // The removed policy file's exact text stays in the runtime record.
      if (process.platform === "darwin") {const line = JSON.parse(result.stdout.split("\n")[0]); assert.equal(privateState.sha256(line.policy), line.policySha256);}
    });
    await t.test("clean resumed profile still publishes atomically", async () => {
      const base = join(f.directory, "clean"); await mkdir(base, {mode: 0o700});
      const profile = await resumed(join(base, "profile")), published = join(profile, "gateway-transport.json");
      await writeFile(published, "previous launch", {mode: 0o600}); const previous = await lstat(published);
      const result = await launch(profile, join(base, "cwd"));
      // Past publication, macOS starts the confined guest, which cannot load the
      // linked test dependencies; Linux refuses the unpinned runtime manifest.
      if (process.platform === "darwin") assert.match(result.stdout, /chio_protected_runtime/);
      else assert.match(result.stderr, /Actual architecture-pinned Linux runtime manifest required/);
      const current = await lstat(published), temporary = await lstat(join(profile, "tmp"));
      assert.equal(current.isFile(), true); assert.equal(current.nlink, 1); assert.equal(current.mode & 0o777, 0o600); assert.notEqual(current.ino, previous.ino);
      assert.equal(JSON.parse(await readFile(published, "utf8")).schema, "chio.pi.transport.v1");
      assert.equal(temporary.isDirectory(), true); assert.equal(temporary.mode & 0o777, 0o700);
      assert.deepEqual(await leftovers(profile), []);
    });
  } finally {await f.close();}
});
