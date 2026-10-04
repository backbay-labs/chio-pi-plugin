import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {chmod, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import test from "node:test";
import {AssistantEntry, Harness, MemoryStorage, ToolTask, createRegistry, hook} from "@earendil-works/pi-durable";
import {openNodeJsonlStorage} from "@earendil-works/pi-durable/storage/jsonl/node";
import * as plugin from "../dist/index.js";
import {gatewayExecutor} from "../dist/http-executor.js";
import {canonicalJson} from "../dist/tool-registry.js";
import {hash, initialize, nativeFixture, request} from "./helpers/continuation-fixture.mjs";
const durable = await import("../dist/durable.js").catch(() => ({}));
const context = {};
function api() {assert.equal(typeof durable.createChioDurableTools, "function", "Task 4 requires actual Pi Durable ToolRegistrations"); return durable;}
function transportConfig(f, proxy) {return {schema: "chio.pi.transport.v1", sessionId: f.config.sessionId, transport: {url: proxy.url, token: proxy.token}, binding: f.config.execution, tools: f.config.tools, approvals: Boolean(f.config.approval), toolMode: "typed", registryDigest: f.registry.digest};}
async function setup(options = {}) {
  api(); const f = await nativeFixture(); const proxy = await plugin.startParentGatewayProxy({configPath: f.configPath, native: f.native, binding: f.binding});
  const client = await gatewayExecutor(transportConfig(f, proxy));
  const storageDirectory = join(f.directory, "durable-store"); await mkdir(storageDirectory, {mode: 0o700});
  const storage = options.memory ? new MemoryStorage() : await openNodeJsonlStorage(storageDirectory, context, {fsync: true});
  const registry = createRegistry();
  const host = await Harness.open(storage, {models: {}, registry, onReport: error => {throw error;}}, context);
  const storeId = randomBytes(32).toString("hex");
  const provenanceDir = join(f.directory, "durable-parent"); await mkdir(provenanceDir, {mode: 0o700});
  const selectedExecutor = options.executor ? options.executor(client.executor, f, storage) : client.executor;
  const selectedTransport = options.transport ? options.transport(f.native, f, storage) : f.native;
  const adapter = await api().createChioDurableTools({storeId, storage, session: host, provenanceDir, binding: f.binding, registry: f.registry, originals: proxy.originals, executor: selectedExecutor, transport: selectedTransport, context});
  registry.install({...adapter.extension, hooks: [...(adapter.extension.hooks ?? []), ...(options.hooks ?? [])]});
  const conversation = await host.root(context);
  return {f, proxy, client, storage, storageDirectory, provenanceDir, storeId, registry, host, adapter, conversation,
    async close() {await adapter.close(); await host.close(context); await proxy.close(); await f.close();}};
}
const assistant = (callId, args) => ({role: "assistant", api: "openai-responses", provider: "openai", model: "fixture", content: [{type: "toolCall", id: callId, name: "chio_write", arguments: args}], stopReason: "toolUse", timestamp: 1, usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}});
async function runTool(h, args = request().arguments, callId = "native-call-1", wait = true, defer = false) {
  const ids = await h.conversation.commit(async tx => {
    const entry = await tx.appendEntry(AssistantEntry, h.conversation.id, {model: [assistant(callId, args)]});
    const taskId = await tx.createTask(ToolTask, {assistant: entry.id, callId}, {ownership: {kind: "conversation"}});
    return {taskId, assistantEntryId: entry.id};
  }, context);
  if (wait) ids.settled = await h.host.waitForTask(ids.taskId, context);
  else if (!defer) h.host.resume();
  return ids;
}

