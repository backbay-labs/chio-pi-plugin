import assert from "node:assert/strict";
import {createHash, generateKeyPairSync} from "node:crypto";
import {execFileSync, spawn} from "node:child_process";
import {createHook} from "node:async_hooks";
import {chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {hostname, tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import * as plugin from "../dist/index.js";
import {verifyCompletedOutcome} from "@chio/bridge";
import {pinHostRegistry} from "../dist/configured.js";
import {registryForConfig} from "../dist/tool-registry.js";
const {createGateway, operationKey} = await import(new URL("./gateway.js", import.meta.resolve("@chio/bridge")));
const sdk = await import(new URL("../node_modules/@chio-protocol/sdk/dist/invariants/index.js", import.meta.resolve("@chio/bridge")));
const {canonicalizeJson, sha256Hex, signUtf8MessageEd25519} = sdk;
const {privateKey, publicKey} = generateKeyPairSync("ed25519");
const signer = publicKey.export({type: "spki", format: "der"}).subarray(-32).toString("hex");
const seed = privateKey.export({type: "pkcs8", format: "der"}).subarray(-32).toString("hex");
const secrets = ["secret-fixture-token", "session-secret-fixture", "provider-secret-fixture", "admin-secret-fixture", "approval-secret-fixture", "delivery-secret-fixture"];
const tools = [{name: "read_text_file", description: "Read pinned source", inputSchema: {type: "object", properties: {path: {type: "string"}, context: {type: "object"}, note: {type: "string"}}, required: ["path"], additionalProperties: false}}];
const requestArgs = {path: "/workspace/source.ts"};

function signedOutcome(config, request, state = "completed") {
  const result = {content: [{type: "text", text: "retained original source"}]};
  if (request.approval) result.content.push({type: "text", text: `credential echo ${request.approval.chioApprovalToken.signature}`});
  const body = {timestamp: 1783000000, capability_id: config.execution.capabilityId, tool_server: config.execution.serverId, tool_name: request.tool,
    action: {parameters: request.arguments, parameter_hash: sha256Hex(canonicalizeJson(request.arguments))},
    decision: {verdict: state === "completed" ? "allow" : "deny", ...(state === "denied" ? {reason: "original retained denial"} : {})},
    receipt_kind: "mediated_decision", boundary_class: "prevent", trust_level: "mediated", tool_origin: "caller_executed", redaction_mode: "none",
    content_hash: sha256Hex(canonicalizeJson(result)), policy_hash: "cd".repeat(32), kernel_key: signer,
    metadata: {receipt_context: {request_id: request.requestId}, attribution: {subject_key: config.execution.subjectKey},
      admission_operation: {schema: "chio.admission-receipt.v1", request_id: request.requestId, projected_state: state, projected_dispatch_state: "terminal", tool_outcome_id: "ef".repeat(32)}}};
  const id = sha256Hex(canonicalizeJson(body));
  const receipt = {...body, id, signature: signUtf8MessageEd25519(canonicalizeJson({id, body}), seed).signature_hex};
  if (state === "denied") return {state, evidence: "verified", requestId: request.requestId, reason: "original retained denial", receipt};
  return {state, evidence: "verified", requestId: request.requestId, receipt, result,
    delivery: {schema: "chio.mcp.delivery-ack.v1", requestId: request.requestId,
      requestHash: sha256Hex(canonicalizeJson({method: "tools/call", params: {name: request.tool, arguments: request.arguments, _meta: {chioRequestId: request.requestId, ...request.approval}}})),
      receiptId: receipt.id, resultHash: receipt.content_hash, acknowledgement: "a".repeat(43)}};
}

function approvedParams(config, requestId, args, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const intent = {server_id: config.execution.serverId, tool_name: "read_text_file",
    body: {kind: "bound_tool_invocation", value: {capability_id: config.execution.capabilityId, parameters_hash: "0x" + sha256Hex(canonicalizeJson(args))}},
    context: {mcpSessionId: config.execution.sessionId, capabilityId: config.execution.capabilityId}};
  const tokenBody = {id: options.approvalId ?? "fixture-approval", approver: signer, subject: config.execution.subjectKey, governed_intent_hash: sha256Hex(canonicalizeJson(intent)),
    request_id: requestId, issued_at: now - 1, expires_at: now + 300, decision: options.decision ?? "approved"};
  return {name: "read_text_file", arguments: args, _meta: {chioRequestId: requestId, chioGovernedIntent: intent,
    chioApprovalToken: {...tokenBody, signature: signUtf8MessageEd25519(canonicalizeJson(tokenBody), seed).signature_hex}}};
}

async function fixture(state = "completed", options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "chio-operator-"));
  const journalDir = join(directory, "journal");
  await mkdir(journalDir, {mode: 0o700});
  let network = 0; let dispatches = 0; let acknowledgements = 0;
  let handler = (req, res) => {res.writeHead(503); res.end("No fixture request expected");};
  const server = createServer((req, res) => {network++; handler(req, res);});
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const config = {sessionId: "retained-host-session", journalDir, tools, scope: {workspace: "/workspace"},
    execution: {sessionId: "kernel-session", endpoint: options.endpoint ?? `http://127.0.0.1:${server.address().port}`, bearerToken: secrets[0], subjectKey: "ab".repeat(32), capabilityId: "original-capability", serverId: "coding", trustedSigners: [signer]},
    sessionCredential: {schema: "chio.mcp.session-credential.v1", sessionId: "kernel-session", subjectKey: "ab".repeat(32), capabilityIds: ["original-capability"], serverId: "coding", endpointPath: "/mcp", allowedTools: ["read_text_file"], issuedAt: 1, expiresAt: 3600, sessionToken: secrets[1]},
    provider: {apiKey: secrets[2]}, adminToken: secrets[3],
    ...(options.approved ? {authentication: {schema: "chio.pi.operator.status.v1", caller: "ab".repeat(32), resource: "coding", tool: "read_text_file",
      path: (options.arguments ?? requestArgs).path, key: secrets[4]}} : {}),
    ...(state === "awaiting_approval" || options.approved ? {approval: {requiredTools: ["read_text_file"], purpose: "Inspect original source", ttlSeconds: 300}} : {})};
  const configPath = join(directory, "prepared.json");
  await writeFile(configPath, JSON.stringify(config), {mode: 0o600});
  await pinHostRegistry(config, registryForConfig(config), journalDir);
  const gateway = createGateway(config, {async execute(request) {dispatches++; return signedOutcome(config, request, state);}, async acknowledge() {acknowledgements++; return {acknowledged: true};}}, {requireHostAcknowledgement: true});
  let original = await gateway.call("fixture-call", "read_text_file", options.arguments ?? requestArgs);
  if (options.approved) {
    assert.equal(original.state, "awaiting_approval");
    const directory = join(journalDir, "approvals"); await mkdir(directory, {mode: 0o700});
    const params = approvedParams(config, original.requestId, options.arguments ?? requestArgs);
    await writeFile(join(directory, operationKey(original.requestId) + ".json"), JSON.stringify({toolCallParams: params}), {mode: 0o600});
    original = await gateway.call("fixture-resume", "chio_resume", {requestId: original.requestId, tool: "read_text_file", arguments: options.arguments ?? requestArgs});
    assert.equal(original.state, "completed", "native gateway must validate the actual signed approval before fixture completion");
  }
  if (!options.alive) gateway.close();
  return {directory, config, configPath, journalDir, gateway, original,
    setHandler(value) {handler = value;},
    recordPath: join(journalDir, operationKey(original.requestId) + ".json"),
    counts: () => ({network, dispatches, acknowledgements}),
    async close() {if (options.alive) gateway.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, {recursive: true, force: true});}};
}

