import {verifyBoundReceipt, verifyCompletedOutcome, type ExecutionOutcome, type ExecutionRequest} from "@chio/bridge";
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat, open, readFile, readdir, realpath} from "node:fs/promises";
import {basename, dirname, isAbsolute, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {preparedAuthorityDigest, type PreparedPiConfig} from "./configured.js";
import {canonicalJson, registryForConfig, validateKernelArguments, type ToolRegistry} from "./tool-registry.js";
import {readPrivateText} from "./private-state.js";

export interface OperationSummary {
  requestId: string;
  state: string;
  tool?: string;
  nextAction: string;
}

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Native status validates journal shape and authority, not effect signatures.
 * Pending, unknown and denied records retain their original dispatch fence. */
export function summarizeGatewayStatus(status: unknown): {sessionId: string; operations: OperationSummary[]} {
  if (!object(status) || status.schema !== "chio.gateway.status.v1" || typeof status.sessionId !== "string"
    || !status.sessionId || status.sessionId.length > 2048 || !Array.isArray(status.operations)) throw new Error("Invalid native gateway status");
  const identities = new Set<string>();
  const operations = status.operations.map((record: unknown): OperationSummary => {
    if (!object(record) || typeof record.requestId !== "string" || !record.requestId || record.requestId.length > 2048
      || identities.has(record.requestId)) throw new Error("Invalid native operation status");
    identities.add(record.requestId);
    let state: string;
    let nextAction: string;
    switch (record.state) {
      case "pending":
      case "unknown":
        state = "unknown_after_dispatch";
        nextAction = "Preserve the original request and fence. Reconcile the original outcome with its resource owner; never retry the effect under a new identity.";
        break;
      case "awaiting_approval":
        state = "approval_pending";
        nextAction = "Inspect and submit the exact retained proposal. Decision retention requires a separately qualified native operator binding the requested decision and approval ID; the frozen adapter refuses approval-decide. Resume only the original request after a trusted decision.";
        break;
      case "not_dispatched":
        state = "not_dispatched";
        nextAction = "Inspect the original retained reason. This record reports no dispatch; it does not resolve any other operation.";
        break;
      case "denied":
        state = "denied";
        nextAction = "Inspect and verify the original signed denial. Preserve its fence: a denial is not proof that an earlier effect did not occur.";
        break;
      case "completed": {
        const delivered = record.acknowledged === true && (record.hostDeliveryRequired === false || record.hostDeliveryConfirmed === true);
        state = delivered ? "completed_acknowledged" : "completed_pending_acknowledgement";
        nextAction = delivered
          ? "Inspect the original signed completion before trusting its effect; status alone does not verify it."
          : "Inspect and verify the original signed completion. Export its original delivery artifact if needed, then explicitly acknowledge the received artifact; listing or export never acknowledges delivery.";
        break;
      }
      default: throw new Error("Invalid native operation state");
    }
    return {requestId: record.requestId, state,
      ...(typeof record.tool === "string" && /^[a-zA-Z0-9_.-]{1,128}$/.test(record.tool) ? {tool: record.tool} : {}), nextAction};
  });
  return {sessionId: status.sessionId, operations};
}

export class OperatorError extends Error {
  constructor(readonly code: string, message: string) {super(message);}
}
function refuse(code: string, message: string): never {throw new OperatorError(code, message);}
const LIMIT = 1024 * 1024;
const states = new Set(["pending", "unknown", "awaiting_approval", "not_dispatched", "denied", "completed"]);
function hash(value: string): string {return createHash("sha256").update(value).digest("hex");}
function within(base: string, path: string): boolean {
  const part = relative(base, path);
  return part === "" || (part !== ".." && !part.startsWith("../") && !isAbsolute(part));
}
export function absolutePath(path: string): void {
  if (!path || path.length > 4096 || path.includes("\0") || resolve(path) !== path) refuse("invalid_path", "Operator paths must be absolute and normalized.");
}
async function privateDirectory(path: string): Promise<string> {
  absolutePath(path);
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid?.())
    refuse("private_path_required", "Operator state requires a private directory owned by the current user.");
  return realpath(path);
}
async function privateText(path: string): Promise<{path: string; text: string}> {
  absolutePath(path);
  try {
    return await readPrivateText(path, LIMIT);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    if (error instanceof Error && error.message.includes("changed")) return refuse("state_changed", "Operator state changed while reading; preserve the original operation and inspect again.");
    if (error instanceof Error && error.message.includes("UTF-8")) return refuse("invalid_private_json", "Private operator JSON requires strict UTF-8; no diagnostic source text is printed.");
    return refuse("private_path_required", "Operator files must be private regular files owned by the current user, at most 1 MiB.");
  }
}
export async function privateJson(path: string): Promise<{path: string; value: unknown}> {
  const file = await privateText(path);
  try {return {path: file.path, value: JSON.parse(file.text) as unknown};}
  catch {return refuse("invalid_private_json", "Private operator JSON is invalid; no diagnostic source text is printed.");}
}
function sensitive(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return !["sessioncredential", "configuredcredential"].includes(normalized)
    && /token|password|secret|authorization|apikey|privatekey|credential|accesskey|^auth(?:entication)?$|^acknowledgement/.test(normalized);
}
/** Redact sensitive fields and known secret values even when embedded in ordinary
 * strings. Native child stdout/stderr are never forwarded to the terminal. */
