import {defineExtension, defineTool, GenerationTask, hook, type Session, type Storage, type TaskId, type ToolExecutionApi, type ToolRegistration} from "@earendil-works/pi-durable";
import {mkdir, readdir} from "node:fs/promises";
import {join} from "node:path";
import type {KernelExecutor, KernelRequest} from "./extension.js";
import {recoverOriginalOperation, type NativeDeliveryTransport, type NativeOriginalOperationPort} from "./continuation.js";
import {assertBinding, checkContentDigest, immutableRequest, withContentDigest, type ContinuationBinding, type HostCommitReference} from "./parent-mappings.js";
import {object} from "./operator.js";
import {ownedDirectory, PRIVATE_LIMIT, readPrivateJson, sha256, syncDirectory, writePrivateJson} from "./private-state.js";
import {canonicalJson, frozenJson, resolveRegistryCall, type ToolRegistry} from "./tool-registry.js";

type Context = Parameters<ToolRegistration["execute"]>[2];
export const DURABLE_REQUEST_MEMO = "chio.pi.original-request.v1";
interface DurableIntent {
  schema: "chio.pi.durable-intent.v1";
  mode: "execute" | "recover-original";
  binding: ContinuationBinding;
  storeId: string;
  conversationId: number;
  taskId: number;
  callId: string;
  toolName: string;
  assistantEntryId: number;
  request: KernelRequest;
  hostCommit?: HostCommitReference;
  contentDigest: string;
}
export interface ChioDurableOptions {
  /** Independently prepared by the trusted backend owner. Reuse it only with
   * that exact persistent backend; the public Storage contract has no ID API. */
  storeId: string;
  storage: Storage;
  session: Session;
  provenanceDir: string;
  binding: ContinuationBinding;
  registry: ToolRegistry;
  executor: KernelExecutor;
  originals: NativeOriginalOperationPort;
  transport: NativeDeliveryTransport;
  context: Context;
}
interface StoreOwner {
  storage: Storage;
  session: Session;
  directory: string;
  binding: ContinuationBinding;
  observer?: object;
  closing: boolean;
  closeConfirmation?: Promise<boolean>;
}
const activeStores = new Map<string, StoreOwner>();
const storageOwners = new WeakMap<Storage, string>();
const sessionOwners = new WeakMap<Session, string>();
async function bindStoreOwner(options: ChioDurableOptions, directory: string, binding: ContinuationBinding): Promise<{owner: StoreOwner; releaseObserver(): void}> {
  const storeId = options.storeId;
  let owner = activeStores.get(storeId);
  if (owner?.closeConfirmation) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {await Promise.race([owner.closeConfirmation, new Promise<void>(resolve => {timer = setTimeout(resolve, 1000);})]);}
    finally {clearTimeout(timer);}
    owner = activeStores.get(storeId);
  }
  if (owner && (owner.storage !== options.storage || owner.session !== options.session || owner.directory !== directory || !same(owner.binding, binding)
    || owner.closing || owner.observer)
    || storageOwners.has(options.storage) && storageOwners.get(options.storage) !== storeId
    || sessionOwners.has(options.session) && sessionOwners.get(options.session) !== storeId) throw new Error("Durable store identity is already bound to live backend and Session handles");
  const observer = {};
  if (!owner) {
    const selected: StoreOwner = {storage: options.storage, session: options.session, directory, binding, observer, closing: false};
    // subscribeClose announces the start, not completion. Its synchronous
    // listener only marks and enqueues; the public close promise confirms that
    // admitted work settled and Storage actually closed before identity release.
    const unsubscribeClose = options.session.subscribeClose(() => {
      selected.closing = true;
      selected.closeConfirmation = Promise.resolve().then(async () => {
        await options.session.close({...options.context, abortSignal: undefined});
        if (activeStores.get(storeId) === selected) activeStores.delete(storeId);
        storageOwners.delete(options.storage); sessionOwners.delete(options.session); unsubscribeClose();
        return true;
      }).catch(() => false); // Failed or unresolved close conservatively retains custody.
    });
    activeStores.set(storeId, selected); storageOwners.set(options.storage, storeId); sessionOwners.set(options.session, storeId); owner = selected;
  } else owner.observer = observer;
  const selected = owner;
  return {owner: selected, releaseObserver() {if (selected.observer === observer) selected.observer = undefined;}};
}
function intentKey(intent: Pick<DurableIntent, "storeId" | "conversationId" | "taskId" | "callId">): string {return sha256(JSON.stringify([intent.storeId, intent.conversationId, intent.taskId, intent.callId]));}
function requestForIntent(intent: Pick<DurableIntent, "storeId" | "conversationId" | "taskId" | "callId">, call: {tool: string; arguments: Record<string, unknown>}): KernelRequest {
  return {sessionId: `durable:${intent.storeId}:${intent.conversationId}`, toolCallId: `${intent.taskId}:${intent.callId}`, ...call};
}
function same(a: unknown, b: unknown): boolean {return canonicalJson(a) === canonicalJson(b);}
function outcomeContent(outcome: unknown): {type: "text"; text: string}[] {
  const text = JSON.stringify(outcome);
  if (Buffer.byteLength(text) > PRIVATE_LIMIT / 4) throw new Error("Full original outcome exceeds the bounded Durable entry capacity; retain its native fence");
  return [{type: "text", text}];
}

