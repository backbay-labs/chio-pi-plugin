import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {chmod, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import test from "node:test";
import {AssistantEntry, Harness, MemoryStorage, ToolTask, createRegistry, hook} from "@earendil-works/pi-durable";
import {createModels, fauxAssistantMessage, fauxProvider, fauxToolCall} from "@earendil-works/pi-ai";
import {openNodeJsonlStorage} from "@earendil-works/pi-durable/storage/jsonl/node";
import * as plugin from "../dist/index.js";
import {gatewayExecutor} from "../dist/http-executor.js";
import {canonicalJson} from "../dist/tool-registry.js";
import {approvedParams, hash, initialize, nativeFixture, request} from "./helpers/continuation-fixture.mjs";
const durable = await import("../dist/durable.js").catch(() => ({}));
const context = {};
function api() {assert.equal(typeof durable.createChioDurableTools, "function", "Task 4 requires actual Pi Durable ToolRegistrations"); return durable;}
function transportConfig(f, proxy) {return {schema: "chio.pi.transport.v1", sessionId: f.config.sessionId, transport: {url: proxy.url, token: proxy.token}, binding: f.config.execution, tools: f.config.tools, approvals: Boolean(f.config.approval), toolMode: "typed", registryDigest: f.registry.digest};}
async function setup(options = {}) {
  api(); const f = await nativeFixture(options.fixture ?? {}); const proxy = await plugin.startParentGatewayProxy({configPath: f.configPath, native: f.native, binding: f.binding});
  const client = await gatewayExecutor(transportConfig(f, proxy));
  const storageDirectory = join(f.directory, "durable-store"); await mkdir(storageDirectory, {mode: 0o700});
  const storage = options.storage ?? (options.memory ? new MemoryStorage() : await openNodeJsonlStorage(storageDirectory, context, {fsync: true}));
  const registry = createRegistry();
  const host = await Harness.open(storage, {models: options.models ?? {}, registry, onReport: options.onReport ?? (error => {throw error;})}, context);
  const storeId = randomBytes(32).toString("hex");
  const provenanceDir = join(f.directory, "durable-parent"); await mkdir(provenanceDir, {mode: 0o700});
  const selectedExecutor = options.executor ? options.executor(client.executor, f, storage) : client.executor;
  const selectedTransport = options.transport ? options.transport(f.native, f, storage) : f.native;
  const originals = options.originals ? options.originals(proxy.originals) : proxy.originals;
  const adapter = await api().createChioDurableTools({storeId, storage, session: host, provenanceDir, binding: f.binding, registry: f.registry, originals, executor: selectedExecutor, transport: selectedTransport, context});
  registry.install({...adapter.extension, hooks: [...(adapter.extension.hooks ?? []), ...(options.hooks ?? [])]});
  const conversation = await host.root(context);
  return {f, proxy, client, storage, storageDirectory, provenanceDir, storeId, registry, host, adapter, conversation, originals, executor: selectedExecutor, transport: selectedTransport,
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
    const first = await runTool(h); await h.adapter.flush();
    assert.equal((await intentOf(h.provenanceDir, first.taskId)).reconciled.state, "undelivered", "a failed task records its non-delivery once; its native original stays fenced");
    assert.equal(h.f.counts().acks, 0); assert.equal((await h.proxy.originals.inventory()).fenced, true);
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
    } else if (fault === "conflictingOutcome") {
      // A substituted outcome is an immutable committed non-delivery: recorded
      // once, never ACKed, and never a reason to fail the receiving store.
      await adapter.flush(); await adapter.flush();
      assert.equal((await intentOf(provenanceDir, receiving.taskId)).reconciled.state, "undelivered");
    } else await assert.rejects(adapter.flush(), /Conflicting committed entry proof/);
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
    const ids = await runTool(h); await h.adapter.flush(); await h.adapter.flush();
    assert.equal((await intentOf(h.provenanceDir, ids.taskId)).reconciled.state, "undelivered");
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

test("spec review: closing only the observer cannot transfer a live store identity to another actual backend", async () => {
  const h = await setup({memory: true}); let otherHost; let mistaken;
  try {
    await h.adapter.close();
    const storage = new MemoryStorage(); const registry = createRegistry(); otherHost = await Harness.open(storage, {models: {}, registry}, context);
    await assert.rejects((async () => {mistaken = await api().createChioDurableTools({storeId: h.storeId, storage, session: otherHost, provenanceDir: h.provenanceDir,
      binding: h.f.binding, registry: h.f.registry, originals: h.proxy.originals, executor: h.client.executor, transport: h.f.native, context});})(), /store|backend|identity/);
    await runTool(h); assert.deepEqual(h.f.counts(), {effects: 0, acks: 0, nativeCalls: 0}, "the closed observer's stale registrations cannot execute");
  } finally {await mistaken?.close(); await otherHost?.close(context); await h.close();}
});

test("spec review: observer reattachment uses the same actual live handles and actual Session closure permits backend reopening", async () => {
  const h = await setup(); let attached; let reopened; let nextHost;
  try {
    await h.adapter.close();
    attached = await api().createChioDurableTools({storeId: h.storeId, storage: h.storage, session: h.host, provenanceDir: h.provenanceDir,
      binding: h.f.binding, registry: h.f.registry, originals: h.proxy.originals, executor: h.client.executor, transport: h.f.native, context});
    h.registry.install(attached.extension); const ids = await runTool(h); await attached.flush(); const logical = attached.requestFor(ids.taskId);
    await attached.close(); await h.host.close(context);
    const storage = await openNodeJsonlStorage(h.storageDirectory, context, {fsync: true}); const registry = createRegistry(); nextHost = await Harness.open(storage, {models: {}, registry}, context);
    reopened = await api().createChioDurableTools({storeId: h.storeId, storage, session: nextHost, provenanceDir: h.provenanceDir,
      binding: h.f.binding, registry: h.f.registry, originals: h.proxy.originals, executor: {execute() {throw new Error("Reopening may recover only original ACKs");}}, transport: h.f.native, context});
    registry.install(reopened.extension); await reopened.flush(); assert.deepEqual(reopened.requestFor(ids.taskId), logical);
    assert.deepEqual(h.f.counts(), {effects: 1, acks: 1, nativeCalls: 1});
  } finally {await reopened?.close(); await nextHost?.close(context); await attached?.close(); await h.close();}
});

for (const fault of ["pending", "failed"]) test(`spec review: actual Session ${fault} close retains the backend identity`, async () => {
  let finish; let entered;
  const gate = new Promise(done => {finish = done;}); const started = new Promise(done => {entered = done;});
  class ClosingStorage extends MemoryStorage {
    async close(context) {entered(); await gate; if (fault === "failed") throw new Error("synthetic selected backend close failure"); await super.close(context);}
  }
  const h = await setup({storage: new ClosingStorage()}); let otherHost; let mistaken;
  try {
    await h.adapter.close(); const closing = h.host.close(context); void closing.catch(() => undefined); await started;
    if (fault === "failed") {finish(); await assert.rejects(closing, /close failure/);}
    const storage = new MemoryStorage(); const registry = createRegistry(); otherHost = await Harness.open(storage, {models: {}, registry}, context);
    await assert.rejects((async () => {mistaken = await api().createChioDurableTools({storeId: h.storeId, storage, session: otherHost, provenanceDir: h.provenanceDir,
      binding: h.f.binding, registry: h.f.registry, originals: h.proxy.originals, executor: h.client.executor, transport: h.f.native, context});})(), /store|backend|identity/);
    assert.deepEqual(h.f.counts(), {effects: 0, acks: 0, nativeCalls: 0}); finish(); if (fault === "pending") await closing;
  } finally {
    finish(); await mistaken?.close(); await otherHost?.close(context); await h.adapter.close();
    await h.host.close(context).catch(() => undefined); await h.proxy.close(); await h.f.close();
  }
});

test("spec review: independent actual hosts and original ports cannot replace the first committed proof", {timeout: 20000}, async () => {
  const h = await setup({executor: inner => ({async execute(req, signal) {await inner.execute(req, signal); throw new Error("source response lost after signed completion");}})});
  const receivers = [];
  function deferred() {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};}
  const firstRead = deferred(); const bothReads = deferred(); const releaseFirst = deferred(); const releaseSecond = deferred(); const published = deferred(); const allowACK = deferred();
  let readCount = 0; let firstPort; let firstReference; const ackReferences = [];
  try {
    const source = await runTool(h); await h.adapter.flush();
    assert.equal((await intentOf(h.provenanceDir, source.taskId)).reconciled.state, "undelivered");
    const logical = h.adapter.requestFor(source.taskId); const original = await plugin.recoverOriginalOperation(logical, h.proxy.originals);
    const mappingPath = join(h.f.config.journalDir, "pi-parent-mappings", hash(JSON.stringify([logical.sessionId, logical.toolCallId])) + ".json");
    for (let index = 0; index < 2; index++) {
      const port = await plugin.createNativeOriginalOperationPort({configPath: h.f.configPath, binding: h.f.binding});
      const storage = new MemoryStorage(); const registry = createRegistry(); const host = await Harness.open(storage, {models: {}, registry}, context);
      const storeId = randomBytes(32).toString("hex"); const provenanceDir = join(h.f.directory, "proof-owner-" + index); await mkdir(provenanceDir, {mode: 0o700});
      let changingProof; const genuineFind = port.mappings.findCurrent.bind(port.mappings); const genuineUpdate = port.mappings.update.bind(port.mappings);
      // Pause only after the actual mutation has read and validated genuine
      // private state. No record or verification response is fabricated.
      port.mappings.findCurrent = async req => {
        const prior = await genuineFind(req);
        if (changingProof && prior && prior.hostCommit === undefined) {
          const rank = ++readCount;
          if (rank === 1) {firstPort = port; firstReference = changingProof; firstRead.resolve(); await releaseFirst.promise;}
          else if (rank === 2) {bothReads.resolve(); await releaseSecond.promise;}
        }
        return prior;
      };
      port.mappings.update = async (req, change) => {
        changingProof = change.hostCommit;
        try {
          await genuineUpdate(req, change);
          if (change.hostCommit && port === firstPort) published.resolve(JSON.parse(await readFile(mappingPath, "utf8")));
        } finally {changingProof = undefined;}
      };
      const adapter = await api().createChioDurableTools({storeId, storage, session: host, provenanceDir, binding: h.f.binding, registry: h.f.registry, originals: port,
        executor: {execute() {throw new Error("A receiving proof cannot redispatch");}}, context,
        transport: {async acknowledgeReceivedOutcome(outcome) {
          await allowACK.promise;
          const mapping = await port.mappings.find(logical); const task = await storage.task(mapping.hostCommit.taskId, context);
          const entry = (await storage.entry(task.state.outcome.result.entryId, context)).entry;
          assert.equal(mapping.hostCommit.storeId, storeId); assert.equal(entry.id, mapping.hostCommit.entryId);
          assert.deepEqual(JSON.parse(entry.model[0].content[0].text), outcome); ackReferences.push(mapping.hostCommit);
          return h.f.native.acknowledgeReceivedOutcome(outcome);
        }}});
      registry.install(adapter.extension); const conversation = await host.root(context);
      const receiving = await runTool({...h, host, conversation}, logical.arguments, "proof-call-" + index, false, true);
      await adapter.bindRecovery({taskId: receiving.taskId, conversationId: conversation.id, callId: "proof-call-" + index, request: logical});
      receivers.push({port, storage, host, adapter, receiving});
    }
    assert.notEqual(receivers[0].port.mappings, receivers[1].port.mappings);
    const settledTasks = receivers.map(receiver => receiver.host.waitForTask(receiver.receiving.taskId, context));
    await firstRead.promise;
    // A shared mutation line keeps the second genuine read behind the first
    // publication. The bound lets that implementation proceed without needing
    // the very concurrent read this regression is designed to prohibit.
    let timer; await Promise.race([bothReads.promise, new Promise(done => {timer = setTimeout(done, 1000);})]); clearTimeout(timer);
    releaseFirst.resolve(); const first = await published.promise;
    assert.deepEqual(first.hostCommit, firstReference); assert.equal(h.f.counts().acks, 0);
    releaseSecond.resolve(); allowACK.resolve(); await Promise.all(settledTasks);
    await Promise.allSettled(receivers.map(receiver => receiver.adapter.flush()));
    const final = JSON.parse(await readFile(mappingPath, "utf8"));
    assert.deepEqual(final.hostCommit, first.hostCommit, `first proof must remain immutable after ${readCount} genuine pre-publication reads`);
    assert.ok(ackReferences.length >= 1);
    for (const reference of ackReferences) assert.deepEqual(reference, first.hostCommit, "original ACK retries use only the immutable first proof");
    assert.deepEqual(await plugin.recoverOriginalOperation(logical, h.proxy.originals), original);
    assert.deepEqual(h.f.counts(), {effects: 1, acks: 1, nativeCalls: 1});
  } finally {
    releaseFirst.resolve(); releaseSecond.resolve(); allowACK.resolve();
    for (const receiver of receivers) {await receiver.adapter.close(); await receiver.host.close(context);}
    await h.close();
  }
});

test("second actual Durable host scans history after host commit before ACK and retries only the original native acknowledgement", async () => {
  // The first host's ACK stays unresolved on every attempt. A failure stays
  // with its own intent and each flush retries it, so the first host never
  // delivers and only the restarted host's history scan can.
  let attempts = 0;
  const h = await setup({transport: () => ({async acknowledgeReceivedOutcome() {attempts++; return {acknowledged: false};}})});
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
    registry.install(adapter.extension); await host.waitForTask(ids.taskId, context); await adapter.flush();
    assert.equal((await intentOf(h.provenanceDir, ids.taskId)).reconciled.state, "undelivered", "a generic interruption is recorded as non-delivery, never as an ACK");
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

// Final review A2-C1 and A2-I1: one undelivered or approval-pending intent must
// not disable later calls or a reopened adapter, and retained history must not
// be re-observed by every flush.
const roundMessage = calls => ({...assistant("unused", {}), content: calls.map(([id, name, args]) => ({type: "toolCall", id, name, arguments: args}))});
async function committedView(storage, taskId) {
  const task = await storage.task(taskId, context); const message = (await storage.entry(task.state.outcome.result.entryId, context)).entry.model[0];
  let outcome; try {outcome = JSON.parse(message.content[0]?.text ?? "");} catch {outcome = undefined;}
  return {status: task.state.outcome.status, isError: message.isError, outcome};
}
async function intentOf(provenanceDir, taskId) {
  const directory = join(provenanceDir, "intents");
  for (const name of await readdir(directory)) {const intent = JSON.parse(await readFile(join(directory, name), "utf8")); if (intent.taskId === taskId) return intent;}
  return undefined;
}
async function runCall(h, callId, name, args) {
  const taskId = await h.conversation.commit(async tx => {
    const entry = await tx.appendEntry(AssistantEntry, h.conversation.id, {model: [roundMessage([[callId, name, args]])]});
    return tx.createTask(ToolTask, {assistant: entry.id, callId}, {ownership: {kind: "conversation"}});
  }, context);
  await h.host.waitForTask(taskId, context);
  return {taskId, ...await committedView(h.storage, taskId)};
}
async function reopen(h, overrides = {}) {
  await h.adapter.close();
  const adapter = await api().createChioDurableTools({storeId: h.storeId, storage: h.storage, session: h.host, provenanceDir: h.provenanceDir, binding: h.f.binding, registry: h.f.registry,
    originals: h.originals, executor: h.executor, transport: h.transport, context, ...overrides});
  h.registry.install(adapter.extension); h.adapter = adapter; return adapter;
}

test("A2-C1: an actual Durable round with two tool calls delivers both originals; later rounds and a reopened adapter keep working", async () => {
  const faux = fauxProvider(); const models = createModels(); models.setProvider(faux.provider); const reports = [];
  const h = await setup({memory: true, models, onReport: error => reports.push(error instanceof Error ? error.message : String(error))});
  try {
    const model = faux.getModel();
    await h.conversation.configure({model: {provider: model.provider, modelId: model.id}, extensions: [h.adapter.extension]}, context);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("chio_write", {path: "a.ts", content: "A"}, {id: "round-1-a"}), fauxToolCall("chio_write", {path: "b.ts", content: "B"}, {id: "round-1-b"})], {stopReason: "toolUse"}),
      fauxAssistantMessage([fauxToolCall("chio_write", {path: "c.ts", content: "C"}, {id: "round-2-c"})], {stopReason: "toolUse"}),
      fauxAssistantMessage("done"),
    ]);
    const submission = await h.conversation.submit({type: "input", content: "write three files"}, context);
    assert.equal((await submission.wait(context)).status, "done");
    const results = (await h.conversation.context(context)).messages.filter(message => message.role === "toolResult");
    assert.deepEqual(results.map(message => [message.toolCallId, message.isError, JSON.parse(message.content[0].text).state]),
      [["round-1-a", false, "completed"], ["round-1-b", false, "completed"], ["round-2-c", false, "completed"]], "the second call of a sequential round is not fenced by its predecessor");
    await h.adapter.flush();
    assert.deepEqual(reports, []);
    assert.deepEqual(h.f.counts(), {effects: 3, acks: 3, nativeCalls: 3});
    assert.equal((await h.proxy.originals.inventory()).fenced, false);
    assert.equal(h.client.state.unresolved, false);
    const reopened = await reopen(h, {executor: {execute() {throw new Error("Reopening observes only")}}});
    await reopened.flush(); await reopened.flush();
    assert.deepEqual(h.f.counts(), {effects: 3, acks: 3, nativeCalls: 3});
  } finally {await h.close();}
});

