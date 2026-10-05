// Development workflow fixture for the roadmap qualification. Evidence layer:
// signed bridge fixture. A scripted kernel signs outcomes with an ephemeral
// fixture key and forwards admitted calls to the real coding participant over
// its kernel-owned stdio pipe. Recipes run in real local OS confinement. This
// measures adapter and host contracts. It does not qualify a real kernel.
import {createHash, randomBytes} from "node:crypto";
import {existsSync, watch} from "node:fs";
import {lstat, mkdir, readFile, readdir} from "node:fs/promises";
import {join} from "node:path";
import {AssistantEntry, Harness, ToolTask, createRegistry} from "@earendil-works/pi-durable";
import {openNodeJsonlStorage} from "@earendil-works/pi-durable/storage/jsonl/node";
import * as plugin from "../../dist/index.js";
import {createChioDurableTools} from "../../dist/durable.js";
import {gatewayExecutor} from "../../dist/http-executor.js";
import {codingToolSchemas} from "../../dist/coding-resource/schemas.js";
import {canonicalJson} from "../../dist/tool-registry.js";
import {caller, command, initialized, stdio} from "./coding-fixture.mjs";
import {nativeFixture} from "./continuation-fixture.mjs";

export const sha256 = value => createHash("sha256").update(value).digest("hex");
export const SOURCE_PATH = "src/expiry.mjs";
export const BUGGY_SOURCE = "// Returns true once the deadline has been reached.\nexport function isExpired(now, deadline) {\n  return now > deadline;\n}\n";
export const FIXED_SOURCE = BUGGY_SOURCE.replace("now > deadline", "now >= deadline");
export const INTENDED_EDIT = {oldText: "now > deadline", newText: "now >= deadline"};
const FIXTURE_TEST = [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import {isExpired} from './src/expiry.mjs';",
  "test('isExpired is false before the deadline', () => assert.equal(isExpired(9, 10), false));",
  "test('isExpired is true at the exact deadline', () => assert.equal(isExpired(10, 10), true));",
  "test('isExpired is true after the deadline', () => assert.equal(isExpired(11, 10), true));",
  "",
].join("\n");
export const FILES = {
  [SOURCE_PATH]: BUGGY_SOURCE,
  "src/token.mjs": "import {isExpired} from './expiry.mjs';\nexport const tokenUsable = (token, now) => !isExpired(now, token.deadline);\n",
  "fixture-test.mjs": FIXTURE_TEST,
};
export const LAYERS = {
  component: "signed bridge fixture: a scripted kernel signs with an ephemeral fixture key and forwards to the real coding participant on its kernel-owned pipe; adapter and host contract evidence only, not native kernel qualification",
  confinement: "real local OS confinement of the operator-pinned recipe on this host; not whole-Pi or P5 confinement",
  forbidden: "resource refusal known before effects, retained and delivered as a completed tool error; not a native signed denial",
  native: "native coding-workflow acceptance remains open until the exact kernel, publisher manifest, custody/launch profile, caller binding and signed recovery fixture are supplied and qualified",
};
const context = {};

/** Real local recipe confinement is required; there is no unconfined fallback. */
export function confinementAvailable() {
  if (process.platform === "darwin") return existsSync("/usr/bin/sandbox-exec") ? {skip: false, backend: "seatbelt"} : {skip: "macOS sandbox-exec is unavailable; refusing to run recipes unconfined", backend: null};
  if (process.platform === "linux" && process.env.CHIO_CODING_LINUX_PROBE === "1" && existsSync("/usr/bin/bwrap")) return {skip: false, backend: "bubblewrap"};
  return {skip: "real local recipe confinement is unavailable here (Linux needs the pinned-image runner); refusing to run unconfined", backend: null};
}

/** Independent observer: reads the private roots directly and the unsigned
 * resource ledger through its read-only operator commands, outside the
 * scripted kernel and the hosts. */