test("actual Durable memo and parent provenance precede one native effect; full model outcome is committed before ACK", async () => {
  let nativeMemo; let retained; let entryAtAck; let taskAtAck;
  const h = await setup({executor: (inner, f, storage) => ({async execute(req, signal) {
    retained = req;
    const tasks = await storage.scanTasks({kind: "pi.tool"}, 10, undefined, context); nativeMemo = tasks.items[0].memos[durable.DURABLE_REQUEST_MEMO];
    const intents = await readdir(join(f.directory, "durable-parent", "intents")); assert.equal(intents.length, 1);
    assert.deepEqual(nativeMemo.request, req); assert.equal(f.counts().effects, 0);
    return inner.execute(req, signal);
  }}), transport: (inner, _f, storage) => ({async acknowledgeReceivedOutcome(outcome) {
    const tasks = await storage.scanTasks({kind: "pi.tool"}, 10, undefined, context); taskAtAck = tasks.items[0];
    assert.equal(taskAtAck.state.status, "terminal"); assert.equal(taskAtAck.state.outcome.status, "completed");
    entryAtAck = (await storage.entry(taskAtAck.state.outcome.result.entryId, context)).entry;
    assert.deepEqual(JSON.parse(entryAtAck.model[0].content[0].text), outcome);
    assert.equal(entryAtAck.byTaskId, taskAtAck.id);
    return inner.acknowledgeReceivedOutcome(outcome);
  }})});
  try {
    const tool = h.adapter.tools[0]; assert.equal(tool.replay, "unsafe"); assert.equal(tool.executionMode, "sequential"); assert.deepEqual(tool.parameters, h.f.registry.tools[0].parameters);
    const ids = await runTool(h); await h.adapter.flush();
    assert.ok(nativeMemo); assert.equal(nativeMemo.storeId, h.storeId);
    assert.equal(taskAtAck.id, ids.taskId); assert.equal(entryAtAck.kind, "pi.tool-result");
    assert.equal((await h.storage.task(ids.taskId, context)).memos, undefined, "native terminal task intentionally drops memos");
    const mapping = await h.proxy.originals.mappings.find(retained); assert.equal(mapping.hostCommit.entryId, entryAtAck.id); assert.equal(mapping.acknowledgement.acknowledged, true);
    assert.deepEqual(h.f.counts(), {effects: 1, acks: 1, nativeCalls: 1});
  } finally {await h.close();}
});

test("a second actual host commits an explicitly imported original without creating a new effect identity", async () => {
  const h = await setup({executor: inner => ({async execute(req, signal) {await inner.execute(req, signal); throw new Error("response lost after original signed completion");}})});
  let secondHost; let adapter;
  try {
    const first = await runTool(h); await assert.rejects(h.adapter.flush(), /terminal|committed|completion/);
    const logical = h.adapter.requestFor(first.taskId); const original = await plugin.recoverOriginalOperation(logical, h.proxy.originals);
    const handoffPath = join(h.f.directory, "handoff.json"); await plugin.exportContinuation(handoffPath, {binding: h.f.binding, requests: [logical], originals: h.proxy.originals});
    const imported = await plugin.importContinuation(handoffPath, {binding: h.f.binding, originals: h.proxy.originals});
    const storage = new MemoryStorage(); const registry = createRegistry(); secondHost = await Harness.open(storage, {models: {}, registry}, context);
    const directory = join(h.f.directory, "receiving-parent"); await mkdir(directory, {mode: 0o700});
    adapter = await api().createChioDurableTools({storeId: randomBytes(32).toString("hex"), storage, session: secondHost, provenanceDir: directory, binding: h.f.binding, registry: h.f.registry, originals: h.proxy.originals, executor: {execute() {throw new Error("Receiving host must recover the original only");}}, transport: h.f.native, context});
    registry.install(adapter.extension); const conversation = await secondHost.root(context);
    const receiving = await runTool({...h, host: secondHost, conversation}, logical.arguments, "receiving-call", false, true);
    assert.equal(typeof adapter.bindRecovery, "function", "trusted receiving host must bind the exact new task to the verified original before scheduling");
    await adapter.bindRecovery({taskId: receiving.taskId, conversationId: conversation.id, callId: "receiving-call", request: imported.originals[0].request});
    await secondHost.waitForTask(receiving.taskId, context); await adapter.flush();
    const task = await storage.task(receiving.taskId, context); const entry = (await storage.entry(task.state.outcome.result.entryId, context)).entry;
    assert.deepEqual(JSON.parse(entry.model[0].content[0].text), original);
    assert.deepEqual(adapter.requestFor(receiving.taskId), logical);
    assert.deepEqual(h.f.counts(), {effects: 1, acks: 1, nativeCalls: 1});
  } finally {await adapter?.close(); await secondHost?.close(context); await h.close();}
});

