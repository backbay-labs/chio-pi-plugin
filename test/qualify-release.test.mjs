import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import * as qualify from "../scripts/qualify-release.mjs";
const {archiveProblems, binProblems, containsHostPath, declarationSpecifiers, installedPackageProblems, listArchive} = qualify;

const script = new URL("../scripts/qualify-release.mjs", import.meta.url).pathname;
async function scratch(t) {const dir = await mkdtemp(join(tmpdir(), "chio-qualify-release-")); t.after(() => rm(dir, {recursive: true, force: true})); return dir;}
function tar(cwd, out, ...members) {
  // COPYFILE_DISABLE keeps macOS bsdtar from adding AppleDouble members.
  const result = spawnSync("tar", ["-czf", out, ...members], {cwd, encoding: "utf8", env: {...process.env, COPYFILE_DISABLE: "1"}});
  assert.equal(result.status, 0, result.stderr);
}

test("archive listing reports links and members outside package/ and checks required members", async t => {
  const dir = await scratch(t);
  await mkdir(join(dir, "package", "dist"), {recursive: true});
  await writeFile(join(dir, "package", "package.json"), "{}");
  await writeFile(join(dir, "package", "dist", "index.js"), "export {};\n");
  await symlink("/etc/hosts", join(dir, "package", "dist", "link.js"));
  await writeFile(join(dir, "outside.txt"), "x");
  tar(dir, "a.tgz", "package", "outside.txt");
  const listed = listArchive(await readFile(join(dir, "a.tgz")), ["dist/index.js"]);
  assert.deepEqual(listed.entries.map(entry => entry.path), ["dist/index.js", "package.json"]);
  assert.equal(listed.files.get("dist/index.js"), "export {};\n");
  assert.ok(listed.problems.some(problem => problem.includes("non-regular archive entry package/dist/link.js")));
  assert.ok(listed.problems.some(problem => problem.includes("entry outside package/: outside.txt")));
  const problems = archiveProblems([...listed.entries, {path: "docs/superpowers/evidence/x.md"}], new Map([["dist/coding-resource/unicode-data.js", "no license"]]));
  assert.ok(problems.includes("missing archive member dist/durable.js"));
  assert.ok(problems.includes("unexpected archive member docs/superpowers/evidence/x.md"));
  assert.ok(problems.includes("generated Unicode data lacks its license text"));
});

test("installed package checks refuse escaping entrypoints, local specs and changed files", async t => {
  const dir = await scratch(t); const pkg = join(dir, "pkg");
  await mkdir(join(pkg, "dist"), {recursive: true});
  await writeFile(join(dir, "outside.js"), "#!/usr/bin/env node\n");
  await writeFile(join(pkg, "dist", "index.js"), "export {};\n");
  await symlink(join(dir, "outside.js"), join(pkg, "dist", "cli.js"));
  const manifest = {name: "x", version: "1.0.0", main: "dist/index.js", exports: {".": "./dist/index.js"}, bin: {x: "./dist/cli.js"},
    dependencies: {a: "file:../a.tgz"}, bundleDependencies: ["b"], peerDependencies: {}, engines: {node: ">=22.19.0"}};
  await writeFile(join(pkg, "package.json"), JSON.stringify(manifest));
  const problems = installedPackageProblems(pkg, {name: "x", version: "1.0.0", bundled: ["b"], peerDependencies: {}, exports: manifest.exports, bin: manifest.bin,
    engines: manifest.engines, archive: [{path: "dist/index.js", sha256: "0".repeat(64)}]});
  assert.ok(problems.includes("entrypoint escapes package: ./dist/cli.js"));
  assert.ok(problems.includes("dependency a is not an exact registry version: file:../a.tgz"));
  assert.ok(problems.includes("bundled dependency missing: b"));
  assert.ok(problems.includes("installed file differs from archive: dist/index.js"));
});

test("executable symlinks must stay inside the consumer installation", async t => {
  const dir = await scratch(t); const bin = join(dir, "consumer", "node_modules", ".bin");
  await mkdir(join(dir, "consumer", "node_modules", "inside"), {recursive: true}); await mkdir(bin);
  await writeFile(join(dir, "consumer", "node_modules", "inside", "cli.js"), "#!/usr/bin/env node\n"); await chmod(join(dir, "consumer", "node_modules", "inside", "cli.js"), 0o755);
  await writeFile(join(dir, "escape.js"), "#!/usr/bin/env node\n"); await chmod(join(dir, "escape.js"), 0o755);
  await symlink("../inside/cli.js", join(bin, "good")); await symlink(join(dir, "escape.js"), join(bin, "bad"));
  await writeFile(join(bin, "plain"), "x");
  const result = binProblems(join(dir, "consumer"));
  assert.deepEqual(result.names, ["bad", "good", "plain"]);
  assert.deepEqual(result.problems, [".bin/bad escapes node_modules", ".bin/plain is not a symlink"]);
});