export class ArtifactObserver {
  constructor(resource) {
    this.configPath = resource.configPath;
    this.artifactRoot = resource.root("artifacts"); this.repositoryRoot = resource.root("repository"); this.stateRoot = resource.root("state");
    this.events = []; this.seen = new Set();
    this.watcher = watch(this.artifactRoot, (type, name) => this.events.push({type, name: name === null ? null : String(name)}));
  }
  async listing() {
    const names = (await readdir(this.artifactRoot)).sort();
    for (const name of names) if (/^[a-f0-9]{64}$/.test(name)) this.seen.add(name);
    return names;
  }
  async artifact(name) {
    const directory = join(this.artifactRoot, name); const file = join(directory, "bundle.json");
    const [entry, info] = [await lstat(directory), await lstat(file)]; const bytes = await readFile(file);
    return {name, sha256: sha256(bytes), contentAddressed: sha256(bytes) === name, bytes: bytes.length, ino: info.ino, mtimeMs: info.mtimeMs, birthtimeMs: info.birthtimeMs,
      fileMode: info.mode & 0o777, directoryMode: entry.mode & 0o777, bundle: JSON.parse(bytes.toString("utf8"))};
  }
  /** Distinct content-addressed publications ever observed by listing or watch. */
  publicationNames() {
    const names = new Set(this.seen);
    for (const event of this.events) if (/^[a-f0-9]{64}$/.test(event.name ?? "")) names.add(event.name);
    return [...names].sort();
  }
  /** Publication operations in the unsigned resource ledger. Storage is
   * content addressed, so an identical second publication leaves the artifact
   * root unchanged; the ledger still records it as another completed operation.
   * Exact replay of one operation is not a new operation. */
  async ledgerPublications() {
    const inspection = await command(["inspect", "--config", this.configPath]);
    if (inspection.code !== 0) throw new Error("Unsigned resource ledger inspection failed");
    const operations = JSON.parse(inspection.stdout).operations.filter(operation => operation.tool === "publish_artifact");
    const published = []; const refused = []; const unresolved = [];
    for (const operation of operations) {
      if (operation.state !== "completed") {unresolved.push(operation.operationId); continue;}
      const exported = await command(["export", "--config", this.configPath, "--operation", operation.operationId]);
      if (exported.code !== 0) throw new Error("Unsigned resource ledger export failed");
      const result = JSON.parse(exported.stdout).result;
      if (result?.isError === true) refused.push(operation.operationId);
      else published.push({operationId: operation.operationId, artifactSha256: JSON.parse(result.content[0].text).artifactSha256});
    }
    return {published, refused, unresolved};
  }
  /** Actual publication effects: the larger of completed ledger publications
   * (including unresolved publication intents) and distinct content-addressed
   * artifacts ever observed. Watch events are recorded per artifact name. */
  async publications() {
    const ledger = await this.ledgerPublications(); await this.listing(); const artifacts = this.publicationNames();
    const events = {};
    for (const event of this.events) if (/^[a-f0-9]{64}$/.test(event.name ?? "")) events[event.name] = (events[event.name] ?? 0) + 1;
    return {...ledger, artifacts, events, effects: Math.max(ledger.published.length + ledger.unresolved.length, artifacts.length)};
  }
  async importedSource() {return await readFile(join(this.repositoryRoot, SOURCE_PATH), "utf8");}
  async generationSource(digest) {return await readFile(join(this.stateRoot, "generations", digest, SOURCE_PATH), "utf8");}
  close() {this.watcher.close();}
}