async function capture(args) {
  assert.equal(typeof plugin.runOperatorCommand, "function", "trusted operator runner must be exported");
  const out = process.stdout.write; const err = process.stderr.write;
  let stdout = ""; let stderr = "";
  process.stdout.write = value => {stdout += value; return true;};
  process.stderr.write = value => {stderr += value; return true;};
  try {return {code: await plugin.runOperatorCommand(args), stdout, stderr};}
  finally {process.stdout.write = out; process.stderr.write = err;}
}
async function snapshot(path) {
  const files = {};
  for (const name of (await readdir(path)).sort()) {
    const full = join(path, name); const info = await lstat(full);
    files[name] = info.isDirectory() ? await snapshot(full) : await readFile(full, "utf8");
  }
  return files;
}
function assertRedacted(result) {
  for (const secret of [...secrets, "a".repeat(43)]) assert.equal(`${result.stdout}${result.stderr}`.includes(secret), false, "operator output must suppress every known credential");
}
function subprocess(file, args, env = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {shell: false, env: {PATH: dirname(process.execPath), LANG: "en_US.UTF-8", ...env}, stdio: ["ignore", "pipe", "pipe"]});
    let stdout = ""; let stderr = ""; let timedOut = false;
    const timer = options.timeoutMs ? setTimeout(() => {timedOut = true; child.kill("SIGKILL");}, options.timeoutMs) : undefined;
    child.stdout.on("data", value => stdout += value); child.stderr.on("data", value => stderr += value);
    child.once("error", error => {clearTimeout(timer); reject(error);});
    child.once("close", code => {clearTimeout(timer); resolve({code, stdout, stderr, timedOut});});
  });
}

const nativeStatus = {
  schema: "chio.gateway.status.v1", sessionId: "retained-host-session",
  lock: {state: "missing"}, fenced: true,
  bearerToken: "secret-fixture-token", sessionToken: "secret-fixture-token",
  provider: {apiKey: "secret-fixture-token"},
  operations: [
    {requestId: "completed", state: "completed", acknowledged: false, hostDeliveryRequired: true, hostDeliveryConfirmed: false},
    {requestId: "unknown", state: "unknown", acknowledged: false},
    {requestId: "pending", state: "pending", acknowledged: false},
    {requestId: "approval", state: "awaiting_approval", acknowledged: false},
    {requestId: "undispatched", state: "not_dispatched", acknowledged: false},
    {requestId: "denied", state: "denied", acknowledged: false},
  ],
};

