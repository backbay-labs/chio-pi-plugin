import type {KernelRequest} from "./extension.js";
import {preparedAuthorityDigest} from "./configured.js";
import {inspectOperation, invokeNative, object, OperatorRedactor, readOperatorContext, resolveNativeOperator, statusView, type OperatorContext} from "./operator.js";
import {canonicalJson, frozenJson} from "./tool-registry.js";
import {assertBinding, checkContentDigest, immutableRequest, logicalKey, openParentMappings, validateCommit, withContentDigest, type ContinuationBinding, type HostCommitReference, type ParentMapping, type ParentMappings} from "./parent-mappings.js";
import {readPrivateJson, sha256, writePrivateJson} from "./private-state.js";

export type OriginalState = "completed" | "denied" | "not_dispatched" | "awaiting_approval" | "pending" | "unknown";
export interface OriginalOperation {
  nativeRequestId: string;
  state: OriginalState;
  verified: boolean;
  outcome?: unknown;
  acknowledged: boolean;
  hostDeliveryConfirmed: boolean;
}
export interface OriginalInventory {fenced: boolean; operations: (OriginalOperation & {mapped: boolean})[];}
/** Lookup is deliberately distinct from KernelExecutor. There is no execute or
 * generated-request fallback on this port. The receiving binding is pinned by
 * the trusted owner, independently of the handoff being read. */