test("declaration closure follows relative imports to bare specifiers", async t => {
  const dir = await scratch(t);
  await writeFile(join(dir, "index.d.ts"), `export {a} from "./a.js";\nimport type {X} from "@earendil-works/pi-coding-agent";\n`);
  await writeFile(join(dir, "a.d.ts"), `export declare const a: import("@earendil-works/pi-durable").Session;\n`);
  assert.deepEqual(declarationSpecifiers(join(dir, "index.d.ts")), ["@earendil-works/pi-coding-agent", "@earendil-works/pi-durable"]);
});

test("host path detection ignores relative package names", () => {
  assert.equal(containsHostPath(`"node_modules/tmp": {}`, "/tmp"), false);
  assert.equal(containsHostPath(`"resolved": "/tmp/work/x.tgz"`, "/tmp/work"), true);
  assert.equal(containsHostPath(`"/Users/someone-else"`, "/Users/someone"), false);
});

test("command refuses missing arguments and existing directories before any install", async t => {
  const dir = await scratch(t);
  const help = spawnSync(process.execPath, [script, "--help"], {encoding: "utf8"});
  assert.equal(help.status, 0); assert.match(help.stdout, /two fresh consumers/);
  assert.equal(spawnSync(process.execPath, [script, "--release", dir], {encoding: "utf8"}).status, 2);
  const existing = spawnSync(process.execPath, [script, "--release", dir, "--work", dir, "--evidence", join(dir, "evidence")], {encoding: "utf8"});
  assert.equal(existing.status, 2); assert.match(existing.stderr, /refusing existing directory/);
});

test("consumer lock must record the artifact's integrity, not merely omit it", () => {
  assert.equal(typeof qualify.consumerLockProblems, "function");
  const manifest = {dependencies: {"@chio/pi-plugin": "file:../a.tgz"}};
  const entry = {resolved: "file:../a.tgz", version: "0.2.0", integrity: "sha512-good"};
  assert.deepEqual(qualify.consumerLockProblems(manifest, entry, "a.tgz", "sha512-good", "0.2.0"), []);
  assert.deepEqual(qualify.consumerLockProblems(manifest, {...entry, integrity: undefined}, "a.tgz", "sha512-good", "0.2.0"), ["lock integrity absent"]);
  assert.deepEqual(qualify.consumerLockProblems(manifest, {...entry, integrity: "sha512-other"}, "a.tgz", "sha512-good", "0.2.0"), ["lock integrity differs from artifact"]);
  assert.deepEqual(qualify.consumerLockProblems({dependencies: {}}, {}, "a.tgz", "sha512-good", "0.2.0"),
    ["manifest dependency undefined", "lock resolved undefined", "lock integrity absent", "lock version undefined"]);
});

test("redacted UUID paths normalize only the selected archive and other absolute file URLs fail", () => {
  const graph = {dependencies: {"@chio/pi-plugin": {resolved: "file:/private/tmp/session-***/chio-pi-plugin-0.2.0.tgz"}}};
  const normalized = qualify.normalizeConsumerGraph(JSON.stringify(graph), "chio-pi-plugin-0.2.0.tgz");
  assert.deepEqual(normalized.problems, []); assert.equal(normalized.absoluteArtifactResolutions, 1);
  assert.equal(JSON.parse(normalized.text).dependencies["@chio/pi-plugin"].resolved, "file:../chio-pi-plugin-0.2.0.tgz");
  for (const resolved of ["file:/redacted/***/other.tgz", "file:///unknown/path.tgz", "file:C:\\redacted\\other.tgz"]) {
    graph.dependencies.other = {resolved};
    assert.ok(qualify.normalizeConsumerGraph(JSON.stringify(graph), "chio-pi-plugin-0.2.0.tgz").problems.includes("graph retains an absolute file resolution"));
  }
  graph.dependencies["@chio/pi-plugin"].resolved = "file:/unknown/other.tgz";
  assert.ok(qualify.normalizeConsumerGraph(JSON.stringify(graph), "chio-pi-plugin-0.2.0.tgz").problems.includes("selected archive lacks exactly one absolute graph resolution"));
});