for (const fault of ["confirmed", "unconfirmed", "staleFlags", "forgedClaims", "conflictingOutcome"]) test(`actual receiving store accepts already-delivered original only with current native proof: ${fault}`, async () => {
  const h = await setup({memory: true, ...(fault === "unconfirmed" ? {transport: () => ({async acknowledgeReceivedOutcome() {return {acknowledged: false};}})} : {})});
  let secondHost; let adapter; let receiving; let staleChanged = false; let receivingAcks = 0;
  try {
    const first = await runTool(h);
    if (fault === "unconfirmed") await assert.rejects(h.adapter.flush(), /ACK|acknowledgement/);
    else await h.adapter.flush();
    const logical = h.adapter.requestFor(first.taskId); const original = await plugin.recoverOriginalOperation(logical, h.proxy.originals);
    const firstProof = (await h.proxy.originals.mappings.find(logical)).hostCommit;
    const handoffPath = join(h.f.directory, "delivered-handoff.json"); await plugin.exportContinuation(handoffPath, {binding: h.f.binding, requests: [logical], originals: h.proxy.originals});
    const imported = await plugin.importContinuation(handoffPath, {binding: h.f.binding, originals: h.proxy.originals});
    async function unconfirmNative() {
      const record = await h.f.record(original.requestId); record.acknowledged = false; record.hostDeliveryConfirmed = false;
      await writeFile(join(h.f.config.journalDir, hash(original.requestId) + ".json"), JSON.stringify(record), {mode: 0o600});
    }
    if (fault === "forgedClaims") await unconfirmNative();
    const storage = new MemoryStorage(); const registry = createRegistry(); secondHost = await Harness.open(storage, {models: {}, registry}, context);
    const provenanceDir = join(h.f.directory, "receiving-parent"); await mkdir(provenanceDir, {mode: 0o700});
    const originals = {...h.proxy.originals, async lookup(req) {
      const observed = await h.proxy.originals.lookup(req);
      const task = receiving && await storage.task(receiving.taskId, context);
      if (fault === "staleFlags" && !staleChanged && task?.state.status === "terminal") {staleChanged = true; await unconfirmNative();}
      return observed;
    }};
    adapter = await api().createChioDurableTools({storeId: randomBytes(32).toString("hex"), storage, session: secondHost, provenanceDir, binding: h.f.binding,
      registry: h.f.registry, originals, executor: {execute() {throw new Error("Already-delivered recovery cannot execute");}},
      transport: {async acknowledgeReceivedOutcome() {receivingAcks++; throw new Error("Receiving store must not ACK an already-delivered or conflicting original");}}, context});
    const forged = hook(ToolTask, {afterTool(_call, result) {
      if (fault === "conflictingOutcome") return {...result, content: [{type: "text", text: JSON.stringify({...original, requestId: "another-original"})}]};
      if (fault === "forgedClaims") return {...result, details: {...result.details, acknowledged: true, hostDeliveryConfirmed: true}};
      return result;
    }});
    registry.install({...adapter.extension, hooks: [...adapter.extension.hooks, forged]}); const conversation = await secondHost.root(context);
    receiving = await runTool({...h, host: secondHost, conversation}, logical.arguments, "receiving-delivered", false, true);
    await adapter.bindRecovery({taskId: receiving.taskId, conversationId: conversation.id, callId: "receiving-delivered", request: imported.originals[0].request});
    await secondHost.waitForTask(receiving.taskId, context);
    if (fault === "confirmed") {
      await adapter.flush(); const task = await storage.task(receiving.taskId, context); const entry = (await storage.entry(task.state.outcome.result.entryId, context)).entry;
      assert.deepEqual(JSON.parse(entry.model[0].content[0].text), original);
      const intent = JSON.parse(await readFile(join(provenanceDir, "intents", (await readdir(join(provenanceDir, "intents")))[0]), "utf8"));
      assert.equal(intent.hostCommit.entryId, entry.id); assert.notEqual(intent.hostCommit.storeId, firstProof.storeId);
    } else await assert.rejects(adapter.flush(), /committed|original|delivery|conflict|entry|outcome/);
    if (fault === "staleFlags") assert.equal(staleChanged, true, "fixture must revoke flags after the first actual committed-result lookup");
    assert.deepEqual((await h.proxy.originals.mappings.find(logical)).hostCommit, firstProof);
    assert.equal(receivingAcks, 0);
    assert.deepEqual(h.f.counts(), {effects: 1, acks: fault === "unconfirmed" ? 0 : 1, nativeCalls: 1});
  } finally {await adapter?.close(); await secondHost?.close(context); await h.close();}
});

