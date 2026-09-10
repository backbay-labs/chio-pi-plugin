#!/usr/bin/env python3
"""Small paired timing observation for Pi and direct bridge reads of one resource.

Direct bridge calls are a performance baseline, never host acceptance. Both
paths use the same frozen bridge, kernel, resource and read arguments. Native
intervals begin at tool_execution_start and end at tool_execution_end, excluding
model generation/startup and later delivery ACK. Direct intervals measure
execute() through verified result, also excluding preparation and ACK.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import tempfile
import threading
import time
import uuid

p = argparse.ArgumentParser(description=__doc__)
for name in ['operator-state', 'package-dir', 'codex-auth', 'output']:
    p.add_argument('--' + name, type=Path, required=True)
p.add_argument('--resource', required=True)
a = p.parse_args(); a.output = a.output.resolve(); a.output.mkdir(mode=0o700)
a.package_dir = a.package_dir.resolve(strict=True)
op = json.loads((a.operator_state / 'operator.json').read_text())
signer = (a.operator_state / 'sessions.sqlite.admission.kernel.pub').read_text().strip()
bridge = a.package_dir / 'node_modules/@chio/bridge'


def save(path, value): path.write_text(json.dumps(value, indent=2) + '\n')


def observe():
    code = "const f=require('fs'),c=require('crypto'),files={};for(const n of f.readdirSync('/observe'))if(f.lstatSync('/observe/'+n).isFile())files[n]=c.createHash('sha256').update(f.readFileSync('/observe/'+n)).digest('hex');console.log(JSON.stringify({files,dispatch:f.readFileSync('/audit/dispatch.jsonl','utf8').split('\\n').filter(Boolean).map(JSON.parse)}))"
    return json.loads(subprocess.check_output(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--mount',
        f"type=volume,src={op['volume']},dst=/observe,readonly", '--mount', f"type=volume,src={op['auditVolume']},dst=/audit,readonly",
        '--entrypoint', 'node', op['image'], '-e', code], text=True))


def prepare(label):
    private = a.operator_state / ('pi-timing-' + label + '-' + uuid.uuid4().hex); private.mkdir(mode=0o700)
    request = {'endpoint': f"http://127.0.0.1:{op['port']}", 'bearerToken': op['agentToken'], 'adminToken': op['adminToken'],
        'credentialTtlSeconds': 900, 'trustedSigners': [signer], 'serverId': 'fs', 'sessionId': str(uuid.uuid4()),
        'journalDir': str(private / 'journal'), 'allowedTools': ['read_text_file', 'write_file', 'edit_file', 'list_directory']}
    source = private / 'prepare.json'; save(source, request); source.chmod(0o600)
    config = private / 'gateway.json'
    subprocess.run(['node', str(bridge / 'dist/prepare-gateway.js'), str(source), str(config)], capture_output=True, check=True)
    return private, config


baseline_js = '''
import fs from 'node:fs'; import {pathToFileURL} from 'node:url'; import {randomUUID} from 'node:crypto';
const [modulePath,configPath,resource,recordDir]=process.argv.slice(1);
const {createMcpExecutionClient}=await import(pathToFileURL(modulePath));
const config=JSON.parse(fs.readFileSync(configPath));const client=createMcpExecutionClient(config.execution);
const validated=await client.validateSession({allowedTools:config.tools.map(t=>t.name)});if(!validated.ok)throw Error('baseline session rejected');
fs.mkdirSync(recordDir,{mode:0o700});
function persist(path,value){const fd=fs.openSync(path,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}const dir=fs.openSync(recordDir,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}}
const request={tool:'read_text_file',arguments:{path:resource},requestId:'pi-timing:'+randomUUID()};
persist(recordDir+'/pending.json',request);
const start=process.hrtime.bigint();const outcome=await client.execute(request);const elapsedMs=Number(process.hrtime.bigint()-start)/1e6;
persist(recordDir+'/outcome.json',outcome);
if(outcome.state!=='completed'||outcome.evidence!=='verified'||outcome.result?.isError)throw Error('baseline outcome unresolved or unsuccessful; do not retry');
const acknowledgement=await client.acknowledge(outcome);persist(recordDir+'/acknowledgement.json',acknowledgement);
if(!acknowledgement.acknowledged)throw Error('baseline delivery acknowledgement failed');
console.log(JSON.stringify({elapsedMs,state:outcome.state,evidence:outcome.evidence,acknowledged:acknowledgement.acknowledged,requestId:request.requestId}));
'''
before = observe(); save(a.output / 'before.json', before)
assert Path(a.resource).name in before['files']
samples = []
for index in range(3):
    direct_private, direct_config = prepare('direct')
    direct = subprocess.run(['node', '--input-type=module', '-e', baseline_js, str(bridge / 'dist/index.js'), str(direct_config), a.resource,
        str(direct_private / 'performance-records')], capture_output=True, text=True, timeout=60)
    (a.output / f'direct-{index}.stdout.json').write_text(direct.stdout); (a.output / f'direct-{index}.stderr.txt').write_text(direct.stderr)
    assert direct.returncode == 0
    baseline = json.loads(direct.stdout)
    native_private, config = prepare('native'); runtime = Path(tempfile.mkdtemp(prefix='chio-pi-timing-'))
    command = ['node', str(a.package_dir / 'dist/protected-cli.js'), '--config', str(config), '--profile', str(runtime / 'profile'),
        '--cwd', str(runtime / 'workspace'), '--provider', 'openai-codex', '--model', 'gpt-5.5', '--codex-auth', str(a.codex_auth),
        '--prompt', f'Call chio_execute read_text_file exactly once for {a.resource}. Report the returned content. Do not call any other tool.']
    timed = []
    with (a.output / f'native-{index}.stdout.jsonl').open('w') as output, (a.output / f'native-{index}.stderr.txt').open('w') as error:
        child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=error, text=True, bufsize=1)
        watchdog = threading.Timer(205, child.terminate); watchdog.start()
        try:
            for line in child.stdout:
                now = time.monotonic_ns(); output.write(line)
                if line.startswith('{'):
                    event = json.loads(line)
                    if event.get('type') in ['tool_execution_start', 'tool_execution_end']: timed.append({'observedMonotonicNs': now, 'event': event})
            code = child.wait(timeout=30)
        finally: watchdog.cancel()
    assert code == 0 and len(timed) == 2 and timed[0]['event']['type'] == 'tool_execution_start' and timed[1]['event']['type'] == 'tool_execution_end'
    assert timed[0]['event']['args'] == {'tool':'read_text_file','arguments':{'path':a.resource}}
    native_outcome = json.loads(timed[1]['event']['result']['content'][0]['text'])
    assert native_outcome['evidence'] == 'verified' and native_outcome['state'] == 'completed' and not timed[1]['event']['isError']
    native_ms = (timed[1]['observedMonotonicNs'] - timed[0]['observedMonotonicNs']) / 1e6
    save(a.output / f'native-{index}.timing.json', timed)
    records = [json.loads(path.read_text()) for path in (native_private / 'journal').glob('*.json')]
    assert len(records) == 1 and records[0]['hostDeliveryConfirmed'] and records[0]['acknowledged']
    sample = {'pair': index, 'directBridgeMs': baseline['elapsedMs'], 'nativePiToolIntervalMs': native_ms,
        'differenceMs': native_ms - baseline['elapsedMs'], 'runtime': str(runtime), 'command': command,
        'directPrivateState': str(direct_private), 'nativePrivateState': str(native_private)}
    samples.append(sample); save(a.output / 'samples.json', samples)
after = observe(); save(a.output / 'after.json', after)
assert before['files'] == after['files'] and len(after['dispatch']) - len(before['dispatch']) == 6
assert all(r['tool'] == 'read_text_file' and r['path'] == a.resource for r in after['dispatch'][len(before['dispatch']):])
save(a.output / 'summary.json', {'artifactSha256':'ec6095390b9eae233540b73aee0ad2fef6977c36122dd30aa2779329b1897aa1',
    'kernelSha256':op['kernelSha256'],'harnessSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'pairedSamples':3,
    'medianDirectBridgeMs':statistics.median(s['directBridgeMs'] for s in samples),
    'medianNativePiToolIntervalMs':statistics.median(s['nativePiToolIntervalMs'] for s in samples),
    'medianPairedDifferenceMs':statistics.median(s['differenceMs'] for s in samples),
    'nativeCalls':3,'baselineOperatorCalls':3,'independentDispatches':6,'resourceContentUnchanged':True,
    'scope':'Small sequential paired observation of Pi native dispatcher, HTTP transport and parent journal overhead over direct bridge execution. Both paths include identical bridge verification/kernel/resource. Native stdout observation adds scheduling/pipe latency. Preparation, model generation, process startup, later ACK and baseline reservation writes excluded. Not a load benchmark, general latency guarantee or independent adoption result. Direct calls are performance-only, not host acceptance.'})
print((a.output / 'summary.json').read_text())
