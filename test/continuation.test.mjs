import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHook} from "node:async_hooks";
import {appendFileSync, chmodSync} from "node:fs";
import {chmod, mkdir, readFile, readdir, symlink, unlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {request as httpRequest} from "node:http";
import test from "node:test";
import * as plugin from "../dist/index.js";
import {gatewayExecutor} from "../dist/http-executor.js";
import {canonicalJson} from "../dist/tool-registry.js";
import {verifyCompletedOutcome} from "@chio/bridge";
import {privateJson} from "../dist/operator.js";
import {approvedParams, bodyOutcome, call, guestRpc, hash, initialize, nativeFixture, redigest, request, signedOutcome} from "./helpers/continuation-fixture.mjs";
function api() {
  for (const name of ["startParentGatewayProxy", "createNativeOriginalOperationPort", "exportContinuation", "importContinuation", "recoverOriginalOperation"])
    assert.equal(typeof plugin[name], "function", `Task 4 trusted ${name} is required`);
  return plugin;
}
async function start(f) {return api().startParentGatewayProxy({configPath: f.configPath, native: f.native, binding: f.binding});}
/** A parent refusal before reservation is a definite native-style non-dispatch,
 * not an unknown transport failure, and it reserves nothing. */
function assertNotDispatched(reply, reason) {
  assert.equal(reply.status, 200); assert.equal(reply.body.error, undefined, JSON.stringify(reply.body));
  const outcome = bodyOutcome(reply);
  assert.equal(reply.body.result.isError, true); assert.equal(outcome.state, "not_dispatched"); assert.match(outcome.reason, reason);
  assert.equal(reply.body.result._meta.chioPiOriginalIdentity.nativeRequestId, outcome.requestId);
}

test("handoff export bounds original requests before any native lookup", async () => {
  const binding = {authorityDigest: "ab".repeat(32), registryDigest: "cd".repeat(32)}; let lookups = 0;
  const originals = {binding, assertPublic() {}, async lookup() {lookups++; throw new Error("unexpected native lookup");}};
  await assert.rejects(api().exportContinuation("/unwritten-handoff.json", {binding, originals, requests: Array.from({length: 257}, (_, index) => request(String(index)))}), /bounded|256/);
  assert.equal(lookups, 0);
});

test("trusted proxy reserves the exact native HTTP identity before dispatch and never forwards a duplicate", async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f); assert.notEqual(proxy.port, f.native.port); assert.notEqual(proxy.token, f.native.token);
    const session = await initialize(proxy); const logical = request();
    const first = bodyOutcome(await call(proxy, session, logical));
    const files = await readdir(join(f.config.journalDir, "pi-parent-mappings"));
    assert.equal(files.includes("parent.lock"), false, "native owner locking must not leave an additional unrecoverable lease after parent process death");
    const mapping = JSON.parse(await readFile(join(f.config.journalDir, "pi-parent-mappings", hash(JSON.stringify([logical.sessionId, logical.toolCallId])) + ".json"), "utf8"));
    const rpcId = JSON.stringify([logical.sessionId, logical.toolCallId]);
    assert.equal(mapping.identity.rpcId, rpcId);
    assert.equal(mapping.identity.gatewayCallId, session + ":" + JSON.stringify(rpcId));
    assert.equal(mapping.identity.nativeRequestId, f.config.sessionId + ":" + hash(canonicalJson({id: mapping.identity.gatewayCallId})));
    assert.deepEqual(mapping.request, logical); assert.ok(files.some(name => name.endsWith(".json")));
    assert.equal(first.state, "completed"); assert.equal(first.requestId, mapping.identity.nativeRequestId);
    assert.deepEqual(bodyOutcome(await call(proxy, session, logical)), first);
    assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
    assert.deepEqual(await proxy.originals.lookup(logical), {...await proxy.originals.lookup(logical)});
    assert.equal((await proxy.originals.inventory()).fenced, true, "original lookup under delivery fence must remain possible");
  } finally {await proxy?.close(); await f.close();}
});

test("native original lookup refuses malformed UTF-8 in private native journal state", async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy); const outcome = bodyOutcome(await call(proxy, session));
    const path = join(f.config.journalDir, hash(outcome.requestId) + ".json");
    const record = await readFile(path);
    const malformed = Buffer.concat([record.subarray(0, record.lastIndexOf(0x7d)), Buffer.from(',"custodyNote":"'), Buffer.from([0xff]), Buffer.from('"}')]);
    await writeFile(path, malformed, {mode: 0o600});
    await assert.rejects(proxy.originals.lookup(request()), /UTF|JSON|private/);
    assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
  } finally {await proxy?.close(); await f.close();}
});

test("trusted private reads bound growth after the initial filesystem admission", async () => {
  const f = await nativeFixture(); const path = join(f.directory, "growing.json");
  await writeFile(path, '{"small":true}', {mode: 0o600});
  let handle = false; let operations = 0; let grew = false;
  const hook = createHook({init(_id, type) {
    if (type === "FILEHANDLE") handle = true;
    if (handle && type === "FSREQPROMISE" && ++operations === 2) {grew = true; appendFileSync(path, "x".repeat(1024 * 1024));}
  }});
  try {hook.enable(); await assert.rejects(privateJson(path), /changed|private|bounded|MiB/); assert.equal(grew, true, "fixture must grow the file after an open handle was admitted");}
  finally {hook.disable(); await f.close();}
});

