import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { canonicalJson, frozenJson } from "./tool-registry.js";

/** Host-only composition contracts. Callbacks implement a native facade, not
 * local admission predicates. Branding protects ownership, never authority. */
export interface NativeBinding {
  authorityDomain: string; tenant: string; process: string; runtime: string;
  lineage: string; isolationEpoch: string; policy: string; contracts: string; installGeneration: string;
}
declare const custodyBrand: unique symbol;
export interface NativeCustody { readonly [custodyBrand]: true }
declare const embeddingBrand: unique symbol;
export interface NativeEmbedding { readonly [embeddingBrand]: true }
export type NativeState = "completed" | "proven_undispatched" | "refused" | "unresolved";
export interface FrozenModelRequest {
  readonly requestId: string; readonly json: string; readonly utf8Size: number; readonly digest: string;
  readonly provider: "openai" | "openai-codex"; readonly accountId: string | null;
  readonly route: string; readonly profile: string; readonly model: string; readonly purpose: string;
  readonly credentialGeneration: string; readonly limitsIdentity: string;
  readonly binding: Readonly<NativeBinding>; readonly process: NativeCustody; readonly context: NativeCustody;
  readonly history: readonly NativeCustody[];
}
export interface NativeModelPort {
  /** Owns knowledge join, retained original intent, commit ACK and provider
   * submission. Never return a permit or delegate fetch back to the adapter. */
  releaseFrozenRequest(request: FrozenModelRequest, installedSink: object, signal?: AbortSignal): Promise<{state: NativeState; response?: Response}>;
  resolveApiAccount?(): Promise<string | null>;
  accountSpecific?: boolean;
}
export interface NativeKnowledgePort {
  reserve(process: object, original: Readonly<Record<string, unknown>>): Promise<object>;
  adoptLegacy(process: object, reservation: object, exact: Readonly<Record<string, unknown>>): Promise<object>;
  checkpoint(process: object, expectedRevision: string, context: object): Promise<object>;
  restore_into(process: object, checkpoint: object, installedSink: object): Promise<void>;
  copy(process: object, artifact: object): Promise<object>;
  export_into(process: object, artifact: object, installedSink: object): Promise<void>;
  import_archive(process: object, archive: object): Promise<object>;
}
export interface NativeRecoveryCommand { kind: "resume_original" | "linked_continuation" | "reconcile_original"; requestId: string; step?: NativeCustody }
export interface NativeRecoveryPort {
  /** Existing semantic runtime selects and retains an accepted native step.
   * Installation, framing, capture and proof acquisition remain native. */
  selectSemanticStep?(process: object, originalRequestId: string): Promise<object>;
  invoke(command: NativeRecoveryCommand, nativeStep?: object): Promise<{state: NativeState}>;
}
export interface NativeChildPort {
  /** MUST retain issuer/signature/capability/parent/request/budget before confined
   * launch, verifying native registry and accounting independently. */
  submit(process: object, installedTemplate: object, request: Readonly<{requestId: string; payload: Record<string, unknown>}>): Promise<{state: NativeState}>;
  reconcile(process: object, originalRequestId: string): Promise<{state: NativeState}>;
  cancel(process: object, originalRequestId: string): Promise<{state: NativeState}>;
  wait?(process: object, originalRequestId: string): Promise<{state: NativeState}>;
}
export interface NativeSessionPort {
  preflight(process: object, target: Readonly<Record<string, unknown>>): Promise<void>;
  /** Native custody checkpoint and release must finish before returning custom
   * summary content. No raw transcript/classifier fallback is permitted. */
  mediate(process: object, action: string, event: unknown, transcript: unknown): Promise<{
    compaction?: {summary: string; firstKeptEntryId: string; tokensBefore: number; details?: unknown};
    summary?: {summary: string; details?: unknown};
  }>;
}
export interface NativeExplanationPort {
  /** Uses existing P2 scoped inspection capability and /v1/recovery/explain. */
  explain(workflowId: string): Promise<unknown>;
}
export interface NativePorts {
  currentInstallation(): Promise<{binding: NativeBinding; expiresAt: number}>;
  model?: NativeModelPort; knowledge?: NativeKnowledgePort; recovery?: NativeRecoveryPort;
  children?: NativeChildPort; sessions?: NativeSessionPort; explanation?: NativeExplanationPort;
}
export interface NativeEmbeddingOptions {
  expectedBinding: NativeBinding; ports: NativePorts; process: object; context: object; history: readonly object[];
  sink: object; templates?: Readonly<Record<string, object>>; providerProfile: string;
  credentialGeneration: string; limitsIdentity: string; purpose: string; explanationAuthority?: Omit<ExplanationAuthority, "now">;
}
interface State {options: NativeEmbeddingOptions; process: NativeCustody; context: NativeCustody; history: readonly NativeCustody[]; fenced?: string}
const embeddings = new WeakMap<NativeEmbedding, State>();
const responseOriginals = new WeakMap<Response, {state: State; requestId: string}>();
const custody = new WeakMap<NativeCustody, {owner: NativeEmbedding; handle: object}>();
function retain(owner: NativeEmbedding, handle: object): NativeCustody {
  if (!handle || typeof handle !== "object") throw new Error("Native custody unavailable");
  const ref = Object.freeze({}) as NativeCustody; custody.set(ref, {owner, handle}); return ref;
}
export function nativeHandle(owner: NativeEmbedding, ref: NativeCustody): object {
  const value = custody.get(ref); if (!value || value.owner !== owner) throw new Error("Foreign native custody refused"); return value.handle;
}
export function createNativeEmbedding(options: NativeEmbeddingOptions): NativeEmbedding {
  const expectedBinding = frozenJson(options.expectedBinding);
  const required = ["authorityDomain", "tenant", "process", "runtime", "lineage", "isolationEpoch", "policy", "contracts", "installGeneration"];
  if (Object.keys(expectedBinding).length !== required.length || required.some(key => typeof expectedBinding[key as keyof NativeBinding] !== "string" || !expectedBinding[key as keyof NativeBinding])) throw new Error("Closed native installation binding required");
  const owner = Object.freeze({}) as NativeEmbedding;
  // Snapshot callbacks and installed selectors so later caller mutation cannot
  // redirect authority. Native installation rechecks remain mandatory.
  const methods: Record<string, string[]> = {
    model: ["releaseFrozenRequest", "resolveApiAccount", "accountSpecific"],
    knowledge: ["reserve", "adoptLegacy", "checkpoint", "restore_into", "copy", "export_into", "import_archive"],
    explanation: ["explain"], recovery: ["invoke", "selectSemanticStep"], children: ["submit", "reconcile", "cancel", "wait"], sessions: ["preflight", "mediate"],
  };
  const ports = Object.freeze(Object.fromEntries(Object.entries(options.ports).map(([key, port]) => {
    if (typeof port === "function") return [key, port.bind(options.ports)];
    if (!port || typeof port !== "object") return [key, port];
    const source = port as Record<string, unknown>;
    return [key, Object.freeze(Object.fromEntries((methods[key] ?? []).filter(name => source[name] !== undefined).map(name => {
      const value = source[name]; return [name, typeof value === "function" ? value.bind(port) : value];
    })))];
  }))) as unknown as NativePorts;
  const selected = Object.freeze({...options, ...(options.explanationAuthority ? {explanationAuthority: frozenJson(options.explanationAuthority)} : {}), expectedBinding, ports, templates: Object.freeze({...options.templates})});
  embeddings.set(owner, {options: selected, process: retain(owner, options.process), context: retain(owner, options.context), history: Object.freeze(options.history.map(handle => retain(owner, handle)))});
  return owner;
}
export async function currentNative(embedding?: NativeEmbedding): Promise<State> {
  const state = embedding && embeddings.get(embedding);
  if (!state) throw new Error("Trusted native embedding unavailable");
  const current = await state.options.ports.currentInstallation();
  if (!Number.isSafeInteger(current.expiresAt) || current.expiresAt <= Date.now() || canonicalJson(current.binding) !== canonicalJson(state.options.expectedBinding)) throw new Error("Native installation expired or binding mismatch");
  return state;
}
const requiredPortMethods: Record<string, string[]> = {
  model: ["releaseFrozenRequest"], knowledge: ["reserve", "adoptLegacy", "checkpoint", "restore_into", "copy", "export_into", "import_archive"],
  recovery: ["invoke"], children: ["submit", "reconcile", "cancel"], sessions: ["preflight", "mediate"], explanation: ["explain"],
};
export async function nativeFeatureAvailability(embedding?: NativeEmbedding) {
  const unavailable = Object.fromEntries(Object.keys(requiredPortMethods).map(name => [name, "unavailable"]));
  try {
    const {options} = await currentNative(embedding);
    return Object.fromEntries(Object.entries(requiredPortMethods).map(([name, methods]) => {
      const port = options.ports[name as keyof NativePorts] as unknown as Record<string, unknown> | undefined;
      const compatible = port && methods.every(method => typeof port[method] === "function") && (name !== "explanation" || options.explanationAuthority);
      return [name, compatible ? "native-qualification-required" : "unavailable"];
    }));
  } catch {return unavailable;}
}
export async function releaseGovernedModel(embedding: NativeEmbedding | undefined, json: string, selection: {provider: "openai" | "openai-codex"; model: string; route: string; accountId: string | null; profileIdentity?: string; limitsIdentity?: string}, signal?: AbortSignal): Promise<Response> {
  const state = await currentNative(embedding); const port = state.options.ports.model;
  if (!port) throw new Error("Native model release unavailable");
  if (selection.profileIdentity !== undefined && selection.profileIdentity !== state.options.providerProfile
    || selection.limitsIdentity !== undefined && selection.limitsIdentity !== state.options.limitsIdentity) throw new Error("Native model limits or provider profile binding mismatch");
  if (state.fenced) throw new Error("Original model release unresolved; native reconciliation required");
  if (signal?.aborted) throw new Error("Cancelled before native model release");
  const accountId = selection.provider === "openai" ? await port.resolveApiAccount?.() ?? null : selection.accountId;
  await currentNative(embedding);
  if (state.fenced) throw new Error("Original model release unresolved; native reconciliation required");
  if (signal?.aborted) throw new Error("Cancelled before native model release");
  if (port.accountSpecific && !accountId) throw new Error("Native provider account mapping unavailable");
  const requestId = randomUUID();
  const request: FrozenModelRequest = Object.freeze({provider: selection.provider, model: selection.model, route: selection.route, accountId, requestId, json, utf8Size: Buffer.byteLength(json, "utf8"), digest: createHash("sha256").update(json, "utf8").digest("hex"),
    profile: state.options.providerProfile, purpose: state.options.purpose, credentialGeneration: state.options.credentialGeneration, limitsIdentity: state.options.limitsIdentity,
    binding: state.options.expectedBinding, process: nativeHandle(embedding!, state.process) as NativeCustody, context: nativeHandle(embedding!, state.context) as NativeCustody, history: Object.freeze(state.history.map(ref => nativeHandle(embedding!, ref) as NativeCustody))});
  state.fenced = requestId; // Even a missing native response proves no non-dispatch.
  const result = await port.releaseFrozenRequest(request, state.options.sink, signal);
  if (result.state === "completed" && result.response instanceof Response) {responseOriginals.set(result.response, {state, requestId}); return result.response;}
  if (result.state === "proven_undispatched" || result.state === "refused") state.fenced = undefined;
  throw new Error("Native model release refused or unresolved");
}
export async function nativeKnowledge(embedding: NativeEmbedding, action: "reserve" | "adoptLegacy" | "checkpoint" | "restore_into" | "copy" | "export_into" | "import_archive", data: {reference?: NativeCustody; exact?: Record<string, unknown>; expectedRevision?: string} = {}): Promise<NativeCustody | void> {
  const state = await currentNative(embedding); const port = state.options.ports.knowledge;
  if (!port) throw new Error("Native knowledge unavailable");
  const process = nativeHandle(embedding, state.process);
  const reference = data.reference ? nativeHandle(embedding, data.reference) : undefined;
  let result: object | void = undefined;
  switch (action) {
    case "reserve": result = await port.reserve(process, frozenJson(data.exact ?? {})); break;
    case "adoptLegacy": if (!reference) throw new Error("Original reservation required"); result = await port.adoptLegacy(process, reference, frozenJson(data.exact ?? {})); break;
    case "checkpoint": if (!data.expectedRevision) throw new Error("Native checkpoint revision CAS required"); result = await port.checkpoint(process, data.expectedRevision, nativeHandle(embedding, state.context)); break;
    case "restore_into": if (!reference) throw new Error("Native checkpoint required"); await port.restore_into(process, reference, state.options.sink); break;
    case "copy": if (!reference) throw new Error("Native artifact required"); result = await port.copy(process, reference); break;
    case "export_into": if (!reference) throw new Error("Native artifact required"); await port.export_into(process, reference, state.options.sink); break;
    case "import_archive": if (!reference) throw new Error("Native archive required"); result = await port.import_archive(process, reference); break;
    default: throw new Error("Unknown native knowledge operation");
  }
  if (!result) return;
  const ref = retain(embedding, result);
  if (action !== "reserve") state.history = Object.freeze([...state.history, ref]);
  return ref;
}
export async function executeNativeRemedy(embedding: NativeEmbedding, outcome: "pending" | "denied" | "unknown", command: NativeRecoveryCommand) {
  const state = await currentNative(embedding); const port = state.options.ports.recovery;
  const expected = {pending: "resume_original", denied: "linked_continuation", unknown: "reconcile_original"};
  if (!port || expected[outcome] !== command.kind || !command.requestId || command.kind === "linked_continuation" && !command.step) throw new Error("Native original recovery authority unavailable");
  const step = command.step ? nativeHandle(embedding, command.step) : undefined;
  return port.invoke(Object.freeze({...command}), step);
}
const verifiedExplanations = new WeakSet<Readonly<Record<string, unknown>>>();
const summaries = ["authorized_inspection_required", "no_disclosable_advice", "alternatives_under_snapshot", "search_bound_reached"];
const assessments = ["feasible_under_snapshot", "requires_exact_approval", "requires_transformation", "requires_prerequisite", "needs_fresh_evidence", "blocked_by_capability", "unknown_outcome", "no_registered_remedy", "search_bound_reached"];
function closed(value: unknown, keys: string[]): asserts value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error("Closed P2 explanation schema required");
}
function opaque(value: unknown) {return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);}
export interface ExplanationAuthority {authorityKey: string; trustDomain: string; issuer: string; recipient: string; now?: number}
export function verifyExplanationView(view: unknown, expected: ExplanationAuthority): Readonly<Record<string, unknown>> {
  closed(view, ["body", "authority_key", "algorithm", "signature"]);
  closed(view.body, ["schema", "version", "planner_version", "trust_domain", "issuer", "recipient", "report_ref", "issued_at_unix_ms", "expires_at_unix_ms", "projection"]);
  const b = view.body; const now = expected.now ?? Date.now();
  if (view.algorithm !== "ed25519" || view.authority_key !== expected.authorityKey || !/^[a-f0-9]{64}$/.test(expected.authorityKey) || typeof view.signature !== "string" || !/^[a-f0-9]{128}$/.test(view.signature)
    || b.schema !== "chio.recovery.explanation-view.v1" || b.version !== 1 || b.planner_version !== "chio.recovery.planner.v1" || b.trust_domain !== expected.trustDomain || b.issuer !== expected.issuer || b.recipient !== expected.recipient
    || ![b.trust_domain, b.issuer, b.recipient, b.report_ref].every(opaque) || !Number.isSafeInteger(b.issued_at_unix_ms) || b.issued_at_unix_ms < 0 || !Number.isSafeInteger(b.expires_at_unix_ms)
    || !(b.issued_at_unix_ms <= now && now < b.expires_at_unix_ms && b.expires_at_unix_ms - b.issued_at_unix_ms <= 30000)) throw new Error("P2 authority or validity mismatch");
  closed(b.projection, ["summary", "candidates"]);
  const p = b.projection;
  if (!summaries.includes(p.summary) || !Array.isArray(p.candidates) || p.candidates.length > 16 || summaries.slice(0, 2).includes(p.summary) && p.candidates.length) throw new Error("Invalid P2 projection");
  let prior = "";
  for (const candidate of p.candidates) {
    closed(candidate, ["template_id", "assessment"]);
    if (!opaque(candidate.template_id) || candidate.template_id <= prior || !assessments.includes(candidate.assessment)) throw new Error("Invalid P2 candidate order or assessment");
    prior = candidate.template_id;
  }
  const key = createPublicKey({format: "der", type: "spki", key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(expected.authorityKey, "hex")])});
  if (!verify(null, Buffer.from("chio:recovery-explanation-view:v1\0" + canonicalJson(b), "utf8"), key, Buffer.from(view.signature, "hex"))) throw new Error("Invalid P2 explanation signature");
  const accepted = frozenJson(b);
  verifiedExplanations.add(accepted);
  return accepted;
}
export function renderExplanation(view: Readonly<Record<string, unknown>>): string {
  if (!verifiedExplanations.has(view)) throw new Error("A verified explanation is required before rendering");
  if (!(Number(view.issued_at_unix_ms) <= Date.now() && Date.now() < Number(view.expires_at_unix_ms))) throw new Error("P2 authority or validity mismatch");
  const projection = view.projection as {summary: string; candidates: {template_id: string; assessment: string}[]};
  return ["Signed advisory explanation. Candidates do not authorize effects.", projection.summary, ...projection.candidates.map(c => `${c.template_id}: ${c.assessment}`)].join("\n");
}

