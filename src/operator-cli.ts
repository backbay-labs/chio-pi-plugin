import {absolutePath, inspectOperation, invokeNative, newArtifactPath, object, OperatorError, OperatorRedactor, privateJson,
  readOperatorContext, resolveNativeOperator, statusView, type NativeAction, type OperatorContext} from "./operator.js";
import {canonicalJson} from "./tool-registry.js";

const HELP = `Usage:
  chio-pi doctor|status --config /absolute/private/prepared.json [--json]
  chio-pi inspect --config CONFIG --request ORIGINAL_REQUEST_ID [--json]
  chio-pi recover --config CONFIG --action recover-lock [--json]
  chio-pi recover --config CONFIG --action delivery-export --request ORIGINAL_REQUEST_ID --output NEW_PRIVATE_FILE [--json]
  chio-pi recover --config CONFIG --action delivery-acknowledge --input RECEIVED_ORIGINAL_ARTIFACT [--json]
  chio-pi recover --config CONFIG --action approval-submit --request ORIGINAL_REQUEST_ID --operator PRIVATE_OPERATOR_FILE --output NEW_PRIVATE_FILE [--json]
Diagnostics launch no model and contact no service. Recovery delegates only the named native operator action. Listing and export never ACK. Unknown outcomes retain their original fence.
approval-decide is unavailable in this frozen artifact. A separately qualified native operator must check the requested decision and approval ID against the signed credential before retention.
Owner-result import, capability attenuation, semantic recovery and native P5 qualification are unavailable. Whole-Pi Linux implementation and parent limits are described in docs/RUN-LIMITS-LINUX.md; these diagnostics do not launch or qualify them. See docs/OPERATOR.md and docs/NATIVE-PREREQUISITES.md.
`;
const recoveryOptions: Record<string, readonly string[]> = {
  "recover-lock": [], "delivery-export": ["--request", "--output"], "delivery-acknowledge": ["--input"],
  "approval-submit": ["--request", "--operator", "--output"],
};
const unavailable = new Set(["owner-result-import", "capability-attenuation", "semantic-recovery", "coding-resource", "durable-host-recovery", "whole-host-linux"]);
interface Parsed {command: "doctor" | "status" | "inspect" | "recover"; values: Map<string, string>; json: boolean;}
function invalid(): never {throw new OperatorError("invalid_arguments", "Invalid, missing, duplicate or unexpected operator arguments; use chio-pi status --help.");}
function parse(args: string[]): Parsed {
  const [command, ...rest] = args;
  if (!["doctor", "status", "inspect", "recover"].includes(command ?? "")) invalid();
  const values = new Map<string, string>(); let json = false;
  const names = new Set(["--config", "--request", "--action", "--input", "--output", "--operator", "--approval", "--decision"]);
  for (let index = 0; index < rest.length; index++) {
    const name = rest[index];
    if (name === "--json") {if (json) invalid(); json = true; continue;}
    const value = rest[++index];
    if (!names.has(name) || values.has(name) || !value || value.startsWith("--") || value.length > 4096 || value.includes("\0")) invalid();
    values.set(name, value);
  }
  let allowed = ["--config"];
  if (command === "inspect") allowed.push("--request");
  if (command === "recover") {
    const action = values.get("--action");
    if (action === "approval-decide") throw new OperatorError("native_prerequisite_unavailable", "Approval decision is unavailable in this frozen artifact. A separately qualified native operator must verify the requested decision and approval ID against the signed credential before retention. Original proposal, journal and fence remain; see docs/NATIVE-PREREQUISITES.md.");
    if (action && unavailable.has(action)) throw new OperatorError("capability_unavailable", "Requested native capability is unavailable in this pinned artifact. Preserve original state; see docs/NATIVE-PREREQUISITES.md and the separately qualified utility in docs/FINAL-QUALIFICATION.md.");
    if (!action || !Object.hasOwn(recoveryOptions, action)) invalid();
    allowed.push("--action", ...recoveryOptions[action]);
  }
  if (allowed.some(name => !values.has(name)) || [...values.keys()].some(name => !allowed.includes(name))) invalid();
  for (const name of ["--config", "--input", "--output", "--operator"]) if (values.has(name)) absolutePath(values.get(name)!);
  for (const name of ["--request", "--approval"]) if (values.has(name) && values.get(name)!.length > 2048) invalid();
  return {command: command as Parsed["command"], values, json};
}
function doctor(context: OperatorContext, status: Record<string, unknown>, bridge: {version: string; operatorSha256: string}): Record<string, unknown> {
  const local = (id: string, reason: string) => ({id, status: "available", available: true, scope: "installed_native_utility", reason});
  const missing = (id: string, reason: string) => ({id, status: "unavailable", available: false, reason});
  const credential = context.config.sessionCredential;
  return {...status, schema: "chio.pi.operator.doctor.v1", bridge: {version: bridge.version, operatorSha256: bridge.operatorSha256,
    identity: "Installed code hash. Version 0.3.0 alone does not identify the bridge variant."},
    configuredCredential: {issuedAt: Number.isSafeInteger(credential?.issuedAt) ? credential!.issuedAt : null,
      expiresAt: Number.isSafeInteger(credential?.expiresAt) ? credential!.expiresAt : null, liveValidation: "unavailable",
      note: "Configured lifetime metadata is not live session validation, revocation status or replacement authority."},
    counters: {tokensUsed: null, tokensRemaining: null, budgetRemaining: null, operationBudgetRemaining: null},
    capabilities: [
      local("native-status", "Native journal shape and authority binding; signatures are not verified by status."),
      local("exact-outcome-inspection", "Public native verifiers check the original completion or denial against its retained request."),
      local("dead-owner-lock-recovery", "Native utility removes only a provably dead same-host gateway lock and retains every operation."),
      local("original-delivery-export", "Native utility exports only an exact verified original completion, without dispatch or ACK."),
      local("original-delivery-acknowledge", "Explicit received original artifact and exclusive native gateway ownership are required; the kernel must confirm ACK."),
      local("original-approval-submit", "Explicit operator credential and original retained proposal; the native endpoint performs no protected dispatch."),
      missing("original-approval-decide", "The frozen utility does not bind the requested decision and approval ID to the signed credential before artifact retention. A separately qualified native operator is required."),
      missing("owner-result-import", "Absent from the bundled operator. Requires the separately qualified native exporter/importer in FINAL-QUALIFICATION.md."),
      missing("capability-attenuation", "No native issuer-backed child authority contract is exposed here; retained-session tool filtering is not attenuation."),
      missing("native-model-egress", "CLI --governance required refuses before provider credentials or egress. Default execution-only uses its fixed credential relay without native disclosure governance. A compatible trusted native committed-release facade and selected provider sink are required."),
      missing("native-knowledge", "P4 writer/broker, classifier roots, same-process custody and selected native artifact sinks are not installed by prepared JSON."),
      missing("native-pi-custody", "Native session preflight, checkpoint and summary-release services require trusted programmatic composition and native qualification."),
      missing("semantic-recovery", "No qualified native semantic host facade is configured; schema existence does not establish a service."),
      missing("coding-resource", "Kernel-owned coding participant ships as the separate chio-coding-resource entrypoint; it is not exposed by these operator commands. See docs/CODING-RESOURCE.md."),
      missing("durable-host-recovery", "Original-operation continuation and the optional Pi Durable adapter ship as trusted programmatic APIs; they are not exposed by these operator commands. See docs/CONTINUATION.md."),
      {id:"parent-model-limits",status:"available",available:true,scope:"trusted_parent",reason:"Protected launcher persists conservative request reservations and absolute deadline. API output tokens are reserved; Codex hard output-token accounting is unavailable. Diagnostics do not select a run or infer remaining model budget."},
      {id:"whole-host-linux",status:"local-confinement-tested",available:false,scope:"measured-linux-arm64",reason:"Bubblewrap whole-Pi launcher is implemented with selected runtime pins, two fixed Unix routes and separate no-fork seccomp. Measured Linux arm64 acceptance requires a privileged network-none outer container. Current installation, ordinary Docker, actual x64 and native P5 qualification remain separate prerequisites; see RUN-LIMITS-LINUX.md."},
    ], qualification: "Component diagnostics and installed native utility support only. No live kernel, provider, resource or confinement qualification is performed."};
}
async function recover(parsed: Parsed, context: OperatorContext, status: Record<string, unknown>, native: Awaited<ReturnType<typeof resolveNativeOperator>>): Promise<Record<string, unknown>> {
  const values = parsed.values;
  const action = values.get("--action") as NativeAction;
  const requestId = values.get("--request");
  const args: string[] = [];
  if (action === "delivery-export" || action === "approval-submit") {
    const original = inspectOperation(context, requestId!, status);
    const expected = action === "delivery-export" ? "completed" : "awaiting_approval";
    if (!object(original.operation) || original.operation.originalState !== expected)
      throw new OperatorError("original_state_refused", "Native recovery action does not match the original retained operation state; its fence is preserved.");
    args.push(requestId!);
  }
  if (action === "approval-submit") {
    const operator = await privateJson(values.get("--operator")!); context.redactor.collect(operator.value);
    if (!object(operator.value) || typeof operator.value.adminToken !== "string" || !operator.value.adminToken || operator.value.adminToken === context.config.execution.bearerToken)
      throw new OperatorError("operator_credential_required", "A distinct private operator-only admin credential is required.");
    args.push(operator.path);
  }
  if (action === "delivery-export" || action === "approval-submit") args.push(await newArtifactPath(context, values.get("--output")!));
  if (action === "delivery-acknowledge") {
    const received = await privateJson(values.get("--input")!); context.redactor.collect(received.value);
    if (!object(received.value) || received.value.schema !== "chio.gateway.delivered-outcome.v1" || !object(received.value.outcome)
      || typeof received.value.outcome.requestId !== "string") throw new OperatorError("original_delivery_required", "Explicit received original delivery artifact is required; export alone never acknowledges.");
    const original = inspectOperation(context, received.value.outcome.requestId, status);
    if (!object(original.verification) || original.verification.kind !== "signed_completion"
      || canonicalJson(original.request) !== canonicalJson(received.value.request) || canonicalJson(original.outcome) !== canonicalJson(received.value.outcome))
      throw new OperatorError("original_delivery_mismatch", "Received artifact differs from the exact verified original request and completion; its fence is preserved.");
    args.push(received.path);
  }
  const result = await invokeNative(native, action, context.configPath, args);
  context.redactor.collect(result);
  const nativeResult: Record<string, unknown> = {};
  const permitted = ["output", "requestId", "receiptId", "acknowledged", "acknowledgedByExport", "protectedDispatch", "status", "approvalId", "recovered", "journalsRetained"];
  for (const key of permitted) if (["string", "boolean"].includes(typeof result[key])) nativeResult[key] = result[key];
  if (action !== "recover-lock" && result.protectedDispatch !== false) throw new OperatorError("invalid_native_response", "Native recovery response lacks its no-dispatch contract; preserve the original operation.");
  if (action === "recover-lock" && (result.recovered !== true || result.journalsRetained !== true)) throw new OperatorError("invalid_native_response", "Native lock recovery did not confirm retained journals; preserve the original operation.");
  return {schema: "chio.pi.operator.recover.v1", action, sessionId: context.config.sessionId, protectedDispatch: false, nativeResult,
    nextAction: action === "delivery-export" ? "Receive and inspect the original private artifact, then explicitly acknowledge it. Export has not cleared the fence."
      : action === "recover-lock" ? "Only the dead owner lock was removed. Original journals and unresolved fences remain; inspect the original request before any continuation."
      : action === "approval-submit" ? "Submission does not execute the effect or supply a trusted decision credential. Preserve the original proposal; decision retention requires a separately qualified native operator."
      : "Only original delivery acknowledgement was requested. Preserve the received artifact and confirm native status before continuing."};
}
function readable(view: Record<string, unknown>): string {
  const lines = [`Chio Pi trusted operator: ${String(view.schema).split(".").at(-2)}`, `Retained session: ${String(view.sessionId)}`];
  if (object(view.lock)) lines.push(`Native owner lock: ${String(view.lock.state)}`);
  if (typeof view.fenced === "boolean") lines.push(`Original operation fence: ${view.fenced ? "retained" : "not set by native status"}`);
  if (object(view.authority)) lines.push(`Pinned allowed tools: ${(view.authority.allowedTools as string[]).join(", ")}`, `Configured caller/resource scope: ${JSON.stringify(view.authority)}`);
  if (Array.isArray(view.operations)) for (const operation of view.operations) if (object(operation)) lines.push(`${operation.requestId}: ${operation.state} (native ${operation.originalState})`, `  ${operation.nextAction}`);
  if (object(view.operation)) lines.push(`Original request: ${view.operation.requestId}`, `State: ${view.operation.state} (native ${view.operation.originalState})`, String(view.operation.nextAction));
  if (view.verification !== undefined) lines.push(`Original evidence: ${JSON.stringify(view.verification)}`);
  for (const key of ["request", "proposal", "outcome", "configuredCredential", "counters", "nativeResult"]) if (view[key] !== undefined) lines.push(`${key}: ${JSON.stringify(view[key], null, 2)}`);
  if (Array.isArray(view.capabilities)) for (const capability of view.capabilities) if (object(capability)) lines.push(`${capability.id}: ${capability.available ? "available in installed utility" : "unavailable"}. ${capability.reason}`);
  if (view.nextAction) lines.push(String(view.nextAction));
  if (view.evidenceVerification === "not_performed") lines.push("Status does not verify signatures or prove a protected effect. Inspect the exact original request for evidence.");
  return lines.join("\n") + "\n";
}

