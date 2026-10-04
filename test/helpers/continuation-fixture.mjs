import assert from "node:assert/strict";
import {createHash, generateKeyPairSync} from "node:crypto";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {startGatewayHttp} from "@chio/bridge";
import {pinHostRegistry, preparedAuthorityDigest} from "../../dist/configured.js";
import {canonicalJson, registryForConfig} from "../../dist/tool-registry.js";

const sdk = await import(new URL("../node_modules/@chio-protocol/sdk/dist/invariants/index.js", import.meta.resolve("@chio/bridge")));
const {canonicalizeJson, sha256Hex, signUtf8MessageEd25519} = sdk;
const {privateKey, publicKey} = generateKeyPairSync("ed25519");
export const signer = publicKey.export({type: "spki", format: "der"}).subarray(-32).toString("hex");
const seed = privateKey.export({type: "pkcs8", format: "der"}).subarray(-32).toString("hex");
export const hash = value => createHash("sha256").update(value).digest("hex");
export const tools = [{name: "write_file", description: "Synthetic retained write", inputSchema: {type: "object", properties: {path: {type: "string"}, content: {type: "string"}}, required: ["path", "content"], additionalProperties: false}}];
export const request = (call = "call-1") => ({sessionId: "pi-host-1", toolCallId: call, tool: "write_file", arguments: {path: "source.ts", content: "exact original"}});

export function signedOutcome(config, nativeRequest, state = "completed", overrides = {}) {
  const result = {content: [{type: "text", text: "synthetic resource committed once"}], isError: false};
  const body = {timestamp: 1783000000, capability_id: config.execution.capabilityId, tool_server: config.execution.serverId, tool_name: nativeRequest.tool,
    action: {parameters: nativeRequest.arguments, parameter_hash: sha256Hex(canonicalizeJson(nativeRequest.arguments))}, decision: {verdict: state === "completed" ? "allow" : "deny", ...(state === "denied" ? {reason: "retained original denial"} : {})},
    receipt_kind: "mediated_decision", boundary_class: "prevent", trust_level: "mediated", tool_origin: "caller_executed", redaction_mode: "none", content_hash: sha256Hex(canonicalizeJson(result)), policy_hash: "cd".repeat(32), kernel_key: signer,
    metadata: {receipt_context: {request_id: nativeRequest.requestId}, attribution: {subject_key: config.execution.subjectKey}, admission_operation: {schema: "chio.admission-receipt.v1", request_id: nativeRequest.requestId, projected_state: state, projected_dispatch_state: "terminal", tool_outcome_id: "ef".repeat(32)}}, ...overrides};
  const id = sha256Hex(canonicalizeJson(body));
  const receipt = {...body, id, signature: signUtf8MessageEd25519(canonicalizeJson({id, body}), seed).signature_hex};
  if (state === "denied") return {state, evidence: "verified", requestId: nativeRequest.requestId, receipt, reason: "retained original denial"};
  return {state, evidence: "verified", requestId: nativeRequest.requestId, receipt, result,
    delivery: {schema: "chio.mcp.delivery-ack.v1", requestId: nativeRequest.requestId, requestHash: sha256Hex(canonicalizeJson({method: "tools/call", params: {name: nativeRequest.tool, arguments: nativeRequest.arguments, _meta: {chioRequestId: nativeRequest.requestId, ...nativeRequest.approval}}})), receiptId: id, resultHash: receipt.content_hash, acknowledgement: "a".repeat(43)}};
}
export function approvedParams(config, requestId, args) {
  const now = Math.floor(Date.now() / 1000);
  const intent = {server_id: config.execution.serverId, tool_name: "write_file", body: {kind: "bound_tool_invocation", value: {capability_id: config.execution.capabilityId, parameters_hash: "0x" + sha256Hex(canonicalizeJson(args))}}, context: {mcpSessionId: config.execution.sessionId, capabilityId: config.execution.capabilityId}};
  const body = {id: "synthetic-approval", approver: signer, subject: config.execution.subjectKey, governed_intent_hash: sha256Hex(canonicalizeJson(intent)), request_id: requestId, issued_at: now - 1, expires_at: now + 300, decision: "approved"};
  return {name: "write_file", arguments: args, _meta: {chioRequestId: requestId, chioGovernedIntent: intent, chioApprovalToken: {...body, signature: signUtf8MessageEd25519(canonicalizeJson(body), seed).signature_hex}}};
}