/** Native ToolRegistration, memo, ToolTask and committed Session contracts.
 * execute and afterTool never ACK and never wait for their future commit. */
export async function createChioDurableTools(options: ChioDurableOptions) {
  assertBinding(options.binding);
  const binding = frozenJson(options.binding); const storeId = options.storeId;
  if (!/^[a-f0-9]{64}$/.test(storeId) || !same(binding, options.originals.binding) || options.registry.digest !== binding.registryDigest) throw new Error("Durable store identity or independently prepared authority binding mismatch");
  const directory = await ownedDirectory(options.provenanceDir);
  const {owner, releaseObserver} = await bindStoreOwner(options, directory, binding);
  let intentsDirectory: string;
  const intents = new Map<number, DurableIntent>();
  function validateIntent(raw: unknown, name: string): DurableIntent {
    checkContentDigest(raw);
    if (!object(raw) || raw.schema !== "chio.pi.durable-intent.v1" || raw.storeId !== storeId || !same(raw.binding, binding)
      || !["execute", "recover-original"].includes(String(raw.mode))
      || [raw.conversationId, raw.taskId, raw.assistantEntryId].some(value => !Number.isSafeInteger(value) || Number(value) < 0)
      || typeof raw.callId !== "string" || !raw.callId || typeof raw.toolName !== "string" || !options.registry.tools.some(tool => tool.name === raw.toolName)
      || Object.keys(raw).some(key => !["schema", "mode", "binding", "storeId", "conversationId", "taskId", "callId", "toolName", "assistantEntryId", "request", "hostCommit", "contentDigest"].includes(key))) throw new Error("Durable private original task provenance mismatch");
    const intent = raw as unknown as DurableIntent;
    immutableRequest(options.registry, intent.request);
    const call = resolveRegistryCall(options.registry, intent.toolName, options.registry.mode === "legacy" ? {tool: intent.request.tool, arguments: intent.request.arguments} : intent.request.arguments);
    if (name !== intentKey(intent) + ".json" || intent.mode === "execute" && !same(intent.request, requestForIntent(intent, call))) throw new Error("Durable immutable original request mapping mismatch");
    if (intent.hostCommit && (intent.hostCommit.storeId !== storeId || intent.hostCommit.taskId !== intent.taskId || intent.hostCommit.callId !== intent.callId || intent.hostCommit.conversationId !== intent.conversationId || intent.hostCommit.assistantEntryId !== intent.assistantEntryId)) throw new Error("Durable committed entry reference provenance mismatch");
    return frozenJson(intent);
  }
  async function readIntents(): Promise<void> {
    await ownedDirectory(intentsDirectory);
    const names = await readdir(intentsDirectory);
    if (names.length > 4096 || names.some(name => !/^[a-f0-9]{64}\.json$/.test(name))) throw new Error("Durable private intent inventory is invalid or interrupted");
    for (const name of names.sort()) {
      const intent = validateIntent(await readPrivateJson(join(intentsDirectory, name)), name);
      if (intents.has(intent.taskId) && !same(intents.get(intent.taskId)!.request, intent.request)) throw new Error("Durable task has conflicting original provenance");
      intents.set(intent.taskId, intent);
    }
  }
  try {
    const ownerPath = join(directory, "store-owner.binding");
    const owner = {schema: "chio.pi.durable-store-owner.v1", storeId, binding};
    try {if (!same(await readPrivateJson(ownerPath), owner)) throw new Error("Durable immutable backend owner binding mismatch");}
    catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await writePrivateJson(ownerPath, owner);}
    const requested = join(directory, "intents");
    try {await mkdir(requested, {mode: 0o700}); await syncDirectory(directory);} catch (error) {if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;}
    intentsDirectory = await ownedDirectory(requested);
    await readIntents();
  } catch (error) {releaseObserver(); throw error;}
  let closed = false; let failure: Error | undefined; let draining: Promise<void> | undefined; let scheduled = false;
  const queue = new Set<number>();
  function fail(error: unknown): void {failure ??= error instanceof Error ? error : new Error("Durable committed outcome verification failed");}
  async function observe(taskId: number): Promise<void> {
    const intent = intents.get(taskId); if (!intent) return;
    const privateIntent = validateIntent(await readPrivateJson(join(intentsDirectory, intentKey(intent) + ".json")), intentKey(intent) + ".json");
    if (!same(privateIntent, intent)) throw new Error("Durable original private provenance changed before delivery");
    // A public read-only transaction gives one committed task/entry snapshot.
    // Compare it with the independently selected Storage as well, so a Session
    // attached to another backend cannot lend its numeric IDs as evidence.
    const snapshot = await options.session.commit(async tx => {
      const task = await tx.task(taskId as TaskId);
      if (task?.state.status !== "terminal") return {task};
      const result = task.state.outcome.result;
      if (!object(result) || !Number.isSafeInteger(result.entryId)) throw new Error("Durable terminal task lacks a committed result entry");
      return {task, entry: await tx.entry(result.entryId as never), assistant: await tx.entry(intent.assistantEntryId as never)};
    }, options.context);
    const task = snapshot.task;
    if (!task || task.state.status !== "terminal") return;
    if (task.kind !== "pi.tool" || task.version !== 1 || task.conversationId !== intent.conversationId || task.id !== intent.taskId || !object(task.input)
      || task.input.assistant !== intent.assistantEntryId || task.input.callId !== intent.callId || task.state.outcome.status !== "completed"
      || !same(await options.storage.task(task.id, options.context), task)) throw new Error("Actual committed Durable tool task provenance or terminal completion mismatch");
    const entry = snapshot.entry; const originalAssistant = snapshot.assistant;
    if (!entry || entry.kind !== "pi.tool-result" || entry.conversationId !== intent.conversationId || entry.byTaskId !== intent.taskId || !entry.model || entry.model.length !== 1
      || !originalAssistant || originalAssistant.kind !== "pi.assistant" || originalAssistant.conversationId !== intent.conversationId) throw new Error("Actual committed native tool result entry provenance mismatch");
    const message = entry.model[0]; const calling = originalAssistant.model?.[0];
    const call = calling?.role === "assistant" ? calling.content.find(item => item.type === "toolCall" && item.id === intent.callId) : undefined;
    if (!call || call.type !== "toolCall" || call.name !== intent.toolName || !same(resolveRegistryCall(options.registry, call.name, call.arguments), retainedCall(intent.request))) throw new Error("Committed assistant-call arguments differ from the immutable original request");
    if (message.role !== "toolResult" || message.toolCallId !== intent.callId || message.toolName !== intent.toolName || message.content.length !== 1 || message.content[0].type !== "text") throw new Error("Complete original outcome must be committed in native model content");
    let outcome: unknown;
    try {outcome = JSON.parse(message.content[0].text) as unknown;} catch {throw new Error("Committed original outcome content is truncated or invalid");}
    const details = message.details;
    if (!object(details) || details.schema !== "chio.pi.durable-result.v1" || details.storeId !== storeId || !same(details.binding, binding) || !same(details.request, intent.request)) throw new Error("Committed Durable result original provenance mismatch");
    const original = await options.originals.lookup(intent.request);
    if (!same(original.outcome, outcome) || original.state !== "completed" && original.state !== "denied" && original.state !== "awaiting_approval") throw new Error("Committed outcome differs from independently verified native original");
    if (original.state === "awaiting_approval") return;
    if (!original.verified) throw new Error("Committed original outcome lacks native verification");
    if (original.state === "denied") return;
    const persisted = await options.storage.entry(entry.id, options.context);
    if (!persisted || !same(persisted.entry, entry)) throw new Error("Committed native entry is absent from the independently selected actual store");
    const reference: HostCommitReference = {kind: "pi-durable", storeId, conversationId: intent.conversationId, taskId: intent.taskId, callId: intent.callId,
      toolName: intent.toolName, assistantEntryId: intent.assistantEntryId, entryId: entry.id, commitSeq: persisted.commitSeq, entryDigest: sha256(canonicalJson(entry))};
    if (intent.hostCommit && !same(intent.hostCommit, reference)) throw new Error("Committed original entry reference changed across restart");
    if (!intent.hostCommit) {
      const next = withContentDigest({...intent, hostCommit: reference});
      await writePrivateJson(join(intentsDirectory, intentKey(intent) + ".json"), next, true); intents.set(taskId, frozenJson(next));
    }
    const firstProof = (await options.originals.mappings.find(intent.request))?.hostCommit;
    if (firstProof && !same(firstProof, reference)) {
      // Another actual store may consume an already-delivered original. Its
      // verified commit remains in its own intent; the first proof is immutable.
      // Refresh native state after reading the actual receiving entry. Neither
      // cached delivery flags nor the parent mapping establish confirmation.
      const refreshed = await options.originals.lookup(intent.request);
      if (refreshed.state === "completed" && refreshed.verified && refreshed.acknowledged && refreshed.hostDeliveryConfirmed
        && same(refreshed.outcome, outcome)) return;
      throw new Error("Conflicting committed entry proof requires the exact original's current native delivery confirmation");
    }
    await options.originals.retainHostCommit(intent.request, reference);
    await options.originals.acknowledgeCommitted(intent.request, outcome, reference, options.transport);
  }
  async function drain(): Promise<void> {
    if (draining) return draining;
    draining = (async () => {
      while (queue.size && !closed && !owner.closing && !failure) {
        const taskId = queue.values().next().value!; queue.delete(taskId);
        try {await observe(taskId);} catch (error) {fail(error);}
      }
    })().finally(() => {draining = undefined;});
    return draining;
  }
  function schedule(): void {
    if (scheduled || closed || owner.closing || failure) return;
    scheduled = true;
    setImmediate(() => {scheduled = false; if (!closed) void drain().catch(fail);});
  }
  // This listener does bounded enqueue only. No Session operation, await, throw
  // or blocking work runs in the synchronous publication callback.
  const unsubscribe = options.session.subscribeCommits(publication => {
    if (closed || owner.closing || failure) return;
    if (publication.changes.length > 4096) {fail(new Error("Durable committed publication exceeded bounded observation capacity")); return;}
    for (const change of publication.changes) {
      if (change.type !== "task" || change.value.kind !== "pi.tool" || change.value.state.status !== "terminal" || !intents.has(change.value.id)) continue;
      if (queue.size >= 64 && !queue.has(change.value.id)) {fail(new Error("Durable committed delivery queue exceeded; native original remains fenced")); break;}
      queue.add(change.value.id);
    }
    if (queue.size) schedule();
  });
  async function flush(): Promise<void> {
    if (closed || owner.closing) throw new Error("Durable host observer or actual Session closed");
    if (failure) throw failure;
    await readIntents();
    for (const intent of intents.values()) {
      if (queue.size >= 64) {await drain(); if (failure) throw failure;}
      queue.add(intent.taskId);
    }
    await drain(); if (failure) throw failure;
  }
  const tools: ToolRegistration[] = options.registry.tools.map(definition => defineTool({
    name: definition.name, description: definition.description, parameters: definition.parameters as ToolRegistration["parameters"], replay: "unsafe", executionMode: "sequential",
    outputLimits: {maxBytes: PRIVATE_LIMIT, maxLines: PRIVATE_LIMIT, retain: "head"},
    prepareArguments(raw) {resolveRegistryCall(options.registry, definition.name, raw); return frozenJson(raw) as never;},
    async execute(args, api: ToolExecutionApi, context) {
      if (closed || owner.closing || failure) throw failure ?? new Error("Durable trusted host closed");
      const call = resolveRegistryCall(options.registry, definition.name, args);
      const task = await api.getTask(api.taskId, context);
      const selected = await options.storage.task(api.taskId, context);
      if (!task || !selected || !same(task, selected) || task.kind !== "pi.tool" || task.version !== 1 || task.conversationId !== api.conversationId || task.state.status !== "running"
        || !object(task.state.checkpoint) || task.state.checkpoint.phase !== "execute" || task.state.checkpoint.replay !== "unsafe" || !same(task.state.checkpoint.arguments, args)
        || !object(task.input) || task.input.callId !== api.callId || !Number.isSafeInteger(task.input.assistant)) throw new Error("Actual Durable invocation does not match the selected host store task");
      const originalAssistant = await options.storage.entry(task.input.assistant as never, context);
      const message = originalAssistant?.entry.model?.[0];
      const originalCall = message?.role === "assistant" ? message.content.find(item => item.type === "toolCall" && item.id === api.callId) : undefined;
      if (!originalCall || originalCall.type !== "toolCall" || originalCall.name !== definition.name || originalAssistant!.entry.kind !== "pi.assistant"
        || originalAssistant!.entry.conversationId !== api.conversationId || !same(resolveRegistryCall(options.registry, definition.name, originalCall.arguments), call)) throw new Error("Original committed assistant call differs from eventual execute arguments after hooks");
      const provenance = {storeId, conversationId: api.conversationId, taskId: api.taskId, callId: api.callId, toolName: definition.name, assistantEntryId: task.input.assistant as number};
      const prior = intents.get(api.taskId);
      const mode = prior?.mode ?? "execute";
      const request = immutableRequest(options.registry, mode === "recover-original" ? prior!.request : requestForIntent(provenance, call));
      if (!same(retainedCall(request), call)) throw new Error("Explicit original recovery differs from the receiving assistant call");
      const candidate = {schema: "chio.pi.durable-memo.v1", mode, binding, ...provenance, request};
      const memo = await api.memo(DURABLE_REQUEST_MEMO, candidate as never, context);
      if (!same(memo, candidate) || !same((await options.storage.task(api.taskId, context))?.memos?.[DURABLE_REQUEST_MEMO], candidate)) throw new Error("Durable immutable original memo is not the committed native winner");
      const intent = withContentDigest({schema: "chio.pi.durable-intent.v1" as const, mode, binding, ...provenance, request});
      let outcome: unknown;
      if (prior) {
        const {hostCommit: _reference, contentDigest: _priorDigest, ...priorIdentity} = prior;
        const {contentDigest: _candidateDigest, ...candidateIdentity} = intent;
        if (!same(priorIdentity, candidateIdentity)) throw new Error("Durable original task identity changed; no dispatch");
        outcome = await recoverOriginalOperation(prior.request, options.originals);
      } else {
        await writePrivateJson(join(intentsDirectory, intentKey(intent) + ".json"), intent); intents.set(api.taskId, frozenJson(intent));
        if (closed || owner.closing || failure) throw failure ?? new Error("Durable trusted host closed before dispatch");
        const result = await options.executor.execute(request, context.abortSignal);
        const original = await options.originals.lookup(request);
        if (result.outcome !== original.state || result.retainedOutcome !== undefined && !same(result.retainedOutcome, original.outcome)
          || original.state === "completed" && (!original.verified || result.retainedOutcome === undefined)) throw new Error("Executor result does not bind the retained native original outcome");
        outcome = original.outcome;
      }
      if (!object(outcome)) throw new Error("Native original outcome unavailable; preserve its fence");
      return {content: outcomeContent(outcome), isError: outcome.state !== "completed" || object(outcome.result) && outcome.result.isError === true,
        details: {schema: "chio.pi.durable-result.v1", binding, storeId, request, originalOutcome: outcome} as never};
    },
  }));
  const extension = defineExtension({name: "chio-original-operations", tools, hooks: [hook(GenerationTask, {afterTools: async () => {await flush();}})]});
  return {tools, extension, flush,
    /** Trusted owner action before scheduling the exact receiving ToolTask.
     * This never executes, creates authority or acknowledges an operation. */
    async bindRecovery(input: {taskId: number; conversationId: number; callId: string; request: KernelRequest}): Promise<void> {
      if (closed || owner.closing || failure) throw failure ?? new Error("Durable trusted host closed");
      const request = immutableRequest(options.registry, input.request);
      await recoverOriginalOperation(request, options.originals);
      const task = await options.storage.task(input.taskId as TaskId, options.context);
      if (!task || task.kind !== "pi.tool" || task.version !== 1 || task.conversationId !== input.conversationId || task.state.status !== "pending" || !object(task.input)
        || task.input.callId !== input.callId || !Number.isSafeInteger(task.input.assistant)) throw new Error("Explicit recovery requires the exact unscheduled native receiving task");
      const assistant = await options.storage.entry(task.input.assistant as never, options.context); const message = assistant?.entry.model?.[0];
      const call = message?.role === "assistant" ? message.content.find(item => item.type === "toolCall" && item.id === input.callId) : undefined;
      if (!call || call.type !== "toolCall" || assistant!.entry.kind !== "pi.assistant" || assistant!.entry.conversationId !== input.conversationId
        || !same(resolveRegistryCall(options.registry, call.name, call.arguments), retainedCall(request))) throw new Error("Receiving committed assistant call differs from the verified original");
      const intent: DurableIntent = withContentDigest({schema: "chio.pi.durable-intent.v1" as const, mode: "recover-original" as const, binding, storeId,
        taskId: input.taskId, conversationId: input.conversationId, callId: input.callId, toolName: call.name, assistantEntryId: task.input.assistant as number, request});
      const prior = intents.get(input.taskId);
      if (prior) {if (!same(prior, intent)) throw new Error("Receiving task original recovery binding is immutable"); return;}
      await writePrivateJson(join(intentsDirectory, intentKey(intent) + ".json"), intent); intents.set(input.taskId, frozenJson(intent));
    },
    requestFor(taskId: number): KernelRequest {const intent = intents.get(taskId); if (!intent) throw new Error("Original Durable task provenance unavailable"); return frozenJson(intent.request);},
    async close() {if (closed) return; closed = true; unsubscribe(); if (draining) await draining; releaseObserver();}};
}
function retainedCall(request: KernelRequest): {tool: string; arguments: Record<string, unknown>} {return {tool: request.tool, arguments: request.arguments};}