test("trusted private reads refuse a leaf made public after the final descriptor check", async () => {
  const f = await nativeFixture(); const path = join(f.directory, "changing-mode.json"); await writeFile(path, '{"private":true}', {mode: 0o600});
  let handle = false; let operations = 0; let changed = false;
  const hook = createHook({init(_id, type) {
    if (type === "FILEHANDLE") handle = true;
    if (handle && type === "FSREQPROMISE" && ++operations === 5) {changed = true; chmodSync(path, 0o644);}
  }});
  try {hook.enable(); await assert.rejects(privateJson(path), /changed|private/); assert.equal(changed, true, "fixture must change mode after the final descriptor stat");}
  finally {hook.disable(); await f.close();}
});

test("spec review: private reads refuse a parent made public after directory admission", async () => {
  const f = await nativeFixture(); const path = join(f.directory, "directory-custody.json"); await writeFile(path, '{"private":true}', {mode: 0o600});
  let changed = false;
  const hook = createHook({init(_id, type) {if (type === "FILEHANDLE" && !changed) {changed = true; chmodSync(f.directory, 0o755);}}});
  try {
    hook.enable(); await assert.rejects(privateJson(path), error => error.code === "state_changed" || error.code === "private_path_required");
    assert.equal(changed, true, "fixture must change the actual parent after directory admission while the leaf remains private");
  } finally {hook.disable(); await chmod(f.directory, 0o700); await f.close();}
});

test("parent refuses dispatch when the actual native gateway owner changes", async () => {
  const f = await nativeFixture(); let proxy; const path = join(f.config.journalDir, "gateway.lock"); const original = await readFile(path);
  try {
    proxy = await start(f); const session = await initialize(proxy);
    const owner = JSON.parse(original); owner.hostname = "unverifiable-foreign-host"; await writeFile(path, JSON.stringify(owner), {mode: 0o600});
    assert.ok((await call(proxy, session)).body.error); assert.deepEqual(f.counts(), {effects: 0, acks: 0, nativeCalls: 0});
  } finally {await writeFile(path, original, {mode: 0o600}); await proxy?.close(); await f.close();}
});

test("a signed retained denial remains exact in handoff without clearing its native fence", async () => {
  const f = await nativeFixture({state: "denied"}); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy); const original = bodyOutcome(await call(proxy, session));
    assert.deepEqual(f.counts(), {effects: 0, acks: 0, nativeCalls: 1}, "the independent fixture counter must record no effect for a signed denial");
    const path = join(f.directory, "denied-handoff.json"); await api().exportContinuation(path, {binding: f.binding, requests: [request()], originals: proxy.originals});
    const imported = await api().importContinuation(path, {binding: f.binding, originals: proxy.originals});
    assert.deepEqual(imported.originals[0].outcome, original); assert.equal((await proxy.originals.inventory()).fenced, true); assert.equal(f.counts().acks, 0);
  } finally {await proxy?.close(); await f.close();}
});

for (const field of ["api_key", "session-token", "authorization", "approval_token"]) test(`handoff rejects normalized ${field} credential fields`, async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy); await call(proxy, session);
    await assert.rejects(api().exportContinuation(join(f.directory, "secret.json"), {binding: f.binding, requests: [request()], originals: proxy.originals, context: {[field]: "new-credential-value"}}), /credential/);
  } finally {await proxy?.close(); await f.close();}
});

for (const field of ["authToken", "AUTH_TOKEN", "providerToken", "Provider-TOKEN", "client_secret", "ClIeNt.SeCrEt", "access_key", "ACCESS-KEY"])
  for (const direction of ["export", "import"]) test(`spec review: handoff ${direction} refuses nested standard credential field ${field}`, async () => {
    const f = await nativeFixture(); let proxy;
    try {
      proxy = await start(f); const session = await initialize(proxy); await call(proxy, session);
      const path = join(f.directory, "review-credential.json"); const context = {outer: [{[field]: "previously-unknown-synthetic-material"}]};
      if (direction === "export") await assert.rejects(api().exportContinuation(path, {binding: f.binding, requests: [request()], originals: proxy.originals, context}), /credential/);
      else {
        const original = await api().exportContinuation(path, {binding: f.binding, requests: [request()], originals: proxy.originals});
        await writeFile(path, JSON.stringify(redigest({...original, context})), {mode: 0o600});
        await assert.rejects(api().importContinuation(path, {binding: f.binding, originals: proxy.originals}), /credential/);
      }
      assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
    } finally {await proxy?.close(); await f.close();}
  });