test("Durable prepareArguments rejects raw arguments before native coercion admits them", async () => {
  const h = await setup();
  try {await runTool(h, {path: "source.ts", content: 42}); await h.adapter.flush(); assert.deepEqual(h.f.counts(), {effects: 0, acks: 0, nativeCalls: 0});}
  finally {await h.close();}
});

test("argument-changing hooks cannot execute an operation that differs from the retained assistant call", async () => {
  const h = await setup({hooks: [hook(ToolTask, {beforeTool: call => ({arguments: {...call.arguments, content: "substitution"}})})]});
  try {await runTool(h); await h.adapter.flush(); assert.deepEqual(h.f.counts(), {effects: 0, acks: 0, nativeCalls: 0});}
  finally {await h.close();}
});

for (const fault of ["detailsOnly", "truncated", "fakeOutcome", "interruption"]) test(`committed Durable ${fault} result cannot acknowledge native original delivery`, async () => {
  let outcomeAtExecute;
  const h = await setup({executor: inner => ({async execute(req, signal) {const result = await inner.execute(req, signal); outcomeAtExecute = result.retainedOutcome; return result;}}), hooks: [hook(ToolTask, {afterTool(_call, result) {
    assert.ok(outcomeAtExecute, "native execute precedes afterTool");
    if (fault === "detailsOnly") return {...result, content: [], details: {originalOutcome: outcomeAtExecute}};
    if (fault === "truncated") return {...result, content: [{type: "text", text: JSON.stringify(outcomeAtExecute).slice(0, 40)}]};
    if (fault === "fakeOutcome") return {...result, content: [{type: "text", text: JSON.stringify({...outcomeAtExecute, requestId: "another-original"})}]};
    return {content: [{type: "text", text: "Tool interrupted and may have partially run"}], isError: true};
  }})]});
  try {
    await runTool(h); await assert.rejects(h.adapter.flush(), /committed|original|outcome|content|interruption/);
    assert.deepEqual(h.f.counts(), {effects: 1, acks: 0, nativeCalls: 1}); assert.equal((await h.proxy.originals.inventory()).fenced, true);
  } finally {await h.close();}
});

