#!/usr/bin/env node
/** Qualification fixture, never a live-model acceptance claim.
 * Only the trusted launcher's fixed provider fetch is substituted. Stock Pi,
 * its protected launcher, gateway, kernel and resource server remain real.
 * Run only with exclusive access to the designated kernel/resource fixture.
 */
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const self = fileURLToPath(import.meta.url);
const artifactSha256 = 'ec6095390b9eae233540b73aee0ad2fef6977c36122dd30aa2779329b1897aa1';
const sourceCommit = '2ccc027b42b837f3df2889863273df2c1e2d5669';
const expectedLauncherSha256 = 'f49ba53cb044aa42dfba49eef229a6c2badaa4238d146d7b5cb1c6716ff2b0c1';
const upstream = 'https://chatgpt.com/backend-api/codex/responses';
const sha = data => createHash('sha256').update(data).digest('hex');
const fileSha = path => sha(readFileSync(path));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
const lines = text => text.split('\n').filter(Boolean).flatMap(line => {try {return [JSON.parse(line)];} catch {return [];}});

function pairedCalls(spec) {
  return spec.calls.map((call, index) => ({type: 'function_call', id: `fc_pi_parallel_${index}`,
    call_id: `call_pi_parallel_${index}`, name: 'chio_execute', status: 'completed',
    arguments: JSON.stringify({tool: 'write_file', arguments: {path: call.path, content: call.content}})}));
}

function sse(items, id) {
  const events = [{type: 'response.created', response: {id, object: 'response', model: 'gpt-5.5', status: 'in_progress', output: []}}];
  for (const [output_index, item] of items.entries()) {
    events.push({type: 'response.output_item.added', output_index,
      item: item.type === 'function_call' ? {...item, arguments: '', status: 'in_progress'} : {...item, content: [], status: 'in_progress'}});
    if (item.type === 'function_call') {
      events.push({type: 'response.function_call_arguments.delta', output_index, item_id: item.id, delta: item.arguments});
      events.push({type: 'response.function_call_arguments.done', output_index, item_id: item.id, arguments: item.arguments});
    } else {
      const part = item.content[0];
      events.push({type: 'response.content_part.added', output_index, content_index: 0, item_id: item.id, part: {...part, text: ''}});
      events.push({type: 'response.output_text.delta', output_index, content_index: 0, item_id: item.id, delta: part.text});
      events.push({type: 'response.output_text.done', output_index, content_index: 0, item_id: item.id, text: part.text});
      events.push({type: 'response.content_part.done', output_index, content_index: 0, item_id: item.id, part});
    }
    events.push({type: 'response.output_item.done', output_index, item});
  }
  events.push({type: 'response.completed', response: {id, object: 'response', model: 'gpt-5.5', status: 'completed', output: items,
    usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: {cached_tokens: 0}, output_tokens_details: {reasoning_tokens: 0}}}});
  return events.map((event, sequence_number) => 'data: ' + JSON.stringify({...event, sequence_number}) + '\n\n').join('');
}

function extractOutcome(value) {
  for (let depth = 0; depth < 6; depth++) {
    if (typeof value === 'string') {try {value = JSON.parse(value);} catch {return undefined;}}
    else if (Array.isArray(value) && value.length === 1 && typeof value[0]?.text === 'string') value = value[0].text;
    else if (value && Array.isArray(value.content)) value = value.content;
    else break;
  }
  return value && typeof value === 'object' && typeof value.state === 'string' ? value : undefined;
}