test("spec review: handoff preserves ordinary public identifiers, digests and exact proof fields", async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy); const original = bodyOutcome(await call(proxy, session));
    const context = {nested: [{providerId: "public-provider", clientId: "public-client", session_id: "public-session", capability_id: f.config.execution.capabilityId,
      authDigest: f.binding.authorityDigest, accessKeyDigest: "ab".repeat(32), registryDigest: f.binding.registryDigest, tokenCount: 7}]};
    const path = join(f.directory, "public-fields.json"); await api().exportContinuation(path, {binding: f.binding, requests: [request()], originals: proxy.originals, context});
    const imported = await api().importContinuation(path, {binding: f.binding, originals: proxy.originals});
    assert.deepEqual(imported.context, context); assert.deepEqual(imported.originals[0].outcome, original);
  } finally {await proxy?.close(); await f.close();}
});

async function completeApprovedOriginal(f, proxy) {
  const session = await initialize(proxy); const logical = request(); const pending = bodyOutcome(await call(proxy, session, logical));
  assert.equal(pending.state, "awaiting_approval");
  const directory = join(f.config.journalDir, "approvals"); await mkdir(directory, {mode: 0o700});
  await writeFile(join(directory, hash(pending.requestId) + ".json"), JSON.stringify({toolCallParams: approvedParams(f.config, pending.requestId, logical.arguments)}), {mode: 0o600});
  const resume = {...request("quality-approved-resume"), tool: "chio_resume", arguments: {requestId: pending.requestId, tool: logical.tool, arguments: logical.arguments}};
  const completed = bodyOutcome(await call(proxy, session, resume)); const retained = await f.record(pending.requestId);
  assert.equal(completed.state, "completed"); assert.equal(verifyCompletedOutcome(completed, f.config.execution, retained.request), true);
  return {logical, completed, signature: retained.request.approval.chioApprovalToken.signature};
}

test("quality review: a fresh original port screens already-retained approval credentials before its first lookup", async () => {
  const f = await nativeFixture({approval: true}); let proxy;
  try {
    proxy = await start(f); const approved = await completeApprovedOriginal(f, proxy);
    const fresh = await api().createNativeOriginalOperationPort({configPath: f.configPath, binding: f.binding});
    assert.throws(() => fresh.assertPublic({note: approved.signature}), /credential/);
    assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
  } finally {await proxy?.close(); await f.close();}
});

for (const timing of ["fresh", "before-approval"]) for (const originals of ["selected", "empty"])
  test(`quality review: ${timing} port import excludes retained approval material with ${originals} originals`, async () => {
    const f = await nativeFixture({approval: true}); let proxy;
    try {
      proxy = await start(f);
      let receiving = timing === "before-approval" ? await api().createNativeOriginalOperationPort({configPath: f.configPath, binding: f.binding}) : undefined;
      const approved = await completeApprovedOriginal(f, proxy); const path = join(f.directory, "quality-approved-import.json");
      const envelope = await api().exportContinuation(path, {binding: f.binding, requests: originals === "selected" ? [approved.logical] : [], originals: proxy.originals});
      await writeFile(path, JSON.stringify(redigest({...envelope, context: {nested: [{note: approved.signature}]}})), {mode: 0o600});
      receiving ??= await api().createNativeOriginalOperationPort({configPath: f.configPath, binding: f.binding});
      await assert.rejects(api().importContinuation(path, {binding: f.binding, originals: receiving}), /credential/);
      assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
    } finally {await proxy?.close(); await f.close();}
  });

for (const timing of ["fresh", "before-approval"]) test(`quality review: empty export from a ${timing} port excludes selected retained approval material`, async () => {
  const f = await nativeFixture({approval: true}); let proxy;
  try {
    proxy = await start(f);
    let selected = timing === "before-approval" ? await api().createNativeOriginalOperationPort({configPath: f.configPath, binding: f.binding}) : undefined;
    const approved = await completeApprovedOriginal(f, proxy);
    selected ??= await api().createNativeOriginalOperationPort({configPath: f.configPath, binding: f.binding});
    await assert.rejects(api().exportContinuation(join(f.directory, "quality-empty-export.json"), {binding: f.binding, requests: [], originals: selected, context: {note: approved.signature}}), /credential/);
    assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
  } finally {await proxy?.close(); await f.close();}
});

for (const source of ["bearer", "session", "bearer-pattern"]) for (const direction of ["export", "import"])
  test(`quality review: ${direction} excludes ${source} material in nested JSON member names`, async () => {
    const f = await nativeFixture(); let proxy;
    try {
      proxy = await start(f); const path = join(f.directory, "quality-member-name.json");
      const name = source === "bearer" ? f.config.execution.bearerToken : source === "session" ? f.config.sessionCredential.sessionToken : "note Bearer unrelated-synthetic-material";
      const context = {nested: [{[name]: "operator note"}]};
      if (direction === "export") await assert.rejects(api().exportContinuation(path, {binding: f.binding, requests: [], originals: proxy.originals, context}), /credential/);
      else {
        const envelope = await api().exportContinuation(path, {binding: f.binding, requests: [], originals: proxy.originals});
        await writeFile(path, JSON.stringify(redigest({...envelope, context})), {mode: 0o600});
        const fresh = await api().createNativeOriginalOperationPort({configPath: f.configPath, binding: f.binding});
        await assert.rejects(api().importContinuation(path, {binding: f.binding, originals: fresh}), /credential/);
      }
      assert.deepEqual(f.counts(), {effects: 0, acks: 0, nativeCalls: 0});
    } finally {await proxy?.close(); await f.close();}
  });

