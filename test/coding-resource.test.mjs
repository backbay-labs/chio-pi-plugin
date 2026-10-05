import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {chmod, link, mkdtemp, readFile, readdir, rm, symlink, truncate, unlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {canonicalJson} from "../dist/tool-registry.js";
import * as codingConfig from "../dist/coding-resource/config.js";
import {assertBubblewrapSupport, bubblewrapArguments} from "../dist/coding-resource/recipe-sandbox.js";
import {caller, cli, command, data, fixture, hash, initialized, meta, patch, stdio} from "./helpers/coding-fixture.mjs";
import {compiledRecipeFilter, evaluateClassicBpf} from "./helpers/coding-seccomp.mjs";

const ledgerCrash = fileURLToPath(new URL("./helpers/coding-ledger-crash.mjs", import.meta.url));

test("an npm-style executable symlink runs resource commands", async t => {
  const f = await initialized(); t.after(() => f.close());
  const directory = await mkdtemp(join(tmpdir(), "chio-coding-bin-")); t.after(() => rm(directory, {recursive: true, force: true}));
  const alias = join(directory, "chio-coding-resource"); await symlink(cli, alias);
  const help = await command(["--help"], {entry: alias});
  assert.equal(help.code, 0); assert.match(help.stdout, /^chio-coding-resource init\|serve\|inspect\|export\|recover-lock/);
  const inspection = await command(["inspect", "--config", f.configPath], {entry: alias});
  assert.equal(inspection.code, 0, inspection.stderr); assert.ok(JSON.parse(inspection.stdout), "symlinked inspect must produce the read-only view");
});

test("coding resource requires explicit private import before serving", async t => {
  const f = await fixture(); t.after(() => f.close());
  const before = await command(["serve", "--config", f.configPath]);
  assert.notEqual(before.code, 0);
  assert.match(before.stderr, /initializ|import/i, "serve must explain the missing initialized workspace");
  assert.deepEqual(await readdir(f.root("state")), []);
  const result = await command(["init", "--config", f.configPath]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).sourceDigest, /^[a-f0-9]{64}$/);
  assert.equal((await command(["init", "--config", f.configPath])).code, 1);
});
for (const kind of ["initial missing", "current missing", "current corrupt"]) test(`startup validates ${kind} generation before advertising native tools`, async t => {
  const f = await initialized(); t.after(() => f.close()); let io = stdio(f); t.after(() => io.close());
  const current = data(await io.call("apply_patch", patch(f.sourceDigest, hash("alpha\nbeta\n")))).sourceDigest; await io.close();
  if (kind === "current corrupt") {
    io = stdio(f, {fault: "afterIntent"});
    await assert.rejects(io.call("apply_patch", patch(current, hash("changed\nbeta\n")), meta("2")), /transport closed/); await io.exited;
    assert.equal((await command(["recover-lock", "--config", f.configPath])).code, 0);
  }
  const selected = kind.startsWith("initial") ? f.sourceDigest : current; const generation = join(f.root("state"), "generations", selected); const source = join(generation, "source.txt");
  await chmod(generation, 0o700);
  if (kind.endsWith("missing")) await unlink(source);
  else {await chmod(source, 0o600); await writeFile(source, "corrupt\nbeta\n"); await chmod(source, 0o400);}
  await chmod(generation, 0o500);
  io = stdio(f);
  await assert.rejects(Promise.all([io.request("initialize", {protocolVersion: "2025-06-18"}), io.request("tools/list")]), /transport closed/); await io.exited; assert.equal(io.messages.length, 0);
  assert.equal((await readdir(f.root("state"))).includes("owner.lock"), false, "only the startup attempt's owned lock may be released");
  const inspection = await command(["inspect", "--config", f.configPath]); assert.equal(inspection.code, 0); const state = JSON.parse(inspection.stdout);
  assert.equal(state.unsigned, true); assert.equal(state.sourceDigest, current); assert.equal(state.operations[0].state, "completed");
  if (kind === "current corrupt") {
    assert.equal(state.fenced, true); const original = JSON.parse((await command(["export", "--config", f.configPath, "--operation", "2".repeat(64)])).stdout); assert.equal(original.operation.state, "intent"); assert.equal(original.result, null);
  }
  assert.equal((await readdir(join(f.root("state"), "generations"))).length, 2, "do not promote or repair another generation");
});
test("native JSONL initialize lists exactly nine closed tools and no extra capabilities", async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const hello = await io.request("initialize", {protocolVersion: "2024-11-05", capabilities: {}, clientInfo: {name: "native-fixture", version: "1"}});
  assert.deepEqual(hello.result.capabilities, {tools: {}});
  const inventory = (await io.request("tools/list")).result.tools;
  assert.deepEqual(inventory.map(x => x.name).sort(), ["apply_patch", "publish_artifact", "read_many", "read_range", "repo_context", "repo_diff", "repo_status", "search", "test_recipe"]);
  for (const tool of inventory) assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal((await io.request("sampling/createMessage")).error.code, -32601);
});
test("missing caller and nonnative request identity refuse without source effects", async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const missing = meta(); delete missing.chioCallerCapabilitySha256;
  for (const m of [missing, meta("2", {chioRequestId: "pi-call"}), meta("3", {chioTransportKeyEpoch: 0}), meta("4", {chioCallerCapabilitySha256: "c".repeat(64)}), meta("5", {chioAttemptId: "x".repeat(513)})]) {
    assert.equal((await io.call("apply_patch", patch(f.sourceDigest, hash("alpha\nbeta\n")), m)).isError, true);
  }
  assert.equal((await readdir(join(f.root("state"), "generations"))).length, 1);
});
test("CAS applies one fresh generation and exact historical replay precedes current source checks", async t => {
  const f = await initialized(); t.after(() => f.close()); let io = stdio(f);
  const args = patch(f.sourceDigest, hash("alpha\nbeta\n"));
  const first = await io.call("apply_patch", args);
  assert.equal(first.isError, undefined);
  const current = data(first).sourceDigest;
  assert.notEqual(current, f.sourceDigest);
  const second = await io.call("apply_patch", patch(current, hash("changed\nbeta\n"), "later\n"), meta("2"));
  assert.equal(second.isError, undefined); await io.close();
  io = stdio(f); t.after(() => io.close());
  assert.deepEqual(await io.call("apply_patch", args, meta("1", {chioAttemptId: "new-attempt", chioTransportKeyEpoch: 2})), first);
  assert.equal((await readdir(join(f.root("state"), "generations"))).length, 3, "observe actual immutable generations, not ledger counts");
  assert.equal(await readFile(join(f.root("repository"), "source.txt"), "utf8"), "alpha\nbeta\n");
  const status = data(await io.call("repo_status", {}, meta("3")));
  assert.equal(status.sourceDigest, data(second).sourceDigest);
  assert.deepEqual(status.changed.map(x => x.path), ["source.txt"]);
});
test("operation reuse conflicts on tool arguments caller and operator snapshot", async t => {
  const f = await initialized(); t.after(() => f.close()); let io = stdio(f);
  const args = patch(f.sourceDigest, hash("alpha\nbeta\n")); await io.call("apply_patch", args);
  for (const [tool, input, native] of [["apply_patch", {...args, sourceDigest: "f".repeat(64)}, meta()], ["repo_status", {}, meta()], ["apply_patch", args, meta("1", {chioCallerCapabilitySha256: "b".repeat(64)})]]) {
    assert.match(data(await io.call(tool, input, native)).message, /conflict/i);
  }
  await io.close(); await f.updateConfig(c => c.bounds.maxReadMany = 7); io = stdio(f); t.after(() => io.close());
  assert.match(data(await io.call("apply_patch", args)).message, /conflict/i);
});
test("crash after durable intent fences fresh work and never returns terminal MCP outcome", async t => {
  const f = await initialized(); t.after(() => f.close()); let io = stdio(f, {fault: "afterIntent"}); t.after(() => io.close());
  await assert.rejects(io.call("apply_patch", patch(f.sourceDigest, hash("alpha\nbeta\n"))), /transport closed/);
  assert.equal((await io.exited).code, 92); assert.equal(io.messages.length, 0);
  assert.equal((await command(["recover-lock", "--config", f.configPath])).code, 0);
  io = stdio(f); await assert.rejects(io.call("repo_status", {}, meta("2")), /transport closed/); assert.equal(io.messages.length, 0);
  const state = JSON.parse((await command(["inspect", "--config", f.configPath])).stdout);
  assert.equal(state.fenced, true); assert.equal(state.operations[0].state, "intent");
});
for (const point of ["afterGeneration", "beforeCommit", "afterPublication"]) test(`post-intent storage failure at ${point} closes without ACK-able MCP error`, async t => {
  const f = await initialized(); t.after(() => f.close());
  const io = stdio(f, {fault: `throw:${point}`});
  t.after(() => io.close());
  if (point === "afterPublication") {
    const result = data(await io.call("test_recipe", {sourceDigest: f.sourceDigest, recipe: "unit"}, meta("2")));
    await assert.rejects(io.call("publish_artifact", {sourceDigest: f.sourceDigest, testOperationId: "2".repeat(64), testResultSha256: result.resultSha256, recipeSha256: f.config.recipes[0].recipeSha256, destination: "review"}), /transport closed/);
  } else await assert.rejects(io.call("apply_patch", patch(f.sourceDigest, hash("alpha\nbeta\n"))), /transport closed/);
  await io.exited;
  const state = JSON.parse((await command(["inspect", "--config", f.configPath])).stdout);
  assert.equal(state.sourceDigest, f.sourceDigest, "head and terminal outcome must share the final transaction"); assert.equal(state.fenced, true);
  assert.equal(io.messages.filter(x => x.id === 1 && point !== "afterPublication").length, 0);
});
test("commit-before-reply crash retains exact completed result and one generation", async t => {
  const f = await initialized(); t.after(() => f.close()); const args = patch(f.sourceDigest, hash("alpha\nbeta\n")); let io = stdio(f, {fault: "afterCommit"});
  await assert.rejects(io.call("apply_patch", args), /transport closed/); await io.exited;
  await command(["recover-lock", "--config", f.configPath]);
  const exported = JSON.parse((await command(["export", "--config", f.configPath, "--operation", "1".repeat(64)])).stdout);
  assert.equal(exported.unsigned, true); assert.equal(exported.kernelFenceClearance, false);
  io = stdio(f); t.after(() => io.close()); assert.deepEqual(await io.call("apply_patch", args), exported.result);
  assert.equal((await readdir(join(f.root("state"), "generations"))).length, 2);
});
test("paths refuse traversal aliases and edits use full file CAS with all-or-none semantics", async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  for (const [i, path] of ["../operator.json", "/etc/passwd", "source.txt/../source.txt", "./source.txt", "source.txt\u0000", ".git/config"].entries()) {
    assert.equal((await io.call("read_range", {sourceDigest: f.sourceDigest, path, startLine: 1, endLine: 2}, meta(String(i + 1)))).isError, true);
  }
  const stale = await io.call("apply_patch", {sourceDigest: f.sourceDigest, changes: [{path: "source.txt", expectedFileSha256: hash("alpha\nbeta\n"), edits: [{oldText: "alpha", newText: "okay"}]}, {path: "fixture-test.mjs", expectedFileSha256: "f".repeat(64), replacement: ""}]}, meta("7"));
  assert.equal(stale.isError, true); assert.equal((await readdir(join(f.root("state"), "generations"))).length, 1);
  assert.equal((await io.call("apply_patch", patch("f".repeat(64), hash("alpha\nbeta\n")), meta("8"))).isError, true);
});
for (const kind of ["existing file ancestor", "existing directory ancestor", "same batch ancestor first", "same batch child first"]) test(`candidate namespace refuses ${kind} as a retained known patch error`, async t => {
  const f = await initialized(kind === "existing directory ancestor" ? {files: {"folder/leaf.txt": "retained"}} : {}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const fresh = path => ({path, expectedFileSha256: null, replacement: "new"});
  let changes = [fresh("source.txt/child.txt")];
  if (kind === "existing directory ancestor") changes = [fresh("folder")];
  if (kind.startsWith("same batch")) {changes = [fresh("new-file"), fresh("new-file/child.txt")]; if (kind.endsWith("child first")) changes.reverse();}
  const args = {sourceDigest: f.sourceDigest, changes}; const original = await io.call("apply_patch", args);
  assert.equal(original.isError, true); assert.equal(data(original).code, "invalid_patch");
  assert.deepEqual(await io.call("apply_patch", args, meta("1", {chioAttemptId: "known-namespace-replay"})), original);
  assert.deepEqual(await readdir(join(f.root("state"), "generations")), [f.sourceDigest], "no candidate or staging directory materialized");
  await io.close(); const state = JSON.parse((await command(["inspect", "--config", f.configPath])).stdout);
  assert.equal(state.sourceDigest, f.sourceDigest); assert.equal(state.fenced, false); assert.equal(state.operations.length, 1); assert.equal(state.operations[0].state, "completed");
});
for (const [kind, path] of [
  ["256-byte component", "x".repeat(256)], ["multibyte component", "é".repeat(128)],
  ["non-NFC spelling", "e\u0301.txt"], ["unpaired surrogate", "\ud800.txt"],
  ["default-ignorable scalar", "name\u200d.txt"], ["unassigned scalar", "name\u0378.txt"],
  ["newer than Unicode 15.1", "name\u{1c89}.txt"],
]) test(`portable namespace rejects ${kind} with an exact retained patch refusal`, async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const args = {sourceDigest: f.sourceDigest, changes: [{path, expectedFileSha256: null, replacement: "valid"}]};
  const original = await io.call("apply_patch", args); assert.equal(original.isError, true); assert.equal(data(original).code, "invalid_patch");
  assert.deepEqual(await io.call("apply_patch", args, meta("1", {chioAttemptId: "namespace-replay"})), original);
  assert.deepEqual(await readdir(join(f.root("state"), "generations")), [f.sourceDigest]); await io.close();
  const state = JSON.parse((await command(["inspect", "--config", f.configPath])).stdout);
  assert.equal(state.sourceDigest, f.sourceDigest); assert.equal(state.fenced, false); assert.equal(state.operations.length, 1); assert.equal(state.operations[0].state, "completed");
});
test("portable namespace accounts for the full managed absolute destination capacity", async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const path = Array(5).fill("x".repeat(200)).join("/"); const args = {sourceDigest: f.sourceDigest, changes: [{path, expectedFileSha256: null, replacement: "valid"}]};
  const original = await io.call("apply_patch", args);
  if (process.platform === "darwin") {
    assert.equal(original.isError, true); assert.equal(data(original).code, "invalid_patch");
    assert.deepEqual(await readdir(join(f.root("state"), "generations")), [f.sourceDigest]);
  } else {
    assert.equal(original.isError, undefined); assert.equal(data(await io.call("read_range", {sourceDigest: data(original).sourceDigest, path, startLine: 1, endLine: 1}, meta("2"))).text, "valid");
  }
  assert.deepEqual(await io.call("apply_patch", args, meta("1", {chioAttemptId: "destination-replay"})), original); await io.close();
  assert.equal(JSON.parse((await command(["inspect", "--config", f.configPath])).stdout).fenced, false);
});
for (const [kind, existing, added] of [
  ["ASCII file", "source.txt", "SOURCE.txt"], ["full Unicode fold", "Straße.txt", "STRASSE.txt"],
  ["directory", "Dir/a.txt", "dir/b.txt"], ["folded ancestor type", "Folder", "folder/child.txt"],
]) for (const order of ["existing", "same batch forward", "same batch reversed"]) test(`portable namespace refuses ${kind} aliases ${order}`, async t => {
  const f = await initialized({files: order === "existing" ? {[existing]: "retained"} : {"retained.txt": "retained"}}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  let names = order === "existing" ? [added] : [existing, added]; if (order.endsWith("reversed")) names.reverse();
  const args = {sourceDigest: f.sourceDigest, changes: names.map(path => ({path, expectedFileSha256: null, replacement: "valid"}))};
  const original = await io.call("apply_patch", args); assert.equal(original.isError, true); assert.equal(data(original).code, "invalid_patch");
  assert.deepEqual(await io.call("apply_patch", args, meta("1", {chioAttemptId: "alias-replay"})), original);
  assert.deepEqual(await readdir(join(f.root("state"), "generations")), [f.sourceDigest]); await io.close();
  const state = JSON.parse((await command(["inspect", "--config", f.configPath])).stdout);
  assert.equal(state.sourceDigest, f.sourceDigest); assert.equal(state.fenced, false); assert.equal(state.operations[0].state, "completed");
});
for (const order of ["existing NFC", "NFC first", "NFD first"]) test(`portable namespace rejects canonical Unicode aliases ${order}`, async t => {
  const f = await initialized({files: order === "existing NFC" ? {"é.txt": "retained"} : {"retained.txt": "retained"}}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  let names = order === "existing NFC" ? ["e\u0301.txt"] : ["é.txt", "e\u0301.txt"]; if (order === "NFD first") names.reverse();
  const args = {sourceDigest: f.sourceDigest, changes: names.map(path => ({path, expectedFileSha256: null, replacement: "valid"}))};
  const original = await io.call("apply_patch", args); assert.equal(original.isError, true); assert.equal(data(original).code, "invalid_patch");
  assert.deepEqual(await io.call("apply_patch", args, meta("1", {chioAttemptId: "unicode-replay"})), original);
  assert.deepEqual(await readdir(join(f.root("state"), "generations")), [f.sourceDigest]); await io.close();
  assert.equal(JSON.parse((await command(["inspect", "--config", f.configPath])).stdout).fenced, false);
});
test("portable namespace supports ordinary NFC Unicode import patch and read", async t => {
  const originals = {"café/Δ.txt": "initial", "日本語/😀.txt": "symbol"}; const f = await initialized({files: originals}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const args = {sourceDigest: f.sourceDigest, changes: [{path: "café/Δ.txt", expectedFileSha256: hash("initial"), replacement: "changed"}, {path: "résumé.txt", expectedFileSha256: null, replacement: "new"}]};
  const applied = await io.call("apply_patch", args); assert.equal(applied.isError, undefined); const current = data(applied).sourceDigest;
  for (const [index, [path, text]] of Object.entries({"café/Δ.txt": "changed", "日本語/😀.txt": "symbol", "résumé.txt": "new"}).entries()) assert.equal(data(await io.call("read_range", {sourceDigest: current, path, startLine: 1, endLine: 1}, meta(String(index + 2)))).text, text);
  const noncanonical = await io.call("read_range", {sourceDigest: current, path: "cafe\u0301/Δ.txt", startLine: 1, endLine: 1}, meta("5")); assert.equal(noncanonical.isError, true); assert.equal(data(noncanonical).code, "invalid_path");
  for (const [path, text] of Object.entries(originals)) assert.equal(await readFile(join(f.root("repository"), path), "utf8"), text);
});
for (const name of ["e\u0301.txt", "name\u200d.txt"]) test(`portable namespace import refuses unsupported spelling ${JSON.stringify(name)}`, async t => {
  const f = await fixture({files: {[name]: "retained"}}); t.after(() => f.close());
  const imported = await command(["init", "--config", f.configPath]); assert.equal(imported.code, 1); assert.match(imported.stderr, /canonical|Unicode|Path must/i);
  assert.deepEqual(await readdir(f.root("state")), []); assert.equal(await readFile(join(f.root("repository"), name), "utf8"), "retained");
});
test("newly materialized immutable generation must reload before head and outcome commit", async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f, {fault: "corrupt:afterGeneration"}); t.after(() => io.close());
  await assert.rejects(io.call("apply_patch", patch(f.sourceDigest, hash("alpha\nbeta\n"))), /transport closed/); await io.exited; assert.equal(io.messages.length, 0);
  const state = JSON.parse((await command(["inspect", "--config", f.configPath])).stdout);
  assert.equal(state.sourceDigest, f.sourceDigest); assert.equal(state.fenced, true); assert.equal(state.operations[0].state, "intent");
  assert.equal((await readdir(join(f.root("state"), "generations"))).length, 2, "retain the corrupt candidate for investigation without promotion");
});
test("nested recipe output capacity rejects unsafe NUL-byte budget before source import", async t => {
  const f = await fixture({files: {"source.txt": "alpha", "fixture-test.mjs": "process.stdout.write(Buffer.alloc(20480))"}, outputBytes: 20480}); t.after(() => f.close());
  const refused = await command(["init", "--config", f.configPath]); assert.equal(refused.code, 1); assert.match(refused.stderr, /output bounds/i);
  for (const root of ["state", "jobs", "artifacts"]) assert.deepEqual(await readdir(f.root(root)), []);
});
test("full response envelope refuses oversized control read and replays its retained original", async t => {
  const f = await initialized({files: {"source.txt": "\0".repeat(18500)}}); t.after(() => f.close()); let io = stdio(f); t.after(() => io.close());
  const args = {sourceDigest: f.sourceDigest, path: "source.txt", startLine: 1, endLine: 1}; const transportId = "\0".repeat(512);
  const original = await io.call("read_range", args, meta(), transportId); assert.equal(original.isError, true); assert.equal(data(original).code, "result_bound");
  assert.equal(io.messages[0].id, transportId); assert.ok(Buffer.byteLength(JSON.stringify(io.messages[0]) + "\n") <= f.config.bounds.maxOutputBytes); await io.close();
  io = stdio(f, {fault: "throw:beforeIntent"}); assert.deepEqual(await io.call("read_range", args, meta("1", {chioAttemptId: "short-id-replay"})), original); await io.close();
  const state = JSON.parse((await command(["inspect", "--config", f.configPath])).stdout); assert.equal(state.fenced, false); assert.equal(state.operations.length, 1); assert.equal(state.operations[0].state, "completed");
});
test("full response envelope delivers successful control reads and exact replay with the largest ID", async t => {
  const source = "\0".repeat(18000); const f = await initialized({files: {"source.txt": source}}); t.after(() => f.close()); let io = stdio(f); t.after(() => io.close());
  const args = {sourceDigest: f.sourceDigest, path: "source.txt", startLine: 1, endLine: 1}; const original = await io.call("read_range", args); assert.equal(original.isError, undefined); assert.equal(data(original).text, source); await io.close();
  io = stdio(f, {fault: "throw:beforeIntent"}); const transportId = "\0".repeat(512);
  assert.deepEqual(await io.call("read_range", args, meta("1", {chioAttemptId: "largest-id-replay"}), transportId), original);
  assert.equal(io.messages[0].id, transportId); assert.ok(Buffer.byteLength(JSON.stringify(io.messages[0]) + "\n") <= f.config.bounds.maxOutputBytes); await io.close();
  const state = JSON.parse((await command(["inspect", "--config", f.configPath])).stdout); assert.equal(state.fenced, false); assert.equal(state.operations.length, 1); assert.equal(state.operations[0].state, "completed");
});
test("actual compiled x64 seccomp rejects x32 syscall variants and preserves native controls", async () => {
  const denied = 0x00050001; const allowed = 0x7fff0000; const arch = 0xc000003e; const filter = await compiledRecipeFilter("x64");
  for (const nr of [57, 41, 86, 56]) {
    assert.equal(evaluateClassicBpf(filter, {arch, nr}), denied);
    assert.equal(evaluateClassicBpf(filter, {arch, nr: nr | 0x40000000}), denied, `x32 variant of syscall ${nr} must not bypass policy`);
  }
  assert.equal(evaluateClassicBpf(filter, {arch, nr: 39}), allowed);
  assert.equal(evaluateClassicBpf(filter, {arch, nr: 39 | 0x40000000}), denied);
  assert.equal(evaluateClassicBpf(filter, {arch, nr: 56, argument0: 0x10000}), allowed);
  assert.equal(evaluateClassicBpf(filter, {arch, nr: 435}), 0x00050026);
  assert.equal(evaluateClassicBpf(filter, {arch: 0xc00000b7, nr: 39}), 0x80000000);
  const arm = await compiledRecipeFilter("arm64"); assert.equal(evaluateClassicBpf(arm, {arch: 0xc00000b7, nr: 198}), denied); assert.equal(evaluateClassicBpf(arm, {arch: 0xc00000b7, nr: 220, argument0: 0x10000}), allowed);
});
test("B-M4 compiled recipe filters deny io_uring and nested namespaces on both architectures, including x32 variants", async () => {
  const denied = 0x00050001; const allowed = 0x7fff0000;
  // io_uring_setup/enter/register share numbers on arm64 and x64; unshare is 97 on arm64 and 272 on x64.
  for (const [architecture, arch, unshare, ordinary] of [["x64", 0xc000003e, 272, 39], ["arm64", 0xc00000b7, 97, 172]]) {
    const filter = await compiledRecipeFilter(architecture);
    for (const nr of [425, 426, 427, unshare]) {
      assert.equal(evaluateClassicBpf(filter, {arch, nr}), denied, `${architecture} syscall ${nr} must be denied`);
      if (architecture === "x64") assert.equal(evaluateClassicBpf(filter, {arch, nr: nr | 0x40000000}), denied, `x32 variant of ${nr} must be denied`);
    }
    assert.equal(evaluateClassicBpf(filter, {arch, nr: ordinary}), allowed, `${architecture} ordinary getpid stays allowed`);
    assert.equal(evaluateClassicBpf(filter, {arch, nr: architecture === "x64" ? 56 : 220, argument0: 0x10000}), allowed, "thread-only clone stays allowed");
    assert.equal(evaluateClassicBpf(filter, {arch, nr: architecture === "x64" ? 56 : 220, argument0: 0x10000000}), denied, "clone without CLONE_THREAD, including CLONE_NEWUSER, stays denied");
    assert.equal(evaluateClassicBpf(filter, {arch, nr: 435}), 0x00050026);
  }
  const args = bubblewrapArguments({executable: "/usr/bin/node", argv: [], timeoutMs: 1, outputBytes: 1, graceMs: 1}, {backend: "bubblewrap", launcher: "/usr/bin/bwrap", runtimeFiles: []}, "/source-generation", "/job-directory");
  assert.ok(args.includes("--disable-userns"), "bubblewrap must also block nested user namespaces");
  assert.ok(args.indexOf("--unshare-user") < args.indexOf("--disable-userns"), "--disable-userns requires the sandbox user namespace");
});
test("final review: an old or setuid bubblewrap is an unsupported_sandbox refusal, not a recorded failing test", () => {
  // --disable-userns needs a non-setuid bubblewrap 0.8.0 or later. The probe runs
  // while preparing test_recipe, before any intent or job exists.
  for (const version of ["bubblewrap 0.8.0\n", "bubblewrap 0.9.0\n", "bubblewrap 0.11.1\n", "bubblewrap 1.0.0\n"]) assert.doesNotThrow(() => assertBubblewrapSupport(0o100755, version), version);
  for (const [mode, version] of [[0o104755, "bubblewrap 0.8.0\n"], [0o104755, "bubblewrap 0.11.1\n"], [0o100755, "bubblewrap 0.7.0\n"], [0o100755, "bubblewrap 0.4.1\n"], [0o100755, ""], [0o100755, "bwrap 0.8.0\n"], [0o100755, "bubblewrap 0.8\n"]])
    assert.throws(() => assertBubblewrapSupport(mode, version), error => error.code === "unsupported_sandbox" && /non-setuid bubblewrap 0\.8\.0/.test(error.message), `${mode.toString(8)} ${JSON.stringify(version)}`);
});
test("read many preserves ordered partial truth and bounded literal search returns digests", async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const batch = data(await io.call("read_many", {sourceDigest: f.sourceDigest, reads: [{path: "source.txt", startLine: 1, endLine: 1}, {path: "missing.txt", startLine: 1, endLine: 1}, {path: "source.txt", startLine: 2, endLine: 2}]}));
  assert.equal(batch.partial, true); assert.equal(batch.results[0].text, "alpha\n"); assert.equal(batch.results[1].ok, false); assert.equal(batch.results[2].text, "beta\n");
  assert.equal(batch.results[0].fileSha256, hash("alpha\nbeta\n"));
  const found = data(await io.call("search", {sourceDigest: f.sourceDigest, literal: "a", maxMatches: 1}, meta("2")));
  assert.equal(found.matches.length, 1); assert.equal(found.truncated, true);
  const context = data(await io.call("repo_context", {sourceDigest: f.sourceDigest}, meta("3")));
  assert.equal(context.authority, false); assert.equal(context.recipes[0].recipeSha256, f.config.recipes[0].recipeSha256);
});
for (const kind of ["symlink", "hardlink", "fifo"]) test(`explicit import rejects ${kind} before reading`, async t => {
  const f = await fixture(); t.after(() => f.close()); const path = join(f.root("repository"), "unsafe");
  if (kind === "symlink") await symlink("source.txt", path);
  if (kind === "hardlink") await link(join(f.root("repository"), "source.txt"), path);
  if (kind === "fifo") await new Promise((resolve, reject) => {const child = spawn("/usr/bin/mkfifo", [path]); child.once("close", code => code === 0 ? resolve() : reject(new Error("mkfifo")));});
  const response = await command(["init", "--config", f.configPath]); assert.equal(response.code, 1); assert.match(response.stderr, /regular|link|private/i);
});
test("private config rejects unknown properties overlapping roots and unsafe modes", async t => {
  const f = await fixture(); t.after(() => f.close());
  await f.updateConfig(c => c.shell = "sh"); assert.match((await command(["init", "--config", f.configPath])).stderr, /closed schema/i);
  await f.updateConfig(c => {delete c.shell; c.artifactRoot = c.stateRoot;}); assert.match((await command(["init", "--config", f.configPath])).stderr, /disjoint/i);
  await f.updateConfig(c => c.artifactRoot = f.root("artifacts")); await chmod(f.configPath, 0o644); assert.match((await command(["init", "--config", f.configPath])).stderr, /private/i);
});
test("exclusive owner lock refuses concurrent serve and explicit dead recovery refuses a living owner", async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close()); await io.call("repo_status", {});
  assert.equal((await command(["serve", "--config", f.configPath])).code, 1); assert.equal((await command(["recover-lock", "--config", f.configPath])).code, 1);
  await io.close(); assert.equal((await readdir(f.root("state"))).includes("owner.lock"), false);
});
test("bounded framing rejects a line before newline and releases only its own lock", async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close()); await io.request("initialize");
  assert.equal(typeof codingConfig.MAX_REQUEST_FRAME_BYTES, "number", "the reader exports its fixed frame ceiling");
  io.child.stdin.write("x".repeat(codingConfig.MAX_REQUEST_FRAME_BYTES + 1)); const response = await io.exited;
  assert.equal(response.code, 1); assert.equal(response.messages.length, 1); assert.equal((await readdir(f.root("state"))).includes("owner.lock"), false);
});
test("CLI help exposes operator safety and no model/provider authorization", async () => {
  const result = await command(["--help"]); assert.equal(result.code, 0); assert.match(result.stdout, /kernel-owned|Chio-owned/i); assert.match(result.stdout, /unsigned/i); assert.match(result.stdout, /init/); assert.doesNotMatch(result.stdout, /--api-key|--provider/);
});
test("original durable binding covers source provenance and retains every native replay attempt", async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f); const args = patch(f.sourceDigest, hash("alpha\nbeta\n"));
  await io.call("apply_patch", args); await io.call("apply_patch", args, meta("1", {chioAttemptId: "attempt-two", chioTransportKeyEpoch: 2})); await io.close();
  const record = JSON.parse((await command(["export", "--config", f.configPath, "--operation", "1".repeat(64)])).stdout);
  assert.equal(record.operation.binding, hash(canonicalJson({schema: "chio.coding-operation-binding.v1", resourceOwnerId: f.config.resourceOwnerId, workspaceId: f.config.workspaceId, configDigest: hash(canonicalJson(f.config)), caller: caller, operationId: "1".repeat(64), tool: "apply_patch", arguments: args, sourceDigest: f.sourceDigest})));
  assert.equal(record.attempts.length, 2); assert.equal(record.attempts[1].chioAttemptId, "attempt-two");
});
test("overlapping literal matches refuse an ambiguous CAS edit before generation creation", async t => {
  const f = await initialized({files: {"source.txt": "aaa"}}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const result = await io.call("apply_patch", {sourceDigest: f.sourceDigest, changes: [{path: "source.txt", expectedFileSha256: hash("aaa"), edits: [{oldText: "aa", newText: "x"}]}]});
  assert.equal(result.isError, true); assert.equal(data(result).code, "ambiguous_edit"); assert.equal((await readdir(join(f.root("state"), "generations"))).length, 1);
});
for (const [name, source, edits, code] of [
  ["cross-entry overlap", "abcdef", [{oldText: "bcd", newText: "bcD"}, {oldText: "bc", newText: "xx"}], "overlapping_edit"],
  ["introduced text", "abc def", [{oldText: "abc", newText: "xyz"}, {oldText: "xyz", newText: "X"}], "ambiguous_edit"],
]) test(`literal patch rejects ${name} against original full-file content`, async t => {
  const f = await initialized({files: {"source.txt": source}}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const refused = await io.call("apply_patch", {sourceDigest: f.sourceDigest, changes: [{path: "source.txt", expectedFileSha256: hash(source), edits}]});
  assert.equal(refused.isError, true); assert.equal(data(refused).code, code); assert.equal((await readdir(join(f.root("state"), "generations"))).length, 1);
  assert.equal(data(await io.call("repo_status", {}, meta("2"))).sourceDigest, f.sourceDigest);
});
test("literal patch applies disjoint original ranges despite changed lengths and introduced matches", async t => {
  const source = "abcdef"; const edits = [{oldText: "bc", newText: "defBC"}, {oldText: "def", newText: "D"}];
  for (const selected of [edits, [...edits].reverse()]) {
    const f = await initialized({files: {"source.txt": source}}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
    const applied = await io.call("apply_patch", {sourceDigest: f.sourceDigest, changes: [{path: "source.txt", expectedFileSha256: hash(source), edits: selected}]}); assert.equal(applied.isError, undefined);
    assert.equal(data(await io.call("read_range", {sourceDigest: data(applied).sourceDigest, path: "source.txt", startLine: 1, endLine: 1}, meta("2"))).text, "adefBCD");
    assert.equal((await readdir(join(f.root("state"), "generations"))).length, 2); assert.equal(await readFile(join(f.root("repository"), "source.txt"), "utf8"), source); await io.close();
  }
});
test("SQLite rejects nonregular private sidecars before potentially blocking recovery open", async t => {
  const f = await initialized(); t.after(() => f.close()); const path = join(f.root("state"), "ledger.sqlite-journal");
  await new Promise((resolve, reject) => {const child = spawn("/usr/bin/mkfifo", [path]); child.once("close", code => code === 0 ? resolve() : reject(Error("mkfifo")));});
  const response = await command(["inspect", "--config", f.configPath], {timeoutMs: 1000});
  assert.equal(response.timedOut, false, "must refuse FIFO before SQLite can open it"); assert.equal(response.code, 1); assert.match(response.stderr, /regular|private|sidecar/i);
});
test("conflicting redelivery of incomplete intent closes without ordinary terminal conflict", async t => {
  const f = await initialized(); t.after(() => f.close()); let io = stdio(f, {fault: "afterIntent"}); t.after(() => io.close());
  await assert.rejects(io.call("apply_patch", patch(f.sourceDigest, hash("alpha\nbeta\n"))), /transport closed/); await io.exited; await command(["recover-lock", "--config", f.configPath]);
  io = stdio(f); await assert.rejects(io.call("repo_status", {}), /transport closed/); await io.exited; assert.equal(io.messages.length, 0);
});
for (const kind of ["arguments", "metadata", "call parameters"]) test(`malformed ${kind} redelivery preserves unresolved intent without a terminal error`, async t => {
  const f = await initialized(); t.after(() => f.close()); let io = stdio(f, {fault: "afterIntent"}); t.after(() => io.close());
  await assert.rejects(io.call("apply_patch", patch(f.sourceDigest, hash("alpha\nbeta\n"))), /transport closed/); await io.exited;
  assert.equal((await command(["recover-lock", "--config", f.configPath])).code, 0);
  io = stdio(f);
  const params = {name: "apply_patch", arguments: patch(f.sourceDigest, hash("alpha\nbeta\n")), _meta: meta()};
  if (kind === "arguments") delete params.arguments.changes;
  if (kind === "metadata") delete params._meta.chioCallerCapabilitySha256;
  if (kind === "call parameters") params.extra = true;
  await assert.rejects(io.request("tools/call", params), /transport closed/); await io.exited; assert.equal(io.messages.length, 0);
  const original = JSON.parse((await command(["export", "--config", f.configPath, "--operation", "1".repeat(64)])).stdout);
  assert.equal(original.operation.state, "intent"); assert.equal(original.result, null);
});
test("malformed private operator JSON never echoes input or fixture credential bytes", async t => {
  const f = await fixture(); t.after(() => f.close()); await writeFile(f.configPath, "fixture-secret-private", {mode: 0o600});
  const result = await command(["init", "--config", f.configPath]); assert.equal(result.code, 1); assert.doesNotMatch(result.stderr, /fixture-sec/); assert.match(result.stderr, /invalid.*JSON/i);
});
test("graceful native termination releases only the live resource owner's lock", async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f); await io.call("repo_status", {});
  io.child.kill("SIGTERM"); await io.exited; assert.equal((await readdir(f.root("state"))).includes("owner.lock"), false);
  assert.equal(JSON.parse((await command(["inspect", "--config", f.configPath])).stdout).operations[0].state, "completed");
});
test("recipe output pins leave capacity for worst-case JSON escaping before accepting config", async t => {
  const f = await fixture({outputBytes: 30000}); t.after(() => f.close()); const result = await command(["init", "--config", f.configPath]);
  assert.equal(result.code, 1); assert.match(result.stderr, /output bounds/i); assert.deepEqual(await readdir(f.root("state")), []);
});

test("B-I2 a crash inside a ledger commit is rolled back by serve under the owner lock; read-only commands refuse naming the journal", async t => {
  const f = await initialized(); t.after(() => f.close()); let io = stdio(f);
  const current = data(await io.call("apply_patch", patch(f.sourceDigest, hash("alpha\nbeta\n")))).sourceDigest; await io.close();
  const journal = join(f.root("state"), "ledger.sqlite-journal");
  const signal = await new Promise((resolve, reject) => {const child = spawn(process.execPath, [ledgerCrash, f.root("state")], {stdio: "ignore", env: {PATH: "/usr/bin:/bin", LANG: "C"}}); child.once("error", reject); child.once("close", (_, value) => resolve(value));});
  assert.equal(signal, "SIGKILL"); const hot = await readFile(journal); assert.ok(hot.length > 0, "the interrupted commit leaves a rollback journal");
  for (const args of [["inspect", "--config", f.configPath], ["export", "--config", f.configPath, "--operation", "1".repeat(64)]]) {
    const refused = await command(args); assert.equal(refused.code, 1); assert.match(refused.stderr, /ledger\.sqlite-journal/); assert.match(refused.stderr, /never delete/i);
  }
  assert.deepEqual(await readFile(journal), hot, "read-only commands neither roll back nor delete the journal");
  assert.equal((await command(["recover-lock", "--config", f.configPath])).code, 0, "the crashed owner's lock is recovered first");
  io = stdio(f); t.after(() => io.close());
  assert.equal(data(await io.call("repo_status", {}, meta("2"))).sourceDigest, current, "serve restores the last committed head");
  await assert.rejects(readFile(journal), {code: "ENOENT"}, "SQLite consumed the journal during the locked rollback"); await io.close();
  const state = JSON.parse((await command(["inspect", "--config", f.configPath])).stdout);
  assert.equal(state.sourceDigest, current); assert.equal(state.initialDigest, f.sourceDigest); assert.equal(state.fenced, false); assert.equal(state.operations.length, 2);
  const db = new DatabaseSync(join(f.root("state"), "ledger.sqlite"), {readOnly: true});
  try {assert.equal(db.prepare("SELECT count(*) AS count FROM generations").get().count, 2, "uncommitted rows are gone");} finally {db.close();}
});
test("B-I4 a ledger beyond the former 256 MiB full-read cap still opens for serve, inspect and export", async t => {
  const f = await initialized(); t.after(() => f.close()); let io = stdio(f); const args = patch(f.sourceDigest, hash("alpha\nbeta\n"));
  const first = await io.call("apply_patch", args); await io.close();
  // Sparse trailing space past SQLite's in-header page count stands in for growth.
  await truncate(join(f.root("state"), "ledger.sqlite"), 300 * 1024 * 1024);
  const inspected = await command(["inspect", "--config", f.configPath]); assert.equal(inspected.code, 0, inspected.stderr); assert.equal(JSON.parse(inspected.stdout).sourceDigest, data(first).sourceDigest);
  const exported = await command(["export", "--config", f.configPath, "--operation", "1".repeat(64)]); assert.equal(exported.code, 0, exported.stderr); assert.deepEqual(JSON.parse(exported.stdout).result, first);
  io = stdio(f); t.after(() => io.close());
  assert.deepEqual(await io.call("apply_patch", args, meta("1", {chioAttemptId: "large-ledger-replay"})), first);
  assert.equal(data(await io.call("repo_status", {}, meta("2"))).sourceDigest, data(first).sourceDigest);
});
test("B-I3 a diff beyond the 1 MiB canonical limit returns diff_bound with the documented bounds", async t => {
  const line = "const value = \"example\";\n"; const body = line.repeat(Math.floor(200000 / line.length));
  const files = Object.fromEntries(["a", "b", "c"].map(name => [`${name}.js`, `${body}// end ${name}\n`]));
  const f = await initialized({files}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const applied = await io.call("apply_patch", {sourceDigest: f.sourceDigest, changes: ["a", "b", "c"].map(name => ({path: `${name}.js`, expectedFileSha256: hash(files[`${name}.js`]), edits: [{oldText: `// end ${name}`, newText: `// END ${name}`}]}))});
  assert.equal(applied.isError, undefined); const current = data(applied).sourceDigest;
  const diff = await io.call("repo_diff", {sourceDigest: current}, meta("2")); assert.equal(diff.isError, true); assert.equal(data(diff).code, "diff_bound");
  assert.deepEqual(await io.call("repo_diff", {sourceDigest: current}, meta("2", {chioAttemptId: "diff-bound-replay"})), diff);
  assert.equal(data(await io.call("repo_status", {}, meta("3"))).changed.length, 3, "the transport stays open");
});
test("B-I3 reads, read_many and search beyond the 1 MiB canonical limit return their bound outcomes", async t => {
  const f = await initialized({files: {"source.txt": "\u0001".repeat(200000)}, bounds: {maxReadBytes: 200000, maxOutputBytes: 1048576}}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const read = await io.call("read_range", {sourceDigest: f.sourceDigest, path: "source.txt", startLine: 1, endLine: 1}); assert.equal(read.isError, true); assert.equal(data(read).code, "result_bound");
  const many = data(await io.call("read_many", {sourceDigest: f.sourceDigest, reads: [{path: "source.txt", startLine: 1, endLine: 1}]}, meta("2")));
  assert.equal(many.partial, true); assert.equal(many.results[0].code, "read_many_bound");
  const found = data(await io.call("search", {sourceDigest: f.sourceDigest, literal: "\u0001"}, meta("3"))); assert.deepEqual(found.matches, []); assert.equal(found.truncated, true);
  await io.close(); const state = JSON.parse((await command(["inspect", "--config", f.configPath])).stdout); assert.equal(state.fenced, false); assert.equal(state.operations.length, 3);
});
test("B-I3 repository context and a grown manifest beyond the 1 MiB canonical limit return bound refusals", async t => {
  // Long nested names keep the managed absolute destination within macOS capacity.
  // Size the manifest just under its 1 MiB binding; maximal escaped owner and
  // workspace identities then carry the requested context past that limit.
  const directory = ["d", "e", "g"].map(letter => letter.repeat(240)).join("/"); const name = index => `${directory}/f${String(index).padStart(5, "0")}`;
  const entry = Buffer.byteLength(JSON.stringify({bytes: 1, path: name(0), sha256: hash("x")})) + 1; const base = Buffer.byteLength(JSON.stringify({files: [], schema: "chio.coding-source.v1"}));
  const count = Math.floor((1024 * 1024 - 2048 - base) / entry);
  const files = Object.fromEntries(Array.from({length: count}, (_, index) => [name(index), "x"]));
  const f = await fixture({files, bounds: {maxFiles: 4000}}); t.after(() => f.close());
  await f.updateConfig(config => {config.resourceOwnerId = "\u0001".repeat(1024); config.workspaceId = "\u0002".repeat(1024);});
  const init = await command(["init", "--config", f.configPath]); assert.equal(init.code, 0, init.stderr); const sourceDigest = JSON.parse(init.stdout).sourceDigest;
  const io = stdio(f); t.after(() => io.close());
  const context = await io.call("repo_context", {sourceDigest}); assert.equal(context.isError, true); assert.equal(data(context).code, "context_bound");
  const grown = await io.call("apply_patch", {sourceDigest, changes: Array.from({length: 8}, (_, index) => ({path: name(count + index), expectedFileSha256: null, replacement: "x"}))}, meta("2"));
  assert.equal(grown.isError, true); assert.equal(data(grown).code, "source_bound");
  assert.equal(data(await io.call("repo_status", {}, meta("3"))).changed.length, 0, "the transport stays open");
});
test("B-I5 literal edits preserve a UTF-8 byte-order mark that reads and diffs report", async t => {
  const original = "\ufeffalpha\nbeta\n"; const f = await initialized({files: {"a.ps1": original}}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const applied = await io.call("apply_patch", {sourceDigest: f.sourceDigest, changes: [{path: "a.ps1", expectedFileSha256: hash(original), edits: [{oldText: "beta", newText: "gamma"}]}]});
  assert.equal(applied.isError, undefined); const current = data(applied).sourceDigest;
  assert.deepEqual(await readFile(join(f.root("state"), "generations", current, "a.ps1")), Buffer.from("\ufeffalpha\ngamma\n"));
  assert.equal(data(await io.call("read_range", {sourceDigest: current, path: "a.ps1", startLine: 1, endLine: 1}, meta("2"))).text, "\ufeffalpha\n");
  assert.deepEqual(data(await io.call("repo_diff", {sourceDigest: current}, meta("3"))).changes, [{path: "a.ps1", before: original, after: "\ufeffalpha\ngamma\n"}]);
});
test("B-M1 arguments beyond the input bound return input_bound with the documented bounds instead of closing the transport", async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const args = {sourceDigest: f.sourceDigest, changes: ["one.txt", "two.txt", "three.txt"].map(path => ({path, expectedFileSha256: null, replacement: "x".repeat(45000)}))};
  assert.ok(Buffer.byteLength(JSON.stringify(args)) > f.config.bounds.maxInputBytes);
  const refused = await io.call("apply_patch", args); assert.equal(refused.isError, true); assert.equal(data(refused).code, "input_bound");
  assert.deepEqual(await io.call("apply_patch", args, meta("1", {chioAttemptId: "input-bound-redelivery"})), refused);
  assert.deepEqual(await readdir(join(f.root("state"), "generations")), [f.sourceDigest]);
  assert.equal(data(await io.call("repo_status", {}, meta("2"))).sourceDigest, f.sourceDigest, "the transport stays open"); await io.close();
  const state = JSON.parse((await command(["inspect", "--config", f.configPath])).stdout); assert.equal(state.fenced, false); assert.deepEqual(state.operations.map(x => x.tool), ["repo_status"]);
});
test("final review: the input bound reserves the request envelope so an accepted config carries a full-size patch", async t => {
  const maxPatchBytes = 65536; const reserve = maxPatchBytes + 8192;
  const short = await fixture({bounds: {maxPatchBytes, maxInputBytes: reserve + codingConfig.MCP_REQUEST_ENVELOPE_BYTES - 1}}); t.after(() => short.close());
  const refused = await command(["init", "--config", short.configPath]);
  assert.equal(refused.code, 1, "a config that cannot carry its own full-size patch inside the input bound is refused"); assert.match(refused.stderr, /input and output bounds/i);
  assert.deepEqual(await readdir(short.root("state")), []);
  const f = await initialized({bounds: {maxPatchBytes, maxInputBytes: reserve + codingConfig.MCP_REQUEST_ENVELOPE_BYTES}}); t.after(() => f.close());
  const io = stdio(f); t.after(() => io.close());
  // A full-size patch whose structure (32 changes, about 2.2 KB) fits the 8192-byte
  // reserve. Without the envelope term it validated and then got input_bound.
  const changes = Array.from({length: 32}, (_, index) => ({path: `full-${String(index).padStart(2, "0")}.txt`, expectedFileSha256: null, replacement: "x".repeat(maxPatchBytes / 32)}));
  const args = {sourceDigest: f.sourceDigest, changes};
  assert.ok(Buffer.byteLength(JSON.stringify(args)) - maxPatchBytes > 8192 - codingConfig.MCP_REQUEST_ENVELOPE_BYTES);
  const applied = await io.call("apply_patch", args);
  assert.equal(applied.isError, undefined, JSON.stringify(applied));
  assert.deepEqual(await readFile(join(f.root("state"), "generations", data(applied).sourceDigest, "full-31.txt")), Buffer.from("x".repeat(maxPatchBytes / 32)));
});
for (const [kind, change] of [
  ["an edit splitting a surrogate pair", sha => ({path: "e.txt", expectedFileSha256: sha, edits: [{oldText: "\ud83d", newText: "Z"}]})],
  ["an unpaired surrogate replacement", sha => ({path: "e.txt", expectedFileSha256: sha, replacement: "a\ude00"})],
  ["an unpaired surrogate inserted by an edit", sha => ({path: "e.txt", expectedFileSha256: sha, edits: [{oldText: "y", newText: "\ud800"}]})],
]) test(`B-M2 patches refuse ${kind} as a retained invalid_patch`, async t => {
  const f = await initialized({files: {"e.txt": "x\u{1f600}y"}}); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const args = {sourceDigest: f.sourceDigest, changes: [change(hash("x\u{1f600}y"))]};
  const refused = await io.call("apply_patch", args); assert.equal(refused.isError, true); assert.equal(data(refused).code, "invalid_patch");
  assert.deepEqual(await io.call("apply_patch", args, meta("1", {chioAttemptId: "surrogate-replay"})), refused);
  assert.deepEqual(await readdir(join(f.root("state"), "generations")), [f.sourceDigest]);
});
for (const kind of ["executable", ...(process.platform === "linux" ? ["runtime library"] : [])]) test(`B-M3 a missing pinned recipe ${kind} is a retained recipe_pin refusal, not a closed transport`, async t => {
  const f = await initialized(); t.after(() => f.close());
  await f.updateConfig(config => {
    const recipe = config.recipes[0]; const missing = join(f.base, "missing-recipe-file");
    if (kind === "executable") recipe.executable = missing; else recipe.runtimeFiles[0].path = missing;
    const {recipeSha256, ...body} = recipe; recipe.recipeSha256 = hash(canonicalJson(body));
  });
  const io = stdio(f); t.after(() => io.close()); const args = {sourceDigest: f.sourceDigest, recipe: "unit"};
  const refused = await io.call("test_recipe", args); assert.equal(refused.isError, true); assert.equal(data(refused).code, "recipe_pin");
  assert.deepEqual(await io.call("test_recipe", args, meta("1", {chioAttemptId: "missing-pin-replay"})), refused);
  assert.deepEqual(await readdir(f.root("jobs")), []); await io.close();
  const state = JSON.parse((await command(["inspect", "--config", f.configPath])).stdout); assert.equal(state.fenced, false); assert.equal(state.operations[0].state, "completed");
});
test("B-M7 initialize reports the installed package version", async t => {
  const f = await initialized(); t.after(() => f.close()); const io = stdio(f); t.after(() => io.close());
  const {version} = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal((await io.request("initialize", {protocolVersion: "2025-06-18"})).result.serverInfo.version, version);
});