test("A2-C1: concurrent tool tasks in one store yield delivered originals or definite non-dispatch, never a poisoned store", async () => {
  const h = await setup({memory: true});
  try {
    const calls = [["concurrent-0", "chio_write", {path: "f0.ts", content: "v0"}], ["concurrent-1", "chio_write", {path: "f1.ts", content: "v1"}]];
    const ids = await h.conversation.commit(async tx => {
      const entry = await tx.appendEntry(AssistantEntry, h.conversation.id, {model: [roundMessage(calls)]});
      const created = []; for (const [callId] of calls) created.push(await tx.createTask(ToolTask, {assistant: entry.id, callId}, {ownership: {kind: "conversation"}})); return created;
    }, context);
    for (const id of ids) await h.host.waitForTask(id, context);
    const views = await Promise.all(ids.map(id => committedView(h.storage, id)));
    for (const view of views) assert.ok(view.outcome?.state === "completed" || view.outcome?.state === "not_dispatched", JSON.stringify(view));
    const delivered = views.filter(view => view.outcome.state === "completed").length; assert.ok(delivered >= 1);
    for (const [index, view] of views.entries()) if (view.outcome.state === "not_dispatched") {
      assert.equal(view.isError, true);
      const intent = await intentOf(h.provenanceDir, ids[index]);
      assert.ok(intent === undefined || intent.reconciled?.state === "not-dispatched", "a definite non-dispatch is never retained as a delivery to verify");
    }
    await h.adapter.flush();
    assert.deepEqual(h.f.counts(), {effects: delivered, acks: delivered, nativeCalls: delivered});
    assert.equal(h.client.state.unresolved, false, "a definite parent refusal never makes the guest adapter treat later work as unknown");
    const later = await runCall(h, "after-concurrent", "chio_write", {path: "later.ts", content: "later"});
    assert.equal(later.status, "completed"); assert.equal(later.outcome.state, "completed");
    await h.adapter.flush();
    assert.deepEqual(h.f.counts(), {effects: delivered + 1, acks: delivered + 1, nativeCalls: delivered + 1});
    await (await reopen(h)).flush();
  } finally {await h.close();}
});