test("quality review: public member names, IDs, digests and exact signed proofs survive credential discovery", async () => {
  const f = await nativeFixture({approval: true}); let proxy;
  try {
    proxy = await start(f); const approved = await completeApprovedOriginal(f, proxy); const path = join(f.directory, "quality-public-control.json");
    const context = {nested: [{[f.config.execution.capabilityId]: "public capability", [f.config.sessionId]: "public session", [f.binding.authorityDigest]: "public digest",
      providerId: "public-provider", clientId: "public-client", accessKeyDigest: "ab".repeat(32)}]};
    await api().exportContinuation(path, {binding: f.binding, requests: [approved.logical], originals: proxy.originals, context});
    const fresh = await api().createNativeOriginalOperationPort({configPath: f.configPath, binding: f.binding});
    const imported = await api().importContinuation(path, {binding: f.binding, originals: fresh});
    assert.deepEqual(imported.context, context); assert.deepEqual(imported.originals[0].outcome, approved.completed);
    assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
  } finally {await proxy?.close(); await f.close();}
});

test("two parent instances recover signed completion after response loss without reconstructing its connection identity", async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy); const logical = request();
    await new Promise((done, reject) => {
      const rpc = httpRequest(proxy.url, {method: "POST", headers: {Authorization: `Bearer ${proxy.token}`, "Content-Type": "application/json", "Mcp-Session-Id": session}}, response => {response.destroy(); done();});
      rpc.once("error", reject); rpc.end(JSON.stringify({jsonrpc: "2.0", id: JSON.stringify([logical.sessionId, logical.toolCallId]), method: "tools/call", params: {name: logical.tool, arguments: logical.arguments}}));
    });
    const first = await api().recoverOriginalOperation(logical, proxy.originals);
    await proxy.close(); await f.restart(); proxy = await start(f);
    const changed = await initialize(proxy); assert.notEqual(changed, session);
    assert.deepEqual(await api().recoverOriginalOperation(logical, proxy.originals), first);
    const duplicate = await call(proxy, changed, logical);
    assert.deepEqual(bodyOutcome(duplicate), first);
    assertNotDispatched(await call(proxy, changed, request("fresh")), /fenced/);
    assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
  } finally {await proxy?.close(); await f.close();}
});

test("actual guest adapter accepts only parent-bound original IDs after a changed connection", async () => {
  const f = await nativeFixture(); let proxy;
  const config = () => ({schema: "chio.pi.transport.v1", sessionId: f.config.sessionId, transport: {url: proxy.url, token: proxy.token}, binding: f.config.execution, parentBinding: f.binding, tools: f.config.tools, registryDigest: f.registry.digest, approvals: false});
  try {
    proxy = await start(f); const first = await gatewayExecutor(config()); const original = await first.executor.execute(request());
    await proxy.close(); await f.restart(); proxy = await start(f);
    const second = await gatewayExecutor(config());
    const recovered = await second.executor.execute(request());
    assert.deepEqual({...recovered, content: JSON.parse(recovered.content)}, {...original, content: JSON.parse(original.content)}, "native identity must come from the retained parent map rather than the new MCP session");
    assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
  } finally {await proxy?.close(); await f.close();}
});

for (const fault of ["binding", "rpcId", "requestDigest", "nativeRequestId", "signedOutcome"]) test(`guest refuses substituted parent ${fault} metadata or outcome`, async () => {
  const f = await nativeFixture(); let proxy; const originalFetch = globalThis.fetch;
  try {
    proxy = await start(f);
    const config = {schema: "chio.pi.transport.v1", sessionId: f.config.sessionId, transport: {url: proxy.url, token: proxy.token}, binding: f.config.execution, parentBinding: f.binding, tools: f.config.tools, registryDigest: f.registry.digest, approvals: false};
    const client = await gatewayExecutor(config);
    globalThis.fetch = async (url, init) => {
      const response = await originalFetch(url, init);
      if (String(url) !== proxy.url || JSON.parse(init.body).method !== "tools/call") return response;
      const wire = await response.json(); const identity = wire.result._meta.chioPiOriginalIdentity;
      if (fault === "binding") identity.binding.authorityDigest = "00".repeat(32);
      if (fault === "rpcId") identity.rpcId = JSON.stringify(["another-host", "another-call"]);
      if (fault === "requestDigest") identity.requestDigest = "00".repeat(32);
      if (fault === "nativeRequestId") identity.nativeRequestId = "substituted-native-original";
      if (fault === "signedOutcome") {const value = JSON.parse(wire.result.content[0].text); value.receipt.signature = "00".repeat(64); wire.result.content[0].text = JSON.stringify(value);}
      return new Response(JSON.stringify(wire), {status: response.status, headers: response.headers});
    };
    await assert.rejects(client.executor.execute(request()), /metadata|binding|identity|operation|Receipt|receipt|output/);
    assert.equal(client.state.unresolved, true); assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
  } finally {globalThis.fetch = originalFetch; await proxy?.close(); await f.close();}
});

