import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import * as plugin from "../dist/index.js";
import { startModelRelay } from "../dist/model-relay.js";
import { verifyBoundReceipt } from "@chio/bridge";
const {createGateway, operationKey} = await import(new URL("./gateway.js", import.meta.resolve("@chio/bridge")));
const {gatewayStatus} = await import(new URL("./gateway-operator.js", import.meta.resolve("@chio/bridge")));
const sdk = await import(new URL("../node_modules/@chio-protocol/sdk/dist/invariants/index.js", import.meta.resolve("@chio/bridge")));
const {canonicalizeJson, sha256Hex, signUtf8MessageEd25519} = sdk;
const {privateKey, publicKey} = generateKeyPairSync("ed25519");
const signer = publicKey.export({type: "spki", format: "der"}).subarray(-32).toString("hex");
const seed = privateKey.export({type: "pkcs8", format: "der"}).subarray(-32).toString("hex");
const args = {path: "source.ts"};
const tools = [{name: "read_text_file", description: "Read source", inputSchema: {type: "object", properties: {path: {type: "string"}}, required: ["path"], additionalProperties: false}}];
const execution = {sessionId: "kernel-session", endpoint: "http://127.0.0.1:1/mcp", bearerToken: "fixture-only", subjectKey: "ab".repeat(32), capabilityId: "capability", serverId: "coding", trustedSigners: [signer]};
function signedReceipt(requestId, overrides = {}, completed = false) {
  const result = {content: [{type: "text", text: "signed fixture result"}]};
  const body = {timestamp: 1783000000, capability_id: execution.capabilityId, tool_server: execution.serverId, tool_name: "read_text_file",
    action: {parameters: args, parameter_hash: sha256Hex(canonicalizeJson(args))}, decision: {verdict: completed ? "allow" : "deny", ...(!completed ? {reason: "original retained denial"} : {})},
    receipt_kind: "mediated_decision", boundary_class: "prevent", trust_level: "mediated", tool_origin: "caller_executed", redaction_mode: "none",
    content_hash: sha256Hex(canonicalizeJson(result)), policy_hash: "cd".repeat(32), kernel_key: signer,
    metadata: {receipt_context: {request_id: requestId}, attribution: {subject_key: execution.subjectKey},
      admission_operation: {schema: "chio.admission-receipt.v1", request_id: requestId, projected_state: completed ? "completed" : "denied", projected_dispatch_state: "terminal", tool_outcome_id: "ef".repeat(32)}}, ...overrides};
  const id = sha256Hex(canonicalizeJson(body));
  return {...body, id, signature: signUtf8MessageEd25519(canonicalizeJson({id, body}), seed).signature_hex};
}
function denied(requestId) {return {state: "denied", evidence: "verified", requestId, reason: "original retained denial", receipt: signedReceipt(requestId)};}
function completed(requestId) {
  const receipt = signedReceipt(requestId, {}, true);
  return {state: "completed", evidence: "verified", requestId, receipt, result: {content: [{type: "text", text: "signed fixture result"}]},
    delivery: {schema: "chio.mcp.delivery-ack.v1", requestId, requestHash: sha256Hex(canonicalizeJson({method: "tools/call", params: {name: "read_text_file", arguments: args, _meta: {chioRequestId: requestId}}})), receiptId: receipt.id, resultHash: receipt.content_hash, acknowledgement: "a".repeat(43)}};
}
async function fixture(state = "denied", transform = value => value) {
  const journalDir = await mkdtemp(join(tmpdir(), "chio-retained-history-"));
  const config = {sessionId: "host-session", execution, tools, journalDir};
  let dispatches = 0; let acks = 0;
  const gateway = createGateway(config, {async execute(request) {dispatches++; return transform(state === "denied" ? denied(request.requestId) : completed(request.requestId));}, async acknowledge() {acks++; return {acknowledged: true};}}, {requireHostAcknowledgement: true});
  const original = await gateway.call("original-call", "read_text_file", args);
  assert.equal(original.state, state);
  return {config, gateway, original, registry: plugin.createToolRegistry(tools), counts: () => ({dispatches, acks}), async close() {gateway.close(); await rm(journalDir, {recursive: true, force: true});}};
}
function observer(f) {
  assert.equal(typeof plugin.createHostDeliveryObserver, "function", "protected parent must verify retained denied history");
  return plugin.createHostDeliveryObserver(f.config, f.gateway);
}
function request(f, outcome) {
  return {model: "gpt-4.1-mini", store: false, stream: true,
    tools: f.registry.tools.map(tool => ({type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: false})),
    input: [{type: "function_call", call_id: "native-call", name: "chio_read", arguments: JSON.stringify(args)}, {type: "function_call_output", call_id: "native-call", output: JSON.stringify(outcome)}]};
}

