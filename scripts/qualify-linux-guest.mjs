#!/usr/bin/env node
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const preparedImage='sha256:6d5bbc54ae9fd29177042755c41667006b708874c7ed6d489d543e931e33fe23';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv.includes('--help')){console.log('Build first: npm run build. Run: node scripts/qualify-linux-guest.mjs. Uses only an owned disposable privileged outer Docker container with --network none. Pinned default image must already exist. Rebuilt images require explicit --image sha256:DIGEST and exact runtime hashes. Build reference: docker build -f scripts/linux-guest/Dockerfile scripts/linux-guest. Native P5/kernel/provider qualification is excluded.');process.exit(0);}
const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--image' || !/^sha256:[a-f0-9]{64}$/.test(args[1])))throw new Error('Use --image with an explicit immutable rebuilt runtime image digest');
const image=args[1]??preparedImage;
console.log(JSON.stringify({kind:'qualification_runtime',image}));
const identity=execFileSync('docker',['image','inspect',image,'--format','{{.Id}} {{.Architecture}}'],{encoding:'utf8'}).trim();if(identity!==`${image} arm64`)throw new Error('Explicit selected Linux arm64 image unavailable');
const temporary=await mkdtemp(join(dirname(root),'task6-linux-probe-'));
const probeTag=`chio-pi-task6-probe:${randomUUID()}`;
execFileSync('docker',['build','--tag',probeTag,'--provenance=false','--sbom=false','--iidfile',join(temporary,'image.id'),'-f',join(root,'scripts/linux-guest/Dockerfile.probe'),join(root,'scripts/linux-guest')],{stdio:'inherit'});
const probeImage=execFileSync('docker',['image','inspect',probeTag,'--format','{{.Id}}'],{encoding:'utf8'}).trim();
const addon=execFileSync('docker',['run','--rm','--network','none',probeTag,'/bin/cat','/probe.node'],{maxBuffer:1024*1024});
await writeFile(join(temporary,'probe.node'),addon,{mode:0o600});
console.log(JSON.stringify({kind:'syscall_probe_setup',image:probeImage,addonSha256:createHash('sha256').update(addon).digest('hex'),sourceSha256:createHash('sha256').update(await readFile(join(root,'scripts/linux-guest/probe.c'))).digest('hex')}));
const child=spawn('docker',['run','--rm','--name',`chio-pi-task6-${randomUUID()}`,'--privileged','--network','none','--mount',`type=bind,source=${root},target=/input,readonly`,'--mount',`type=bind,source=${join(temporary,'probe.node')},target=/probe.node,readonly`,image,'node','/input/scripts/linux-guest/runner.mjs'],{stdio:'inherit'});
process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});

await rm(temporary,{recursive:true,force:true});