export class OperatorRedactor {
  private readonly secrets = new Set<string>();
  collect(value: unknown, credentialContainer = false, secretValue = false): void {
    if (typeof value === "string") {if (secretValue && value) this.secrets.add(value); return;}
    if (Array.isArray(value)) {for (const child of value) this.collect(child, credentialContainer, secretValue); return;}
    if (object(value)) for (const [key, child] of Object.entries(value)) {
      const field = sensitive(key);
      // Hide credential objects wholesale when rendered, but only register actual
      // secret fields and credential signatures for global value redaction. Public
      // request/caller/signer/scope IDs inside them remain usable elsewhere.
      const material = credentialContainer && /^(?:signature(?:hex|base64)?|sig|key|value|access|refresh|payload|seed)$/.test(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
      this.collect(child, credentialContainer || field, field || material);
    }
  }
  redact(value: unknown): unknown {
    if (typeof value === "string") {
      let safe = value;
      for (const secret of [...this.secrets].sort((a, b) => b.length - a.length)) safe = safe.split(secret).join("[REDACTED]");
      return safe.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]");
    }
    if (Array.isArray(value)) return value.map(child => this.redact(child));
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [this.redact(key) as string, sensitive(key) && child !== null ? "[REDACTED]" : this.redact(child)]));
    return value;
  }
}
export interface OperatorContext {
  configPath: string;
  config: PreparedPiConfig & {journalDir: string; sessionCredential?: Record<string, unknown>};
  registry: ToolRegistry;
  records: Map<string, Record<string, unknown>>;
  hostBindingPresent: boolean;
  redactor: OperatorRedactor;
}
export async function readOperatorContext(path: string, redactor: OperatorRedactor): Promise<OperatorContext> {
  const loaded = await privateJson(path);
  redactor.collect(loaded.value);
  const raw = loaded.value;
  if (!object(raw) || !object(raw.execution) || typeof raw.sessionId !== "string" || !raw.sessionId || raw.sessionId.length > 2048
    || typeof raw.journalDir !== "string" || !Array.isArray(raw.tools) || !raw.tools.length || raw.execution.fetchImpl !== undefined
    || typeof raw.execution.sessionId !== "string" || !raw.execution.sessionId || !Array.isArray(raw.execution.trustedSigners))
    return refuse("invalid_configuration", "Prepared retained-session configuration and explicit pinned tools are required.");
  const config = raw as unknown as OperatorContext["config"];
  const execution = config.execution;
  if (typeof execution.endpoint !== "string" || execution.endpoint.length > 4096 || typeof execution.bearerToken !== "string" || !execution.bearerToken
    || !/^[a-f0-9]{64}$/i.test(execution.subjectKey) || typeof execution.capabilityId !== "string" || !execution.capabilityId
    || typeof execution.serverId !== "string" || !execution.serverId || !execution.trustedSigners.length
    || execution.trustedSigners.some(key => typeof key !== "string" || !/^[a-f0-9]{64}$/i.test(key)))
    return refuse("invalid_configuration", "Prepared retained caller, capability, resource and trusted signer fields are invalid.");
  let endpoint: URL;
  try {endpoint = new URL(execution.endpoint);}
  catch {return refuse("invalid_endpoint", "Prepared kernel endpoint is invalid; no credential-bearing source value is printed.");}
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/"
    || (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))))
    return refuse("invalid_endpoint", "Prepared kernel endpoint must be a bare HTTPS or loopback HTTP origin without credentials, query, fragment or MCP path.");
  let registry: ToolRegistry;
  try {registry = registryForConfig(config);}
  catch {return refuse("invalid_registry", "Prepared tool inventory or schemas are invalid.");}
  config.journalDir = await privateDirectory(config.journalDir);
  const nativeBinding = canonicalJson({sessionId: config.sessionId, kernelSessionId: config.execution.sessionId,
    endpoint: config.execution.endpoint, subjectKey: config.execution.subjectKey, capabilityId: config.execution.capabilityId,
    serverId: config.execution.serverId, trustedSigners: config.execution.trustedSigners, tools: config.tools,
    ...(config.approval ? {approval: config.approval} : {})});
  if ((await privateText(join(config.journalDir, "authority.binding"))).text !== nativeBinding)
    return refuse("authority_binding_mismatch", "Native journal authority differs from the prepared configuration; no recovery or dispatch is permitted.");
  const names = await readdir(config.journalDir);
  // Capacity limits govern new admission, never access to retained originals.
  // Native status and recovery must remain available when a session is full.
  const hostBindingPresent = names.includes("pi-host.binding");
  if (hostBindingPresent) {
    const binding = (await privateJson(join(config.journalDir, "pi-host.binding"))).value;
    if (!object(binding) || (Object.hasOwn(binding, "governanceProfile") && binding.governanceProfile !== "execution-only" && binding.governanceProfile !== "required"))
      return refuse("host_binding_mismatch", "Pinned governance profile is invalid; preserve the original host binding.");
    const expected = {schema: "chio.pi.host-binding.v1", piVersion: "1.0.2", registryDigest: registry.digest,
      authorityDigest: preparedAuthorityDigest(config, registry), sessionId: config.sessionId, kernelSessionId: config.execution.sessionId,
      ...(Object.hasOwn(binding, "governanceProfile") ? {governanceProfile: binding.governanceProfile} : {})};
    if (canonicalJson(binding) !== canonicalJson(expected)) return refuse("host_binding_mismatch", "Pinned Pi host, registry or authority differs from the original host binding.");
  }
  for (const name of ["gateway.lock", "recovery.lock"]) if (names.includes(name)) redactor.collect((await privateJson(join(config.journalDir, name))).value);
  if (names.includes("approvals")) await privateDirectory(join(config.journalDir, "approvals"));
  const records = new Map<string, Record<string, unknown>>();
  for (const name of names.filter(name => name.endsWith(".json"))) {
    const record = (await privateJson(join(config.journalDir, name))).value;
    redactor.collect(record);
    if (!object(record) || typeof record.requestId !== "string" || !record.requestId || record.requestId.length > 2048
      || name !== hash(record.requestId) + ".json" || typeof record.state !== "string" || !states.has(record.state))
      return refuse("invalid_journal", "Native operation identity, filename or state is invalid; preserve the journal.");
    records.set(record.requestId, record);
  }
  return {configPath: loaded.path, config, registry, records, hostBindingPresent, redactor};
}
export interface NativeOperator {entrypoint: string; version: string; operatorSha256: string;}
/** package.json is a public bridge export. The operator module is deliberately
 * executed as the installed native binary instead of importing a private API. */