/** Default launcher has no native facade. Refuse before credentials, sessions,
 * gateway creation or provider egress. Programmatic hosts supply their own ports. */
export async function requireNativeGovernance(embedding?: NativeEmbedding) {
  if (!embedding) throw new Error("Required native governance unavailable; compatible trusted host facade required");
  const state = await currentNative(embedding);
  if (!state.options.ports.model || !state.options.ports.sessions) throw new Error("Required native governance unavailable; model release and Pi custody ports required");
}

/** Successful complete response observation releases only the adapter's extra
 * in-process interlock. The native service owns durable intent and accounting. */
export function finishGovernedModelDelivery(response: Response) {
  const original = responseOriginals.get(response);
  if (original && original.state.fenced === original.requestId) original.state.fenced = undefined;
  responseOriginals.delete(response);
}
export async function explainNativeRecovery(embedding: NativeEmbedding, workflowId: string): Promise<string> {
  const state = await currentNative(embedding); const port = state.options.ports.explanation;
  if (!port || !state.options.explanationAuthority || !opaque(workflowId)) throw new Error("Native scoped explanation unavailable");
  const signedView = await port.explain(workflowId);
  await currentNative(embedding);
  // The public view deliberately has no workflow/graph binding or authority to
  // execute candidate remedies. Protected native report checks remain required.
  return renderExplanation(verifyExplanationView(signedView, {...state.options.explanationAuthority, now: Date.now()}));
}

export async function prepareNativeContinuation(embedding: NativeEmbedding, originalRequestId: string): Promise<NativeCustody> {
  const state = await currentNative(embedding); const port = state.options.ports.recovery;
  if (!port?.selectSemanticStep || !originalRequestId) throw new Error("Native accepted semantic continuation unavailable");
  const handle = await port.selectSemanticStep(nativeHandle(embedding, state.process), originalRequestId);
  await currentNative(embedding);
  return retain(embedding, handle);
}
