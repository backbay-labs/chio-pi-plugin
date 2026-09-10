import assert from "node:assert/strict";
import test from "node:test";
import { nativeToolOutcome, readCodexAuthority, startModelRelay, validateModelRequest } from "../dist/model-relay.js";
import { relayCredentials } from "../dist/model-credentials.js";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { zstdCompressSync } from "node:zlib";
import { mkdtemp, writeFile, chmod, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const request = input => ({ model: "gpt-4.1-mini", input, store: false, stream: true });
test("native tool-error history preserves the full outcome and never interprets arbitrary prose", () => {
  const outcome = {state: "completed", evidence: "verified", requestId: "original", result: {isError: true, content: [{type: "text", text: "ENOENT"}]}, receipt: {signature: "unchanged"}};
  const text = "Chio tool completed with an error: " + JSON.stringify(outcome);
  assert.deepEqual(nativeToolOutcome(text), outcome);
  assert.deepEqual(nativeToolOutcome([{type: "input_text", text}]), outcome);
  assert.equal(nativeToolOutcome("untrusted prose: " + JSON.stringify(outcome)), undefined);
  assert.equal(nativeToolOutcome("Chio tool completed with an error: " + JSON.stringify({...outcome, result: {isError: false}})), undefined);
  assert.equal(nativeToolOutcome("Chio tool completed with an error: invalid"), undefined);
  // Parsing never changes signatures, evidence, request identity or result.
  const forged = {...outcome, receipt: {signature: "forged"}};
  assert.deepEqual(nativeToolOutcome("Chio tool completed with an error: " + JSON.stringify(forged)), forged);
});
test("model relay requires complete text/function history and removes provider item references", () => {
  for (const input of [[{ id: "msg_other" }], [{ id: "msg_other", type: null }], [{ type: "item_reference", id: "msg_other" }], [{ role: "user", content: [{ type: "input_image", image_url: "https://example.test/private" }] }]]) {
    assert.throws(() => validateModelRequest(request(input), "gpt-4.1-mini"));
  }
  const valid = request([
    { role: "system", content: "Use Chio" }, { role: "user", content: [{ type: "input_text", text: "Read the file" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Reading", annotations: [] }], id: "msg_old", status: "completed" },
    { type: "function_call", id: "fc_old", call_id: "call_1", name: "chio_execute", arguments: "{}" },
    { type: "function_call_output", call_id: "call_1", output: "verified content" },
  ]);
  validateModelRequest(valid, "gpt-4.1-mini");
  assert.ok(valid.input.every(item => item.id === undefined));
});

test("Codex reasoning must be inline encrypted content, never an item reference", () => {
  const body = {model: "gpt-5.5", store: false, stream: true, include: ["reasoning.encrypted_content"], input: [{type: "reasoning", id: "rs_prior", content: [], encrypted_content: "opaque_ciphertext=", summary: [{type: "summary_text", text: "Considering"}]}]};
  validateModelRequest(body, "gpt-5.5", "openai-codex");
  assert.equal(body.input[0].id, undefined);
  for (const item of [{type: "reasoning", id: "rs_other", summary: []}, {type: "reasoning", encrypted_content: "opaque", summary: [], content: [{type: "input_file", file_id: "file_other"}]}]) {
    assert.throws(() => validateModelRequest({...body, input: [item]}, "gpt-5.5", "openai-codex"));
  }
  assert.throws(() => validateModelRequest({...body, include: ["web_search_call.action.sources"]}, "gpt-5.5", "openai-codex"));
  assert.throws(() => validateModelRequest(body, "gpt-5.5", "openai"));
  const phase = {...body, input: [{type: "message", role: "assistant", content: [{type: "output_text", text: "Working"}], phase: "commentary", id: "msg_prior"}]};
  validateModelRequest(phase, "gpt-5.5", "openai-codex");
  assert.equal(phase.input[0].phase, "commentary");
  assert.equal(phase.input[0].id, undefined);
  assert.throws(() => validateModelRequest({...phase, input: [{...phase.input[0], phase: "other"}]}, "gpt-5.5", "openai-codex"));
});

test("native Codex cache stays read-only and must bind an unexpired account", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chio-codex-auth-test-"));
  const path = join(directory, "auth.json");
  const fixture = (exp, account = "fixture-account") => ({auth_mode: "chatgpt", tokens: {access_token: `header.${Buffer.from(JSON.stringify({exp, "https://api.openai.com/auth": {chatgpt_account_id: account}})).toString("base64url")}.signature`, account_id: "fixture-account", refresh_token: "must-not-refresh"}});
  try {
    const content = JSON.stringify(fixture(Date.now() / 1000 + 3600));
    await writeFile(path, content, {mode: 0o600});
    const authority = await readCodexAuthority(path);
    assert.equal(authority.accountId, "fixture-account");
    assert.equal(await readFile(path, "utf8"), content);
    const legacy = JSON.parse(content); delete legacy.auth_mode; legacy.OPENAI_API_KEY = null;
    await writeFile(path, JSON.stringify(legacy));
    assert.equal((await readCodexAuthority(path)).accountId, "fixture-account");
    await writeFile(path, "Bearer PRIVATE_FIXTURE_TOKEN_ONLY");
    await assert.rejects(readCodexAuthority(path), error => error.message === "Native Codex auth cache is unreadable or malformed" && !error.message.includes("PRIVATE"));
    await writeFile(path, JSON.stringify(fixture(Date.now() / 1000 - 1)));
    await assert.rejects(readCodexAuthority(path), /expired/);
    await writeFile(path, JSON.stringify(fixture(Date.now() / 1000 + 3600, "other-account")));
    await assert.rejects(readCodexAuthority(path), /binding/);
    await chmod(path, 0o644);
    await assert.rejects(readCodexAuthority(path), /private/);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test("native Codex transport uses local-only auth, bounded compressed history and fixed upstream", async () => {
  const fetchOriginal = globalThis.fetch;
  const requests = []; let confirmed = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("http://127.0.0.1:")) return fetchOriginal(url, init);
    assert.equal(confirmed, true);
    requests.push({url, init});
    return new Response("data: [DONE]\n\n", {headers: {"content-type": "text/event-stream"}});
  };
  const relay = await startModelRelay({provider: "openai-codex", accessToken: "private-provider-token", accountId: "private-provider-account"}, "gpt-5.5", async outcomes => {assert.deepEqual(outcomes, [{state: "completed"}]); confirmed = true;});
  try {
    assert.ok(!relay.token.includes("private-provider"));
    const credentials = relayCredentials("openai-codex", relay.token);
    const runtime = await ModelRuntime.create({credentials, modelsPath: null, refreshOnCreate: false});
    const auth = await runtime.getAuth("openai-codex");
    assert.equal(auth.auth.apiKey, relay.token);
    assert.equal(runtime.getModel("openai-codex", "gpt-5.5").api, "openai-codex-responses");
    await assert.rejects(credentials.modify("openai-codex", async value => value), /cannot/);
    const body = {model: "gpt-5.5", store: false, stream: true, input: [{type: "function_call_output", call_id: "call_1", output: '{"state":"completed"}'}]};
    const send = (route, bytes, encoding = "zstd") => fetch(`http://127.0.0.1:${relay.port}${route}`, {method: "POST", headers: {authorization: `Bearer ${relay.token}`, "content-encoding": encoding, "chatgpt-account-id": "guest-forged-account"}, body: bytes});
    const result = await send("/v1/codex/responses", zstdCompressSync(JSON.stringify(body)));
    assert.equal(result.status, 200); await result.text();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://chatgpt.com/backend-api/codex/responses");
    assert.equal(requests[0].init.headers.authorization, "Bearer private-provider-token");
    assert.equal(requests[0].init.headers["ChatGPT-Account-Id"], "private-provider-account");
    assert.equal(JSON.parse(requests[0].init.body).parallel_tool_calls, false);
    for (const route of ["/v1/responses", "/v1/codex/responses?other=1", "/v1/files", "/v1/codex/responses/other"]) assert.equal((await send(route, zstdCompressSync(JSON.stringify(body)))).status, 403);
    assert.equal((await send("/v1/codex/responses", zstdCompressSync(Buffer.alloc(8 * 1024 * 1024 + 1)))).status, 502);
    assert.equal(requests.length, 1);
  } finally { await relay.close(); globalThis.fetch = fetchOriginal; }
});

test("model relay refuses alternate models, hosted tools, references and background routes", () => {
  for (const override of [
    { model: "other-model" }, { background: true }, { previous_response_id: "resp_other" }, { store: true },
    { tools: [{ type: "web_search" }] }, { tools: [{ type: "function", name: "shell" }] },
    { tool_choice: { type: "web_search" } }, { tool_choice: { type: "function", name: "shell" } },
  ]) assert.throws(() => validateModelRequest({ ...request([{ role: "user", content: "hello" }]), ...override }, "gpt-4.1-mini"));
});