function testView(step) {
  const result = step.data;
  const {resultSha256, ...body} = result;
  const output = `${result.stdout}\n${result.stderr}`;
  const counts = {};
  for (const match of output.matchAll(/^(?:#|ℹ) (pass|fail) (\d+)$/gm)) counts[match[1]] = Number(match[2]);
  const failed = [...output.matchAll(/^not ok \d+ - (.+)$/gm), ...output.matchAll(/^✖ (.+?) \(\d/gm)].map(match => match[1].trim());
  const failedTests = [...new Set(failed)];
  return {passed: result.success === true, operationId: step.record.operationId, nativeRequestId: step.record.nativeRequestId, sourceDigest: result.sourceDigest, recipe: result.recipe,
    recipeSha256: result.recipeSha256, executableSha256: result.executableSha256, resultSha256, resultBound: sha256(canonicalJson(body)) === resultSha256,
    sandbox: result.sandbox, exitCode: result.exitCode, signal: result.signal, limit: result.limit, counts, failedTests,
    failedAtEquality: result.success === false && failedTests.length === 1 && /exact deadline/.test(failedTests[0]) && counts.fail === 1, output: output.slice(0, 4096)};
}

async function withLostResponse(url, kernelTool, action) {
  const genuine = globalThis.fetch; let lost = 0;
  globalThis.fetch = async (input, init) => {
    const response = await genuine(input, init);
    if (String(input) !== url) return response;
    let message; try {message = JSON.parse(typeof init?.body === "string" ? init.body : "");} catch {return response;}
    if (message?.method !== "tools/call" || message.params?.name !== kernelTool) return response;
    // The trusted parent and native gateway have completed and retained the
    // signed outcome. Only the bytes on the way to this host are discarded.
    await response.arrayBuffer(); lost++;
    throw new TypeError("fetch failed: fixture discarded the parent response after native retention");
  };
  try {return {value: await action(), lost: () => lost};} finally {globalThis.fetch = genuine;}
}

/** Runs the complete development task. loss selects the publication fault:
 * "after-native-retention" loses only the host response after the native
 * gateway retained the signed completion; "before-native-retention" loses the
 * scripted kernel's completion after the resource committed the publication. */
export async function runRoadmapWorkflow({loss = "after-native-retention", trace = () => {}, files = FILES} = {}) {
  if (!["after-native-retention", "before-native-retention"].includes(loss)) throw new Error("Unknown publication response-loss point");
  const cleanup = []; const closeErrors = [];
  const close = async () => {for (const action of cleanup.splice(0).reverse()) {try {await action();} catch (error) {closeErrors.push(error.message);}} return closeErrors;};
  try {
    const resource = await initialized({files, timeoutMs: 10000}); cleanup.push(() => resource.close());
    const observer = new ArtifactObserver(resource); cleanup.push(async () => observer.close());
    const io = stdio(resource); cleanup.push(() => io.close());
    await io.request("initialize", {protocolVersion: "2025-06-18", capabilities: {}, clientInfo: {name: "scripted-kernel-fixture", version: "1"}});
    const advertised = (await io.request("tools/list")).result.tools;
    const pinned = codingToolSchemas(resource.config.bounds).inventory;
    if (canonicalJson(advertised) !== canonicalJson(pinned)) throw new Error("Resource inventory differs from the independently pinned nine-tool inventory");

    // Scripted kernel: fixture admission identity is sha256(native request ID).
    // It forwards on the kernel-owned pipe and signs with the fixture key.
    const kernel = {dispatches: []};
    const dispatch = async nativeRequest => {
      const operationId = sha256(nativeRequest.requestId);
      const record = {tool: nativeRequest.tool, nativeRequestId: nativeRequest.requestId, operationId, caller};
      kernel.dispatches.push(record);
      try {
        record.result = await io.call(nativeRequest.tool, nativeRequest.arguments, {chioRequestId: operationId, chioOperationId: operationId,
          chioAttemptId: `scripted-kernel-attempt-${kernel.dispatches.length}`, chioTransportKeyEpoch: 1, chioCallerCapabilitySha256: caller});
      } catch {record.transportClosed = true; return {drop: true};}
      if (loss === "before-native-retention" && nativeRequest.tool === "publish_artifact" && record.result.isError !== true) {record.completionLost = true; return {drop: true};}
      return {result: record.result};
    };
    const f = await nativeFixture({tools: pinned, timeoutMs: 30000, dispatch}); cleanup.push(() => f.close());
    const authority = {capabilityId: f.config.execution.capabilityId, subjectKey: f.config.execution.subjectKey, serverId: f.config.execution.serverId,
      callerCapabilitySha256: caller, authorityDigest: f.binding.authorityDigest, registryDigest: f.binding.registryDigest};
    const transportConfig = proxy => ({schema: "chio.pi.transport.v1", sessionId: f.config.sessionId, transport: {url: proxy.url, token: proxy.token}, binding: f.config.execution,
      tools: f.config.tools, approvals: false, toolMode: "typed", registryDigest: f.registry.digest, parentBinding: f.binding});
    async function openHost(name, proxy) {
      const client = await gatewayExecutor(transportConfig(proxy));
      const storageDirectory = join(f.directory, `${name}-store`); await mkdir(storageDirectory, {mode: 0o700});
      const storage = await openNodeJsonlStorage(storageDirectory, context, {fsync: true});
      const registry = createRegistry();
      const host = await Harness.open(storage, {models: {}, registry, onReport: error => {throw error;}}, context);
      const provenanceDir = join(f.directory, `${name}-parent`); await mkdir(provenanceDir, {mode: 0o700});
      const counted = {calls: 0};
      const executor = {async execute(request, signal) {counted.calls++; return client.executor.execute(request, signal);}};
      const adapter = await createChioDurableTools({storeId: randomBytes(32).toString("hex"), storage, session: host, provenanceDir, binding: f.binding,
        registry: f.registry, originals: proxy.originals, executor, transport: f.native, context});
      registry.install(adapter.extension);
      const conversation = await host.root(context); let closed = false;
      return {name, proxy, client, storage, host, adapter, conversation, counted, async close() {if (closed) return; closed = true; await adapter.close(); await host.close(context);}};
    }
    const alias = kernelTool => f.registry.tools.find(tool => tool.kernelTool === kernelTool).name;
    async function runTool(h, kernelTool, args, callId, {defer = false} = {}) {
      const ids = await h.conversation.commit(async tx => {
        const entry = await tx.appendEntry(AssistantEntry, h.conversation.id, {model: [{role: "assistant", api: "openai-responses", provider: "openai", model: "fixture",
          content: [{type: "toolCall", id: callId, name: alias(kernelTool), arguments: args}], stopReason: "toolUse", timestamp: 1,
          usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}}]});
        const taskId = await tx.createTask(ToolTask, {assistant: entry.id, callId}, {ownership: {kind: "conversation"}});
        return {taskId, assistantEntryId: entry.id};
      }, context);
      if (!defer) await h.host.waitForTask(ids.taskId, context);
      return ids;
    }
    async function committed(h, taskId) {
      const task = await h.storage.task(taskId, context);
      if (task?.state.status !== "terminal") return {status: task?.state.status ?? "missing"};
      const message = (await h.storage.entry(task.state.outcome.result.entryId, context)).entry.model[0];
      let outcome; try {outcome = JSON.parse(message.content[0]?.text ?? "");} catch {outcome = undefined;}
      return {status: task.state.outcome.status, outcome, details: message.details};
    }
    // Wait for the adapter's own committed-history observer to deliver this
    // task. flush() rescans every retained intent, which is quadratic over a
    // long workflow; this bounded wait reads only this original's native record
    // and parent mapping. After the bound, the documented flush() wait either
    // surfaces a retained observer failure or completes the same delivery.
    async function delivered(h, taskId, nativeRequestId) {
      const logical = h.adapter.requestFor(taskId);
      const mappingPath = join(f.config.journalDir, "pi-parent-mappings", sha256(JSON.stringify([logical.sessionId, logical.toolCallId])) + ".json");
      const done = async () => {
        const record = await f.record(nativeRequestId).catch(() => undefined);
        const mapping = await readFile(mappingPath, "utf8").then(JSON.parse).catch(() => undefined);
        return record?.acknowledged === true && record.hostDeliveryConfirmed === true && mapping?.acknowledgement?.acknowledged === true;
      };
      for (const deadline = Date.now() + 60000; Date.now() < deadline;) {
        if (await done()) return "commit-observer";
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await h.adapter.flush();
      if (await done()) return "flush";
      throw new Error("Committed original delivery was not acknowledged within its bound");
    }
    const steps = [];
    async function step(h, name, kernelTool, args) {
      const before = kernel.dispatches.length;
      trace(`${h.name} ${name}: dispatch`);
      const ids = await runTool(h, kernelTool, args, name);
      const view = await committed(h, ids.taskId);
      trace(`${h.name} ${name}: committed ${view.status}`);
      if (view.status !== "completed" || view.outcome?.state !== "completed") {await h.adapter.flush(); throw new Error(`Workflow step ${name} has no committed signed completion`);}
      const deliveredBy = await delivered(h, ids.taskId, view.outcome.requestId);
      trace(`${h.name} ${name}: delivered by ${deliveredBy}`);
      const dispatched = kernel.dispatches.slice(before);
      if (dispatched.length !== 1 || dispatched[0].operationId !== sha256(view.outcome.requestId) || dispatched[0].tool !== kernelTool) throw new Error(`Workflow step ${name} did not reach the resource exactly once`);
      const outcome = view.outcome; const data = JSON.parse(outcome.result.content[0].text);
      const record = {name, kernelTool, callId: name, nativeRequestId: outcome.requestId, operationId: dispatched[0].operationId, state: outcome.state, deliveredBy,
        verdict: outcome.receipt.decision.verdict, toolError: outcome.result.isError === true, ...(outcome.result.isError === true ? {code: data.code} : {}),
        authority: {capabilityId: outcome.receipt.capability_id, subjectKey: outcome.receipt.metadata.attribution.subject_key, serverId: outcome.receipt.tool_server,
          callerCapabilitySha256: dispatched[0].caller, authorityDigest: view.details.binding.authorityDigest, registryDigest: view.details.binding.registryDigest}};
      steps.push(record);
      return {record, outcome, data, taskId: ids.taskId};
    }

    const evidence = {schema: "chio.pi.roadmap-workflow-evidence.v1", layer: LAYERS.component, loss, status: "running", authority,
      nativeKernel: {status: "open", reason: LAYERS.native},
      recipe: {name: resource.config.recipes[0].name, recipeSha256: resource.config.recipes[0].recipeSha256, executableSha256: resource.config.recipes[0].executableSha256, executable: resource.config.recipes[0].executable},
      steps, forbidden: [], beforeTest: null, afterTest: null, originalArtifact: null, recoveredArtifact: null, publicationEffects: 0};
    const result = async status => {
      evidence.status = status;
      const publications = await observer.publications();
      evidence.publications = {ledgerPublished: publications.published, ledgerRefused: publications.refused.length, ledgerUnresolved: publications.unresolved,
        artifacts: publications.artifacts, artifactEvents: publications.events};
      evidence.publicationEffects = publications.effects;
      return {evidence, observer, resource, native: f, kernel, close};
    };

    const proxyA = await plugin.startParentGatewayProxy({configPath: f.configPath, native: f.native, binding: f.binding}); cleanup.push(() => proxyA.close());
    const hostA = await openHost("first-host", proxyA); cleanup.push(() => hostA.close());

    // Locate and read through admitted resource tools.
    const status = await step(hostA, "inspect-status", "repo_status", {});
    const initialDigest = status.data.sourceDigest;
    evidence.source = {initialDigest, path: SOURCE_PATH, buggySha256: sha256(BUGGY_SOURCE), fixedSha256: sha256(FIXED_SOURCE)};
    const located = await step(hostA, "locate", "search", {sourceDigest: initialDigest, literal: "export function isExpired"});
    if (located.data.matches.length !== 1) return await result("source-not-located");
    evidence.located = located.data.matches[0];
    const read = await step(hostA, "read", "read_range", {sourceDigest: initialDigest, path: evidence.located.path, startLine: 1, endLine: 4});
    evidence.read = {path: read.data.path, fileSha256: read.data.fileSha256, text: read.data.text};

    // First real confined run of the pinned recipe must demonstrate the bug.
    evidence.beforeTest = testView(await step(hostA, "before-test", "test_recipe", {sourceDigest: initialDigest, recipe: evidence.recipe.name}));
    if (evidence.beforeTest.passed || !evidence.beforeTest.failedAtEquality) return await result("bug-not-demonstrated");

    // Forbidden resource access under the same retained authority.
    for (const [name, kernelTool, args] of [
      ["forbidden-operator-config", "read_range", {sourceDigest: initialDigest, path: "../operator.json", startLine: 1, endLine: 20}],
      ["forbidden-failed-publication", "publish_artifact", {sourceDigest: initialDigest, testOperationId: evidence.beforeTest.operationId,
        testResultSha256: evidence.beforeTest.resultSha256, recipeSha256: evidence.beforeTest.recipeSha256, destination: "review"}],
    ]) {
      const refused = await step(hostA, name, kernelTool, args);
      evidence.forbidden.push({name, kernelTool, arguments: args, state: refused.outcome.state, verdict: refused.record.verdict, toolError: refused.record.toolError,
        code: refused.data.code, layer: LAYERS.forbidden, nativeDenial: refused.outcome.state === "denied",
        fencedAfterDelivery: (await proxyA.originals.inventory()).fenced, artifactsAfter: (await observer.listing()).length});
    }

    // Compare-and-swap patch, then the same pinned recipe.
    const patchArguments = {sourceDigest: initialDigest, changes: [{path: evidence.read.path, expectedFileSha256: evidence.read.fileSha256, edits: [INTENDED_EDIT]}]};
    const patch = await step(hostA, "patch", "apply_patch", patchArguments);
    evidence.patch = {arguments: patchArguments, previousSourceDigest: patch.data.previousSourceDigest, sourceDigest: patch.data.sourceDigest, changedPaths: patch.data.changedPaths};
    evidence.afterTest = testView(await step(hostA, "after-test", "test_recipe", {sourceDigest: evidence.patch.sourceDigest, recipe: evidence.recipe.name}));
    if (!evidence.afterTest.passed) return await result("fix-failed");

    // Review the diff before publication; refuse anything but the intended fix.
    const diff = await step(hostA, "review-diff", "repo_diff", {sourceDigest: evidence.patch.sourceDigest});
    const intended = [{path: evidence.read.path, before: evidence.read.text, after: evidence.read.text.replace(INTENDED_EDIT.oldText, INTENDED_EDIT.newText)}];
    evidence.diff = {diffSha256: diff.data.diffSha256, changes: diff.data.changes, reviewed: canonicalJson(diff.data.changes) === canonicalJson(intended)};
    if (!evidence.diff.reviewed) return await result("diff-rejected");

    // Publish the exact successfully tested artifact; the response is lost.
    const publication = {sourceDigest: evidence.patch.sourceDigest, testOperationId: evidence.afterTest.operationId, testResultSha256: evidence.afterTest.resultSha256,
      recipeSha256: evidence.afterTest.recipeSha256, destination: "review"};
    evidence.publication = {arguments: publication};
    const dispatchesBeforePublish = kernel.dispatches.length;
    trace(`first-host publish: dispatch with ${loss} loss`);
    const lossRun = loss === "after-native-retention" ? await withLostResponse(proxyA.url, "publish_artifact", () => runTool(hostA, "publish_artifact", publication, "publish")) : {value: await runTool(hostA, "publish_artifact", publication, "publish"), lost: () => 0};
    // Let the automatic committed-history observer see the failed task first;
    // flush() then reports its retained failure (or rescans, equally correct).
    await new Promise(resolve => setTimeout(resolve, 200));
    let flushError = null; try {await hostA.adapter.flush();} catch (error) {flushError = error.message;}
    const publishTask = lossRun.value.taskId; const publishView = await committed(hostA, publishTask);
    const logical = hostA.adapter.requestFor(publishTask);
    const firstLookup = await proxyA.originals.lookup(logical);
    evidence.firstHost = {publicationResponse: lossRun.lost() === 1 ? "lost" : loss === "before-native-retention" ? "unknown-native-outcome" : "delivered",
      taskStatus: publishView.status, guestUnresolved: hostA.client.state.unresolved, flushError, nativeOriginalState: firstLookup.state, nativeOriginalVerified: firstLookup.verified,
      nativeRequestId: firstLookup.nativeRequestId, resourceDispatches: kernel.dispatches.length - dispatchesBeforePublish};
    trace(`first-host publish: native original ${firstLookup.state}, host ${publishView.status}`);
    const publishedNames = await observer.listing();
    evidence.originalArtifact = publishedNames.length === 1 ? (({bundle: _bundle, ...metadata}) => metadata)(await observer.artifact(publishedNames[0])) : null;

    // Private same-authority handoff, then a second actual host instance.
    const handoffPath = join(f.directory, "publication-handoff.json");
    await plugin.exportContinuation(handoffPath, {binding: f.binding, requests: [logical], originals: proxyA.originals, context: {note: "Recover the review publication for the isExpired equality fix"}});
    await hostA.close(); await proxyA.close(); await f.restart();
    const recoveryStart = {...f.counts(), dispatches: kernel.dispatches.length};
    const proxyB = await plugin.startParentGatewayProxy({configPath: f.configPath, native: f.native, binding: f.binding}); cleanup.push(() => proxyB.close());
    const hostB = await openHost("second-host", proxyB); cleanup.push(() => hostB.close());
    const imported = await plugin.importContinuation(handoffPath, {binding: f.binding, originals: proxyB.originals});
    trace("second-host: imported handoff after native gateway restart");
    const receiving = await runTool(hostB, "publish_artifact", imported.originals[0].request.arguments, "recover-publication", {defer: true});
    let recovered = null; let recoveryRefusal = null;
    try {
      await hostB.adapter.bindRecovery({taskId: receiving.taskId, conversationId: hostB.conversation.id, callId: "recover-publication", request: imported.originals[0].request});
      await hostB.host.waitForTask(receiving.taskId, context); await hostB.adapter.flush();
      const view = await committed(hostB, receiving.taskId);
      if (view.status !== "completed" || view.outcome?.state !== "completed") throw new Error("Receiving host did not commit the original completion");
      recovered = view.outcome;
    } catch (error) {recoveryRefusal = error.message;}
    trace(`second-host: recovery ${recovered ? "committed the original" : "refused"}`);
    let replacementAttempt = null;
    if (!recovered) {
      // A replacement publication would make the demo finish; it must stay refused.
      const before = {...f.counts(), dispatches: kernel.dispatches.length}; let refusal = null; let parentRefusal = null;
      const genuine = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const response = await genuine(input, init);
        if (String(input) === proxyB.url) parentRefusal = (await response.clone().json().catch(() => undefined))?.error?.message ?? null;
        return response;
      };
      try {await hostB.client.executor.execute({sessionId: "second-host-replacement", toolCallId: "replacement-publication", tool: "publish_artifact", arguments: publication});}
      catch (error) {refusal = error.message;} finally {globalThis.fetch = genuine;}
      replacementAttempt = {refusal, parentRefusal, dispatched: kernel.dispatches.length !== before.dispatches || f.counts().nativeCalls !== before.nativeCalls};
    }
    const recoveryEnd = {...f.counts(), dispatches: kernel.dispatches.length};
    const nativeOutcome = f.outcomes.get(evidence.firstHost.nativeRequestId);
    evidence.secondHost = {restartedNativeGateway: true, executorCalls: hostB.counted.calls, recoveryRefusal, replacementAttempt,
      recoveredOutcomeMatchesOriginal: recovered !== null && canonicalJson(recovered) === canonicalJson(firstLookup.outcome) && canonicalJson(recovered) === canonicalJson(nativeOutcome),
      recoveredOutcomeDigest: recovered === null ? null : sha256(canonicalJson(recovered)), fencedAfterRecovery: (await proxyB.originals.inventory()).fenced};
    if (recovered) {
      const data = JSON.parse(recovered.result.content[0].text);
      evidence.recoveredArtifact = {sha256: data.artifactSha256, sourceDigest: data.sourceDigest, diffSha256: data.diffSha256, testOperationId: data.testOperationId,
        testResultSha256: data.testResultSha256, recipeSha256: data.recipeSha256, destination: data.destination, unsigned: data.unsigned, authority: data.authority};
    }
    const publishes = kernel.dispatches.filter(item => item.tool === "publish_artifact");
    // Scripted kernel counters: tools/call requests, resource pipe dispatches
    // and delivery ACKs. The artifact observer counts actual publications.
    evidence.kernel = {nativeCalls: recoveryEnd.nativeCalls, acks: recoveryEnd.acks, resourceDispatches: kernel.dispatches.length,
      nativeCallsDuringRecovery: recoveryEnd.nativeCalls - recoveryStart.nativeCalls, acksDuringRecovery: recoveryEnd.acks - recoveryStart.acks,
      resourceDispatchesDuringRecovery: recoveryEnd.dispatches - recoveryStart.dispatches,
      resourcePublishCalls: {refusedBeforeEffects: publishes.filter(item => item.result?.isError === true).length, published: publishes.filter(item => item.result && item.result.isError !== true).length}};
    const ledger = await command(["inspect", "--config", resource.configPath]);
    const inspection = ledger.code === 0 ? JSON.parse(ledger.stdout) : null;
    evidence.resourceLedger = inspection && {unsigned: inspection.unsigned === true, kernelFenceClearance: inspection.kernelFenceClearance,
      publishCompleted: inspection.operations.some(operation => operation.tool === "publish_artifact" && operation.state === "completed" && operation.sourceDigest === evidence.patch.sourceDigest)};
    return await result(recovered ? "recovered" : firstLookup.state === "completed" ? "recovery-failed" : "uncertain-preserved");
  } catch (error) {await close(); throw error;}
}
