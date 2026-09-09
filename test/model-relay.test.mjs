import assert from "node:assert/strict";
import test from "node:test";
import { validateModelRequest } from "../dist/model-relay.js";

const request = input => ({ model: "gpt-4.1-mini", input, store: false, stream: true });
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

test("model relay refuses alternate models, hosted tools, references and background routes", () => {
  for (const override of [
    { model: "other-model" }, { background: true }, { previous_response_id: "resp_other" }, { store: true },
    { tools: [{ type: "web_search" }] }, { tools: [{ type: "function", name: "shell" }] },
    { tool_choice: { type: "web_search" } }, { tool_choice: { type: "function", name: "shell" } },
  ]) assert.throws(() => validateModelRequest({ ...request([{ role: "user", content: "hello" }]), ...override }, "gpt-4.1-mini"));
});
