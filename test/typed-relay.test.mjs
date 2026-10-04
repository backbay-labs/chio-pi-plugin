import assert from "node:assert/strict";
import test from "node:test";
import * as plugin from "../dist/index.js";
import { validateModelRequest, startModelRelay } from "../dist/model-relay.js";

const spec = {name: "read_text_file", description: "Read selected source", inputSchema: {type: "object", properties: {path: {type: "string"}}, required: ["path"], additionalProperties: false}};
function registry() {assert.equal(typeof plugin.createToolRegistry, "function"); return plugin.createToolRegistry([spec]);}
const request = (input = [], override = {}) => ({model: "gpt-4.1-mini", input, store: false, stream: true, ...override});
const declaration = () => ({type: "function", name: "chio_read", description: spec.description, parameters: structuredClone(spec.inputSchema), strict: false});
const call = () => ({type: "function_call", call_id: "original-call", name: "chio_read", arguments: JSON.stringify({path: "source.ts"})});
const outcome = () => ({state: "completed", evidence: "verified", requestId: "original-operation", receipt: {tool_name: "read_text_file", action: {parameters: {path: "source.ts"}}, signature: "fixture-only"}, result: {content: [{type: "text", text: "source"}]}, delivery: {acknowledgement: "delivery-fixture"}});
const output = () => ({type: "function_call_output", call_id: "original-call", output: JSON.stringify(outcome())});

test("typed relay accepts only pinned native schemas, descriptions and choices", () => {
  const pinned = registry();
  validateModelRequest(request([], {tools: [declaration()], tool_choice: {type: "function", name: "chio_read"}}), "gpt-4.1-mini", "openai", pinned);
  validateModelRequest({...request([], {tools: [{...declaration(), strict: null}]}), model: "gpt-5.5"}, "gpt-5.5", "openai-codex", pinned);
  for (const tool of [
    {...declaration(), name: "read_text_file"}, {...declaration(), name: "chio_execute"},
    {...declaration(), parameters: {...spec.inputSchema, additionalProperties: true}},
    {...declaration(), description: "widened authority"}, {...declaration(), defer_loading: true},
    {...declaration(), strict: true}, {type: "mcp", server_url: "http://foreign.test"},
  ]) assert.throws(() => validateModelRequest(request([], {tools: [tool]}), "gpt-4.1-mini", "openai", pinned));
  assert.throws(() => validateModelRequest(request([], {tools: [declaration(), declaration()]}), "gpt-4.1-mini", "openai", pinned));
  assert.throws(() => validateModelRequest(request([], {tool_choice: {type: "function", name: "chio_execute"}}), "gpt-4.1-mini", "openai", pinned));
});

test("relay requires an explicit registry instead of implicitly choosing the legacy wrapper", async () => {
  assert.throws(() => validateModelRequest(request(), "gpt-4.1-mini"), /explicit.*registry/);
  await assert.rejects(startModelRelay({provider: "openai", apiKey: "fixture-only"}, "gpt-4.1-mini"), /explicit.*registry/);
});

test("relay binds function history aliases, exact arguments, call identity and full outcome", () => {
  const pinned = registry();
  const body = request([call(), output()]);
  validateModelRequest(body, "gpt-4.1-mini", "openai", pinned);
  assert.deepEqual(JSON.parse(body.input[1].output), outcome());
  for (const input of [
    [{...call(), name: "chio_other"}, output()],
    [{...call(), arguments: "invalid"}, output()],
    [{...call(), arguments: JSON.stringify({path: 7})}, output()],
    [{...call(), arguments: JSON.stringify({path: "source.ts", extra: true})}, output()],
    [output()], [call(), {...output(), call_id: "another-call"}], [call(), call(), output()],
    [call(), output(), output()],
    [call(), {...output(), output: JSON.stringify({...outcome(), receipt: {...outcome().receipt, tool_name: "write_file"}})}],
    [call(), {...output(), output: JSON.stringify({...outcome(), receipt: {...outcome().receipt, action: {parameters: {path: "other.ts"}}}})}],
  ]) assert.throws(() => validateModelRequest(request(input), "gpt-4.1-mini", "openai", pinned));
});

test("typed relay refuses substituted schemas and history before delivery observation or network egress", async () => {
  const pinned = registry();
  const original = globalThis.fetch; let delivered = 0; let upstream = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("http://127.0.0.1:")) return original(url, init);
    upstream++; return new Response("data: [DONE]\n\n", {headers: {"content-type": "text/event-stream"}});
  };
  const relay = await startModelRelay({provider: "openai", apiKey: "fixture-key"}, "gpt-4.1-mini", async outcomes => {delivered++; assert.deepEqual(outcomes, [outcome()]);}, pinned);
  try {
    const send = body => fetch(`http://127.0.0.1:${relay.port}/v1/responses`, {method: "POST", headers: {authorization: `Bearer ${relay.token}`, "content-type": "application/json"}, body: JSON.stringify(body)});
    const bad = await send(request([call(), output()], {tools: [{...declaration(), parameters: {type: "object"}}]}));
    assert.equal(bad.status, 502); await bad.text();
    assert.equal(delivered, 0); assert.equal(upstream, 0);
    const good = await send(request([call(), output()], {tools: [declaration()]}));
    assert.equal(good.status, 200); await good.text();
    assert.equal(delivered, 1); assert.equal(upstream, 1);
  } finally {await relay.close(); globalThis.fetch = original;}
});