async function approve(h, pending, args) {
  const directory = join(h.f.config.journalDir, "approvals"); await mkdir(directory, {mode: 0o700}).catch(error => {if (error.code !== "EEXIST") throw error;});
  await writeFile(join(directory, hash(pending.requestId) + ".json"), JSON.stringify({toolCallParams: approvedParams(h.f.config, pending.requestId, args)}), {mode: 0o600});
}

test("A2-C1: an approval-pending original resumed by chio_resume keeps later calls and a reopened adapter working", async () => {
  const h = await setup({memory: true, fixture: {approval: true}});
  try {
    const args = {path: "source.ts", content: "exact original"};
    const first = await runCall(h, "approval-call", "chio_write", args);
    assert.equal(first.outcome.state, "awaiting_approval"); await h.adapter.flush();
    assert.equal((await intentOf(h.provenanceDir, first.taskId)).reconciled.state, "approval-pending");
    await approve(h, first.outcome, args);
    const resumed = await runCall(h, "resume-call", "chio_resume", {requestId: first.outcome.requestId, tool: "write_file", arguments: args});
    assert.equal(resumed.status, "completed"); assert.equal(resumed.outcome.state, "completed");
    await h.adapter.flush(); await h.adapter.flush();
    assert.equal((await intentOf(h.provenanceDir, resumed.taskId)).reconciled.state, "acknowledged");
    const record = await h.f.record(first.outcome.requestId);
    assert.deepEqual([record.state, record.acknowledged, record.hostDeliveryConfirmed], ["completed", true, true]);
    assert.equal((await h.proxy.originals.inventory()).fenced, false);
    const next = await runCall(h, "next-call", "chio_write", {path: "other.ts", content: "next"});
    assert.equal(next.status, "completed"); assert.equal(next.outcome.state, "awaiting_approval", "later work reaches native admission instead of a poisoned store");
    await h.adapter.flush(); await (await reopen(h)).flush();
    assert.deepEqual(h.f.counts(), {effects: 1, acks: 1, nativeCalls: 1});
  } finally {await h.close();}
});