function installFixture(specPath) {
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  if (spec.schema !== 'chio.pi.parallel-probe.v1' || spec.calls?.length !== 2
    || !spec.calls.every(call => /^\/workspace\/pi-forced-parallel-[a-f0-9-]+-[ab]\.txt$/.test(call.path)
      && typeof call.content === 'string' && call.content.length < 256)
    || !isAbsolute(spec.log) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(spec.kernelOrigin)) throw new Error('Explicit bounded parallel fixture required');
  const record = value => appendFileSync(spec.log, JSON.stringify({at: new Date().toISOString(),
    monotonicNs: process.hrtime.bigint().toString(), ...value}) + '\n', {mode: 0o600});
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === upstream) {
      const body = JSON.parse(String(init?.body));
      requests++;
      if (requests > 2 || body.model !== 'gpt-5.5' || body.parallel_tool_calls !== false
        || !body.tools?.some(tool => tool.type === 'function' && tool.name === 'chio_execute')) {
        record({phase: 'fixture-precondition-failed', request: requests, parallel_tool_calls: body.parallel_tool_calls});
        throw new Error('Unexpected provider request or retry in bounded parallel fixture');
      }
      const outputs = (body.input ?? []).filter(item => item.type === 'function_call_output').map(item => {
        const outcome = extractOutcome(item.output);
        return {callId: item.call_id, state: outcome?.state, evidence: outcome?.evidence,
          requestId: outcome?.requestId, outputSha256: sha(JSON.stringify(item.output))};
      });
      record({phase: 'provider-request', request: requests, parallel_tool_calls: body.parallel_tool_calls,
        tools: body.tools.map(tool => ({type: tool.type, name: tool.name})), toolOutputs: outputs});
      let items;
      if (requests === 1) {
        if (outputs.length) throw new Error('Parallel probe requires an empty native session');
        items = pairedCalls(spec);
        record({phase: 'parallel-batch-injected', responseId: 'resp_pi_parallel_1', calls: items,
          note: 'One explicit fixture response contains two calls despite outbound parallel_tool_calls=false'});
      } else {
        if (outputs.length !== 2 || new Set(outputs.map(value => value.callId)).size !== 2
          || outputs.some(value => !['call_pi_parallel_0', 'call_pi_parallel_1'].includes(value.callId))) throw new Error('Both native results must reach the next provider turn');
        items = [{type: 'message', id: 'msg_pi_parallel_done', role: 'assistant', phase: 'final_answer', status: 'completed',
          content: [{type: 'output_text', annotations: [], text: 'Fixture complete. The retained native tool results and independent observer determine the outcome; no retry was requested.'}]}];
      }
      return new Response(sse(items, `resp_pi_parallel_${requests}`), {status: 200, headers: {'content-type': 'text/event-stream'}});
    }
    // No alternate model endpoint or external fetch is permitted by this fixture.
    if (new URL(url).origin !== spec.kernelOrigin) throw new Error('Fetch outside the designated kernel and substituted provider route');
    let kernelCall;
    if (typeof init?.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        if (body.method === 'tools/call') {
          kernelCall = {rpcId: body.id, tool: body.params?.name, path: body.params?.arguments?.path};
          record({phase: 'kernel-call-start', ...kernelCall});
        }
      } catch { /* Non-JSON transport is passed through unchanged. */ }
    }
    const response = await originalFetch.call(this, input, init);
    if (kernelCall) record({phase: 'kernel-call-response-headers', ...kernelCall, status: response.status});
    return response;
  };
  record({phase: 'fixture-installed', pid: process.pid, upstreamNetworkDisabled: true,
    note: 'Parent-only preload; the protected Pi child receives the launcher fixed environment'});
}

function observe(operator) {
  const code = "const f=require('fs'),c=require('crypto');let files={};for(const n of f.readdirSync('/observe'))if(f.lstatSync('/observe/'+n).isFile())files[n]=c.createHash('sha256').update(f.readFileSync('/observe/'+n)).digest('hex');console.log(JSON.stringify({files,dispatch:f.readFileSync('/audit/dispatch.jsonl','utf8').trim().split('\\n').filter(Boolean).map(JSON.parse)}));";
  const result = spawnSync('docker', ['run', '--rm', '--network', 'none', '--read-only', '--mount',
    `type=volume,src=${operator.volume},dst=/observe,readonly`, '--mount',
    `type=volume,src=${operator.auditVolume},dst=/audit,readonly`, '--entrypoint', 'node', operator.image, '-e', code],
  {encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024});
  if (result.status !== 0) throw new Error('Independent resource observer failed');
  return JSON.parse(result.stdout);
}

function journalState(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => name.endsWith('.json')).map(name => {
    const bytes = readFileSync(join(directory, name));
    const value = JSON.parse(bytes);
    return {file: name, sha256: sha(bytes), requestId: value.requestId, state: value.state,
      outcomeState: value.outcome?.state, evidence: value.outcome?.evidence,
      path: value.request?.arguments?.path, hostDeliveryConfirmed: value.hostDeliveryConfirmed === true,
      acknowledged: value.acknowledged === true};
  });
}