export interface OriginalOperationPort {
  readonly binding: ContinuationBinding;
  lookup(request: KernelRequest): Promise<OriginalOperation>;
  inventory(): Promise<OriginalInventory>;
  assertPublic(value: unknown): void;
}
export interface NativeOriginalOperationPort extends OriginalOperationPort {
  readonly mappings: ParentMappings;
  retainHostCommit(request: KernelRequest, reference: HostCommitReference): Promise<void>;
  acknowledgeCommitted(request: KernelRequest, outcome: unknown, reference: HostCommitReference, transport: NativeDeliveryTransport): Promise<void>;
  acknowledgeHistory(outcome: unknown, transport: NativeDeliveryTransport): Promise<{acknowledged: boolean}>;
}
export interface NativeDeliveryTransport {acknowledgeReceivedOutcome(outcome: unknown): Promise<{acknowledged: boolean}>;}
const NATIVE_OPERATOR_SHA256 = "84602a3f626ecf47283f0ada72fd4d2116104b167adc16eedd02e45d23306ac8";
function bindingFor(context: OperatorContext): ContinuationBinding {return {authorityDigest: preparedAuthorityDigest(context.config, context.registry), registryDigest: context.registry.digest};}
function fingerprint(context: OperatorContext): string {return sha256(canonicalJson([...context.records.entries()].sort(([a], [b]) => a < b ? -1 : 1)));}
function delivered(record: Record<string, unknown>): boolean {return record.state === "not_dispatched" || record.state === "completed" && record.acknowledged === true && (record.hostDeliveryRequired === false || record.hostDeliveryConfirmed === true);}
function retainedCall(request: KernelRequest): {tool: string; arguments: unknown} {
  return request.tool === "chio_resume" ? {tool: String(request.arguments.tool), arguments: request.arguments.arguments} : request;
}
function nativeMatches(context: OperatorContext, mapping: ParentMapping, status: Record<string, unknown>): OriginalOperation {
  const nativeRequestId = mapping.identity.nativeRequestId;
  const record = context.records.get(nativeRequestId);
  if (!record) return {nativeRequestId, state: "unknown", verified: false, acknowledged: false, hostDeliveryConfirmed: false};
  const expected = retainedCall(mapping.request);
  const inspection = inspectOperation(context, nativeRequestId, status);
  if (!object(inspection.request) || inspection.request.tool !== expected.tool || canonicalJson(inspection.request.arguments) !== canonicalJson(expected.arguments)) throw new Error("Native original differs from the complete immutable host request");
  const verification = inspection.verification as {verified: boolean};
  return {nativeRequestId, state: record.state as OriginalState, verified: verification.verified,
    ...(record.outcome !== undefined ? {outcome: frozenJson(record.outcome)} : {}), acknowledged: record.acknowledged === true, hostDeliveryConfirmed: record.hostDeliveryConfirmed === true};
}
function collectSecrets(value: unknown, secrets: Set<string>, container = false, secret = false): void {
  if (typeof value === "string") {if (secret && value.length >= 3) secrets.add(value); return;}
  if (Array.isArray(value)) {for (const child of value) collectSecrets(child, secrets, container, secret); return;}
  if (object(value)) for (const [key, child] of Object.entries(value)) {
    const credential = credentialKey(key);
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const material = container && /^(?:signature|signaturehex|value|seed|payload|key)$/.test(normalized);
    // Credential containers also carry public caller, session and scope IDs.
    // Preserve those; register only actual secret material for string scanning.
    collectSecrets(child, secrets, container || credential, credential || material);
  }
}
function credentialKey(key: string): boolean {
  return /^(?:bearertoken|sessiontoken|apikey|accesstoken|refreshtoken|capabilitytoken|chioapprovaltoken|approvaltoken|privatekey|password|secret|authorization|credential|credentials|providercredentials|sessioncredential)$/.test(key.replace(/[^a-z0-9]/gi, "").toLowerCase());
}
function assertPublicValue(value: unknown, secrets: Set<string>): void {
  canonicalJson(value);
  function visit(item: unknown): void {
    if (typeof item === "string" && [...secrets].some(secret => item.includes(secret))) throw new Error("Continuation contains a retained authority credential");
    if (typeof item === "string" && /\bBearer\s+[A-Za-z0-9._~+\/-]+/i.test(item)) throw new Error("Continuation contains a bearer credential");
    if (Array.isArray(item)) {for (const child of item) visit(child);}
    else if (object(item)) for (const [key, child] of Object.entries(item)) {if (credentialKey(key)) throw new Error("Continuation credential fields are forbidden"); visit(child);}
  }
  visit(value);
}
export async function createNativeOriginalOperationPort(options: {configPath: string; binding: ContinuationBinding; mappings?: ParentMappings}): Promise<NativeOriginalOperationPort> {
  assertBinding(options.binding);
  const binding = frozenJson(options.binding);
  const redactor = new OperatorRedactor();
  const initial = await readOperatorContext(options.configPath, redactor);
  if (canonicalJson(bindingFor(initial)) !== canonicalJson(binding)) throw new Error("Independently pinned receiving authority binding mismatch");
  const operator = await resolveNativeOperator();
  if (operator.operatorSha256 !== NATIVE_OPERATOR_SHA256) throw new Error("Native original lookup requires the exact frozen operator artifact");
  const mappings = options.mappings ?? await openParentMappings(initial.config.journalDir, binding, initial.registry, initial.config.sessionId);
  if (canonicalJson(mappings.binding) !== canonicalJson(binding)) throw new Error("Parent mapping binding mismatch");
  const secrets = new Set<string>(); collectSecrets(initial.config, secrets);
  async function stable(): Promise<{context: OperatorContext; status: Record<string, unknown>; maps: ParentMapping[]}> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = await readOperatorContext(options.configPath, redactor); const maps = await mappings.all();
      if (canonicalJson(bindingFor(before)) !== canonicalJson(binding)) throw new Error("Native authority or registry binding changed");
      const native = await invokeNative(operator, "status", before.configPath);
      const status = statusView(before, native);
      const after = await readOperatorContext(options.configPath, redactor); const afterMaps = await mappings.all();
      if (fingerprint(before) !== fingerprint(after) || canonicalJson(maps) !== canonicalJson(afterMaps) || canonicalJson(bindingFor(after)) !== canonicalJson(binding)) continue;
      for (const reported of native.operations as Record<string, unknown>[]) {
        const record = after.records.get(String(reported.requestId))!;
        collectSecrets(record.request, secrets);
        if (reported.acknowledged !== (record.acknowledged === true) || reported.hostDeliveryConfirmed !== (record.hostDeliveryConfirmed === true)
          || (reported.hostDeliveryRequired !== false) !== (record.hostDeliveryRequired !== false)) throw new Error("Native original delivery state changed during inspection");
        if (["completed", "denied", "awaiting_approval", "not_dispatched"].includes(String(record.state))) inspectOperation(after, String(record.requestId), status);
      }
      return {context: after, status, maps: afterMaps};
    }
    throw new Error("Native original state changed concurrently; preserve the fence and retry read-only inspection");
  }
  async function lookup(request: KernelRequest): Promise<OriginalOperation> {
    request = immutableRequest(initial.registry, request);
    const snapshot = await stable();
    const mapping = snapshot.maps.find(value => logicalKey(value.request) === logicalKey(request));
    if (!mapping) throw new Error("Original parent mapping missing; never dispatch a replacement");
    if (canonicalJson(mapping.request) !== canonicalJson(request)) throw new Error("Original immutable request or caller mapping mismatch");
    return nativeMatches(snapshot.context, mapping, snapshot.status);
  }
  async function exactCompletion(request: KernelRequest, outcome: unknown): Promise<OriginalOperation> {
    const original = await lookup(request);
    if (original.state !== "completed" || !original.verified || canonicalJson(original.outcome) !== canonicalJson(outcome)) throw new Error("Original completion verification failed; preserve its fence");
    return original;
  }
  return {
    binding, mappings, lookup,
    assertPublic(value) {assertPublicValue(value, secrets);},
    async inventory() {
      const snapshot = await stable(); const ids = new Set(snapshot.maps.map(value => value.identity.nativeRequestId));
      const operations = snapshot.maps.map(mapping => ({...nativeMatches(snapshot.context, mapping, snapshot.status), mapped: true}));
      for (const record of snapshot.context.records.values()) if (!ids.has(String(record.requestId))) operations.push({nativeRequestId: String(record.requestId), state: record.state as OriginalState, verified: false, acknowledged: record.acknowledged === true, hostDeliveryConfirmed: record.hostDeliveryConfirmed === true, mapped: false});
      const missingOriginal = snapshot.maps.some(mapping => !snapshot.context.records.has(mapping.identity.nativeRequestId));
      return {fenced: snapshot.status.fenced === true || missingOriginal || [...snapshot.context.records.values()].some(record => !delivered(record)), operations};
    },
    async retainHostCommit(request, reference) {validateCommit(reference); await exactCompletion(request, (await lookup(request)).outcome); await mappings.update(request, {hostCommit: frozenJson(reference)});},
    async acknowledgeCommitted(request, outcome, reference, transport) {
      validateCommit(reference); await exactCompletion(request, outcome);
      const mapping = await mappings.find(request);
      if (!mapping?.hostCommit || canonicalJson(mapping.hostCommit) !== canonicalJson(reference)) throw new Error("Exact committed entry reference must be durably retained before ACK");
      const result = await transport.acknowledgeReceivedOutcome(outcome);
      if (!result.acknowledged) throw new Error("Original native delivery acknowledgement unresolved; retry only verified original ACK");
      await mappings.update(request, {acknowledgement: {acknowledged: true, outcomeDigest: sha256(canonicalJson(outcome))}});
    },
    async acknowledgeHistory(outcome, transport) {
      if (!object(outcome) || typeof outcome.requestId !== "string") throw new Error("Complete original host history outcome required");
      const snapshot = await stable(); const mapping = snapshot.maps.find(value => value.identity.nativeRequestId === outcome.requestId);
      if (!mapping) throw new Error("Original parent history mapping missing");
      await exactCompletion(mapping.request, outcome);
      await mappings.update(mapping.request, {hostHistory: {kind: "pi-model-history", outcomeDigest: sha256(canonicalJson(outcome))}});
      const result = await transport.acknowledgeReceivedOutcome(outcome);
      if (result.acknowledged) await mappings.update(mapping.request, {acknowledgement: {acknowledged: true, outcomeDigest: sha256(canonicalJson(outcome))}});
      return result;
    },
  };
}
export async function recoverOriginalOperation(request: KernelRequest, originals: OriginalOperationPort): Promise<unknown> {
  const original = await originals.lookup(request);
  if (original.state !== "completed" || !original.verified || original.outcome === undefined) throw new Error(`Original verified completion unavailable (${original.state}); preserve its fence, no replacement dispatch`);
  return frozenJson(original.outcome);
}
export interface ContinuationEnvelope {
  schema: "chio.pi.continuation.v1";
  binding: ContinuationBinding;
  originals: {request: KernelRequest; nativeRequestId: string; state: OriginalState; outcome?: unknown}[];
  context: Record<string, unknown>;
  contentDigest: string;
}
function validateEnvelope(raw: unknown, binding: ContinuationBinding, originals: OriginalOperationPort): ContinuationEnvelope {
  assertBinding(binding); checkContentDigest(raw);
  if (!object(raw) || raw.schema !== "chio.pi.continuation.v1" || Object.keys(raw).sort().join(",") !== "binding,contentDigest,context,originals,schema"
    || canonicalJson(raw.binding) !== canonicalJson(binding) || canonicalJson(originals.binding) !== canonicalJson(binding)
    || !Array.isArray(raw.originals) || raw.originals.length > 256 || !object(raw.context) || Buffer.byteLength(canonicalJson(raw.context)) > 32768) throw new Error("Continuation schema, bounded context or receiving authority binding mismatch");
  const identities = new Set<string>();
  for (const entry of raw.originals) {
    if (!object(entry) || !object(entry.request) || typeof entry.nativeRequestId !== "string" || !entry.nativeRequestId || entry.nativeRequestId.length > 2048
      || !["completed", "denied", "not_dispatched", "awaiting_approval", "pending", "unknown"].includes(String(entry.state))
      || Object.keys(entry).some(key => !["request", "nativeRequestId", "state", "outcome"].includes(key))
      || (["completed", "denied"].includes(String(entry.state))) !== (entry.outcome !== undefined)) throw new Error("Continuation original identity or verified outcome invalid");
    const identity = logicalKey(entry.request as unknown as KernelRequest);
    if (identities.has(identity)) throw new Error("Duplicate continuation original identity"); identities.add(identity);
  }
  assertPublicValue(raw, new Set()); originals.assertPublic(raw);
  return frozenJson(raw) as unknown as ContinuationEnvelope;
}
export async function exportContinuation(path: string, options: {binding: ContinuationBinding; requests: KernelRequest[]; originals: OriginalOperationPort; context?: Record<string, unknown>}): Promise<ContinuationEnvelope> {
  if (!Array.isArray(options.requests) || options.requests.length > 256) throw new Error("Continuation export requires at most 256 bounded original requests");
  assertBinding(options.binding);
  if (canonicalJson(options.binding) !== canonicalJson(options.originals.binding)) throw new Error("Continuation export authority binding mismatch");
  const entries: ContinuationEnvelope["originals"] = [];
  for (const request of options.requests) {
    const original = await options.originals.lookup(request);
    const signed = original.state === "completed" || original.state === "denied";
    if (signed && (!original.verified || original.outcome === undefined)) throw new Error("Original signed outcome verification unavailable");
    entries.push({request: frozenJson(request), nativeRequestId: original.nativeRequestId, state: original.state, ...(signed ? {outcome: original.outcome} : {})});
  }
  const envelope = validateEnvelope(withContentDigest({schema: "chio.pi.continuation.v1", binding: options.binding, originals: entries, context: options.context ?? {}}), options.binding, options.originals);
  await writePrivateJson(path, envelope); return envelope;
}
export async function importContinuation(path: string, options: {binding: ContinuationBinding; originals: OriginalOperationPort}): Promise<ContinuationEnvelope> {
  const envelope = validateEnvelope(await readPrivateJson(path), options.binding, options.originals);
  for (const entry of envelope.originals) {
    const original = await options.originals.lookup(entry.request);
    if (original.nativeRequestId !== entry.nativeRequestId) throw new Error("Continuation original native identity verification mismatch");
    if (["completed", "denied"].includes(entry.state) && (original.state !== entry.state || !original.verified || canonicalJson(entry.outcome) !== canonicalJson(original.outcome))) throw new Error("Continuation original signed outcome verification failed");
    if (!["completed", "denied"].includes(entry.state) && original.state !== entry.state) throw new Error("Continuation original state changed; inspect its native original independently");
  }
  return envelope;
}
