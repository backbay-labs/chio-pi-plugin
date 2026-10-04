import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { configuredExecutor, readPreparedConfig } from "../dist/configured.js";
import * as configured from "../dist/configured.js";
import { createToolRegistry } from "../dist/index.js";

function config() {
  return {sessionId: "host-session", execution: {sessionId: "kernel-session", endpoint: "http://127.0.0.1:1/mcp", bearerToken: "fixture-only", subjectKey: "ab".repeat(32), capabilityId: "capability", serverId: "coding", trustedSigners: ["cd".repeat(32)]}, tools: [{name: "read_text_file", description: "Read source", inputSchema: {type: "object", properties: {path: {type: "string"}}, required: ["path"], additionalProperties: false}}]};
}

test("prepared operator inventory is validated and frozen before a model session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chio-config-registry-"));
  const path = join(directory, "prepared.json");
  try {
    await writeFile(path, JSON.stringify(config()), {mode: 0o600});
    const pinned = await readPreparedConfig(path);
    assert.equal(pinned.toolMode, "typed");
    assert.ok(Object.isFrozen(pinned.tools) && Object.isFrozen(pinned.tools[0].inputSchema.properties));
    for (const tools of [[{name: "read_text_file", inputSchema: {type: "invalid"}}], [{name: "a.b", inputSchema: {}}, {name: "a_b", inputSchema: {}}]]) {
      await writeFile(path, JSON.stringify({...config(), tools}));
      await assert.rejects(readPreparedConfig(path), /schema|collision/);
    }
  } finally {await rm(directory, {recursive: true, force: true});}
});

test("resume binding pins exact registry mode, schemas and mappings before dispatch", async () => {
  const profile = await mkdtemp(join(tmpdir(), "chio-config-binding-"));
  try {
    const original = config();
    const controlled = await configuredExecutor(original, profile);
    assert.match(controlled.registry.digest, /^[a-f0-9]{64}$/);
    const binding = await readFile(join(profile, "chio/authority.binding"), "utf8");
    await controlled.close();
    // JSON key order is not a semantic authority change.
    const reordered = config();
    reordered.tools[0].inputSchema = {additionalProperties: false, required: ["path"], properties: {path: {type: "string"}}, type: "object"};
    const same = await configuredExecutor(reordered, profile);
    assert.equal(await readFile(join(profile, "chio/authority.binding"), "utf8"), binding);
    await same.close();
    for (const changed of [
      {...original, toolMode: "legacy"},
      {...original, tools: [{...original.tools[0], inputSchema: {...original.tools[0].inputSchema, additionalProperties: true}}]},
      {...original, tools: [{...original.tools[0], description: "Changed tool description"}]},
    ]) await assert.rejects(configuredExecutor(changed, profile), /authority|registry|tools/);
  } finally {await rm(profile, {recursive: true, force: true});}
});

test("trusted parent journal pins host version and registry across guest profile tampering", async () => {
  assert.equal(typeof configured.pinHostRegistry, "function", "trusted parent host binding must be available");
  const directory = await mkdtemp(join(tmpdir(), "chio-parent-binding-"));
  try {
    const original = config(); const registry = createToolRegistry(original.tools);
    await configured.pinHostRegistry(original, registry, directory);
    const path = join(directory, "pi-host.binding.json");
    const text = await readFile(path, "utf8");
    const binding = JSON.parse(text);
    assert.equal(binding.piVersion, "1.0.2");
    assert.equal(binding.registryDigest, registry.digest);
    assert.equal(text.includes(original.execution.bearerToken), false);
    await configured.pinHostRegistry(original, registry, directory);
    await assert.rejects(configured.pinHostRegistry({...original, toolMode: "legacy"}, createToolRegistry(original.tools, "legacy"), directory), /binding|registry|host/);
    await assert.rejects(configured.pinHostRegistry({...original, sessionId: "replacement"}, registry, directory), /binding|authority/);
    await writeFile(path, JSON.stringify({...binding, piVersion: "0.85.1"}));
    await assert.rejects(configured.pinHostRegistry(original, registry, directory), /binding|host/);
  } finally {await rm(directory, {recursive: true, force: true});}
});