function parseArgs(args) {
  const keys = ['--gateway-config', '--operator-state', '--codex-auth', '--archive', '--package-dir', '--output'];
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!keys.includes(key) || !value || values[key] || !isAbsolute(value)) throw new Error('Unique absolute arguments required: ' + keys.join(' '));
    values[key] = value;
  }
  if (keys.some(key => !values[key])) throw new Error('Required absolute arguments: ' + keys.join(' '));
  return values;
}

async function main() {
  if (process.argv[2] === '--help') {
    console.log('node scripts/probe-parallel.mjs --gateway-config /absolute/fresh/gateway.json --operator-state /absolute/designated/operator --codex-auth /absolute/private/native/auth.json --archive /absolute/chio-pi-plugin-0.1.0.tgz --package-dir /absolute/node_modules/@chio/pi-plugin --output /absolute/new/evidence-directory');
    console.log('Requires exclusive resource access and fresh prepared authority. --self-test performs no host, model or kernel calls.'); return;
  }
  if (process.argv[2] === '--self-test') {
    const items = pairedCalls({calls: [{path: '/workspace/a', content: 'a'}, {path: '/workspace/b', content: 'b'}]});
    assert.equal(items.length, 2); assert.notEqual(items[0].call_id, items[1].call_id);
    assert.ok(items.every(item => item.name === 'chio_execute' && !('namespace' in item) && JSON.parse(item.arguments).tool === 'write_file'));
    const events = sse(items, 'fixture-test').trim().split('\n\n').map(line => JSON.parse(line.slice(6)));
    assert.equal(events.filter(event => event.type === 'response.output_item.done').length, 2);
    assert.equal(events.at(-1).type, 'response.completed');
    assert.equal(extractOutcome({content: [{type: 'text', text: '{"state":"completed","evidence":"verified"}'}]}).state, 'completed');
    assert.equal(extractOutcome({content: [{type: 'text', text: 'Chio did not dispatch operation: fence'}]}), undefined);
    console.log('Fixture shape/parser checks passed; no host, model or kernel called'); return;
  }
  const args = parseArgs(process.argv.slice(2));
  assert.equal(fileSha(args['--archive']), artifactSha256, 'Frozen archive identity differs');
  const installedMain = join(args['--package-dir'], 'dist/protected-cli.js');
  assert.equal(fileSha(installedMain), expectedLauncherSha256, 'Frozen launcher identity differs');
  const output = resolve(args['--output']);
  mkdirSync(dirname(output), {recursive: true, mode: 0o700}); mkdirSync(output, {mode: 0o700});
  const operator = JSON.parse(readFileSync(join(args['--operator-state'], 'operator.json'), 'utf8'));
  const gateway = JSON.parse(readFileSync(args['--gateway-config'], 'utf8'));
  const kernelOrigin = `http://127.0.0.1:${operator.port}`;
  assert.equal(new URL(gateway.execution.endpoint).origin, kernelOrigin, 'Observer and prepared kernel differ');
  assert.ok(gateway.tools.some(tool => tool.name === 'write_file'), 'Prepared inventory must contain write_file');
  assert.ok(!gateway.approval?.requiredTools?.includes('write_file'), 'Use a fresh non-approval session for the bounded parallel case');
  const initialJournal = journalState(gateway.journalDir);
  assert.equal(initialJournal.length, 0, 'Refusing to reuse a retained operation; prepare fresh authority for this independent probe');
  const runId = randomUUID();
  const calls = ['a', 'b'].map(letter => ({path: `/workspace/pi-forced-parallel-${runId}-${letter}.txt`, content: `designated Pi parallel fixture ${runId} ${letter}`}));
  const spec = {schema: 'chio.pi.parallel-probe.v1', calls, kernelOrigin, log: join(output, 'fixture.jsonl')};
  const specPath = join(output, 'fixture.json'); save(specPath, spec);
  const before = observe(operator); save(join(output, 'before.json'), before);
  assert.ok(calls.every(call => !(basename(call.path) in before.files)), 'Designated target unexpectedly exists');
  const runtime = mkdtempSync(join(tmpdir(), 'chio-pi-parallel-fixture-'));
  const command = [installedMain, '--config', args['--gateway-config'], '--profile', join(runtime, 'profile'), '--cwd', join(runtime, 'workspace'),
    '--provider', 'openai-codex', '--model', 'gpt-5.5', '--codex-auth', args['--codex-auth'],
    '--prompt', 'Use the designated Chio tools. Never retry an uncertain effect. The operator fixture will supply one two-call response and then finish.'];
  const runtimeHashes = Object.fromEntries(readdirSync(join(args['--package-dir'], 'dist')).filter(name => name.endsWith('.js')).map(name => [name, fileSha(join(args['--package-dir'], 'dist', name))]));
  const configSha256 = fileSha(args['--gateway-config']);
  save(join(output, 'identity.json'), {claim: 'Supplemental forced provider response; actual stock Pi, protected launcher, gateway, kernel and independent resource observer',
    liveModel: false, acceptance: false, artifactSha256, sourceCommit, harnessSha256: fileSha(self), runtimeHashes,
    preparedConfigSha256: configSha256, kernelSha256: operator.kernelSha256, image: operator.image,
    volume: operator.volume, auditVolume: operator.auditVolume, calls, command: [process.execPath, ...command],
    runtime, startedAt: new Date().toISOString(), interventions: ['parent-only fixed upstream response substitution', 'two calls emitted despite unchanged outbound parallel_tool_calls=false']});
  const started = performance.now();
  const child = spawn(process.execPath, command, {detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, NODE_OPTIONS: '--import=' + pathToFileURL(self).href, CHIO_PI_PARALLEL_SPEC: specPath}});
  let timedOut = false, forceStop;
  const killGroup = signal => {try {process.kill(-child.pid, signal);} catch (error) {if (error.code !== 'ESRCH') throw error;}};
  const timer = setTimeout(() => {timedOut = true; killGroup('SIGTERM'); forceStop = setTimeout(() => killGroup('SIGKILL'), 5000);}, 195000);
  const stdout = [], stderr = [];
  child.stdout.on('data', data => stdout.push(data)); child.stderr.on('data', data => stderr.push(data));
  let exit;
  try {exit = await new Promise((yes, no) => {child.once('error', no); child.once('close', (code, signal) => yes({code, signal}));});}
  finally {clearTimeout(timer); if (forceStop) clearTimeout(forceStop);}
  writeFileSync(join(output, 'host.stdout.jsonl'), Buffer.concat(stdout), {mode: 0o600});
  writeFileSync(join(output, 'host.stderr.txt'), Buffer.concat(stderr), {mode: 0o600});
  const after = observe(operator); save(join(output, 'after.json'), after);
  const journal = journalState(gateway.journalDir); save(join(output, 'journal-states.json'), journal);
  const fixture = existsSync(spec.log) ? lines(readFileSync(spec.log, 'utf8')) : [];
  const events = lines(Buffer.concat(stdout).toString());
  const nativeStarts = events.filter(event => event.type === 'tool_execution_start');
  const nativeEnds = events.filter(event => event.type === 'tool_execution_end');
  const terminal = events.filter(event => event.type === 'chio_session');
  const dispatch = after.dispatch.slice(before.dispatch.length);
  const hostCalls = calls.map((call, index) => {
    const toolCallId = `call_pi_parallel_${index}|fc_pi_parallel_${index}`;
    const startedIndex = events.findIndex(event => event.type === 'tool_execution_start' && event.toolCallId === toolCallId);
    const completedIndex = events.findIndex(event => event.type === 'tool_execution_end' && event.toolCallId === toolCallId);
    const event = events[completedIndex], outcome = extractOutcome(event?.result);
    const resultText = event?.result?.content?.map(part => part.text ?? '').join('\n') ?? '';
    return {path: call.path, toolCallId, startedIndex, completedIndex, state: outcome?.state, evidence: outcome?.evidence,
      requestId: outcome?.requestId, isError: event?.isError,
      explicitNonDispatch: event?.isError === true && resultText.startsWith('Chio did not dispatch operation:'),
      refusedForUnacknowledgedOutcome: resultText.includes('an unresolved operation fences this gateway'),
      dispatches: dispatch.filter(row => row.path === call.path).length,
      expectedContentSha256: sha(call.content), actualContentSha256: after.files[basename(call.path)] ?? null};
  });
  const nativeSerialized = hostCalls[0].completedIndex >= 0 && hostCalls[1].startedIndex > hostCalls[0].completedIndex;
  const bothCompleted = hostCalls.every(call => call.state === 'completed' && call.evidence === 'verified' && !call.isError
    && call.dispatches === 1 && call.actualContentSha256 === call.expectedContentSha256);
  const secondBlocked = hostCalls[0].state === 'completed' && hostCalls[0].evidence === 'verified' && !hostCalls[0].isError
    && hostCalls[0].dispatches === 1 && hostCalls[0].actualContentSha256 === hostCalls[0].expectedContentSha256
    && hostCalls[1].explicitNonDispatch && hostCalls[1].refusedForUnacknowledgedOutcome && hostCalls[1].dispatches === 0 && hostCalls[1].actualContentSha256 === null;
  const injected = fixture.filter(event => event.phase === 'parallel-batch-injected').length === 1;
  const providerRequests = fixture.filter(event => event.phase === 'provider-request');
  const outboundParallelDisabled = providerRequests.length === 2 && providerRequests.every(event => event.parallel_tool_calls === false);
  const exactNativeCalls = nativeStarts.length === 2 && nativeEnds.length === 2 && calls.every((call, index) =>
    nativeStarts[index].toolName === 'chio_execute' && nativeStarts[index].toolCallId === hostCalls[index].toolCallId
    && JSON.stringify(nativeStarts[index].args) === JSON.stringify({tool: 'write_file', arguments: {path: call.path, content: call.content}}));
  const kernelAttempts = fixture.filter(event => event.phase === 'kernel-call-start');
  const noHiddenRetries = kernelAttempts.length === dispatch.length && hostCalls.every(call => call.dispatches <= 1)
    && kernelAttempts.every(event => calls.some(call => call.path === event.path));
  const unrelatedDispatches = dispatch.length - hostCalls.reduce((count, call) => count + call.dispatches, 0);
  const targets = new Set(calls.map(call => basename(call.path)));
  const unrelatedFilesUnchanged = Object.entries(before.files).every(([name, hash]) => after.files[name] === hash)
    && Object.keys(after.files).every(name => name in before.files || targets.has(name));
  const completedCount = hostCalls.filter(call => call.state === 'completed').length;
  const deliveryConfirmed = journal.length === completedCount && completedCount > 0 && journal.every(record => record.state === 'completed'
    && record.outcomeState === 'completed' && record.evidence === 'verified' && record.hostDeliveryConfirmed && record.acknowledged);
  const parentOnlyFixture = fixture.filter(event => event.phase === 'fixture-installed').length === 1
    && fixture.find(event => event.phase === 'fixture-installed')?.pid === child.pid;
  const operatorConfigUnchanged = configSha256 === fileSha(args['--gateway-config']);
  const passed = !timedOut && injected && outboundParallelDisabled && exactNativeCalls && nativeSerialized && noHiddenRetries
    && parentOnlyFixture && unrelatedDispatches === 0 && unrelatedFilesUnchanged && deliveryConfirmed && operatorConfigUnchanged
    && terminal.length === 1 && (secondBlocked && exit.code === 3 && terminal[0].outcome === 'completed_with_tool_errors'
      || bothCompleted && exit.code === 0 && terminal[0].outcome === 'completed');
  const summary = {acceptance: false, supplementalOnly: true, liveModel: false, passed, exit, timedOut,
    classification: secondBlocked ? 'native-serialized-second-call-fenced-before-effect' : bothCompleted ? 'native-serialized-both-completed' : 'unresolved',
    injectedTwoCallResponse: injected, outboundParallelDisabled, providerRequests: providerRequests.length,
    exactNativeCalls, nativeSerialized, nativeToolStarts: nativeStarts.length, nativeToolEnds: nativeEnds.length,
    noHiddenRetries, kernelAttempts: kernelAttempts.length, resourceDispatches: dispatch.length, unrelatedDispatches,
    unrelatedFilesUnchanged, parentOnlyFixture, deliveryConfirmed, operatorConfigUnchanged, hostCalls, terminal,
    elapsedMs: performance.now() - started, timingClaim: 'Fixture wallclock only; no live-model or incremental overhead claim'};
  save(join(output, 'summary.json'), summary); console.log(JSON.stringify(summary, null, 2));
  process.exitCode = passed ? 0 : 1;
}

if (process.env.CHIO_PI_PARALLEL_SPEC && process.argv[1] && resolve(process.argv[1]) !== self) installFixture(process.env.CHIO_PI_PARALLEL_SPEC);
else if (process.argv[1] && resolve(process.argv[1]) === self) await main();