test("approved original verification uses the private retained native request and preserves its exact signed delivery", async () => {
  const f = await nativeFixture({approval: true}); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy); const logical = request(); const pending = bodyOutcome(await call(proxy, session, logical));
    assert.equal(pending.state, "awaiting_approval"); assert.equal(f.counts().effects, 0);
    const directory = join(f.config.journalDir, "approvals"); await mkdir(directory, {mode: 0o700});
    await writeFile(join(directory, hash(pending.requestId) + ".json"), JSON.stringify({toolCallParams: approvedParams(f.config, pending.requestId, logical.arguments)}), {mode: 0o600});
    const resume = {...request("explicit-resume"), tool: "chio_resume", arguments: {requestId: pending.requestId, tool: logical.tool, arguments: logical.arguments}};
    const completed = bodyOutcome(await call(proxy, session, resume)); assert.equal(completed.state, "completed");
    const retained = await f.record(pending.requestId); assert.ok(retained.request.approval.chioApprovalToken);
    assert.equal(verifyCompletedOutcome(completed, f.config.execution, retained.request), true);
    assert.equal(verifyCompletedOutcome(completed, f.config.execution, {tool: logical.tool, arguments: logical.arguments, requestId: pending.requestId}), false, "a stripped reconstruction cannot bind the native approved request hash");
    assert.deepEqual(await api().recoverOriginalOperation(logical, proxy.originals), completed);
    const path = join(f.directory, "approved-handoff.json"); await api().exportContinuation(path, {binding: f.binding, requests: [logical], originals: proxy.originals});
    const imported = await api().importContinuation(path, {binding: f.binding, originals: proxy.originals}); assert.deepEqual(imported.originals[0].outcome, completed);
    assert.equal((await readFile(path, "utf8")).includes(retained.request.approval.chioApprovalToken.signature), false);
    assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
  } finally {await proxy?.close(); await f.close();}
});

test("trusted stock-host history resolves the authoritative parent map and persists provenance before native ACK", async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy); const original = bodyOutcome(await call(proxy, session));
    const observer = plugin.createHostDeliveryObserver(f.config, {async acknowledgeReceivedOutcome(outcome) {
      const mapping = await proxy.originals.mappings.find(request()); assert.equal(mapping.hostHistory?.outcomeDigest, hash(canonicalJson(original)));
      return f.native.acknowledgeReceivedOutcome(outcome);
    }}, proxy.originals);
    await observer([original]); assert.deepEqual(f.counts(), {effects: 1, acks: 1, nativeCalls: 1});
    assert.equal((await proxy.originals.mappings.find(request())).acknowledgement.acknowledged, true);
  } finally {await proxy?.close(); await f.close();}
});

test("ambiguous native initialization is terminal for that parent transport", async () => {
  const f = await nativeFixture(); let proxy; const originalFetch = globalThis.fetch;
  try {
    proxy = await start(f);
    globalThis.fetch = async (url, init) => {
      const response = await originalFetch(url, init);
      if (String(url) === f.native.url && JSON.parse(new TextDecoder().decode(init.body)).method === "initialize") return new Response("truncated native initialization", {headers: {"Mcp-Session-Id": response.headers.get("mcp-session-id")}});
      return response;
    };
    assert.equal((await guestRpc(proxy, "", "initialize", "initialize", {})).status, 500);
    assert.equal((await guestRpc(proxy, "", "second-init", "initialize", {})).status, 409);
    assert.deepEqual(f.counts(), {effects: 0, acks: 0, nativeCalls: 0});
  } finally {globalThis.fetch = originalFetch; await proxy?.close(); await f.close();}
});

for (const state of ["pending", "unknown", "denied", "awaiting_approval"]) test(`native ${state} original never becomes a replacement dispatch during explicit recovery`, async () => {
  const f = await nativeFixture(state === "denied" ? {state} : state === "awaiting_approval" ? {approval: true} : {}); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy); const outcome = bodyOutcome(await call(proxy, session));
    if (state === "pending" || state === "unknown") {
      const record = await f.record(outcome.requestId); record.state = state;
      if (state === "pending") delete record.outcome;
      else record.outcome = {state: "unknown", evidence: "unverified", requestId: outcome.requestId, reason: "resource owner reconciliation required"};
      await writeFile(join(f.config.journalDir, hash(outcome.requestId) + ".json"), JSON.stringify(record), {mode: 0o600});
    }
    const before = f.counts(); await assert.rejects(api().recoverOriginalOperation(request(), proxy.originals), /original|completion|unknown|pending|approval|denied/);
    assertNotDispatched(await call(proxy, session, request("replacement")), /fenced/); assert.deepEqual(f.counts(), before);
  } finally {await proxy?.close(); await f.close();}
});