test("A2-C1: a pending proposal first observed after its chio_resume completed is recorded as superseded without ACK", async () => {
  let blocked = false; let firstRequest;
  const h = await setup({memory: true, fixture: {approval: true},
    originals: port => ({...port, async lookup(req) {if (blocked && req.toolCallId === firstRequest?.toolCallId) throw new Error("synthetic transient native inspection failure"); return port.lookup(req);}})});
  try {
    const args = {path: "source.ts", content: "exact original"};
    const first = await runCall(h, "approval-late", "chio_write", args); firstRequest = h.adapter.requestFor(first.taskId);
    assert.equal(first.outcome.state, "awaiting_approval");
    const intent = await intentOf(h.provenanceDir, first.taskId);
    if (intent.reconciled === undefined) blocked = true;
    else {
      // The automatic observer already recorded it; reproduce an observation
      // that first happens after the resume by withholding that marker.
      blocked = true;
      const {reconciled: _marker, contentDigest: _digest, ...body} = intent;
      await writeFile(join(h.provenanceDir, "intents", hash(JSON.stringify([h.storeId, intent.conversationId, intent.taskId, intent.callId])) + ".json"),
        JSON.stringify({...body, contentDigest: hash(canonicalJson(body))}), {mode: 0o600});
      await reopen(h);
    }
    await approve(h, first.outcome, args);
    const resumed = await runCall(h, "resume-late", "chio_resume", {requestId: first.outcome.requestId, tool: "write_file", arguments: args});
    assert.equal(resumed.outcome.state, "completed");
    await assert.rejects(h.adapter.flush(), /transient/, "an inspection failure stays with its own intent");
    assert.equal(h.f.counts().acks, 1, "the resumed original was acknowledged despite the unrelated failing observation");
    blocked = false; await h.adapter.flush();
    assert.equal((await intentOf(h.provenanceDir, first.taskId)).reconciled.state, "superseded");
    assert.equal((await intentOf(h.provenanceDir, resumed.taskId)).reconciled.state, "acknowledged");
    await (await reopen(h)).flush();
    assert.deepEqual(h.f.counts(), {effects: 1, acks: 1, nativeCalls: 1});
  } finally {await h.close();}
});

