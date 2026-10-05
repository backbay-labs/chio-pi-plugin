import assert from 'node:assert/strict';
import {chmod, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import * as privateState from '../dist/private-state.js';
import {readPreparedConfig} from '../dist/configured.js';
import {readTransportConfig} from '../dist/http-executor.js';
import {requireSessionCredential} from '../dist/sandbox.js';
import {compiledRecipeFilter, evaluateClassicBpf} from './helpers/coding-seccomp.mjs';

async function scratch(t) {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'chio-review-'));
  t.after(() => rm(dir, {recursive: true, force: true})); return dir;
}
for (const [name, read] of [['prepared', readPreparedConfig], ['transport', readTransportConfig], ['session', requireSessionCredential]]) {
  test(`malformed ${name} configuration with credential bytes never includes them in diagnostics`, async t => {
    const dir = await scratch(t); const path = join(dir, 'private.json');
    const secret = 'fixture-secret-credential'; await writeFile(path, secret, {mode: 0o600});
    await assert.rejects(read(path), error => {
      assert.doesNotMatch(error.message, /fixture|secret-credential/);
      assert.match(error.message, /malformed.*withheld/); return true;
    });
  });
}
for (const [name, arch, calls] of [['arm64', 0xc00000b7, [117, 270, 271, 438]], ['x64', 0xc000003e, [101, 310, 311, 438]]]) {
  test(`${name} recipe denies process inspection, memory writes and descriptor theft independent of Yama`, async () => {
    const filter = await compiledRecipeFilter(name);
    for (const nr of calls) assert.equal(evaluateClassicBpf(filter, {arch, nr}), 0x50001, `syscall ${nr} must return EPERM`);
  });
}
test('private publication recovery removes partial temporaries and preserves published original bytes', async t => {
  assert.equal(typeof privateState.recoverPrivateWrites, 'function');
  const dir = await scratch(t); const target = join(dir, 'a'.repeat(64) + '.json');
  const temporary = join(dir, '.chio-' + 'b'.repeat(32) + '.tmp');
  await privateState.writePrivateJson(target, {original: 'retained'});
  await writeFile(temporary, '{partial', {mode: 0o600});
  await privateState.recoverPrivateWrites(dir);
  assert.deepEqual(await privateState.readPrivateJson(target), {original: 'retained'});
  assert.deepEqual(await readdir(dir), ['a'.repeat(64) + '.json']);
  // Exact crash point after exclusive link publication and before temp unlink.
  await link(target, temporary);
  await assert.rejects(privateState.readPrivateJson(target), /Private regular/);
  await privateState.recoverPrivateWrites(dir);
  assert.deepEqual(await privateState.readPrivateJson(target), {original: 'retained'});
});
for (const kind of ['symlink', 'external hardlink', 'public file']) test(`private publication recovery refuses ${kind} without following it`, async t => {
  const root = await scratch(t); const dir = join(root, 'state'); await mkdir(dir, {mode: 0o700});
  const external = join(root, 'sentinel'); await writeFile(external, 'untouched', {mode: 0o600});
  const temporary = join(dir, '.chio-' + 'c'.repeat(32) + '.tmp');
  if (kind === 'symlink') await symlink(external, temporary);
  else if (kind === 'external hardlink') await link(external, temporary);
  else {await writeFile(temporary, 'untrusted', {mode: 0o600}); await chmod(temporary, 0o644);}
  await assert.rejects(privateState.recoverPrivateWrites(dir), /unsafe|external hardlink/);
  assert.equal(await readFile(external, 'utf8'), 'untouched');
  assert.equal((await readdir(dir)).length, 1);
});

test('full parent mapping inventories preserve original lookup and refuse new reservations before writing', {timeout: 120000}, async t => {
  const {hostname} = await import('node:os');
  const {createToolRegistry} = await import('../dist/tool-registry.js');
  const {gatewayIdentity, logicalKey, openParentMappings, PARENT_MAPPING_LIMIT, withContentDigest} = await import('../dist/parent-mappings.js');
  const {canonicalJson} = await import('../dist/tool-registry.js');
  const dir = await scratch(t); const registry = createToolRegistry([{name: 'read', inputSchema: {type: 'object'}}, {name: 'chio_resume', inputSchema: {type: 'object'}}]);
  const binding = {authorityDigest: 'a'.repeat(64), registryDigest: registry.digest};
  const store = await openParentMappings(dir, binding, registry, 'native-session');
  await privateState.writePrivateJson(join(dir, 'gateway.lock'), {hostname: hostname(), pid: process.pid, sessionId: 'native-session'});
  // Include an already-over-cap historical inventory: recovery must not depend
  // on the new admission bound. Every record has a valid original identity.
  const records = Array.from({length: 4097}, (_, index) => {
    const request = {sessionId: 'retained', toolCallId: String(index), tool: 'read', arguments: {}};
    return withContentDigest({schema: 'chio.pi.parent-mapping.v1', binding, request, argumentDigest: privateState.sha256(canonicalJson(request.arguments)), identity: gatewayIdentity('native-session', 'mcp-session', request)});
  });
  for (let index = 0; index < records.length; index += 64) await Promise.all(records.slice(index, index + 64).map(record =>
    writeFile(join(store.directory, logicalKey(record.request) + '.json'), JSON.stringify(record), {mode: 0o600})));
  assert.equal((await store.all()).length, 4097);
  assert.deepEqual(await store.find(records.at(-1).request), records.at(-1));
  assert.equal((await store.reserve(records.at(-1).request, 'new-mcp-session')).created, false, 'old identity is recoverable even at capacity');
  assert.equal(PARENT_MAPPING_LIMIT, 4096);
  await assert.rejects(store.reserve({...records[0].request, toolCallId: 'fresh'}, 'mcp-session'), /capacity reached/);
  assert.equal((await readdir(store.directory)).length, 4097);
  const resume = {...records[0].request, toolCallId: 'resume', tool: 'chio_resume', arguments: {requestId: records[0].identity.nativeRequestId, tool: 'read', arguments: {}}};
  assert.equal((await store.reserve(resume, 'mcp-session')).created, true, 'a retained approval can still gain its resume mapping');
  await assert.rejects(store.reserve({...resume, toolCallId: 'unknown-resume', arguments: {requestId: 'unknown', tool: 'read', arguments: {}}}, 'mcp-session'), /capacity reached/);
});