test("a distinct actual host store reusing numeric task IDs cannot alias the original operation or steal its commit proof", async () => {
  const h = await setup({memory: true}); let secondHost; let otherAdapter;
  try {
    const ids = await runTool(h); await h.adapter.flush();
    const secondStorage = new MemoryStorage(); const secondRegistry = createRegistry();
    secondHost = await Harness.open(secondStorage, {models: {}, registry: secondRegistry}, context);
    const otherDir = join(h.f.directory, "other-parent"); await mkdir(otherDir, {mode: 0o700});
    await assert.rejects(api().createChioDurableTools({storeId: h.storeId, storage: secondStorage, session: secondHost, provenanceDir: otherDir, binding: h.f.binding, registry: h.f.registry, originals: h.proxy.originals, executor: h.client.executor, transport: h.f.native, context}), /store|backend|identity/);
    otherAdapter = await api().createChioDurableTools({storeId: randomBytes(32).toString("hex"), storage: secondStorage, session: secondHost, provenanceDir: otherDir, binding: h.f.binding, registry: h.f.registry, originals: h.proxy.originals, executor: h.client.executor, transport: h.f.native, context});
    secondRegistry.install(otherAdapter.extension); const conversation = await secondHost.root(context);
    const second = await runTool({...h, host: secondHost, conversation}); await otherAdapter.flush();
    assert.equal(second.taskId, ids.taskId, "fixture must exercise actual numeric reuse across stores");
    assert.equal(h.f.counts().effects, 2, "different stores are distinct new operations after the prior actual delivery ACK");
    const firstIntent = h.adapter.requestFor(ids.taskId); const secondIntent = otherAdapter.requestFor(second.taskId);
    assert.notEqual(firstIntent.sessionId, secondIntent.sessionId);
  } finally {await otherAdapter?.close(); await secondHost?.close(context); await h.close();}
});

test("second actual Durable host scans history after host commit before ACK and retries only the original native acknowledgement", async () => {
  let attempts = 0;
  const h = await setup({transport: inner => ({async acknowledgeReceivedOutcome(outcome) {attempts++; if (attempts === 1) return {acknowledged: false}; return inner.acknowledgeReceivedOutcome(outcome);}})});
  let secondHost; let secondAdapter;
  try {
    const ids = await runTool(h); await assert.rejects(h.adapter.flush(), /acknowledgement|ACK|delivery/);
    const original = await plugin.recoverOriginalOperation(h.adapter.requestFor(ids.taskId), h.proxy.originals);
    assert.equal(h.f.counts().acks, 0);
    await h.adapter.close(); await h.host.close(context);
    const storage = await openNodeJsonlStorage(h.storageDirectory, context, {fsync: true}); const registry = createRegistry();
    secondHost = await Harness.open(storage, {models: {}, registry}, context);
    secondAdapter = await api().createChioDurableTools({storeId: h.storeId, storage, session: secondHost, provenanceDir: h.provenanceDir, binding: h.f.binding, registry: h.f.registry, originals: h.proxy.originals, executor: {execute() {throw new Error("Restart must not redispatch");}}, transport: h.f.native, context});
    registry.install(secondAdapter.extension); await secondAdapter.flush();
    assert.deepEqual(await plugin.recoverOriginalOperation(secondAdapter.requestFor(ids.taskId), h.proxy.originals), original);
    assert.deepEqual(h.f.counts(), {effects: 1, acks: 1, nativeCalls: 1});
    assert.equal((await h.proxy.originals.inventory()).fenced, false);
  } finally {await secondAdapter?.close(); await secondHost?.close(context); await h.close();}
});