test("A2-C1: an executor exception leaves its original natively fenced without poisoning the store; after recovery elsewhere later calls dispatch", async () => {
  let lose = true; let executorCalls = 0;
  const h = await setup({executor: inner => ({async execute(req, signal) {
    executorCalls++; const result = await inner.execute(req, signal);
    if (lose) {lose = false; throw new Error("response lost after original signed completion");}
    return result;
  }})});
  let receivingHost; let receiving;
  try {
    const lost = await runCall(h, "lost-call", "chio_write", {path: "lost.ts", content: "lost"});
    assert.equal(lost.status, "failed");
    await h.adapter.flush();
    assert.equal((await intentOf(h.provenanceDir, lost.taskId)).reconciled.state, "undelivered");
    assert.deepEqual(h.f.counts(), {effects: 1, acks: 0, nativeCalls: 1}); assert.equal((await h.proxy.originals.inventory()).fenced, true);
    const fenced = await runCall(h, "fenced-call", "chio_write", {path: "fenced.ts", content: "fenced"});
    assert.equal(fenced.status, "completed"); assert.equal(fenced.isError, true); assert.equal(fenced.outcome.state, "not_dispatched");
    assert.equal(executorCalls, 1, "a fenced call never reaches the executor");
    assert.equal(await intentOf(h.provenanceDir, fenced.taskId), undefined, "a definite non-dispatch retains no intent");
    await h.adapter.flush(); await (await reopen(h)).flush();
    // Explicit recovery of the exact original in another actual store.
    const logical = h.adapter.requestFor(lost.taskId);
    const storage = new MemoryStorage(); const registry = createRegistry(); receivingHost = await Harness.open(storage, {models: {}, registry}, context);
    const provenanceDir = join(h.f.directory, "receiving-parent"); await mkdir(provenanceDir, {mode: 0o700});
    receiving = await api().createChioDurableTools({storeId: randomBytes(32).toString("hex"), storage, session: receivingHost, provenanceDir, binding: h.f.binding, registry: h.f.registry,
      originals: h.proxy.originals, executor: {execute() {throw new Error("Receiving host recovers the original only");}}, transport: h.f.native, context});
    registry.install(receiving.extension); const conversation = await receivingHost.root(context);
    const task = await runTool({...h, host: receivingHost, conversation}, logical.arguments, "recover-lost", false, true);
    await receiving.bindRecovery({taskId: task.taskId, conversationId: conversation.id, callId: "recover-lost", request: logical});
    await receivingHost.waitForTask(task.taskId, context); await receiving.flush();
    assert.deepEqual(h.f.counts(), {effects: 1, acks: 1, nativeCalls: 1}); assert.equal((await h.proxy.originals.inventory()).fenced, false);
    const later = await runCall(h, "after-recovery", "chio_write", {path: "later.ts", content: "later"});
    assert.equal(later.status, "completed"); assert.equal(later.outcome.state, "completed");
    await h.adapter.flush(); await (await reopen(h)).flush();
    assert.deepEqual(h.f.counts(), {effects: 2, acks: 2, nativeCalls: 2});
  } finally {await receiving?.close(); await receivingHost?.close(context); await h.close();}
});