export async function nativeFixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "chio-continuation-"));
  const journalDir = join(directory, "journal"); await mkdir(journalDir, {mode: 0o700});
  let effects = 0; let acks = 0; let nativeCalls = 0; const messages = []; const outcomes = new Map();
  let config;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8")); messages.push(message);
    assert.equal(req.url, "/mcp"); assert.equal(req.headers.authorization, "Bearer private-synthetic-bearer");
    assert.equal(req.headers["mcp-session-id"], "retained-kernel-session");
    let result;
    if (message.method === "chio/execution-context") result = {schema: "chio.mcp.execution-context.v1", evidenceVersion: "1", deliveryAcknowledgementVersion: "1", subjectKey: config.execution.subjectKey, capabilityIds: [config.execution.capabilityId], serverId: config.execution.serverId, sessionCredential: config.sessionCredential};
    else if (message.method === "tools/call") {
      nativeCalls++;
      const p = message.params; const id = p._meta.chioRequestId;
      if (!outcomes.has(id)) {
        if (options.state !== "denied") effects++;
        outcomes.set(id, signedOutcome(config, {requestId: id, tool: p.name, arguments: p.arguments, ...(p._meta.chioApprovalToken ? {approval: {chioApprovalToken: p._meta.chioApprovalToken, chioGovernedIntent: p._meta.chioGovernedIntent}} : {})}, options.state ?? "completed"));
      }
      const outcome = outcomes.get(id);
      result = {...outcome.result, _meta: {chioEvidence: {schema: "chio.mcp.execution-evidence.v1", requestId: id, receipt: outcome.receipt, terminalState: outcome.state, outputKind: "value", output: outcome.result}, ...(outcome.delivery ? {chioDelivery: outcome.delivery} : {})}};
    } else if (message.method === "chio/acknowledge") {acks++; result = {...message.params, acknowledged: true};}
    else throw new Error("Unexpected synthetic kernel method");
    res.writeHead(200, {"Content-Type": "application/json"}).end(JSON.stringify({jsonrpc: "2.0", id: message.id, result}));
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const now = Math.floor(Date.now() / 1000);
  config = {sessionId: "native-host-session", journalDir, tools,
    execution: {sessionId: "retained-kernel-session", endpoint: `http://127.0.0.1:${server.address().port}`, bearerToken: "private-synthetic-bearer", subjectKey: "ab".repeat(32), capabilityId: "public-capability-id", serverId: "coding", trustedSigners: [signer], timeoutMs: 1500},
    sessionCredential: {schema: "chio.mcp.session-credential.v1", sessionId: "retained-kernel-session", subjectKey: "ab".repeat(32), capabilityIds: ["public-capability-id"], serverId: "coding", endpointPath: "/mcp", allowedTools: tools.map(t => t.name), issuedAt: now - 5, expiresAt: now + 300, sessionToken: "private-synthetic-session"},
    ...(options.approval ? {approval: {requiredTools: ["write_file"], purpose: "synthetic approved write", ttlSeconds: 300}} : {})};
  const configPath = join(directory, "config.json"); await writeFile(configPath, JSON.stringify(config), {mode: 0o600});
  const registry = registryForConfig(config); await pinHostRegistry(config, registry, journalDir);
  let native = await startGatewayHttp(config);
  const binding = {authorityDigest: preparedAuthorityDigest(config, registry), registryDigest: registry.digest};
  return {directory, config, configPath, registry, binding, get native() {return native;}, messages, outcomes,
    counts: () => ({effects, acks, nativeCalls}),
    async restart() {await native.close(); native = await startGatewayHttp(config); return native;},
    async record(nativeId) {return JSON.parse(await readFile(join(journalDir, hash(nativeId) + ".json"), "utf8"));},
    async close() {await native.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); await rm(directory, {recursive: true, force: true});}};
}

export async function guestRpc(proxy, session, id, method, params, extras = {}) {
  const response = await fetch(proxy.url, {method: "POST", redirect: "error", headers: {"Content-Type": "application/json", Authorization: `Bearer ${proxy.token}`, ...(session ? {"Mcp-Session-Id": session} : {}), ...extras}, body: JSON.stringify({jsonrpc: "2.0", ...(id === undefined ? {} : {id}), method, ...(params === undefined ? {} : {params})})});
  return {status: response.status, session: response.headers.get("mcp-session-id"), body: response.status === 202 ? undefined : await response.json()};
}
export async function initialize(proxy) {
  const result = await guestRpc(proxy, "", "initialize", "initialize", {protocolVersion: "2025-11-25"});
  assert.equal(result.status, 200); assert.ok(result.session); return result.session;
}
export const call = (proxy, session, logical = request()) => guestRpc(proxy, session, JSON.stringify([logical.sessionId, logical.toolCallId]), "tools/call", {name: logical.tool, arguments: logical.arguments});
export const bodyOutcome = reply => JSON.parse(reply.body.result.content[0].text);
export const redigest = value => ({...value, contentDigest: hash(canonicalJson(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "contentDigest"))))});
