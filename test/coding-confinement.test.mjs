import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {watch} from "node:fs";
import {mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {canonicalJson} from "../dist/tool-registry.js";
import {removeJob} from "../dist/coding-resource/paths.js";
import * as recipeSandbox from "../dist/coding-resource/recipe-sandbox.js";
import {command, data, fixture, fixtureRuntimePins, hash, initialized, meta, stdio} from "./helpers/coding-fixture.mjs";

const local = process.platform === "darwin" || process.platform === "linux" && process.env.CHIO_CODING_LINUX_PROBE === "1";
// Minimal SBPL reader: bare symbols, strings and nested lists.
function sbplForms(policy) {
  const tokens = policy.match(/\(|\)|"(?:[^"\\]|\\.)*"|[^\s()"]+/g) ?? []; let index = 0;
  const read = () => {
    const token = tokens[index++]; if (token !== "(") {assert.notEqual(token, ")", "unbalanced SBPL"); return token;}
    const list = []; while (tokens[index] !== ")") {assert.ok(index < tokens.length, "unterminated SBPL list"); list.push(read());} index++; return list;
  };
  const forms = []; while (index < tokens.length) forms.push(read()); return forms;
}
// Every allow rule needs at least one filter list after its operation symbols,
// including multi-operation rules, and boolean filter combinators cannot be empty.
function assertFilteredPolicy(policy) {
  const visit = form => {
    if (!Array.isArray(form)) return;
    const [head, ...rest] = form;
    if (head === "allow") assert.ok(rest.some(Array.isArray), `allow rule without a filter: ${JSON.stringify(form)}`);
    if (["require-any", "require-all", "require-not"].includes(head)) assert.ok(rest.length > 0, `empty ${head}`);
    rest.forEach(visit);
  };
  sbplForms(policy).forEach(visit);
}
test("Seatbelt policies never contain an unfiltered allow or an empty filter combinator", async () => {
  // Official nodejs.org macOS binaries link only system libraries, so the loader
  // alias list is empty. An SBPL allow with no filter would grant every path.
  assert.equal(typeof recipeSandbox.seatbeltPolicy, "function", "policy generation must be testable without a specific Node build");
  for (const bad of ['(allow file-read-metadata )', '(allow file-read* file-write* )', '(allow file-read-metadata (literal "/") (require-all (vnode-type DIRECTORY) (require-any )))'])
    assert.throws(() => assertFilteredPolicy(bad), /without a filter|empty require-any/, `the checker must reject ${bad}`);
  const node = "/opt/selected/node/bin/node"; const source = "/private/state/generations/g"; const job = "/private/jobs/j";
  const policy = recipeSandbox.seatbeltPolicy(node, [node], [], source, job);
  assertFilteredPolicy(policy); assert.doesNotMatch(policy, /\(allow file-read-metadata \)/);
  const alias = "/opt/homebrew/opt/libuv/lib/libuv.1.dylib";
  const aliased = recipeSandbox.seatbeltPolicy(node, [node, "/opt/homebrew/Cellar/libuv/1.51.0/lib/libuv.1.dylib"], [alias, "/opt/homebrew/opt", "/opt/homebrew/opt/libuv"], source, job);
  assert.match(aliased, /\(allow file-read-metadata \(literal "\/opt\/homebrew\/opt\/libuv\/lib\/libuv\.1\.dylib"\)/);
  assertFilteredPolicy(aliased);
  for (const selected of [policy, aliased]) assert.ok(sbplForms(selected).some(form => form[0] === "deny" && form.includes("file-write-flags") && form.includes("file-write-acl")), "job output flags and ACLs stay owner-removable");
  if (process.platform === "darwin") {
    // The actual policy for this host's running Node and its resolved closure.
    const executable = await realpath(process.execPath); const runtimeFiles = await fixtureRuntimePins(executable);
    const recipe = {name: "unit", executable, executableSha256: hash(await readFile(executable)), argv: [], timeoutMs: 1, outputBytes: 1, graceMs: 1, runtimeFiles};
    const sandbox = await recipeSandbox.prepareRecipeSandbox({...recipe, recipeSha256: hash(canonicalJson(recipe))});
    assertFilteredPolicy(sandbox.policy("/private/var/state/generations/g", "/private/var/jobs/job-x"));
  }
});
// Fixture prerequisites, not product refusals: official macOS Node builds link
// only system libraries, so their resolved non-system closure is empty.
const macClosure = process.platform === "darwin" ? await fixtureRuntimePins(await realpath(process.execPath)) : [];
const closureNeeds = {missing: 1, incomplete: 2, "wrong hash": 1, extra: 0};
if (process.platform === "darwin") for (const kind of ["missing", "incomplete", "wrong hash", "extra"]) test(`macOS runtime closure ${kind} pins refuse before recipe jobs and retain exact error replay`, {skip: macClosure.length < closureNeeds[kind] && `needs a Node linked against at least ${closureNeeds[kind]} non-system dylib(s); ${process.execPath} (${process.version}) resolves ${macClosure.length}`}, async t => {
  const f = await initialized(); t.after(() => f.close());
  await f.updateConfig(config => {
    const recipe = config.recipes[0];
    if (kind === "missing") recipe.runtimeFiles = [];
    if (kind === "incomplete") recipe.runtimeFiles = recipe.runtimeFiles.slice(1);
    if (kind === "wrong hash") recipe.runtimeFiles[0].sha256 = "0".repeat(64);
    if (kind === "extra") recipe.runtimeFiles.push({path: recipe.executable, sha256: recipe.executableSha256});
    const {recipeSha256, ...body} = recipe; recipe.recipeSha256 = hash(canonicalJson(body));
  });
  const observedJobs = []; const observer = watch(f.root("jobs"), (_, path) => observedJobs.push(String(path))); t.after(() => observer.close());
  const io = stdio(f); t.after(() => io.close()); const args = {sourceDigest: f.sourceDigest, recipe: "unit"};
  const first = await io.call("test_recipe", args); assert.equal(first.isError, true); assert.equal(data(first).code, "recipe_pin");
  assert.deepEqual(await io.call("test_recipe", args, meta("1", {chioAttemptId: "replay-pinned-refusal"})), first);
  await io.close(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(observedJobs, [], "observe zero job-directory creation events"); assert.deepEqual(await readdir(f.root("jobs")), []); assert.deepEqual(await readdir(f.root("artifacts")), []);
  assert.equal((await readdir(join(f.root("state"), "generations"))).length, 1);
  const state = JSON.parse((await command(["inspect", "--config", f.configPath])).stdout); assert.equal(state.operations.length, 1); assert.equal(state.operations[0].state, "completed"); assert.equal(state.fenced, false);
});
test("real confined recipe passes single-process node:test and retains exact test lineage", {skip: !local}, async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f, {env: {NODE_OPTIONS: "--require=/DO-NOT-LOAD", CHIO_AUTH_TOKEN: "fixture-secret-never-inherit", OPENAI_API_KEY: "fixture-provider-secret"}}); t.after(() => io.close());
  const args = {sourceDigest: f.sourceDigest, recipe: "unit"}; const first = await io.call("test_recipe", args);
  const result = data(first); assert.equal(result.success, true, result.stderr); assert.equal(result.sourceDigest, f.sourceDigest); assert.equal(result.recipeSha256, f.config.recipes[0].recipeSha256);
  assert.deepEqual(await io.call("test_recipe", args, meta("1", {chioAttemptId: "other-attempt"})), first);
  assert.deepEqual(await readdir(f.root("jobs")), []);
});
test("real confined NUL stdout fits nested output framing and largest-ID exact replay", {skip: !local}, async t => {
  const f = await initialized({files: {"source.txt": "alpha", "fixture-test.mjs": "process.stdout.write(Buffer.alloc(20480))"}, outputBytes: 20480, bounds: {maxOutputBytes: 196608}}); t.after(() => f.close()); let io = stdio(f); t.after(() => io.close());
  const args = {sourceDigest: f.sourceDigest, recipe: "unit"}; const original = await io.call("test_recipe", args); assert.equal(original.isError, undefined); assert.equal(data(original).success, true); assert.equal(data(original).stdout, "\0".repeat(20480)); await io.close();
  const observedJobs = []; const observer = watch(f.root("jobs"), (_, path) => observedJobs.push(String(path))); t.after(() => observer.close());
  io = stdio(f, {fault: "throw:beforeIntent"}); const transportId = "\0".repeat(512);
  assert.deepEqual(await io.call("test_recipe", args, meta("1", {chioAttemptId: "control-output-replay"}), transportId), original); assert.equal(io.messages[0].id, transportId); assert.ok(Buffer.byteLength(JSON.stringify(io.messages[0]) + "\n") <= f.config.bounds.maxOutputBytes); await io.close(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(observedJobs, []); assert.deepEqual(await readdir(f.root("jobs")), []); const state = JSON.parse((await command(["inspect", "--config", f.configPath])).stdout); assert.equal(state.fenced, false); assert.equal(state.operations.length, 1); assert.equal(state.operations[0].state, "completed");
});
test("real sandbox denies outside state artifacts credentials writes links fork and network", {skip: !local}, async t => {
  const f = await fixture(); t.after(() => f.close());
  const secret = join(f.base, "fixture-credential.json"); await writeFile(secret, "fixture-credential", {mode: 0o600});
  const artifactFile = join(f.root("artifacts"), "fixture-retained-artifact.json");
  const probes = `import assert from 'node:assert/strict'; import fs from 'node:fs'; import {spawnSync} from 'node:child_process'; import net from 'node:net';
    for (const path of ${JSON.stringify([secret, artifactFile, join(f.root("state"), "ledger.sqlite"), join(f.root("repository"), "source.txt"), "/etc/passwd"])}) assert.throws(()=>fs.readFileSync(path));
    assert.throws(()=>fs.readdirSync(${JSON.stringify(f.root("artifacts"))}));
    for (const path of ${JSON.stringify([secret, artifactFile, join(f.root("state"), "ledger.sqlite"), join(f.root("repository"), "source.txt")])}) assert.throws(()=>fs.statSync(path));
    assert.throws(()=>fs.writeFileSync('source.txt','mutated')); assert.throws(()=>fs.writeFileSync(${JSON.stringify(join(f.root("repository"), "source.txt"))},'mutated'));
    assert.throws(()=>fs.symlinkSync(${JSON.stringify(secret)},process.env.TMPDIR+'/alias')); assert.throws(()=>fs.linkSync('source.txt',process.env.TMPDIR+'/hard'));
    assert.equal(process.env.NODE_OPTIONS,undefined); assert.equal(process.env.CHIO_AUTH_TOKEN,undefined); assert.equal(process.env.OPENAI_API_KEY,undefined);
    const child=spawnSync(process.execPath,['-e','process.exit(0)']); assert.ok(child.error || child.status!==0);
    const socket=net.connect({host:'1.1.1.1',port:443}); await new Promise((resolve,reject)=>{socket.once('error',error=>{try{assert.ok(['EPERM','EACCES'].includes(error.code),'expected explicit permission denial, got '+error.code);console.log('network-denied-'+error.code);resolve();}catch(failure){reject(failure);}}); socket.once('connect',()=>reject(Error('network escaped')));}); console.log('all-confinement-probes-passed');`;
  await writeFile(join(f.root("repository"), "fixture-test.mjs"), probes);
  const init = await command(["init", "--config", f.configPath]); assert.equal(init.code, 0, init.stderr); f.sourceDigest = JSON.parse(init.stdout).sourceDigest;
  await writeFile(artifactFile, "fixture-retained-artifact", {mode: 0o600});
  const io = stdio(f, {env: {NODE_OPTIONS: "--require=/DO-NOT-LOAD", CHIO_AUTH_TOKEN: "fixture-secret", OPENAI_API_KEY: "fixture-secret"}}); t.after(() => io.close());
  const result = data(await io.call("test_recipe", {sourceDigest: f.sourceDigest, recipe: "unit"})); assert.equal(result.success, true, `${result.stdout}\n${result.stderr}`); assert.match(result.stdout, /network-denied-(EPERM|EACCES)/); assert.match(result.stdout, /all-confinement-probes-passed/);
  assert.equal(await readFile(join(f.root("repository"), "source.txt"), "utf8"), "alpha\nbeta\n");
});
for (const [name, code] of [["timeout", "setInterval(()=>{},1000)"], ["output", "while(true)process.stdout.write('x'.repeat(8192))"]]) test(`real recipe ${name} bounds stop observed process group and clean job`, {skip: !local}, async t => {
  const f = await initialized({files: {"source.txt": "alpha", "fixture-test.mjs": code}, timeoutMs: 300, outputBytes: 2048}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const before = Date.now(); const result = data(await io.call("test_recipe", {sourceDigest: f.sourceDigest, recipe: "unit"}));
  assert.equal(result.success, false); assert.equal(result.limit, name); assert.ok(Date.now() - before < 5000); assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 2048); assert.deepEqual(await readdir(f.root("jobs")), []);
});
test("failed tests refuse publication; successful exact lineage publishes one immutable content-addressed bundle", {skip: !local}, async t => {
  const f = await initialized({files: {"source.txt": "alpha", "fixture-test.mjs": "process.exit(1)"}}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const failed = data(await io.call("test_recipe", {sourceDigest: f.sourceDigest, recipe: "unit"})); assert.equal(failed.success, false);
  const bad = await io.call("publish_artifact", {sourceDigest: f.sourceDigest, testOperationId: "1".repeat(64), testResultSha256: failed.resultSha256, recipeSha256: failed.recipeSha256, destination: "review"}, meta("2")); assert.equal(bad.isError, true); assert.deepEqual(await readdir(f.root("artifacts")), []);
});
test("successful publication binds result recipe source and diff and exact replay has one actual publication", {skip: !local}, async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const tested = data(await io.call("test_recipe", {sourceDigest: f.sourceDigest, recipe: "unit"})); assert.equal(tested.success, true, tested.stderr);
  const args = {sourceDigest: f.sourceDigest, testOperationId: "1".repeat(64), testResultSha256: tested.resultSha256, recipeSha256: tested.recipeSha256, destination: "review"};
  const first = await io.call("publish_artifact", args, meta("2")); assert.equal(first.isError, undefined); const artifact = data(first);
  for (const key of ["artifactSha256", "sourceDigest", "diffSha256", "testResultSha256", "recipeSha256"]) assert.match(artifact[key], /^[0-9a-f]{64}$/);
  assert.deepEqual(await io.call("publish_artifact", args, meta("2", {chioAttemptId: "redelivery"})), first);
  assert.equal((await readdir(f.root("artifacts"))).length, 1, "actual publication count");
  const bytes = await readFile(join(f.root("artifacts"), artifact.artifactSha256, "bundle.json")); assert.equal(hash(bytes), artifact.artifactSha256);
  assert.equal(data(await io.call("publish_artifact", {...args, testResultSha256: "f".repeat(64)}, meta("3"))).code, "lineage_mismatch");
});
test("bounded source bundles larger than MCP input framing publish through immutable artifact storage", {skip: !local}, async t => {
  const f = await initialized({files: {"source.txt": "a".repeat(800000), "fixture-test.mjs": "console.log('large-source-tested')"}, bounds: {maxFileBytes: 1048576, maxRepositoryBytes: 2097152}}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const tested = data(await io.call("test_recipe", {sourceDigest: f.sourceDigest, recipe: "unit"})); assert.equal(tested.success, true, tested.stderr);
  const artifact = data(await io.call("publish_artifact", {sourceDigest: f.sourceDigest, testOperationId: "1".repeat(64), testResultSha256: tested.resultSha256, recipeSha256: tested.recipeSha256, destination: "review"}, meta("2")));
  const bytes = await readFile(join(f.root("artifacts"), artifact.artifactSha256, "bundle.json")); assert.ok(bytes.length > f.config.bounds.maxInputBytes); assert.equal(hash(bytes), artifact.artifactSha256); assert.equal(JSON.parse(bytes).files.find(x => x.path === "source.txt").content.length, Buffer.from("a".repeat(800000)).toString("base64").length);
});
for (const [name, code] of [
  ["a read-only job directory and nested unreadable directories", "import fs from 'node:fs'; const t = process.env.TMPDIR; fs.mkdirSync(t + '/fixture'); fs.writeFileSync(t + '/fixture/kept', 'x'); fs.chmodSync(t + '/fixture', 0o500); fs.mkdirSync(t + '/sealed/inner', {recursive: true}); fs.writeFileSync(t + '/sealed/inner/kept', 'x'); fs.chmodSync(t + '/sealed/inner', 0); fs.chmodSync(t + '/sealed', 0); fs.chmodSync(t, 0o500); console.log('left-read-only');"],
  ["its own removed TMPDIR", "import fs from 'node:fs'; try {fs.rmSync(process.env.TMPDIR, {recursive: true, force: true});} catch {} console.log('removed-tmpdir');"],
]) test(`B-I1 a recipe leaving ${name} completes after proven group exit without fencing`, {skip: !local}, async t => {
  const f = await initialized({files: {"source.txt": "alpha", "fixture-test.mjs": code}}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const args = {sourceDigest: f.sourceDigest, recipe: "unit"}; const first = await io.call("test_recipe", args);
  const result = data(first); assert.equal(result.success, true, `${result.stdout}\n${result.stderr}`); assert.match(result.stdout, /left-read-only|removed-tmpdir/);
  assert.deepEqual(await readdir(f.root("jobs")), [], "the inert job tree is removed");
  assert.deepEqual(await io.call("test_recipe", args, meta("1", {chioAttemptId: "cleanup-replay"})), first);
  assert.equal(data(await io.call("test_recipe", args, meta("2"))).success, true, "fresh recipe work is not fenced"); await io.close();
  const state = JSON.parse((await command(["inspect", "--config", f.configPath])).stdout); assert.equal(state.fenced, false); assert.deepEqual(state.operations.map(x => x.state), ["completed", "completed"]);
});
test("B-I1 job cleanup tolerates an already removed job and quarantines a tree its owner still cannot remove", {skip: process.platform !== "darwin" && "needs an owner-settable immutable file flag (macOS chflags uchg)"}, async t => {
  const base = await mkdtemp(join(await realpath(tmpdir()), "chio-job-cleanup-")); const jobs = join(base, "jobs"); await mkdir(jobs, {mode: 0o700});
  t.after(async () => {spawnSync("/usr/bin/chflags", ["-R", "nouchg", base]); await rm(base, {recursive: true, force: true});});
  assert.equal(await removeJob(join(jobs, "job-absent")), "removed");
  const job = join(jobs, "job-locked"); await mkdir(job); await writeFile(join(job, "locked"), "x");
  assert.equal(spawnSync("/usr/bin/chflags", ["uchg", join(job, "locked")]).status, 0);
  assert.equal(await removeJob(job), "quarantined");
  const entries = await readdir(jobs); assert.equal(entries.length, 1); assert.match(entries[0], /^quarantine-job-locked-[0-9a-f-]{36}$/);
});
test("macOS recipe policy denies file flag changes that would make job output undeletable", {skip: process.platform !== "darwin"}, async t => {
  const base = await mkdtemp(join(await realpath(tmpdir()), "chio-flags-")); const job = join(base, "job"); const source = join(base, "source");
  t.after(async () => {spawnSync("/usr/bin/chflags", ["-R", "nouchg", base]); await rm(base, {recursive: true, force: true});});
  await mkdir(job, {mode: 0o700}); await mkdir(source, {mode: 0o700}); await writeFile(join(job, "output"), "x");
  const chflags = "/usr/bin/chflags"; const policy = recipeSandbox.seatbeltPolicy(chflags, [chflags], [], source, job);
  const run = async selected => {const path = join(base, `policy-${hash(selected).slice(0, 8)}.sb`); await writeFile(path, selected); return spawnSync("/usr/bin/sandbox-exec", ["-f", path, chflags, "uchg", join(job, "output")], {encoding: "utf8"});};
  const control = await run(policy.replace("(deny file-write-flags file-write-acl)\n", ""));
  assert.equal(control.status, 0, `without the rule the probe sets uchg: ${control.stderr}`); assert.equal(spawnSync(chflags, ["nouchg", join(job, "output")]).status, 0);
  const denied = await run(policy); assert.notEqual(denied.status, 0); assert.match(denied.stderr, /Operation not permitted/);
  await rm(join(job, "output")); assert.deepEqual(await readdir(job), [], "the owner can still remove job output");
});
test("B-I3 publication with a diff beyond the 1 MiB canonical limit returns diff_bound", {skip: !local}, async t => {
  const line = "const value = \"example\";\n"; const body = line.repeat(Math.floor(200000 / line.length));
  const files = {"fixture-test.mjs": "console.log('tested')", ...Object.fromEntries(["a", "b", "c"].map(name => [`${name}.js`, `${body}// end ${name}\n`]))};
  const f = await initialized({files}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const applied = data(await io.call("apply_patch", {sourceDigest: f.sourceDigest, changes: ["a", "b", "c"].map(name => ({path: `${name}.js`, expectedFileSha256: hash(files[`${name}.js`]), edits: [{oldText: `// end ${name}`, newText: `// END ${name}`}]}))}));
  const tested = data(await io.call("test_recipe", {sourceDigest: applied.sourceDigest, recipe: "unit"}, meta("2"))); assert.equal(tested.success, true, tested.stderr);
  const published = await io.call("publish_artifact", {sourceDigest: applied.sourceDigest, testOperationId: "2".repeat(64), testResultSha256: tested.resultSha256, recipeSha256: tested.recipeSha256, destination: "review"}, meta("3"));
  assert.equal(published.isError, true); assert.equal(data(published).code, "diff_bound"); assert.deepEqual(await readdir(f.root("artifacts")), []);
  await io.close(); assert.equal(JSON.parse((await command(["inspect", "--config", f.configPath])).stdout).fenced, false);
});
test("B-M4 a Linux recipe cannot create a nested user namespace", {skip: !(process.platform === "linux" && process.env.CHIO_CODING_LINUX_PROBE === "1")}, async t => {
  // util-linux unshare reports a refused unshare(2) separately from a later
  // failed exec of the absent command, so the probe needs no shell or fork.
  const f = await initialized({executable: "/usr/bin/unshare", argv: ["--user", "/nonexistent-probe"], files: {"source.txt": "alpha"}}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const result = data(await io.call("test_recipe", {sourceDigest: f.sourceDigest, recipe: "unit"}));
  assert.equal(result.success, false); assert.match(result.stderr, /unshare failed: Operation not permitted/); assert.doesNotMatch(result.stderr, /failed to execute/);
});