test("restart after native ACK before parent acknowledgement mark verifies the exact committed entry and never replays an effect", async () => {
  const h = await setup({transport: (inner, f) => ({async acknowledgeReceivedOutcome(outcome) {
    const acknowledged = await inner.acknowledgeReceivedOutcome(outcome);
    await chmod(join(f.config.journalDir, "pi-parent-mappings"), 0o755);
    return acknowledged;
  }})});
  let host; let adapter;
  try {
    const ids = await runTool(h); await assert.rejects(h.adapter.flush(), /private|directory/);
    assert.deepEqual(h.f.counts(), {effects: 1, acks: 1, nativeCalls: 1});
    await chmod(join(h.f.config.journalDir, "pi-parent-mappings"), 0o700);
    await h.adapter.close(); await h.host.close(context);
    const storage = await openNodeJsonlStorage(h.storageDirectory, context, {fsync: true}); const registry = createRegistry(); host = await Harness.open(storage, {models: {}, registry}, context);
    adapter = await api().createChioDurableTools({storeId: h.storeId, storage, session: host, provenanceDir: h.provenanceDir, binding: h.f.binding, registry: h.f.registry, originals: h.proxy.originals, executor: {execute() {throw new Error("ACK recovery may not execute");}}, transport: h.f.native, context});
    registry.install(adapter.extension); await adapter.flush();
    assert.equal((await h.proxy.originals.mappings.find(adapter.requestFor(ids.taskId))).acknowledgement.acknowledged, true);
    assert.deepEqual(h.f.counts(), {effects: 1, acks: 1, nativeCalls: 1});
  } finally {await chmod(join(h.f.config.journalDir, "pi-parent-mappings"), 0o700); await adapter?.close(); await host?.close(context); await h.close();}
});

test("actual native unsafe ToolTask recovery produces an interruption without acknowledging or re-executing its original", {timeout: 15000}, async () => {
  let complete; const completed = new Promise(done => {complete = done;}); let executorCalls = 0;
  const h = await setup({executor: inner => ({async execute(req, signal) {
    executorCalls++; await inner.execute(req, signal); assert.ok(signal instanceof AbortSignal);
    complete(); await new Promise((_done, reject) => signal.addEventListener("abort", () => reject(signal.reason), {once: true}));
    throw new Error("interrupted");
  }})});
  let host; let adapter;
  try {
    const ids = await runTool(h, request().arguments, "unsafe-call", false); await completed;
    const logical = h.adapter.requestFor(ids.taskId); assert.equal((await plugin.recoverOriginalOperation(logical, h.proxy.originals)).state, "completed");
    await h.adapter.close(); await h.host.close(context);
    const storage = await openNodeJsonlStorage(h.storageDirectory, context, {fsync: true}); const registry = createRegistry(); host = await Harness.open(storage, {models: {}, registry}, context);
    adapter = await api().createChioDurableTools({storeId: h.storeId, storage, session: host, provenanceDir: h.provenanceDir, binding: h.f.binding, registry: h.f.registry, originals: h.proxy.originals, executor: {execute() {executorCalls++; throw new Error("Unsafe recovery must not execute");}}, transport: h.f.native, context});
    registry.install(adapter.extension); await host.waitForTask(ids.taskId, context); await assert.rejects(adapter.flush(), /terminal|completion|committed/);
    const task = await storage.task(ids.taskId, context); assert.equal(task.state.outcome.status, "failed");
    const entry = (await storage.entry(task.state.outcome.result.entryId, context)).entry;
    assert.ok(entry.data.diagnostics.some(value => value.code === "interrupted")); assert.equal(executorCalls, 1);
    assert.deepEqual(h.f.counts(), {effects: 1, acks: 0, nativeCalls: 1}); assert.equal((await h.proxy.originals.inventory()).fenced, true);
  } finally {await adapter?.close(); await host?.close(context); await h.close();}
});

test("optional Durable is isolated from the base runtime and root declarations", async () => {
  api();
  const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(metadata.devDependencies["@earendil-works/pi-durable"], "1.0.2"); assert.equal(metadata.peerDependencies["@earendil-works/pi-durable"], "1.0.2"); assert.equal(metadata.peerDependenciesMeta["@earendil-works/pi-durable"].optional, true);
  assert.equal(metadata.exports["./durable"], "./dist/durable.js");
  for (const file of ["index.js", "index.d.ts"]) assert.equal((await readFile(new URL("../dist/" + file, import.meta.url), "utf8")).includes("pi-durable"), false);
});