test("genuine signed retained denial reaches egress without ACK or clearing its original fence", async () => {
  const f = await fixture(); const originalFetch = globalThis.fetch; let upstream = 0;
  let relay;
  try {
    assert.equal(verifyBoundReceipt(f.original.receipt, {...execution, tool: "read_text_file", parameters: args, requestId: f.original.requestId}), true);
    const before = await readFile(join(f.config.journalDir, operationKey(f.original.requestId) + ".json"), "utf8");
    globalThis.fetch = async (url, init) => String(url).startsWith("http://127.0.0.1:") ? originalFetch(url, init) : (upstream++, new Response("data: [DONE]\n\n"));
    relay = await startModelRelay({provider: "openai", apiKey: "fixture-only"}, "gpt-4.1-mini", observer(f), f.registry);
    const response = await fetch(`http://127.0.0.1:${relay.port}/v1/responses`, {method: "POST", headers: {authorization: `Bearer ${relay.token}`}, body: JSON.stringify(request(f, f.original))});
    assert.equal(response.status, 200); await response.text();
    assert.equal(upstream, 1);
    assert.deepEqual(f.counts(), {dispatches: 1, acks: 0});
    assert.equal(gatewayStatus(f.config).fenced, true);
    assert.equal(await readFile(join(f.config.journalDir, operationKey(f.original.requestId) + ".json"), "utf8"), before);
  } finally {await relay?.close(); globalThis.fetch = originalFetch; await f.close();}
});

for (const fault of ["signature", "caller", "resource", "request", "nonexistent", "reason", "result"]) test(`protected denied history refuses ${fault} substitution before egress`, async () => {
  const f = await fixture(); const originalFetch = globalThis.fetch; let upstream = 0;
  let relay;
  try {
    const value = structuredClone(f.original);
    if (fault === "signature") value.receipt.signature = "00".repeat(64);
    if (fault === "caller") value.receipt = signedReceipt(value.requestId, {metadata: {...value.receipt.metadata, attribution: {subject_key: "11".repeat(32)}}});
    if (fault === "resource") value.receipt = signedReceipt(value.requestId, {tool_server: "foreign-resource"});
    if (fault === "request") value.receipt = signedReceipt("another-original-request");
    if (fault === "nonexistent") {value.requestId = "nonexistent-original"; value.receipt = signedReceipt(value.requestId);}
    if (fault === "reason") value.reason = "substituted denial explanation";
    if (fault === "result") value.result = {content: [{type: "text", text: "substituted denied result"}]};
    globalThis.fetch = async (url, init) => String(url).startsWith("http://127.0.0.1:") ? originalFetch(url, init) : (upstream++, new Response("data: [DONE]\n\n"));
    relay = await startModelRelay({provider: "openai", apiKey: "fixture-only"}, "gpt-4.1-mini", observer(f), f.registry);
    const response = await fetch(`http://127.0.0.1:${relay.port}/v1/responses`, {method: "POST", headers: {authorization: `Bearer ${relay.token}`}, body: JSON.stringify(request(f, value))});
    assert.equal(response.status, 502); await response.text();
    assert.equal(upstream, 0);
    assert.deepEqual(f.counts(), {dispatches: 1, acks: 0});
    assert.equal(gatewayStatus(f.config).fenced, true);
  } finally {await relay?.close(); globalThis.fetch = originalFetch; await f.close();}
});

test("protected completed native history still delegates exact result ACK before egress", async () => {
  const f = await fixture("completed"); const originalFetch = globalThis.fetch; let upstream = 0;
  let relay;
  try {
    assert.deepEqual(f.counts(), {dispatches: 1, acks: 0});
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) return originalFetch(url, init);
      assert.deepEqual(f.counts(), {dispatches: 1, acks: 1}, "full retained result ACK must precede provider egress");
      upstream++; return new Response("data: [DONE]\n\n");
    };
    relay = await startModelRelay({provider: "openai", apiKey: "fixture-only"}, "gpt-4.1-mini", observer(f), f.registry);
    const response = await fetch(`http://127.0.0.1:${relay.port}/v1/responses`, {method: "POST", headers: {authorization: `Bearer ${relay.token}`}, body: JSON.stringify(request(f, f.original))});
    assert.equal(response.status, 200); await response.text();
    assert.equal(upstream, 1);
    assert.deepEqual(f.counts(), {dispatches: 1, acks: 1});
    assert.equal(gatewayStatus(f.config).fenced, false);
  } finally {await relay?.close(); globalThis.fetch = originalFetch; await f.close();}
});

for (const fault of ["signature", "caller", "resource", "request", "allow"]) test(`retained denied history still requires trusted ${fault} verification`, async () => {
  const f = await fixture("denied", value => {
    if (fault === "signature") value.receipt.signature = "00".repeat(64);
    if (fault === "caller") value.receipt = signedReceipt(value.requestId, {metadata: {...value.receipt.metadata, attribution: {subject_key: "11".repeat(32)}}});
    if (fault === "resource") value.receipt = signedReceipt(value.requestId, {tool_server: "foreign-resource"});
    if (fault === "request") value.receipt = signedReceipt("another-original-request");
    if (fault === "allow") value.receipt = signedReceipt(value.requestId, {}, true);
    return value;
  });
  try {
    await assert.rejects(observer(f)([f.original]), /denied|denial|retained|receipt/);
    assert.deepEqual(f.counts(), {dispatches: 1, acks: 0});
    assert.equal(gatewayStatus(f.config).fenced, true);
  } finally {await f.close();}
});