for (const fault of ["signature", "caller", "arguments", "resource"]) test(`native original lookup refuses ${fault} substitution independently of a public content digest`, async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy); const outcome = bodyOutcome(await call(proxy, session));
    const record = await f.record(outcome.requestId);
    if (fault === "signature") record.outcome.receipt.signature = "00".repeat(64);
    if (fault === "caller") record.outcome = signedOutcome(f.config, record.request, "completed", {metadata: {...record.outcome.receipt.metadata, attribution: {subject_key: "11".repeat(32)}}});
    if (fault === "resource") record.outcome = signedOutcome(f.config, record.request, "completed", {tool_server: "foreign-resource"});
    if (fault === "arguments") {
      record.request.arguments.content = "substitution"; record.digest = hash(canonicalJson({name: record.request.tool, args: record.request.arguments})); record.outcome = signedOutcome(f.config, record.request);
    }
    await writeFile(join(f.config.journalDir, hash(outcome.requestId) + ".json"), JSON.stringify(record), {mode: 0o600});
    await assert.rejects(proxy.originals.lookup(request()), /verification|original|completion|request/);
    assert.ok((await call(proxy, session, request("fresh"))).body.error); assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
  } finally {await proxy?.close(); await f.close();}
});

test("handoff refuses genuine credential values in ordinary context strings and refuses replacement publication", async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy); await call(proxy, session);
    const path = join(f.directory, "continuation.json");
    await assert.rejects(api().exportContinuation(path, {binding: f.binding, requests: [request()], originals: proxy.originals, context: {note: "echo private-synthetic-bearer"}}), /credential/);
    await api().exportContinuation(path, {binding: f.binding, requests: [request()], originals: proxy.originals, context: {note: f.config.execution.capabilityId}});
    const before = await readFile(path); await assert.rejects(api().exportContinuation(path, {binding: f.binding, requests: [request()], originals: proxy.originals}), /EEXIST/); assert.deepEqual(await readFile(path), before);
  } finally {await proxy?.close(); await f.close();}
});

test("mapping storage failure before forwarding sends zero effect bytes", async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy);
    const directory = join(f.config.journalDir, "pi-parent-mappings");
    await chmod(directory, 0o755);
    assert.ok((await call(proxy, session)).body.error);
    assert.deepEqual(f.counts(), {effects: 0, acks: 0, nativeCalls: 0});
    await chmod(directory, 0o700);
  } finally {await proxy?.close(); await f.close();}
});

for (const method of ["chio/acknowledge", "chio/execution-context", "approval-decide", "models/list", "unknown/method"]) test(`guest ${method} cannot reach native privileged routes`, async () => {
  const f = await nativeFixture(); let proxy;
  try {proxy = await start(f); const session = await initialize(proxy); const reply = await guestRpc(proxy, session, "guest-admin", method, {}); assert.ok(reply.status === 403 || reply.body.error); assert.deepEqual(f.counts(), {effects: 0, acks: 0, nativeCalls: 0});}
  finally {await proxy?.close(); await f.close();}
});

test("proxy initializes only once and preserves strict session, framing and fixed endpoint boundaries", async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy);
    assert.equal((await guestRpc(proxy, "", "again", "initialize", {})).status, 409);
    assert.equal((await guestRpc(proxy, "wrong-session", "ping", "ping", {})).status, 403);
    assert.equal((await guestRpc(proxy, session, "ping", "ping", {}, {Origin: "https://foreign.invalid"})).status, 403);
    const spoofedHost = await new Promise((done, reject) => {
      const rpc = httpRequest(proxy.url, {method: "POST", headers: {Host: "foreign.invalid", Authorization: `Bearer ${proxy.token}`, "Content-Type": "application/json", "Mcp-Session-Id": session}}, response => {response.resume(); response.once("end", () => done(response.statusCode));});
      rpc.once("error", reject); rpc.end(JSON.stringify({jsonrpc: "2.0", id: "ping", method: "ping", params: {}}));
    });
    assert.equal(spoofedHost, 403);
    assert.equal((await guestRpc(proxy, session, undefined, "notifications/initialized")).status, 202);
    assert.equal((await guestRpc(proxy, session, "ping", "ping", {})).status, 200);
    assert.ok((await guestRpc(proxy, session, 1, "tools/call", {name: "write_file", arguments: request().arguments})).body.error);
    const invalidUtf8 = await fetch(proxy.url, {method: "POST", headers: {Authorization: `Bearer ${proxy.token}`, "Content-Type": "application/json"}, body: Buffer.from([0xff])}); assert.equal(invalidUtf8.status, 400);
    assert.deepEqual(f.counts(), {effects: 0, acks: 0, nativeCalls: 0});
  } finally {await proxy?.close(); await f.close();}
});

for (const fault of ["digest", "binding", "caller", "arguments", "nativeIdentity", "deliverySchema", "nativeObservationSchema"]) test(`parent refuses ${fault} mapping tampering and retains the original effect fence`, async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy); await call(proxy, session);
    const path = join(f.config.journalDir, "pi-parent-mappings", hash(JSON.stringify([request().sessionId, request().toolCallId])) + ".json");
    const mapping = JSON.parse(await readFile(path, "utf8"));
    if (fault === "digest") mapping.contentDigest = "00".repeat(32);
    if (fault === "binding") mapping.binding.authorityDigest = "00".repeat(32);
    if (fault === "caller") mapping.request.sessionId = "other-host";
    if (fault === "arguments") mapping.request.arguments.content = "changed";
    if (fault === "nativeIdentity") mapping.identity.nativeRequestId = "foreign-native-id";
    if (fault === "deliverySchema") mapping.acknowledgement = {acknowledged: false, outcomeDigest: "ab".repeat(32)};
    if (fault === "nativeObservationSchema") mapping.nativeObserved = {state: "invented-authoritative-completion"};
    await writeFile(path, JSON.stringify(["deliverySchema", "nativeObservationSchema"].includes(fault) ? redigest(mapping) : mapping), {mode: 0o600});
    await assert.rejects(proxy.originals.lookup(request()), /mapping|binding|digest|identity/);
    assert.ok((await call(proxy, session, request("fresh"))).body.error);
    assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
  } finally {await proxy?.close(); await f.close();}
});