export async function resolveNativeOperator(): Promise<NativeOperator> {
  const metadataPath = fileURLToPath(import.meta.resolve("@chio/bridge/package.json"));
  const root = await realpath(dirname(metadataPath));
  if (basename(root) !== "bridge" || basename(dirname(root)) !== "@chio" || basename(dirname(dirname(root))) !== "node_modules")
    return refuse("native_operator_unavailable", "Trusted operator requires an installed @chio/bridge package.");
  const metadataStat = await lstat(metadataPath);
  if (!metadataStat.isFile() || metadataStat.isSymbolicLink() || metadataStat.size > LIMIT) return refuse("native_operator_unavailable", "Installed bridge metadata is invalid.");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
  if (metadata.name !== "@chio/bridge" || !object(metadata.bin) || metadata.bin["chio-gateway-operator"] !== "./dist/gateway-operator.js")
    return refuse("native_operator_unavailable", "Installed bridge lacks the expected trusted operator binary.");
  const requested = join(root, "dist", "gateway-operator.js");
  const entrypoint = await realpath(requested);
  const stat = await lstat(requested);
  if (!within(root, entrypoint) || !stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * LIMIT)
    return refuse("native_operator_unavailable", "Trusted operator entrypoint escapes or differs from its installed bridge package.");
  return {entrypoint, version: typeof metadata.version === "string" ? metadata.version : "unknown", operatorSha256: hash(await readFile(entrypoint, "utf8"))};
}
export type NativeAction = "status" | "recover-lock" | "delivery-export" | "delivery-acknowledge" | "approval-submit";
export async function invokeNative(operator: NativeOperator, action: NativeAction, configPath: string, args: string[] = []): Promise<Record<string, unknown>> {
  const executable = await realpath(process.execPath);
  const result = await new Promise<string>((done, reject) => {
    const child = spawn(executable, [operator.entrypoint, action, configPath, ...args], {shell: false, stdio: ["ignore", "pipe", "pipe"],
      env: {PATH: dirname(executable), LANG: "en_US.UTF-8", OPENSSL_CONF: "/dev/null"}});
    let stdout = ""; let bytes = 0; let failed = false; let kill: ReturnType<typeof setTimeout> | undefined;
    // A child that ignores TERM is killed after a short grace. Settlement still
    // waits for its observed close; a kill request is not exit evidence.
    const fail = () => {if (failed) return; failed = true; child.kill("SIGTERM"); kill = setTimeout(() => child.kill("SIGKILL"), 2000);};
    const timer = setTimeout(fail, 45000);
    child.stdout.on("data", (value: Buffer) => {bytes += value.length; if (bytes > 4 * LIMIT) fail(); else stdout += value.toString("utf8");});
    child.stderr.on("data", (value: Buffer) => {bytes += value.length; if (bytes > 4 * LIMIT) fail();});
    child.once("error", () => {clearTimeout(timer); clearTimeout(kill); reject(new OperatorError("native_operator_failed", "Trusted native operator could not start; preserve the original operation."));});
    child.once("close", code => {clearTimeout(timer); clearTimeout(kill); if (failed || code !== 0) reject(new OperatorError("native_operator_refused", "Trusted native operator refused or could not finish the action. Preserve the original journal and artifacts; no protected tool was dispatched by this command.")); else done(stdout);});
  });
  try {const value: unknown = JSON.parse(result); if (object(value)) return value;}
  catch { /* Never forward parse diagnostics or native child output. */ }
  return refuse("invalid_native_response", "Trusted native operator returned an invalid response; preserve the original operation.");
}
export function statusView(context: OperatorContext, native: Record<string, unknown>): Record<string, unknown> {
  const summary = summarizeGatewayStatus(native);
  if (summary.sessionId !== context.config.sessionId || summary.operations.length !== context.records.size || typeof native.fenced !== "boolean"
    || !object(native.lock) || !["alive", "dead", "unverifiable", "missing", "recovered-dead-owner"].includes(String(native.lock.state)))
    return refuse("native_status_mismatch", "Native status differs from the retained configuration or inventory; preserve the operation and inspect again.");
  const operations = summary.operations.map(operation => {
    const record = context.records.get(operation.requestId);
    const reported = (native.operations as Record<string, unknown>[]).find(value => value.requestId === operation.requestId)!;
    if (!record || record.state !== reported.state) return refuse("state_changed", "Native operation state changed during diagnostics; inspect the original request again.");
    const tool = object(record.request) ? record.request.tool : object(record.proposal) ? record.proposal.tool_name : undefined;
    return {...operation, ...(typeof tool === "string" ? {tool} : {}),
      originalState: record.state, acknowledged: reported.acknowledged === true,
      hostDeliveryRequired: reported.hostDeliveryRequired !== false, hostDeliveryConfirmed: reported.hostDeliveryConfirmed === true};
  });
  return {schema: "chio.pi.operator.status.v1", ...summary, operations,
    kernelSessionId: context.config.execution.sessionId, lock: {state: native.lock.state,
      ...(Number.isSafeInteger(native.lock.pid) ? {pid: native.lock.pid} : {}), ...(typeof native.lock.hostname === "string" ? {hostname: native.lock.hostname} : {})},
    fenced: native.fenced, evidenceVerification: "not_performed",
    authority: {subjectKey: context.config.execution.subjectKey, capabilityId: context.config.execution.capabilityId, serverId: context.config.execution.serverId,
      endpoint: context.config.execution.endpoint, allowedTools: context.config.tools.map(tool => tool.name), resourceScope: null},
    registry: {mode: context.registry.mode, digest: context.registry.digest, hostBindingPresent: context.hostBindingPresent,
      tools: context.registry.tools.map(tool => ({name: tool.name, kernelTool: tool.kernelTool, parameters: tool.parameters}))}};
}
export function inspectOperation(context: OperatorContext, requestId: string, status: Record<string, unknown>): Record<string, unknown> {
  const record = context.records.get(requestId);
  if (!record) return refuse("original_record_missing", "Original request is absent from the retained journal. Absence does not prove no dispatch and never permits retry; preserve its original identity and reconcile with the resource owner.");
  // The bundled gateway retains an undispatched approval as a proposal, without
  // a separate request field. Its exact proposal and digest are the original.
  const retainedProposal = object(record.proposal) ? record.proposal : undefined;
  const fromProposal = !record.request && ["awaiting_approval", "not_dispatched"].includes(String(record.state)) && retainedProposal !== undefined;
  const retainedRequest = fromProposal
    ? {requestId: retainedProposal.request_id, tool: retainedProposal.tool_name, arguments: retainedProposal.arguments}
    : record.request;
  if (!object(retainedRequest) || retainedRequest.requestId !== requestId || typeof retainedRequest.tool !== "string")
    return refuse("original_request_invalid", "Original retained request is missing or mismatched; preserve its fence.");
  const request = retainedRequest as unknown as ExecutionRequest;
  let args: Record<string, unknown>;
  try {args = validateKernelArguments(context.registry, request.tool, request.arguments);}
  catch {return refuse("original_request_invalid", "Original retained arguments differ from the pinned tool schema; preserve its fence.");}
  if (record.digest !== hash(canonicalJson({name: request.tool, args})))
    return refuse("original_digest_mismatch", "Original retained request digest differs from its arguments; preserve its fence.");
  let verified = false;
  let kind = "not_verified";
  if (record.state === "completed") {
    if (!object(record.outcome) || !verifyCompletedOutcome(record.outcome as unknown as ExecutionOutcome, context.config.execution, request))
      return refuse("completion_verification_failed", "Original completion failed signature, result or exact request verification; preserve its fence and never repeat its effect.");
    verified = true; kind = "signed_completion";
  } else if (record.state === "denied") {
    const outcome = record.outcome;
    if (!object(outcome) || outcome.state !== "denied" || outcome.evidence !== "verified" || outcome.requestId !== requestId
      || outcome.result !== undefined || outcome.delivery !== undefined || record.acknowledged === true || record.hostDeliveryConfirmed === true
      || !verifyBoundReceipt(outcome.receipt, {...context.config.execution, tool: request.tool, parameters: args, requestId})
      || outcome.receipt.decision?.verdict !== "deny" || outcome.reason !== outcome.receipt.decision.reason)
      return refuse("denial_verification_failed", "Original denial failed exact signature, request or reason verification; preserve its fence.");
    verified = true; kind = "signed_denial";
  }
  if (record.state === "awaiting_approval" || fromProposal) {
    const proposal = record.proposal;
    if (!object(proposal) || proposal.request_id !== requestId || proposal.session_id !== context.config.execution.sessionId
      || proposal.capability_id !== context.config.execution.capabilityId || proposal.tool_name !== request.tool
      || canonicalJson(proposal.arguments) !== canonicalJson(args))
      return refuse("proposal_binding_mismatch", "Retained approval proposal differs from the original request or authority; no approval action is permitted.");
  }
  const operation = (status.operations as Record<string, unknown>[]).find(value => value.requestId === requestId);
  if (!operation) return refuse("native_status_mismatch", "Original operation is missing from native status; never infer permission to retry.");
  return {schema: "chio.pi.operator.inspect.v1", sessionId: context.config.sessionId, fenced: status.fenced, operation,
    verification: {verified, kind}, request, requestSource: fromProposal ? "retained_native_proposal" : "retained_native_request",
    ...(record.outcome !== undefined ? {outcome: record.outcome} : {}), ...(record.proposal !== undefined ? {proposal: record.proposal} : {})};
}
export async function newArtifactPath(context: OperatorContext, path: string): Promise<string> {
  absolutePath(path);
  const canonical = join(await privateDirectory(dirname(path)), basename(path));
  if (within(context.config.journalDir, canonical)) return refuse("invalid_output", "New delivery and approval artifacts must remain outside the authoritative journal.");
  try {await lstat(canonical);}
  catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return canonical; throw error;}
  return refuse("output_exists", "Native output must be a new private artifact; existing files are never overwritten.");
}
