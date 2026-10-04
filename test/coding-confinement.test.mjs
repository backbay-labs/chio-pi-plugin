import assert from "node:assert/strict";
import {readFile, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import test from "node:test";
import {command, data, fixture, hash, initialized, meta, stdio} from "./helpers/coding-fixture.mjs";

const local = process.platform === "darwin" || process.platform === "linux" && process.env.CHIO_CODING_LINUX_PROBE === "1";
test("real confined recipe passes single-process node:test and retains exact test lineage", {skip: !local}, async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f, {env: {NODE_OPTIONS: "--require=/DO-NOT-LOAD", CHIO_AUTH_TOKEN: "fixture-secret-never-inherit", OPENAI_API_KEY: "fixture-provider-secret"}}); t.after(() => io.close());
  const args = {sourceDigest: f.sourceDigest, recipe: "unit"}; const first = await io.call("test_recipe", args);
  const result = data(first); assert.equal(result.success, true, result.stderr); assert.equal(result.sourceDigest, f.sourceDigest); assert.equal(result.recipeSha256, f.config.recipes[0].recipeSha256);
  assert.deepEqual(await io.call("test_recipe", args, meta("1", {chioAttemptId: "other-attempt"})), first);
  assert.deepEqual(await readdir(f.root("jobs")), []);
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