test("reservation missing its native original and unmapped native uncertainty both fence fresh work", async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy); const original = bodyOutcome(await call(proxy, session));
    await unlink(join(f.config.journalDir, hash(original.requestId) + ".json"));
    assert.equal((await proxy.originals.lookup(request())).state, "unknown");
    await assert.rejects(api().recoverOriginalOperation(request(), proxy.originals), /unknown|original|completion/);
    assertNotDispatched(await call(proxy, session, request("fresh")), /fenced/);
    const id = "unmapped-operation";
    await writeFile(join(f.config.journalDir, hash(id) + ".json"), JSON.stringify({requestId: id, digest: "00".repeat(32), state: "unknown", outcome: {state: "unknown", evidence: "unverified", requestId: id}}), {mode: 0o600});
    assert.ok((await proxy.originals.inventory()).operations.some(op => op.nativeRequestId === id && op.mapped === false));
    assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
  } finally {await proxy?.close(); await f.close();}
});

test("same-authority continuation keeps exact signed outcomes and bounded context, and imports through native original lookup", async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy); const original = bodyOutcome(await call(proxy, session));
    const path = join(f.directory, "continuation.json");
    await api().exportContinuation(path, {binding: f.binding, requests: [request()], originals: proxy.originals, context: {note: "continue reviewing source"}});
    const file = JSON.parse(await readFile(path, "utf8")); assert.equal(file.schema, "chio.pi.continuation.v1");
    assert.deepEqual(file.originals[0].outcome, original); assert.deepEqual(file.originals[0].request, request());
    for (const secret of ["private-synthetic-bearer", "private-synthetic-session"]) assert.equal(JSON.stringify(file).includes(secret), false);
    await proxy.close(); await f.restart(); proxy = await start(f);
    const imported = await api().importContinuation(path, {binding: f.binding, originals: proxy.originals});
    assert.deepEqual(imported.originals[0].outcome, original); assert.equal((await proxy.originals.inventory()).fenced, true);
    assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
  } finally {await proxy?.close(); await f.close();}
});

for (const fault of ["digest", "authority", "signature", "caller", "arguments", "contextCredential"]) test(`continuation rejects ${fault} even when a content hash is recomputed`, async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f); const session = await initialize(proxy); await call(proxy, session);
    const path = join(f.directory, "continuation.json"); await api().exportContinuation(path, {binding: f.binding, requests: [request()], originals: proxy.originals, context: {note: "bounded"}});
    let value = JSON.parse(await readFile(path, "utf8"));
    if (fault === "digest") value.contentDigest = "00".repeat(32);
    if (fault === "authority") value.binding.authorityDigest = "00".repeat(32);
    if (fault === "signature") value.originals[0].outcome.receipt.signature = "00".repeat(64);
    if (fault === "caller") value.originals[0].request.sessionId = "other-host";
    if (fault === "arguments") value.originals[0].request.arguments.content = "substituted";
    if (fault === "contextCredential") value.context.bearerToken = "secret";
    if (fault !== "digest") value = redigest(value);
    await writeFile(path, JSON.stringify(value), {mode: 0o600});
    await assert.rejects(api().importContinuation(path, {binding: f.binding, originals: proxy.originals}), /binding|digest|verification|mapping|original|credential/);
    assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
  } finally {await proxy?.close(); await f.close();}
});

for (const kind of ["symlink", "fifo", "directory", "public", "oversize", "invalidUtf8"]) test(`continuation refuses ${kind} input without opening a special file`, async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f); const path = join(f.directory, "bad.json");
    if (kind === "symlink") await symlink(f.configPath, path);
    if (kind === "fifo") execFileSync("mkfifo", [path]);
    if (kind === "directory") await mkdir(path, {mode: 0o700});
    if (kind === "public") await writeFile(path, "{}", {mode: 0o644});
    if (kind === "oversize") await writeFile(path, "x".repeat(1024 * 1024 + 1), {mode: 0o600});
    if (kind === "invalidUtf8") await writeFile(path, Buffer.from([0xff]), {mode: 0o600});
    await assert.rejects(api().importContinuation(path, {binding: f.binding, originals: proxy.originals}), /private|regular|bounded|UTF|JSON|size/);
    assert.deepEqual(f.counts(), {effects: 0, acks: 0, nativeCalls: 0});
  } finally {await proxy?.close(); await f.close();}
});

