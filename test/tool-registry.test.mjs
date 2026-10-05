import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as plugin from "../dist/index.js";

const schema = {type: "object", properties: {path: {type: "string", minLength: 1}}, required: ["path"], additionalProperties: false};
const specs = [
  {name: "read_text_file", description: "Read selected source", inputSchema: schema},
  {name: "write_file", inputSchema: {...schema, properties: {...schema.properties, content: {type: "string"}}, required: ["path", "content"]}},
  {name: "edit_file", inputSchema: schema},
  {name: "list_directory", inputSchema: schema},
];
function registry(tools = specs, mode = "typed") {
  assert.equal(typeof plugin.createToolRegistry, "function", "native typed registry factory must be exported");
  return plugin.createToolRegistry(tools, mode);
}

test("typed file registry exposes native arguments with standard deterministic aliases", () => {
  const value = registry();
  assert.equal(value.mode, "typed");
  assert.deepEqual(value.tools.map(tool => tool.name).sort(), ["chio_edit", "chio_list", "chio_read", "chio_write"]);
  const read = value.tools.find(tool => tool.name === "chio_read");
  assert.equal(read.kernelTool, "read_text_file");
  assert.deepEqual(read.parameters, schema);
  assert.equal(read.description, "Read selected source");
  assert.match(value.digest, /^[a-f0-9]{64}$/);
});

test("registry schemas are deeply cloned and frozen, including the digest binding", () => {
  const original = structuredClone(specs);
  const value = registry(original);
  const digest = value.digest;
  original[0].inputSchema.properties.path.type = "number";
  assert.equal(value.tools.find(tool => tool.name === "chio_read").parameters.properties.path.type, "string");
  assert.equal(value.digest, digest);
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.tools));
  assert.throws(() => {value.tools[0].parameters.properties.path.type = "number";}, TypeError);
});

test("canonical registry digest pins aliases, descriptions, exposure, mode and exact schema", () => {
  const value = registry();
  const reordered = structuredClone(specs).reverse();
  reordered.find(tool => tool.name === "read_text_file").inputSchema = {additionalProperties: false, required: ["path"], properties: {path: {minLength: 1, type: "string"}}, type: "object"};
  assert.equal(registry(reordered).digest, value.digest);
  for (const change of [
    [{...specs[0], description: "Different description"}, ...specs.slice(1)],
    [{...specs[0], inputSchema: {...schema, additionalProperties: true}}, ...specs.slice(1)],
    [{...specs[0], name: "read_range"}, ...specs.slice(1)],
  ]) assert.notEqual(registry(change).digest, value.digest);
  assert.notEqual(registry(specs, "legacy").digest, value.digest);
});

test("aliases reject normalization, standard-name and reserved-wrapper collisions", () => {
  for (const names of [["a.b", "a_b"], ["read_text_file", "read_file"], ["execute"], ["a", "a"]]) {
    assert.throws(() => registry(names.map(name => ({name, inputSchema: {type: "object"}}))), /collision|reserved|duplicate/i);
  }
  assert.equal(registry([{name: "repo.search", inputSchema: {type: "object"}}]).tools[0].name, "chio_repo_search");
});

test("registry rejects non-JSON or malformed schemas and never silently drops constraints", () => {
  const circular = {}; circular.self = circular;
  for (const inputSchema of [null, [], {type: "not-json-schema"}, {type: "object", required: "path"}, {type: "object", properties: {path: {type: "string", minLength: -1}}}, {type: "object", customExecutable: () => true}, circular]) {
    assert.throws(() => registry([{name: "read_text_file", inputSchema}]), /schema|JSON|circular/i);
  }
  assert.throws(() => registry(specs, "anything"), /mode/);
});

test("schema array accessors are refused without executing operator-supplied code", () => {
  let reads = 0;
  const required = ["path"];
  Object.defineProperty(required, "0", {enumerable: true, get() {reads++; return "path";}});
  assert.throws(() => registry([{...specs[0], inputSchema: {...schema, required}}]), /JSON|accessor/);
  assert.equal(reads, 0);
});

test("asynchronous schemas are refused before typed or legacy argument dispatch", () => {
  for (const mode of ["typed", "legacy"]) for (const dialect of [{}, {$schema: "https://json-schema.org/draft/2020-12/schema"}]) {
    assert.throws(() => registry([{name: "read_text_file", inputSchema: {...schema, ...dialect, $async: true}}], mode), /schema|synchronous|async/i);
  }
});

test("legacy wrapper is an explicitly selected, schema-pinned comparison mode", () => {
  const value = registry(specs, "legacy");
  assert.equal(value.mode, "legacy");
  assert.deepEqual(value.tools.map(tool => tool.name), ["chio_execute"]);
  assert.ok(value.tools[0].parameters.properties.tool);
  assert.ok(value.tools[0].parameters.properties.arguments);
  assert.notEqual(value.digest, registry([{...specs[0], inputSchema: {...schema, maxProperties: 1}}, ...specs.slice(1)], "legacy").digest);
  assert.equal(createHash("sha256").update(value.digest).digest("hex").length, 64);
});