test("A2-I1: flush observes only unreconciled intents, so its cost does not grow with retained history", async () => {
  const counted = {lookup: 0, retainHostCommit: 0, acknowledgeCommitted: 0}; const total = () => counted.lookup + counted.retainHostCommit + counted.acknowledgeCommitted;
  const h = await setup({memory: true, originals: port => ({...port,
    async lookup(req) {counted.lookup++; return port.lookup(req);},
    async retainHostCommit(...args) {counted.retainHostCommit++; return port.retainHostCommit(...args);},
    async acknowledgeCommitted(...args) {counted.acknowledgeCommitted++; return port.acknowledgeCommitted(...args);}})});
  try {
    const perFlush = [];
    for (let index = 0; index < 4; index++) {
      assert.equal((await runCall(h, `history-${index}`, "chio_write", {path: `f${index}.ts`, content: `v${index}`})).outcome.state, "completed");
      const before = total(); await h.adapter.flush(); perFlush.push(total() - before);
    }
    // Re-observing every retained intent costs three native port calls per
    // historical call per flush (0, 3, 6, 9 more here). At most the newest
    // intent is still unreconciled when a flush starts.
    assert.ok(perFlush.every(calls => calls <= 3), `port calls per flush: ${JSON.stringify(perFlush)}`);
    const before = total(); await h.adapter.flush(); await h.adapter.flush();
    assert.equal(total() - before, 0, "reconciled history is never observed again");
    for (const name of await readdir(join(h.provenanceDir, "intents"))) assert.equal(JSON.parse(await readFile(join(h.provenanceDir, "intents", name), "utf8")).reconciled.state, "acknowledged");
    assert.deepEqual(h.f.counts(), {effects: 4, acks: 4, nativeCalls: 4});
  } finally {await h.close();}
});

test("A2-C1: an unresolved ACK stays with its own intent; a later flush delivers it and fresh work proceeds", async () => {
  let attempts = 0;
  const h = await setup({memory: true, transport: inner => ({async acknowledgeReceivedOutcome(outcome) {attempts++; if (attempts === 1) return {acknowledged: false}; return inner.acknowledgeReceivedOutcome(outcome);}})});
  try {
    const first = await runCall(h, "ack-retry", "chio_write", {path: "first.ts", content: "first"});
    // The automatic observer or the first flush meets the unresolved ACK.
    const rejected = await h.adapter.flush().then(() => undefined, error => error);
    if (rejected) {assert.match(rejected.message, /acknowledgement unresolved/); await h.adapter.flush();}
    assert.equal(attempts, 2, "only the verified original ACK is retried");
    assert.equal((await intentOf(h.provenanceDir, first.taskId)).reconciled.state, "acknowledged");
    const next = await runCall(h, "after-ack-retry", "chio_write", {path: "next.ts", content: "next"});
    assert.equal(next.outcome.state, "completed"); await h.adapter.flush();
    assert.deepEqual(h.f.counts(), {effects: 2, acks: 2, nativeCalls: 2});
  } finally {await h.close();}
});