/** Trusted operator entrypoint. Parsing finishes before subprocesses or mutation.
 * Diagnostics neither load provider authentication nor start a Pi/model session. */
export async function runOperatorCommand(args: string[]): Promise<number> {
  if (args.length === 2 && ["doctor", "status", "inspect", "recover"].includes(args[0]) && args[1] === "--help") {process.stdout.write(HELP); return 0;}
  const redactor = new OperatorRedactor();
  try {
    const parsed = parse(args);
    const context = await readOperatorContext(parsed.values.get("--config")!, redactor);
    const native = await resolveNativeOperator();
    const status = statusView(context, await invokeNative(native, "status", context.configPath));
    const view = parsed.command === "doctor" ? doctor(context, status, native)
      : parsed.command === "inspect" ? inspectOperation(context, parsed.values.get("--request")!, status)
      : parsed.command === "recover" ? await recover(parsed, context, status, native) : status;
    const safe = redactor.redact(view) as Record<string, unknown>;
    process.stdout.write(parsed.json ? JSON.stringify(safe) + "\n" : readable(safe));
    return 0;
  } catch (error) {
    const controlled = error instanceof OperatorError ? error : new OperatorError("operator_refused", "Trusted operator could not validate private configuration, installed utility or original state. Preserve the original journal and request; no retry is authorized.");
    const view = redactor.redact({schema: "chio.pi.operator.error.v1", code: controlled.code, message: controlled.message});
    process.stderr.write(args.includes("--json") ? JSON.stringify(view) + "\n" : `Chio Pi operator refused: ${(view as Record<string, unknown>).message}\n`);
    return 1;
  }
}