test("A2-M2: a fenced pre-forward refusal is a definite not_dispatched result and leaves the guest adapter usable", async () => {
  const f = await nativeFixture(); let proxy;
  try {
    proxy = await start(f);
    const client = await gatewayExecutor({schema: "chio.pi.transport.v1", sessionId: f.config.sessionId, transport: {url: proxy.url, token: proxy.token}, binding: f.config.execution,
      parentBinding: f.binding, tools: f.config.tools, registryDigest: f.registry.digest, approvals: false});
    const first = await client.executor.execute(request("first")); assert.equal(first.outcome, "completed");
    const refused = await client.executor.execute(request("fenced"));
    assert.equal(refused.outcome, "not_dispatched"); assert.match(refused.content, /fenced/);
    assert.equal(client.state.unresolved, false, "a definite parent refusal is not an unknown external outcome");
    assert.equal(await proxy.originals.mappings.find(request("fenced")), undefined, "nothing was reserved for the refused call");
    assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
    // Trusted history delivery clears the fence; the same guest adapter proceeds.
    assert.equal((await proxy.originals.acknowledgeHistory(first.retainedOutcome, f.native)).acknowledged, true);
    assert.equal((await client.executor.execute(request("after-delivery"))).outcome, "completed");
    assert.deepEqual(f.counts(), {effects: 2, acks: 1, nativeCalls: 2});
  } finally {await proxy?.close(); await f.close();}
});

test("A2-M3: a queued tools/call whose guest connection closed is never reserved or forwarded", async () => {
  const f = await nativeFixture(); let proxy; let release = () => {};
  try {
    proxy = await start(f); const session = await initialize(proxy);
    // Every parent mapping handle in this process shares one line per directory.
    // Holding it keeps the next tools/call queued before its reservation.
    const holder = await api().createNativeOriginalOperationPort({configPath: f.configPath, binding: f.binding});
    const gate = new Promise(done => {release = done;}); const held = holder.mappings.serial(() => gate);
    const abandoned = request("abandoned"); const controller = new AbortController();
    const pending = fetch(proxy.url, {method: "POST", redirect: "error", signal: controller.signal, headers: {"Content-Type": "application/json", Authorization: `Bearer ${proxy.token}`, "Mcp-Session-Id": session},
      body: JSON.stringify({jsonrpc: "2.0", id: JSON.stringify([abandoned.sessionId, abandoned.toolCallId]), method: "tools/call", params: {name: abandoned.tool, arguments: abandoned.arguments}})}).catch(error => error);
    await new Promise(done => setTimeout(done, 300)); controller.abort(); await pending;
    await new Promise(done => setTimeout(done, 100)); release(); await held;
    // The next call queues behind the abandoned one on the parent's tool line.
    const after = await call(proxy, session, request("after"));
    assert.equal(bodyOutcome(after).state, "completed", "the closed connection left no unacknowledged original fencing later work");
    assert.equal(await proxy.originals.mappings.find(abandoned), undefined);
    assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
  } finally {release(); await proxy?.close(); await f.close();}
});

test("final review: a retained identity re-sent while the proxy closes is resolved from its original, never refused as not dispatched", async () => {
  const f = await nativeFixture(); let proxy; let release = () => {};
  try {
    proxy = await start(f); const session = await initialize(proxy);
    const first = request("first");
    assert.equal(bodyOutcome(await call(proxy, session, first)).state, "completed");
    // Hold the shared per-directory mapping line so another call occupies the
    // parent's tool line and the re-send of `first` is still queued at close.
    const holder = await api().createNativeOriginalOperationPort({configPath: f.configPath, binding: f.binding});
    const gate = new Promise(done => {release = done;}); const held = holder.mappings.serial(() => gate);
    const other = call(proxy, session, request("other")).catch(error => error);
    await new Promise(done => setTimeout(done, 200));
    const resend = call(proxy, session, first).catch(error => error);
    await new Promise(done => setTimeout(done, 200));
    const looked = []; const lookup = proxy.originals.lookup.bind(proxy.originals);
    proxy.originals.lookup = async logical => {const original = await lookup(logical); looked.push({toolCallId: logical.toolCallId, state: original.state}); return original;};
    const closing = proxy.close(); const closed = proxy; proxy = undefined;
    release(); await held; await closing; await other; await resend;
    assert.deepEqual(looked, [{toolCallId: "first", state: "completed"}], "the queued re-send reads its retained original instead of a closed-proxy non-dispatch");
    assert.equal(await closed.originals.mappings.find(request("other")), undefined, "nothing new was reserved while closing");
    assert.deepEqual(f.counts(), {effects: 1, acks: 0, nativeCalls: 1});
  } finally {release(); await proxy?.close(); await f.close();}
});

test("A2-M4: the parent refuses a native execution timeout its fixed upstream and guest deadlines cannot accommodate", async () => {
  const f = await nativeFixture({timeoutMs: 60000}); let proxy;
  try {
    await assert.rejects((async () => {proxy = await start(f);})(), /timeoutMs must be at most 30000/);
    assert.deepEqual(f.counts(), {effects: 0, acks: 0, nativeCalls: 0});
  } finally {await proxy?.close(); await f.close();}
  const bounded = await nativeFixture({timeoutMs: 30000});
  try {await (await start(bounded)).close();} finally {await bounded.close();}
});
