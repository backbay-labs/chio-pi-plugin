import {mkdir, readdir} from "node:fs/promises";
import {hostname} from "node:os";
import {dirname, join} from "node:path";
import type {KernelRequest} from "./extension.js";
import {canonicalJson, frozenJson, validateKernelArguments, type ToolRegistry} from "./tool-registry.js";
import {ownedDirectory, readPrivateJson, sha256, syncDirectory, writePrivateJson} from "./private-state.js";
import {object} from "./operator.js";

export interface ContinuationBinding {authorityDigest: string; registryDigest: string;}
export interface GatewayIdentity {kind: "gateway-http"; rpcId: string; nativeMcpSession: string; gatewayCallId: string; nativeRequestId: string;}
/** These fields identify an actually committed native host entry. They are
 * custody metadata only; the Durable observer verifies the selected store. */
export interface HostCommitReference {
  kind: "pi-durable";
  storeId: string;
  conversationId: number;
  taskId: number;
  callId: string;
  toolName: string;
  assistantEntryId: number;
  entryId: number;
  commitSeq: number;
  entryDigest: string;
}
export interface ParentMapping {
  schema: "chio.pi.parent-mapping.v1";
  binding: ContinuationBinding;
  request: KernelRequest;
  argumentDigest: string;
  identity: GatewayIdentity;
  nativeObserved?: {state: string; outcomeDigest?: string};
  hostCommit?: HostCommitReference;
  hostHistory?: {kind: "pi-model-history"; outcomeDigest: string};
  acknowledgement?: {outcomeDigest: string; acknowledged: true};
  contentDigest: string;
}
export function assertBinding(value: ContinuationBinding): void {
  if (!object(value) || Object.keys(value).length !== 2 || !/^[a-f0-9]{64}$/.test(value.authorityDigest) || !/^[a-f0-9]{64}$/.test(value.registryDigest)) throw new Error("Invalid pinned continuation binding");
}
export function logicalKey(request: Pick<KernelRequest, "sessionId" | "toolCallId">): string {return sha256(JSON.stringify([request.sessionId, request.toolCallId]));}
export function immutableRequest(registry: ToolRegistry, raw: KernelRequest): KernelRequest {
  if (!object(raw) || Object.keys(raw).sort().join(",") !== "arguments,sessionId,tool,toolCallId"
    || typeof raw.sessionId !== "string" || !raw.sessionId || raw.sessionId.length > 1024 || typeof raw.toolCallId !== "string" || !raw.toolCallId || raw.toolCallId.length > 1024
    || typeof raw.tool !== "string") throw new Error("Complete original KernelRequest identity required");
  return frozenJson({...raw, arguments: validateKernelArguments(registry, raw.tool, raw.arguments)});
}
export function gatewayIdentity(sessionId: string, nativeMcpSession: string, request: KernelRequest): GatewayIdentity {
  const rpcId = JSON.stringify([request.sessionId, request.toolCallId]);
  const gatewayCallId = `${nativeMcpSession}:${JSON.stringify(rpcId)}`;
  return {kind: "gateway-http", rpcId, nativeMcpSession, gatewayCallId,
    nativeRequestId: request.tool === "chio_resume" ? String(request.arguments.requestId) : `${sessionId}:${sha256(canonicalJson({id: gatewayCallId}))}`};
}
export function directRequestId(request: KernelRequest): string {return `pi:${logicalKey(request)}`;}
export function withContentDigest<T extends object>(value: T): T & {contentDigest: string} {
  const {contentDigest: _digest, ...body} = value as T & {contentDigest?: string};
  return {...body, contentDigest: sha256(canonicalJson(body))} as T & {contentDigest: string};
}
export function checkContentDigest(value: unknown): void {
  if (!object(value) || typeof value.contentDigest !== "string" || value.contentDigest !== withContentDigest(value).contentDigest) throw new Error("Private content digest mismatch");
}
export function validateCommit(value: HostCommitReference): void {
  if (!object(value) || value.kind !== "pi-durable" || !/^[a-f0-9]{64}$/.test(value.storeId) || !/^[a-f0-9]{64}$/.test(value.entryDigest)
    || [value.conversationId, value.taskId, value.assistantEntryId, value.entryId, value.commitSeq].some(id => !Number.isSafeInteger(id) || id < 0)
    || typeof value.callId !== "string" || !value.callId || typeof value.toolName !== "string" || !value.toolName
    || Object.keys(value).sort().join(",") !== "assistantEntryId,callId,commitSeq,conversationId,entryDigest,entryId,kind,storeId,taskId,toolName") throw new Error("Invalid committed host entry reference");
}
export class ParentMappings {
  private line: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string, readonly binding: ContinuationBinding, readonly registry: ToolRegistry, readonly sessionId: string) {assertBinding(binding);}
  private async serial<T>(job: () => Promise<T>): Promise<T> {
    const pending = this.line.then(job); this.line = pending.catch(() => undefined); return pending;
  }
  private validate(raw: unknown, name: string): ParentMapping {
    checkContentDigest(raw);
    if (!object(raw) || raw.schema !== "chio.pi.parent-mapping.v1" || canonicalJson(raw.binding) !== canonicalJson(this.binding)
      || Object.keys(raw).some(key => !["schema", "binding", "request", "argumentDigest", "identity", "nativeObserved", "hostCommit", "hostHistory", "acknowledgement", "contentDigest"].includes(key))) throw new Error("Parent mapping schema or authority binding mismatch");
    const request = immutableRequest(this.registry, raw.request as KernelRequest);
    if (name !== logicalKey(request) + ".json" || raw.argumentDigest !== sha256(canonicalJson(request.arguments)) || !object(raw.identity)
      || typeof raw.identity.nativeMcpSession !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(raw.identity.nativeMcpSession)
      || canonicalJson(raw.identity) !== canonicalJson(gatewayIdentity(this.sessionId, raw.identity.nativeMcpSession, request))) throw new Error("Parent mapping original argument digest or transport identity mismatch");
    if (raw.hostCommit !== undefined) validateCommit(raw.hostCommit as HostCommitReference);
    if (raw.hostHistory !== undefined && (!object(raw.hostHistory) || raw.hostHistory.kind !== "pi-model-history"
      || Object.keys(raw.hostHistory).sort().join(",") !== "kind,outcomeDigest" || !/^[a-f0-9]{64}$/.test(String(raw.hostHistory.outcomeDigest)))) throw new Error("Invalid parent mapping delivery provenance");
    if (raw.acknowledgement !== undefined && (!object(raw.acknowledgement) || raw.acknowledgement.acknowledged !== true
      || Object.keys(raw.acknowledgement).sort().join(",") !== "acknowledged,outcomeDigest" || !/^[a-f0-9]{64}$/.test(String(raw.acknowledgement.outcomeDigest))
      || raw.hostCommit === undefined && raw.hostHistory === undefined)) throw new Error("Invalid parent mapping delivery provenance");
    if (raw.nativeObserved !== undefined && (!object(raw.nativeObserved)
      || !["completed", "denied", "not_dispatched", "awaiting_approval", "pending", "unknown"].includes(String(raw.nativeObserved.state))
      || Object.keys(raw.nativeObserved).some(key => !["state", "outcomeDigest"].includes(key))
      || raw.nativeObserved.outcomeDigest !== undefined && !/^[a-f0-9]{64}$/.test(String(raw.nativeObserved.outcomeDigest)))) throw new Error("Invalid parent mapping native observation");
    return frozenJson(raw) as unknown as ParentMapping;
  }
  private async readAll(): Promise<ParentMapping[]> {
    await ownedDirectory(this.directory);
    const names = await readdir(this.directory);
    if (names.length > 4096 || names.some(name => !/^[a-f0-9]{64}\.json$/.test(name))) throw new Error("Parent mapping inventory is invalid or interrupted");
    const records: ParentMapping[] = [];
    for (const name of names.filter(name => name.endsWith(".json")).sort()) records.push(this.validate(await readPrivateJson(join(this.directory, name)), name));
    return records;
  }
  async all(): Promise<ParentMapping[]> {await this.line; return this.readAll();}
  private async findCurrent(request: KernelRequest): Promise<ParentMapping | undefined> {
    request = immutableRequest(this.registry, request);
    const found = (await this.readAll()).find(value => logicalKey(value.request) === logicalKey(request));
    if (found && canonicalJson(found.request) !== canonicalJson(request)) throw new Error("Parent mapping immutable original request mismatch");
    return found;
  }
  async find(request: KernelRequest): Promise<ParentMapping | undefined> {await this.line; return this.findCurrent(request);}
  async reserve(request: KernelRequest, session: string): Promise<{mapping: ParentMapping; created: boolean}> {
    return this.serial(async () => {
      request = immutableRequest(this.registry, request);
      const prior = await this.findCurrent(request);
      if (prior) return {mapping: prior, created: false};
      const mapping: ParentMapping = withContentDigest({schema: "chio.pi.parent-mapping.v1" as const, binding: this.binding, request,
        argumentDigest: sha256(canonicalJson(request.arguments)), identity: gatewayIdentity(this.sessionId, session, request)});
      this.validate(mapping, logicalKey(request) + ".json");
      await writePrivateJson(join(this.directory, logicalKey(request) + ".json"), mapping);
      return {mapping: frozenJson(mapping), created: true};
    });
  }
  async update(request: KernelRequest, change: Partial<Pick<ParentMapping, "nativeObserved" | "hostCommit" | "hostHistory" | "acknowledgement">>): Promise<void> {
    await this.serial(async () => {
      const prior = await this.findCurrent(request);
      if (!prior) throw new Error("Original parent mapping missing; no delivery acknowledgement");
      if (prior.hostCommit && change.hostCommit && canonicalJson(prior.hostCommit) !== canonicalJson(change.hostCommit)) throw new Error("Committed host entry reference is immutable");
      const next = withContentDigest({...prior, ...change}); this.validate(next, logicalKey(request) + ".json");
      await writePrivateJson(join(this.directory, logicalKey(request) + ".json"), next, true);
    });
  }
}
export async function openParentMappings(journalDir: string, binding: ContinuationBinding, registry: ToolRegistry, sessionId: string): Promise<ParentMappings> {
  const root = await ownedDirectory(journalDir);
  const directory = join(root, "pi-parent-mappings");
  try {await mkdir(directory, {mode: 0o700}); await syncDirectory(root);} catch (error) {if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;}
  return new ParentMappings(await ownedDirectory(directory), frozenJson(binding), registry, sessionId);
}
export async function assertNativeGatewayOwner(store: ParentMappings): Promise<void> {
  const owner = await readPrivateJson(join(dirname(store.directory), "gateway.lock"));
  if (!object(owner) || Object.keys(owner).sort().join(",") !== "hostname,pid,sessionId"
    || owner.pid !== process.pid || owner.hostname !== hostname() || owner.sessionId !== store.sessionId) throw new Error("Parent proxy must belong to the actual native gateway owner process");
}
export async function leaseParentMappings(store: ParentMappings): Promise<() => Promise<void>> {
  // The native gateway's durable exclusive owner lock already provides the
  // cross-process interlock and its public dead-owner recovery protocol. A
  // second persistent parent lock would be stranded after abrupt parent death.
  await assertNativeGatewayOwner(store);
  if (parentLeases.has(store.directory)) throw new Error("Native owner already has a parent proxy for this mapping directory");
  parentLeases.add(store.directory);
  return async () => {parentLeases.delete(store.directory);};
}
const parentLeases = new Set<string>();
