import assert from "node:assert/strict";
import { mkdtemp, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { configuredExecutor, readPreparedConfig } from "../dist/configured.js";
import * as configured from "../dist/configured.js";
import { createToolRegistry } from "../dist/index.js";
const {createGateway} = await import(new URL("./gateway.js", import.meta.resolve("@chio/bridge")));
const {gatewayStatus} = await import(new URL("./gateway-operator.js", import.meta.resolve("@chio/bridge")));

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
    const path = join(directory, "pi-host.binding");
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

test("parent host metadata coexists with bundled gateway startup, status, close and restart", async () => {
  const journalDir = await mkdtemp(join(tmpdir(), "chio-native-binding-"));
  const original = {...config(), journalDir};
  const registry = createToolRegistry(original.tools);
  let gateway;
  try {
    await configured.pinHostRegistry(original, registry, journalDir);
    const executor = {async execute() {throw new Error("No operation may dispatch in the binding fixture");}};
    gateway = createGateway(original, executor, {requireHostAcknowledgement: true});
    assert.deepEqual(gatewayStatus(original).operations, []);
    assert.equal(gatewayStatus(original).fenced, false);
    gateway.close(); gateway = undefined;
    assert.equal(gatewayStatus(original).lock.state, "missing");
    await configured.pinHostRegistry(original, registry, journalDir);
    gateway = createGateway(original, executor, {requireHostAcknowledgement: true});
    assert.deepEqual(gatewayStatus(original).operations, []);
    await assert.rejects(configured.pinHostRegistry({...original, toolMode: "legacy"}, createToolRegistry(original.tools, "legacy"), journalDir), /binding|registry|host/);
    assert.deepEqual(gatewayStatus(original).operations, []);
    gateway.close(); gateway = undefined;
  } finally {gateway?.close(); await rm(journalDir, {recursive: true, force: true});}
});

/** Interrupt the first write whose bytes match, as a crash between creating and
 * filling a binding would. A partial binding must never become the record. */
async function interruptWrite(matches, operation) {
  const probe = await open(fileURLToPath(import.meta.url), "r");
  const prototype = Object.getPrototypeOf(probe); await probe.close();
  const original = prototype.writeFile; let interrupted = 0;
  prototype.writeFile = function (data, ...rest) {
    if (!interrupted && matches(String(data))) {interrupted++; return Promise.reject(new Error("simulated crash during binding write"));}
    return original.call(this, data, ...rest);
  };
  try {await assert.rejects(operation(), /simulated crash/);} finally {prototype.writeFile = original;}
  assert.equal(interrupted, 1);
}

test("A1-M4: an interrupted binding write never leaves an empty binding that refuses later launches", async () => {
  const profile = await mkdtemp(join(tmpdir(), "chio-config-atomic-"));
  const journal = await mkdtemp(join(tmpdir(), "chio-parent-atomic-"));
  try {
    const original = config(); const registry = createToolRegistry(original.tools);
    await interruptWrite(data => /^[a-f0-9]{64}$/.test(data), () => configuredExecutor(original, profile));
    assert.deepEqual(await readdir(join(profile, "chio")), []);
    const controlled = await configuredExecutor(original, profile);
    assert.match(await readFile(join(profile, "chio/authority.binding"), "utf8"), /^[a-f0-9]{64}$/);
    await controlled.close();
    await interruptWrite(data => data.includes("chio.pi.host-binding.v1"), () => configured.pinHostRegistry(original, registry, journal));
    assert.deepEqual(await readdir(journal), []);
    await configured.pinHostRegistry(original, registry, journal);
    assert.equal(JSON.parse(await readFile(join(journal, "pi-host.binding"), "utf8")).registryDigest, registry.digest);
    assert.deepEqual(await readdir(journal), ["pi-host.binding"]);
    assert.deepEqual(await readdir(join(profile, "chio")), ["authority.binding"]);
  } finally {await rm(profile, {recursive: true, force: true}); await rm(journal, {recursive: true, force: true});}
});

test("A1-M5: the direct prepared-config executor refuses approval it cannot resume", async () => {
  const profile = await mkdtemp(join(tmpdir(), "chio-config-approval-"));
  try {
    const approval = {requiredTools: ["read_text_file"], purpose: "operator review", ttlSeconds: 60};
    await assert.rejects(configuredExecutor({...config(), approval}, profile), /approval.*protected launcher/i);
    await assert.rejects(readdir(join(profile, "chio")), {code: "ENOENT"});
    const controlled = await configuredExecutor(config(), profile);
    await controlled.close();
  } finally {await rm(profile, {recursive: true, force: true});}
});