test("native status summarizes original operations without exposing credentials or permitting unknown replay", () => {
  assert.equal(typeof plugin.summarizeGatewayStatus, "function", "trusted operator summary must be exported");
  const before = JSON.stringify(nativeStatus);
  const view = plugin.summarizeGatewayStatus(nativeStatus);
  assert.equal(view.sessionId, "retained-host-session");
  assert.equal(view.operations.find(value => value.requestId === "unknown").state, "unknown_after_dispatch");
  assert.equal(view.operations.find(value => value.requestId === "pending").state, "unknown_after_dispatch");
  assert.equal(view.operations.find(value => value.requestId === "completed").state, "completed_pending_acknowledgement");
  assert.equal(view.operations.find(value => value.requestId === "approval").state, "approval_pending");
  assert.equal(view.operations.find(value => value.requestId === "undispatched").state, "not_dispatched");
  assert.equal(view.operations.find(value => value.requestId === "denied").state, "denied");
  assert.match(view.operations.find(value => value.requestId === "denied").nextAction, /fence/i);
  assert.match(view.operations.find(value => value.requestId === "unknown").nextAction, /original/i);
  assert.equal(JSON.stringify(view).includes("secret-fixture-token"), false);
  assert.equal(JSON.stringify(nativeStatus), before);
});

