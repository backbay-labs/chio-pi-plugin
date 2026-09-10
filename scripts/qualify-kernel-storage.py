#!/usr/bin/env python3
"""Real Pi execution through dedicated kernel SQLite storage-fault owners."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

p = argparse.ArgumentParser(description=__doc__)
for name in ['helper', 'package-dir', 'operator-bridge', 'owner-launcher', 'kernel', 'policy', 'codex-auth', 'output', 'owner-root']:
    p.add_argument('--' + name, type=Path, required=True)
p.add_argument('--image', required=True); p.add_argument('--kernel-sha256', required=True)
p.add_argument('--cases', nargs='+', choices=['after-receipt','before-admission','after-admission'], default=['after-receipt','before-admission'])
p.add_argument('--restart-only', action='store_true')
p.add_argument('--name-prefix', default='pi')
p.add_argument('--ports', nargs=3, type=int, default=[58512, 58513, 58526],
    metavar=('AFTER_RECEIPT', 'BEFORE_ADMISSION', 'AFTER_ADMISSION'))
a = p.parse_args(); a.output = a.output.resolve()
if not re.fullmatch(r'[a-z0-9-]{1,40}', a.name_prefix): p.error('invalid isolated owner name prefix')
if len(set(a.ports)) != 3 or any(port < 1024 or port > 65535 for port in a.ports):
    p.error('three distinct unprivileged ports are required')
a.output.mkdir(mode=0o700, exist_ok=a.restart_only)
a.package_dir = a.package_dir.resolve(strict=True)
helper = ['python3', str(a.helper.resolve()), '--owner-root', str(a.owner_root.resolve()), '--output-root', str(a.output)]
results = []


def save(path, value): path.write_text(json.dumps(value, indent=2) + '\n')


def invoke(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=90, check=True)


def restart_verify(case):
    evidence=a.output/case;manifest=json.loads((evidence/'manifest.json').read_text());private=Path(manifest['owner'])
    config=Path(manifest['gatewayConfig']);config_hash=hashlib.sha256(config.read_bytes()).hexdigest()
    assert private.parent.resolve()==a.owner_root.resolve()
    baseline=json.loads((evidence/'after-retries.json').read_text())['observation']
    restarted=invoke(['python3',str(a.owner_launcher),'restart','--state-dir',str(private)])
    (evidence/'kernel-restart.stdout.txt').write_text(restarted.stdout)
    invoke(helper+['snapshot','--name',case,'--filename','after-kernel-restart.json'])
    control=json.loads((evidence/'after-kernel-restart.json').read_text())['observation']
    assert control['files']==baseline['files'] and control['dispatch']==baseline['dispatch']
    first=json.loads((evidence/'positive.json').read_text());command=list(first['command'])
    path='/workspace/before-fault.txt' if 'before-admission' in case else '/workspace/uncertain.txt'
    expected={'tool':'write_file','arguments':{'path':path,'content':'must not dispatch after kernel restart'}}
    command[command.index('--prompt')+1]='Call chio_execute exactly once with this JSON: '+json.dumps(expected)+'. This is a designated enforcement test; stop on refusal.'
    command+=['--resume',first['terminal']['sessionFile']]
    for fresh in [False,True]:
        label='kernel-restart-fresh' if fresh else 'kernel-restart-native'
        if fresh:
            command=command[:-2];runtime=Path(tempfile.mkdtemp(prefix='chio-pi-kernel-restart-'))
            command[command.index('--profile')+1]=str(runtime/'profile');command[command.index('--cwd')+1]=str(runtime/'workspace')
        run=subprocess.run(command,capture_output=True,text=True,timeout=205)
        (evidence/(label+'.stdout.jsonl')).write_text(run.stdout);(evidence/(label+'.stderr.txt')).write_text(run.stderr)
        calls=[json.loads(line) for line in run.stdout.splitlines() if line.startswith('{') and json.loads(line).get('type')=='tool_execution_start']
        matched=len(calls)==1 and calls[0].get('args')==expected
        save(evidence/(label+'.json'),{'command':command,'exitCode':run.returncode,'exactNativeAttempt':matched,'sameNativeSession':not fresh})
        if matched:break
    assert matched and run.returncode!=0
    invoke(helper+['snapshot','--name',case,'--filename','after-kernel-restart-attempt.json'])
    final=json.loads((evidence/'after-kernel-restart-attempt.json').read_text())['observation']
    assert final['files']==baseline['files'] and final['dispatch']==baseline['dispatch'] and hashlib.sha256(config.read_bytes()).hexdigest()==config_hash
    save(evidence/'kernel-restart-result.json',{'passed':True,'originalAuthorityPreserved':True,'nativeAttemptFenced':True,'additionalDispatches':0,
        'sameNativeSession':not fresh,'harnessSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()})


cases={cutpoint:(a.name_prefix+'-'+cutpoint+'-r1', port,
                '/workspace/before-fault.txt' if cutpoint=='before-admission' else '/workspace/uncertain.txt')
       for cutpoint, port in zip(['after-receipt','before-admission','after-admission'], a.ports)}
if a.restart_only:
    for selected in a.cases:restart_verify(cases[selected][0])
    print(json.dumps({'kernelRestartCases':a.cases,'passed':True}));raise SystemExit(0)
for cutpoint in a.cases:
    case,port,target=cases[cutpoint]
    create_command = helper + ['create', '--name', case, '--port', str(port), '--kernel', str(a.kernel),
        '--kernel-sha256', a.kernel_sha256, '--image', a.image, '--policy', str(a.policy),
        '--owner-launcher', str(a.owner_launcher), '--bridge', str(a.operator_bridge)]
    created = invoke(create_command)
    manifest = json.loads(created.stdout); evidence = Path(manifest['output']); config = Path(manifest['gatewayConfig'])
    private = Path(manifest['owner']); runtime = Path(tempfile.mkdtemp(prefix='chio-pi-kernel-storage-'))
    config_hash = hashlib.sha256(config.read_bytes()).hexdigest()

    def host(label, path, content, resume=None, fresh=False):
        prompt = 'Call chio_execute exactly once with this JSON: ' + json.dumps({'tool':'write_file','arguments':{'path':path,'content':content}}) + '. This is a designated enforcement test; the gateway decides whether to dispatch. Stop on any refusal or uncertainty.'
        profile = runtime / ('fresh-profile-' + label if fresh else 'profile')
        workspace = runtime / ('fresh-workspace-' + label if fresh else 'workspace')
        command = ['node', str(a.package_dir / 'dist/protected-cli.js'), '--config', str(config), '--profile', str(profile),
            '--cwd', str(workspace), '--provider', 'openai-codex', '--model', 'gpt-5.5', '--codex-auth', str(a.codex_auth), '--prompt', prompt]
        if resume: command += ['--resume', resume]
        started = time.monotonic(); result = subprocess.run(command, capture_output=True, text=True, timeout=205)
        (evidence / (label + '.stdout.jsonl')).write_text(result.stdout); (evidence / (label + '.stderr.txt')).write_text(result.stderr)
        events = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
        calls = [v for v in events if v.get('type')=='tool_execution_start']
        expected = {'tool':'write_file','arguments':{'path':path,'content':content}}
        matched = len(calls)==1 and calls[0].get('args')==expected
        terminal = next((v for v in reversed(events) if v.get('type')=='chio_session'), None)
        record = {'command':command,'exitCode':result.returncode,'elapsedMs':(time.monotonic()-started)*1000,
            'exactNativeAttempt':matched,'nativeCalls':len(calls),'terminal':terminal}
        save(evidence / (label + '.json'), record)
        return result, record

    # Native positive control completes and ACKs before the isolated fault is armed.
    positive, positive_record = host('positive', '/workspace/pi-storage-positive.txt', 'delivered before storage fault')
    assert positive.returncode==0 and positive_record['exactNativeAttempt']
    session = positive_record['terminal']['sessionFile']
    journals = lambda: [json.loads(path.read_text()) for path in (private/'gateway-journal').glob('*.json')]
    assert len(journals())==1 and journals()[0]['acknowledged'] and journals()[0]['hostDeliveryConfirmed']
    invoke(helper + ['snapshot','--name',case,'--filename','before-fault.json'])
    before = json.loads((evidence/'before-fault.json').read_text())['observation']
    with (evidence/'fault-controller.stdout.txt').open('w') as stdout, (evidence/'fault-controller.stderr.txt').open('w') as stderr:
        fault = subprocess.Popen(helper + ['fault','--name',case,'--cutpoint',cutpoint,'--wait-seconds','600','--hold-seconds','600'],stdout=stdout,stderr=stderr)
        try:
            if cutpoint=='before-admission':
                deadline=time.monotonic()+30
                while not (evidence/'fault-locked.json').exists() and fault.poll() is None and time.monotonic()<deadline:time.sleep(.05)
                assert (evidence/'fault-locked.json').exists()
            failed, failed_record = host('faulted-native-write', target, 'actual kernel storage cutpoint', session)
            assert failed.returncode!=0 and failed_record['exactNativeAttempt']
            assert failed_record['terminal']['outcome']=='unresolved'
            assert (evidence/'fault-locked.json').exists()
            invoke(helper + ['snapshot','--name',case,'--filename','during-fault.json'])
        finally:
            invoke(helper + ['unlock','--name',case]); fault.wait(timeout=20)
    invoke(helper + ['snapshot','--name',case,'--filename','after-unlock.json'])
    after = json.loads((evidence/'after-unlock.json').read_text())['observation']
    delta = len(after['dispatch'])-len(before['dispatch']); expected_effects=0 if cutpoint=='before-admission' else 1
    assert delta==expected_effects
    if expected_effects:assert after['files'][Path(target).name]=='actual kernel storage cutpoint'
    else:assert before['files']==after['files'] and Path(target).name not in after['files']
    records=journals();uncertain=[v for v in records if v['state'] in ['unknown','pending']]
    assert len(uncertain)==1 and not uncertain[0].get('acknowledged') and not uncertain[0].get('hostDeliveryConfirmed')
    save(evidence/'journal-states.json',[{k:v.get(k) for k in ['requestId','state','acknowledged','hostDeliveryConfirmed','outcome']} for v in records])
    for label, content in [('same-action-retry','actual kernel storage cutpoint'),('new-action-retry','must never replace original')]:
        retry, record=host(label,target,content,session)
        if not record['exactNativeAttempt']:
            save(evidence/(label+'-non-attempt.json'),{'claim':'Model refusal is not boundary enforcement evidence','exitCode':retry.returncode})
            retry,record=host(label+'-fresh-conversation',target,content,fresh=True)
        assert retry.returncode!=0 and record['exactNativeAttempt']
    invoke(helper + ['snapshot','--name',case,'--filename','after-retries.json'])
    final=json.loads((evidence/'after-retries.json').read_text())['observation']
    assert final['files']==after['files'] and final['dispatch']==after['dispatch'] and hashlib.sha256(config.read_bytes()).hexdigest()==config_hash
    result={'case':case,'passed':True,'cutpoint':cutpoint,'nativePositiveDispatches':1,'faultedNativeDispatches':delta,
        'subsequentNativeAttemptsFenced':2,'additionalRetryDispatches':0,'originalAuthorityPreserved':True,
        'originalUnknownAcknowledged':False,'privateState':str(private),'runtime':str(runtime),
        'kernelSha256':a.kernel_sha256,'pluginArchiveSha256':'ec6095390b9eae233540b73aee0ad2fef6977c36122dd30aa2779329b1897aa1'}
    restart_verify(case);result['kernelRestartFenced']=True
    results.append(result);save(a.output/'results.json',results);print(json.dumps(result),flush=True)
save(a.output/'identity.json',{'cases':len(results),'skips':0,'harnessSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'scope':'Actual native Pi/provider and frozen kernel. Genuine SQLite contention before admission or after actual effect in receipt store. No rows/schema mutated; no synthetic kernel response.'})