test("status and doctor use the bundled native utility with no model, network, ACK or journal mutation", async () => {
  const f = await fixture();
  try {
    const before = await snapshot(f.journalDir); const counts = f.counts();
    const status = await capture(["status", "--config", f.configPath, "--json"]);
    assert.equal(status.code, 0, status.stderr); assertRedacted(status);
    const view = JSON.parse(status.stdout);
    assert.equal(view.operations[0].state, "completed_pending_acknowledgement");
    assert.equal(view.operations[0].originalState, "completed");
    assert.equal(view.evidenceVerification, "not_performed");
    assert.equal(view.fenced, true);
    assert.deepEqual(view.authority.allowedTools, ["read_text_file"]);
    assert.equal(view.registry.mode, "typed");
    const doctor = await capture(["doctor", "--config", f.configPath, "--json"]);
    assert.equal(doctor.code, 0, doctor.stderr); assertRedacted(doctor);
    const diagnosis = JSON.parse(doctor.stdout);
    assert.equal(diagnosis.configuredCredential.expiresAt, 3600);
    assert.equal(diagnosis.configuredCredential.liveValidation, "unavailable");
    assert.ok(Object.values(diagnosis.counters).every(value => value === null));
    for (const id of ["owner-result-import", "capability-attenuation", "semantic-recovery", "coding-resource", "durable-host-recovery", "whole-host-linux"])
      assert.equal(diagnosis.capabilities.find(value => value.id === id).available, false, id);
    assert.equal(diagnosis.capabilities.find(value => value.id === "native-status").available, true);
    assert.match(diagnosis.bridge.operatorSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(f.counts(), counts);
    assert.deepEqual(await snapshot(f.journalDir), before);
  } finally {await f.close();}
});

test("first-token operator commands bypass protected platform, installed-plugin and provider launch requirements", async () => {
  const f = await fixture();
  try {
    const before = await snapshot(f.journalDir); const counts = f.counts();
    const result = await subprocess(fileURLToPath(new URL("../dist/protected-cli.js", import.meta.url)), ["status", "--config", f.configPath, "--json"], {OPENAI_API_KEY: secrets[2], CHIO_PI_MODEL_TOKEN: secrets[1]});
    assert.equal(result.code, 0, result.stderr); assertRedacted(result);
    assert.equal(JSON.parse(result.stdout).operations[0].originalState, "completed");
    assert.deepEqual(f.counts(), counts); assert.deepEqual(await snapshot(f.journalDir), before);
    const alias = join(f.directory, "chio-pi");
    await symlink(fileURLToPath(new URL("../dist/protected-cli.js", import.meta.url)), alias);
    const symlinked = await subprocess(alias, ["status", "--config", f.configPath, "--json"]);
    assert.equal(symlinked.code, 0, symlinked.stderr);
    assert.ok(symlinked.stdout, "npm-style binary symlink must run the operator");
    assert.equal(JSON.parse(symlinked.stdout).operations[0].originalState, "completed");
    const imported = await subprocess("--input-type=module", ["--eval", `await import(${JSON.stringify(new URL("../dist/protected-cli.js", import.meta.url).href)})`]);
    assert.equal(imported.code, 0, imported.stderr); assert.equal(imported.stdout, ""); assert.equal(imported.stderr, "");
  } finally {await f.close();}
});

test("inspect verifies original completed signature, result and request before labeling the effect verified", async () => {
  const f = await fixture();
  try {
    const before = await snapshot(f.journalDir); const counts = f.counts();
    const result = await capture(["inspect", "--config", f.configPath, "--request", f.original.requestId, "--json"]);
    assert.equal(result.code, 0, result.stderr); assertRedacted(result);
    const view = JSON.parse(result.stdout);
    assert.equal(view.verification.verified, true); assert.equal(view.verification.kind, "signed_completion");
    assert.equal(view.operation.originalState, "completed"); assert.equal(view.operation.acknowledged, false);
    assert.deepEqual(view.request.arguments, requestArgs);
    assert.equal(view.outcome.result.content[0].text, "retained original source");
    assert.equal(view.outcome.delivery.acknowledgement, "[REDACTED]");
    assert.deepEqual(f.counts(), counts); assert.deepEqual(await snapshot(f.journalDir), before);
  } finally {await f.close();}
});

test("approved completed diagnostics preserve public recovery bindings while hiding the approval credential and genuine secret echoes", async () => {
  const args = {path: "/workspace/approved-source.ts", note: `provider credential ${secrets[2]}`};
  const f = await fixture("completed", {approved: true, arguments: args});
  try {
    const before = await snapshot(f.journalDir); const counts = f.counts();
    const record = JSON.parse(await readFile(f.recordPath, "utf8"));
    assert.equal(verifyCompletedOutcome(record.outcome, f.config.execution, record.request), true, "native completion must bind the real signed approval and requestHash");
    const signature = record.request.approval.chioApprovalToken.signature;
    const expectedArgs = {...args, note: "provider credential [REDACTED]"};
    for (const command of ["doctor", "status", "inspect"]) for (const json of [true, false]) {
      const result = await capture([command, "--config", f.configPath, ...(command === "inspect" ? ["--request", f.original.requestId] : []), ...(json ? ["--json"] : [])]);
      assert.equal(result.code, 0, result.stderr); assertRedacted(result);
      assert.equal(`${result.stdout}${result.stderr}`.includes(signature), false, "approval credential signature must be hidden even in signed result text");
      assert.ok(result.stdout.includes(f.original.requestId), `${command} must preserve the exact original request ID`);
      assert.ok(result.stdout.includes(f.config.execution.subjectKey), `${command} must preserve the public caller binding`);
      assert.ok(result.stdout.includes(f.config.execution.serverId), `${command} must preserve the public resource binding`);
      assert.ok(result.stdout.includes("read_text_file"), `${command} must preserve the original tool`);
      if (json) {
        const view = JSON.parse(result.stdout);
        if (command === "inspect") {
          assert.equal(view.operation.requestId, f.original.requestId); assert.equal(view.request.requestId, f.original.requestId);
          assert.equal(view.request.tool, "read_text_file"); assert.deepEqual(view.request.arguments, expectedArgs);
          assert.equal(view.request.approval.chioApprovalToken, "[REDACTED]");
          assert.equal(view.outcome.receipt.metadata.attribution.subject_key, f.config.execution.subjectKey);
          assert.equal(view.outcome.receipt.kernel_key, signer);
          assert.equal(view.outcome.receipt.signature, record.outcome.receipt.signature, "public receipt proof is not an approval credential");
          assert.equal(view.outcome.result.content[1].text, "credential echo [REDACTED]");
          assert.deepEqual(view.verification, {verified: true, kind: "signed_completion"});
        } else {
          assert.equal(view.schema, command === "doctor" ? "chio.pi.operator.doctor.v1" : "chio.pi.operator.status.v1");
          assert.equal(view.operations[0].requestId, f.original.requestId); assert.equal(view.operations[0].tool, "read_text_file");
          assert.equal(view.authority.subjectKey, f.config.execution.subjectKey); assert.equal(view.authority.serverId, f.config.execution.serverId);
          assert.equal(view.authority.capabilityId, f.config.execution.capabilityId);
        }
      } else if (command === "inspect") {
        assert.ok(result.stdout.includes(args.path)); assert.ok(result.stdout.includes('"chioApprovalToken": "[REDACTED]"'));
        assert.ok(result.stdout.includes("credential echo [REDACTED]"));
      }
    }
    assert.deepEqual(f.counts(), counts); assert.deepEqual(await snapshot(f.journalDir), before);
  } finally {await f.close();}
});

for (const fault of ["signature", "result", "caller", "resource", "request", "arguments", "delivery", "digest"]) test(`inspect refuses a retained completion with substituted ${fault} despite native completed status`, async () => {
  const f = await fixture();
  try {
    const record = JSON.parse(await readFile(f.recordPath, "utf8"));
    if (fault === "signature") record.outcome.receipt.signature = "00".repeat(64);
    if (fault === "result") record.outcome.result.content[0].text = "forged retained result";
    if (fault === "caller") record.outcome.receipt.metadata.attribution.subject_key = "00".repeat(32);
    if (fault === "resource") record.outcome.receipt.tool_server = "foreign-resource";
    if (fault === "request") record.request.requestId = "replacement-request";
    if (fault === "arguments") record.request.arguments.path = "/workspace/other.ts";
    if (fault === "delivery") record.outcome.delivery.requestHash = "00".repeat(32);
    if (fault === "digest") record.digest = "00".repeat(32);
    await writeFile(f.recordPath, JSON.stringify(record));
    const before = await snapshot(f.journalDir);
    const status = await capture(["status", "--config", f.configPath, "--json"]);
    assert.equal(status.code, 0, status.stderr); assert.equal(JSON.parse(status.stdout).evidenceVerification, "not_performed");
    const inspected = await capture(["inspect", "--config", f.configPath, "--request", f.original.requestId, "--json"]);
    assert.equal(inspected.code, 1); assertRedacted(inspected);
    assert.equal(`${inspected.stdout}${inspected.stderr}`.includes('"verified":true'), false);
    assert.deepEqual(await snapshot(f.journalDir), before);
  } finally {await f.close();}
});

test("inspect verifies an exact signed denial without ACK or treating it as undispatched", async () => {
  const f = await fixture("denied");
  try {
    const before = await snapshot(f.journalDir); const counts = f.counts();
    const result = await capture(["inspect", "--config", f.configPath, "--request", f.original.requestId, "--json"]);
    assert.equal(result.code, 0, result.stderr); assertRedacted(result);
    const view = JSON.parse(result.stdout);
    assert.equal(view.verification.verified, true); assert.equal(view.verification.kind, "signed_denial");
    assert.equal(view.operation.state, "denied"); assert.equal(view.fenced, true);
    assert.equal(view.outcome.reason, "original retained denial");
    assert.match(view.operation.nextAction, /fence/i);
    assert.deepEqual(f.counts(), counts); assert.deepEqual(await snapshot(f.journalDir), before);
    const record = JSON.parse(await readFile(f.recordPath, "utf8")); record.outcome.reason = "substituted denial";
    await writeFile(f.recordPath, JSON.stringify(record));
    assert.equal((await capture(["inspect", "--config", f.configPath, "--request", f.original.requestId, "--json"])).code, 1);
  } finally {await f.close();}
});

test("inspect renders exact original proposal arguments while redacting auth fields and embedded known credentials", async () => {
  const args = {path: "/workspace/source.ts", context: {bearerToken: secrets[0], sessionToken: secrets[1], provider: {apiKey: secrets[2]},
    authentication: {key: "unknown-authentication-value"}, providerCredential: "unknown-provider-credential", _meta: {chioApprovalToken: secrets[4]}}, note: `private ${secrets[0]}`};
  const f = await fixture("awaiting_approval", {arguments: args});
  try {
    const before = await snapshot(f.journalDir); const counts = f.counts();
    const result = await capture(["inspect", "--config", f.configPath, "--request", f.original.requestId, "--json"]);
    assert.equal(result.code, 0, result.stderr); assertRedacted(result);
    const view = JSON.parse(result.stdout);
    assert.equal(view.operation.state, "approval_pending");
    assert.equal(view.proposal.tool_name, "read_text_file");
    assert.equal(view.proposal.arguments.path, args.path);
    assert.equal(view.proposal.arguments.context.bearerToken, "[REDACTED]");
    assert.equal(view.proposal.arguments.context._meta.chioApprovalToken, "[REDACTED]");
    assert.equal(view.proposal.arguments.context.authentication, "[REDACTED]");
    assert.equal(view.proposal.arguments.context.providerCredential, "[REDACTED]");
    assert.equal(view.proposal.arguments.note, "private [REDACTED]");
    assert.equal(view.verification.verified, false);
    assert.deepEqual(f.counts(), counts); assert.deepEqual(await snapshot(f.journalDir), before);
  } finally {await f.close();}
});

test("delivery export uses native exact completion without dispatch, ACK, overwrite or journal mutation", async () => {
  const f = await fixture();
  try {
    const before = await snapshot(f.journalDir); const counts = f.counts();
    const output = join(f.directory, "received-original.json");
    const result = await capture(["recover", "--config", f.configPath, "--action", "delivery-export", "--request", f.original.requestId, "--output", output, "--json"]);
    assert.equal(result.code, 0, result.stderr); assertRedacted(result);
    const exported = JSON.parse(await readFile(output, "utf8"));
    assert.equal(exported.schema, "chio.gateway.delivered-outcome.v1"); assert.equal(exported.outcome.requestId, f.original.requestId);
    assert.equal((await lstat(output)).mode & 0o077, 0);
    assert.equal(JSON.parse(result.stdout).nativeResult.acknowledgedByExport, false);
    assert.equal((await capture(["recover", "--config", f.configPath, "--action", "delivery-export", "--request", f.original.requestId, "--output", output, "--json"])).code, 1);
    for (const name of ["foreign-artifact.json", "non-json-artifact"]) {
      const refused = await capture(["recover", "--config", f.configPath, "--action", "delivery-export", "--request", f.original.requestId, "--output", join(f.journalDir, name), "--json"]);
      assert.equal(refused.code, 1); assertRedacted(refused);
      assert.match(refused.stderr, /authoritative journal/);
    }
    assert.deepEqual(f.counts(), counts); assert.deepEqual(await snapshot(f.journalDir), before);
  } finally {await f.close();}
});

test("native approval submission retains the exact proposal without a decision credential or protected dispatch", async () => {
  const f = await fixture("awaiting_approval");
  try {
    const originalRecord = await readFile(f.recordPath, "utf8");
    const proposal = JSON.parse(originalRecord).proposal;
    const operatorPath = join(f.directory, "operator.json");
    await writeFile(operatorPath, JSON.stringify({adminToken: secrets[3], provider: {apiKey: secrets[2]}}), {mode: 0o600});
    const requests = [];
    f.setHandler(async (req, res) => {
      let raw = ""; for await (const part of req) raw += part;
      requests.push({route: req.url, authorization: req.headers.authorization, body: JSON.parse(raw)});
      res.writeHead(200, {"Content-Type": "application/json"});
      res.end(JSON.stringify({dispatchPerformedByThisEndpoint: false, status: "pending",
        record: {id: "fixture-approval", request_id: f.original.requestId, session_id: f.config.execution.sessionId, capability_id: f.config.execution.capabilityId},
        adminToken: secrets[3]}));
    });
    const output = join(f.directory, "submitted.json");
    const submitted = await capture(["recover", "--config", f.configPath, "--action", "approval-submit", "--request", f.original.requestId, "--operator", operatorPath, "--output", output, "--json"]);
    assert.equal(submitted.code, 0, submitted.stderr); assertRedacted(submitted);
    assert.equal(JSON.parse(submitted.stdout).nativeResult.protectedDispatch, false);
    assert.equal((await lstat(output)).mode & 0o077, 0);
    assert.deepEqual(requests[0], {route: "/admin/approvals", authorization: `Bearer ${secrets[3]}`, body: proposal});
    assert.equal(await lstat(join(f.journalDir, "approvals")).then(() => true, error => error.code === "ENOENT" ? false : Promise.reject(error)), false);
    assert.equal(await readFile(f.recordPath, "utf8"), originalRecord);
    assert.deepEqual(f.counts(), {network: 1, dispatches: 0, acknowledgements: 0});
    const before = await snapshot(f.journalDir);
    const invalidOutput = await capture(["recover", "--config", f.configPath, "--action", "approval-submit", "--request", f.original.requestId, "--operator", operatorPath, "--output", join(f.journalDir, "foreign-proposal.json"), "--json"]);
    assert.equal(invalidOutput.code, 1); assertRedacted(invalidOutput);
    assert.deepEqual(f.counts(), {network: 1, dispatches: 0, acknowledgements: 0});
    assert.deepEqual(await snapshot(f.journalDir), before);
  } finally {await f.close();}
});

for (const decision of ["denied", "approved"]) test(`approval-decide ${decision} is unavailable before native children, admin work or retaining an activatable credential`, async () => {
  const f = await fixture("awaiting_approval");
  let resumedGateway;
  try {
    const before = await snapshot(f.journalDir);
    const operatorPath = join(f.directory, "operator.json"); await writeFile(operatorPath, JSON.stringify({adminToken: secrets[3]}), {mode: 0o600});
    let adminRequests = 0; let nativeChildren = 0; let protectedDispatches = 0;
    f.setHandler(async (req, res) => {
      for await (const part of req) {};
      adminRequests++;
      const params = approvedParams(f.config, f.original.requestId, requestArgs, {approvalId: decision === "approved" ? "foreign-signed-approval" : "fixture-approval"});
      res.writeHead(200, {"Content-Type": "application/json"});
      res.end(JSON.stringify({dispatchPerformedByThisEndpoint: false, status: decision,
        record: {id: "fixture-approval", request_id: f.original.requestId, session_id: f.config.execution.sessionId, capability_id: f.config.execution.capabilityId}, toolCallParams: params}));
    });
    // Observe real process creation without replacing or importing native code.
    const processes = createHook({init(id, type) {if (type === "PROCESSWRAP") nativeChildren++;}});
    let result;
    processes.enable();
    try {result = await capture(["recover", "--config", f.configPath, "--action", "approval-decide", "--request", f.original.requestId,
      "--operator", operatorPath, "--approval", "fixture-approval", "--decision", decision, "--json"]);}
    finally {processes.disable();}
    resumedGateway = createGateway(f.config, {async execute(request) {protectedDispatches++; return signedOutcome(f.config, request);}}, {requireHostAcknowledgement: true});
    const resumed = await resumedGateway.call("retained-resume", "chio_resume", {requestId: f.original.requestId, tool: "read_text_file", arguments: requestArgs});
    resumedGateway.close(); resumedGateway = undefined;
    const artifactExists = await lstat(join(f.journalDir, "approvals", operationKey(f.original.requestId) + ".json")).then(() => true, error => {if (error.code === "ENOENT") return false; throw error;});
    assert.deepEqual({code: result.code, adminRequests, nativeChildren, protectedDispatches, state: resumed.state, artifactExists},
      {code: 1, adminRequests: 0, nativeChildren: 0, protectedDispatches: 0, state: "awaiting_approval", artifactExists: false},
      "frozen native utility cannot retain a requested decision or approval ID safely");
    assert.match(result.stderr, /unavailable|native.*prerequisite/i); assertRedacted(result);
    assert.deepEqual(await snapshot(f.journalDir), before);
  } finally {resumedGateway?.close(); await f.close();}
});

test("operator help and doctor expose submission while marking frozen native decision binding unavailable", async () => {
  const help = await capture(["recover", "--help"]);
  assert.equal(help.code, 0); assert.match(help.stdout, /approval-decide[^\n]*unavailable/i);
  assert.match(help.stdout, /decision and approval ID[^\n]*before/i);
  const f = await fixture("awaiting_approval");
  try {
    const result = await capture(["doctor", "--config", f.configPath, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const diagnosis = JSON.parse(result.stdout);
    assert.equal(diagnosis.capabilities.find(value => value.id === "original-approval-submit").available, true);
    const decision = diagnosis.capabilities.find(value => value.id === "original-approval-decide");
    assert.equal(decision.available, false); assert.match(decision.reason, /decision and approval ID/); assert.match(decision.reason, /before.*retention/);
    assert.equal(f.counts().network, 0);
  } finally {await f.close();}
});

for (const seam of ["config", "journal", "delivery-input", "operator-input"]) test(`private ${seam} FIFO is refused promptly without native/admin effects`, async () => {
  const f = await fixture(seam === "operator-input" ? "awaiting_approval" : "completed");
  let restoreRecord;
  try {
    const fifo = seam === "journal" ? f.recordPath : join(f.directory, "private-fifo");
    if (seam === "journal") {restoreRecord = await readFile(f.recordPath, "utf8"); await unlink(f.recordPath);}
    execFileSync("mkfifo", [fifo]); await chmod(fifo, 0o600);
    const before = await lstat(fifo);
    const args = seam === "config" ? ["status", "--config", fifo, "--json"]
      : seam === "journal" ? ["status", "--config", f.configPath, "--json"]
      : seam === "delivery-input" ? ["recover", "--config", f.configPath, "--action", "delivery-acknowledge", "--input", fifo, "--json"]
      : ["recover", "--config", f.configPath, "--action", "approval-submit", "--request", f.original.requestId, "--operator", fifo, "--output", join(f.directory, "new-submission.json"), "--json"];
    const result = await subprocess(fileURLToPath(new URL("../dist/protected-cli.js", import.meta.url)), args, {}, {timeoutMs: 6000});
    assert.equal(result.timedOut, false, `${seam} FIFO must be refused before a blocking open`);
    assert.equal(result.code, 1); assertRedacted(result);
    const after = await lstat(fifo); assert.equal(after.ino, before.ino); assert.equal(after.isFIFO(), true);
    assert.equal(f.counts().network, 0);
    assert.equal(await lstat(join(f.directory, "new-submission.json")).then(() => true, error => error.code === "ENOENT" ? false : Promise.reject(error)), false);
  } finally {
    if (restoreRecord !== undefined) {await unlink(f.recordPath); await writeFile(f.recordPath, restoreRecord, {mode: 0o600});}
    await f.close();
  }
});

test("native delivery ACK requires the exact received artifact and exclusive gateway ownership, without replaying the effect", async () => {
  const f = await fixture("completed", {alive: true});
  try {
    const output = join(f.directory, "received-original.json");
    const exported = await capture(["recover", "--config", f.configPath, "--action", "delivery-export", "--request", f.original.requestId, "--output", output, "--json"]);
    assert.equal(exported.code, 0, exported.stderr);
    const before = await snapshot(f.journalDir);
    const acknowledgementArgs = ["recover", "--config", f.configPath, "--action", "delivery-acknowledge", "--input", output, "--json"];
    const locked = await capture(acknowledgementArgs); assert.equal(locked.code, 1); assertRedacted(locked);
    assert.deepEqual(await snapshot(f.journalDir), before); assert.equal(f.counts().network, 0);
    f.gateway.close();
    const requests = [];
    f.setHandler(async (req, res) => {
      let raw = ""; for await (const part of req) raw += part;
      const rpc = JSON.parse(raw); requests.push({method: rpc.method, params: rpc.params, authorization: req.headers.authorization});
      res.writeHead(200, {"Content-Type": "application/json", "Mcp-Session-Id": f.config.execution.sessionId});
      res.end(JSON.stringify({jsonrpc: "2.0", id: rpc.id, result: {schema: "chio.mcp.delivery-ack.v1", acknowledged: true, requestId: rpc.params.requestId, receiptId: rpc.params.receiptId}}));
    });
    const received = JSON.parse(await readFile(output, "utf8"));
    const forged = structuredClone(received); forged.outcome.result.content[0].text = "substituted receive";
    const forgedPath = join(f.directory, "forged-received.json"); await writeFile(forgedPath, JSON.stringify(forged), {mode: 0o600});
    const invalid = await capture(["recover", "--config", f.configPath, "--action", "delivery-acknowledge", "--input", forgedPath, "--json"]);
    assert.equal(invalid.code, 1); assertRedacted(invalid); assert.equal(f.counts().network, 0);
    const acknowledged = await capture(acknowledgementArgs);
    assert.equal(acknowledged.code, 0, acknowledged.stderr); assertRedacted(acknowledged);
    assert.equal(JSON.parse(acknowledged.stdout).nativeResult.acknowledged, true);
    assert.deepEqual(requests, [{method: "chio/acknowledge", params: received.outcome.delivery, authorization: `Bearer ${secrets[0]}`}]);
    const retained = JSON.parse(await readFile(f.recordPath, "utf8"));
    assert.equal(retained.acknowledged, true); assert.equal(retained.hostDeliveryConfirmed, true);
    assert.deepEqual(retained.request, received.request); assert.deepEqual(retained.outcome, received.outcome);
    assert.deepEqual(f.counts(), {network: 1, dispatches: 1, acknowledgements: 0});
    const status = await capture(["status", "--config", f.configPath, "--json"]);
    assert.equal(status.code, 0, status.stderr); assert.equal(JSON.parse(status.stdout).fenced, false);
    assert.equal(JSON.parse(status.stdout).operations[0].state, "completed_acknowledged");
  } finally {await f.close();}
});

test("operator rejects credential-bearing endpoints without printing credentials from a native-bound malformed config", async () => {
  const f = await fixture("completed", {endpoint: "http://private-user:untracked-endpoint-password@127.0.0.1:1"});
  try {
    const before = await snapshot(f.journalDir);
    const result = await capture(["status", "--config", f.configPath, "--json"]);
    assert.equal(result.code, 1);
    assert.equal(`${result.stdout}${result.stderr}`.includes("untracked-endpoint-password"), false);
    assert.deepEqual(await snapshot(f.journalDir), before); assert.equal(f.counts().network, 0);
  } finally {await f.close();}
});

test("dead same-host lock recovery removes only the lock and retains the original fenced journal", async () => {
  const f = await fixture();
  try {
    const before = await snapshot(f.journalDir);
    await writeFile(join(f.journalDir, "gateway.lock"), JSON.stringify({sessionId: f.config.sessionId, hostname: hostname(), pid: 2147483647}), {mode: 0o600});
    const result = await capture(["recover", "--config", f.configPath, "--action", "recover-lock", "--json"]);
    assert.equal(result.code, 0, result.stderr); assertRedacted(result);
    assert.equal(JSON.parse(result.stdout).nativeResult.journalsRetained, true);
    assert.deepEqual(await snapshot(f.journalDir), before); assert.equal(f.counts().network, 0);
    for (const owner of [{sessionId: f.config.sessionId, hostname: hostname(), pid: process.pid}, {sessionId: f.config.sessionId, hostname: "other-host", pid: 2147483647}]) {
      await writeFile(join(f.journalDir, "gateway.lock"), JSON.stringify(owner), {mode: 0o600});
      const snapshotBefore = await snapshot(f.journalDir);
      assert.equal((await capture(["recover", "--config", f.configPath, "--action", "recover-lock", "--json"])).code, 1);
      assert.deepEqual(await snapshot(f.journalDir), snapshotBefore);
    }
  } finally {await f.close();}
});

test("invalid command arguments and unavailable native actions are rejected before any native mutation", async () => {
  const f = await fixture();
  try {
    const before = await snapshot(f.journalDir); const counts = f.counts();
    for (const args of [
      ["status", "--config", f.configPath, "--provider", secrets[2]],
      ["status", "--config", f.configPath, "--request", f.original.requestId],
      ["recover", "--config", f.configPath, "--action", "recover-lock", "--output", join(f.directory, "unexpected")],
      ["recover", "--config", f.configPath, "--action", "delivery-export", "--request", f.original.requestId],
      ["recover", "--config", f.configPath, "--action", "approval-decide", "--request", f.original.requestId, "--operator", f.configPath, "--approval", "a", "--decision", "maybe"],
      ["doctor", "--config", f.configPath, "--json", "--json"],
      ["inspect", "--config", f.configPath, "--request", "missing-original"],
    ]) {const result = await capture(args); assert.equal(result.code, 1); assertRedacted(result);}
    for (const action of ["owner-result-import", "capability-attenuation", "semantic-recovery", "whole-host-linux"]) {
      const result = await capture(["recover", "--config", f.configPath, "--action", action, "--json"]);
      assert.equal(result.code, 1); assert.match(result.stderr, /unavailable/i); assertRedacted(result);
    }
    assert.deepEqual(f.counts(), counts); assert.deepEqual(await snapshot(f.journalDir), before);
  } finally {await f.close();}
});

test("operator refuses public, symlinked, oversized and mismatched authority files without revealing parse errors", async () => {
  const f = await fixture();
  try {
    const before = await snapshot(f.journalDir);
    const alternate = join(f.directory, "alternate.json");
    await symlink(f.configPath, alternate);
    assert.equal((await capture(["status", "--config", alternate, "--json"])).code, 1);
    await chmod(f.configPath, 0o644);
    assert.equal((await capture(["status", "--config", f.configPath, "--json"])).code, 1);
    await chmod(f.configPath, 0o600);
    await writeFile(f.configPath, `{"bearerToken":"${secrets[0]}", malformed`);
    const badJson = await capture(["status", "--config", f.configPath, "--json"]); assert.equal(badJson.code, 1); assertRedacted(badJson);
    await writeFile(f.configPath, "x".repeat(1024 * 1024 + 1));
    assert.equal((await capture(["status", "--config", f.configPath, "--json"])).code, 1);
    await writeFile(f.configPath, JSON.stringify({...f.config, execution: {...f.config.execution, capabilityId: "replacement-authority"}}));
    assert.equal((await capture(["status", "--config", f.configPath, "--json"])).code, 1);
    assert.deepEqual(await snapshot(f.journalDir), before);
  } finally {await f.close();}
});

test('doctor reports parent limits and measured Linux implementation separately from native P5 availability',async()=>{
 const f=await fixture();try{const before=await snapshot(f.journalDir);const counts=f.counts();const output=await capture(['doctor','--config',f.configPath,'--json']);assert.equal(output.code,0,output.stderr);const doctor=JSON.parse(output.stdout);
 const limits=doctor.capabilities.find(value=>value.id==='parent-model-limits');assert.equal(limits?.scope,'trusted_parent');assert.equal(limits.available,true);
 const linux=doctor.capabilities.find(value=>value.id==='whole-host-linux');assert.equal(linux.status,'local-confinement-tested');assert.equal(linux.available,false);assert.match(linux.reason,/P5/);
 assert.deepEqual(f.counts(),counts);assert.deepEqual(await snapshot(f.journalDir),before);
 }finally{await f.close();}
});
