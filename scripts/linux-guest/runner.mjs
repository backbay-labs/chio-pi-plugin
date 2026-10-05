import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {cp,mkdir,readFile,writeFile,realpath,readlink,rm,lstat,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createServer as createNetServer} from 'node:net';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createUnixRelay} from '/input/dist/unix-relay.js';
import {prepareLinuxGuest,wholeGuestFilter} from '/input/dist/linux-sandbox.js';
import {superviseGuest} from '/input/dist/guest-termination.js';
import {openRunBudget} from '/input/dist/run-limits.js';
import {createToolRegistry,registryInventory} from '/input/dist/tool-registry.js';
async function installedDigest(root){const entries=[];const pending=[''];while(pending.length){const relative=pending.pop(),path=join(root,relative),stat=await lstat(path);if(stat.isDirectory()){for(const name of await readdir(path))pending.push(join(relative,name));}else if(stat.isSymbolicLink())entries.push([relative,'link',await readlink(path)]);else if(stat.isFile())entries.push([relative,'file',createHash('sha256').update(await readFile(path)).digest('hex')]);else throw new Error('Unexpected special installed leaf');}entries.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);return hash(JSON.stringify(entries));}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(process.arch,'arm64');assert.equal(process.version,'v22.23.1');
const packages=execFileSync('dpkg-query',['-W','-f=${Package}=${Version}\n','bubblewrap','libc6','libstdc++6'],{encoding:'utf8'}).trim();
assert.match(packages,/bubblewrap=0.8.0-2\+deb12u1/);assert.match(packages,/libc6=2.36-9\+deb12u14/);assert.match(packages,/libstdc\+\+6=12.2.0-14\+deb12u1/);
await mkdir('/pkg/node_modules/@chio/pi-plugin',{recursive:true});
await cp('/input/node_modules','/pkg/node_modules',{recursive:true,verbatimSymlinks:true});
await cp('/input/dist','/pkg/node_modules/@chio/pi-plugin/dist',{recursive:true});
await cp('/input/package.json','/pkg/node_modules/@chio/pi-plugin/package.json');
console.log(JSON.stringify({kind:'qualification_setup',stage:'installed-code-copied'}));
for(const path of ['/private-parent','/profile','/disposable'])await mkdir(path,{mode:0o700});
for(const name of ['operator-config','journal','provider-credential','resource-source'])await writeFile(`/private-parent/${name}`,'PRIVATE SYNTHETIC FORBIDDEN',{mode:0o600});
const forbidden=createNetServer(s=>s.destroy());await new Promise(r=>forbidden.listen('/private-parent/extra.sock',r));
const node=await realpath(process.execPath);const ldd=execFileSync('/usr/bin/ldd',[node],{encoding:'utf8'});
const selected=[...new Set([...ldd.matchAll(/(?:=>\s+)?(\/[^\s]+)\s+\(/g)].map(x=>x[1]))];
const runtimeFiles=await Promise.all(selected.map(async target=>({path:await realpath(target),mountPath:target,sha256:hash(await readFile(target))})));
const runtime={schema:'chio.pi.linux-runtime.v1',architecture:'arm64',node,nodeSha256:hash(await readFile(node)),runtimeFiles};
assert.equal(runtime.nodeSha256,'d8fa08f79c8198c5a5ccc9faa5a69803052703fc9513f99e7200e0ab42e1d799');
assert.equal(hash(await readFile('/usr/bin/bwrap')),'ff5add553bea12a45c18ebe6c67d3ed637052b869a1ca2fc5d74a6a2e8c5cce6');
const libraryPins=['e5e9474a683596d59cc9e13246bc83878433e53c3befbabd73e3da9ccb5fe174','532f3a12d7b8fef6cc7a064ea106b6c4ab2365674b73e743e4a385d4ffb6c8ab','3c4cb3be0b974edf05f023f85ab15107fb5afc2687163593d0d4cf8e80c17b39','046856f95f4636f1fc7c3a12bf4f3cd5634c2fc5145c3fdf7395d4f349fa69c7','434dcd27f22fc8bf236c0c00541a1e503d302aa796c333729a2cd15a4cfe4814','e4ac8ae1d81e4865e3aadedb962879cf9415903b3f2ba81ec75e9962b86ab8b0','17538b8f9889a470c061f69a8fea8124da89627311cd16546c133a89f09056df'];
assert.deepEqual(runtimeFiles.map(file=>file.sha256).sort(),libraryPins.sort());
const namespaces={};for(const name of ['user','mnt','net','pid','ipc'])namespaces[name]=await readlink(`/proc/self/ns/${name}`);
const tools=[{name:'read_text_file',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}];
const registry=createToolRegistry(tools,'typed');const inventory=registryInventory(registry);
const budgetOptions={binding:{authorityDigest:'a'.repeat(64),registryDigest:registry.digest,profileIdentity:'/profile',governanceProfile:'execution-only'},limits:{maxRequests:2,maxOutputTokens:32,maxTotalOutputTokens:48,providerTimeoutMs:1000,maxResponseBytes:4096,wallMs:60000,killGraceMs:100},provider:'openai',model:'gpt-4.1-mini'};
const firstBudget=await openRunBudget('/private-parent/budget',{...budgetOptions,create:true});const firstRequest={max_output_tokens:100};await firstBudget.reserveRequest(firstRequest);assert.equal(firstRequest.max_output_tokens,32);const retainedDeadline=firstBudget.deadline;await firstBudget.close();const resumedBudget=await openRunBudget('/private-parent/budget',budgetOptions);assert.equal(resumedBudget.deadline,retainedDeadline);assert.equal(resumedBudget.remainingRequests,1);const finalRequest={};await resumedBudget.reserveRequest(finalRequest);assert.equal(finalRequest.max_output_tokens,16);await assert.rejects(resumedBudget.reserveRequest({}));const parentLimits={remainingRequests:resumedBudget.remainingRequests,remainingOutputTokens:resumedBudget.remainingOutputTokens,deadlineRetained:resumedBudget.deadline===retainedDeadline};await resumedBudget.close();
const seen={gateway:[],model:[]};const servers=[];
for(const name of ['gateway','model']){
 const server=createServer(async(req,res)=>{let chunks=[];for await(const chunk of req)chunks.push(chunk);seen[name].push({host:req.headers.host,session:req.headers['mcp-session-id'],authorization:req.headers.authorization,method:req.method,url:req.url,body:Buffer.concat(chunks).toString()});if(req.headers.host!==`127.0.0.1:${server.address().port}`){res.writeHead(403);res.end('refused');return;}if(req.method==='CONNECT'){res.writeHead(403);res.end('refused');return;}res.setHeader('mcp-session-id','qualified-session');
 const raw=Buffer.concat(chunks).toString();let rpc;try{rpc=JSON.parse(raw);}catch{}
 if(name==='gateway'&&rpc?.jsonrpc==='2.0'){res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result:rpc.method==='initialize'?{capabilities:{experimental:{chioDeliveryAcknowledgement:{version:'1'}}}}:{tools:inventory}}));return;}
 if(name==='model'&&rpc?.model==='gpt-4.1-mini'){
  const item={id:'message-qualified',type:'message',role:'assistant',content:[{type:'output_text',text:'qualified synthetic response',annotations:[]}]};
  const events=[{type:'response.created',response:{id:'response-qualified'}},{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'response-qualified',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0}}}}];
  res.setHeader('content-type','text/event-stream');res.end(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''));return;
 }
 res.end(JSON.stringify({service:name,session:req.headers['mcp-session-id']}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));servers.push(server);
}
const relays=[await createUnixRelay('/private-parent/g.sock',servers[0].address().port),await createUnixRelay('/private-parent/m.sock',servers[1].address().port)];
await cp('/probe.node','/pkg/node_modules/@chio/pi-plugin/dist/probe.node');
const guestSource=`import assert from 'node:assert/strict';import {readFile,writeFile,readlink} from 'node:fs/promises';import {createConnection} from 'node:net';import {spawn} from 'node:child_process';import {createLoopbackRelay} from './unix-relay.js';import {ModelRuntime} from '@earendil-works/pi-coding-agent';import {createRequire} from 'node:module';const probe=createRequire(import.meta.url)('./probe.node');\nconst relays=[];try{for(const [socket,port] of [[process.env.CHIO_PI_GATEWAY_SOCKET,process.env.CHIO_PI_GATEWAY_PORT],[process.env.CHIO_PI_MODEL_SOCKET,process.env.CHIO_PI_MODEL_PORT]])relays.push(await createLoopbackRelay(socket,Number(port)));\nconst runtime=await ModelRuntime.create({modelsPath:null,modelsStorePath:'/profile/models-cache.json',allowModelNetwork:false,refreshOnCreate:false});assert.equal(runtime.getModel('openai','gpt-4.1-mini').api,'openai-responses');\nconst routes=[];for(const [service,port] of [['gateway',process.env.CHIO_PI_GATEWAY_PORT],['model',process.env.CHIO_PI_MODEL_PORT]]){const reply=await fetch('http://127.0.0.1:'+port+(service==='gateway'?'/mcp':'/v1/responses'),{method:'POST',headers:{'mcp-session-id':'qualified-session'},body:'private synthetic request'});routes.push(await reply.json());}\nassert.deepEqual(routes,[{service:'gateway',session:'qualified-session'},{service:'model',session:'qualified-session'}]);\nfor(const path of ['/private-parent/operator-config','/private-parent/journal','/private-parent/provider-credential','/private-parent/resource-source','/input/package.json','/root/.pi/agent/auth.json','/var/run/docker.sock'])await assert.rejects(readFile(path));\nawait assert.rejects(writeFile(new URL('./guest-probe.mjs',import.meta.url),'bad'));await writeFile('/profile/allowed','allowed');await writeFile(process.cwd()+'/allowed','allowed');\nconst socketDenied=path=>new Promise((resolve,reject)=>{const s=createConnection({path});s.once('error',()=>{s.destroy();resolve();});s.once('connect',()=>{s.destroy();reject(new Error('extra socket accessible'));});});await socketDenied('/private-parent/extra.sock');\nfor(const target of [{host:'1.1.1.1',port:443},{host:'127.0.0.1',port:1}])await new Promise((resolve,reject)=>{const s=createConnection(target);s.once('error',()=>resolve());s.once('connect',()=>{s.destroy();reject(new Error('general network accessible'));});s.setTimeout(500,()=>{s.destroy();resolve();});});\nfor(const [nr,a,b,c,expected] of [[220,0,0,0,-1],[220,0x10000|0x20000000,0,0,-1],[97,0,0,0,-1],[268,-1,0,0,-1],[198,10,1,0,-1],[198,2,2,0,-1],[435,0,0,0,-38],[117,2,1,0,-1],[270,1,0,0,-1],[271,1,0,0,-1],[438,0,0,0,-1]])assert.equal(probe.probe(nr,a,b,c),expected,'syscall '+nr);\nawait new Promise((resolve,reject)=>{let child;try{child=spawn(process.execPath,['-e','process.exit(0)']);}catch(error){assert.equal(error.code,'EPERM');resolve();return;}child.once('error',error=>{assert.equal(error.code,'EPERM');resolve();});child.once('spawn',()=>reject(new Error('process creation permitted')));});\nconst ns={};for(const name of ['user','mnt','net','pid','ipc'])ns[name]=await readlink('/proc/self/ns/'+name);console.log(JSON.stringify({kind:'whole_guest_probe',routes,namespaces:ns,pid:process.pid,sdk:'1.0.2',denials:'files,installed-write,network,extra-unix,process,namespace,ptrace,process-vm,pidfd-getfd'}));\n}finally{for(const r of relays)await r.close();}\n`;
const bootstrap='/pkg/node_modules/@chio/pi-plugin/dist/guest-probe.mjs';await writeFile(bootstrap,guestSource);
// Independent observer of world-readable process attributes while a guest runs.
function observeProcesses(secret){
 const report={samples:0,bubblewrapCommandLines:0,secretHits:[]};let active=true;
 const done=(async()=>{while(active){report.samples++;
  for(const pid of (await readdir('/proc')).filter(value=>/^\d+$/.test(value))){
   for(const attribute of ['cmdline','environ']){
    let text;try{text=await readFile(`/proc/${pid}/${attribute}`,'utf8');}catch(error){if(['ENOENT','ESRCH','EACCES','EPERM'].includes(error.code))continue;throw error;}
    if(attribute==='cmdline'&&text.startsWith('/usr/bin/bwrap\0'))report.bubblewrapCommandLines++;
    if(secret&&text.includes(secret))report.secretHits.push({pid:Number(pid),attribute});
    if(attribute==='cmdline'&&text.includes('CHIO_PI_MODEL_TOKEN'))report.secretHits.push({pid:Number(pid),attribute,name:'CHIO_PI_MODEL_TOKEN'});
   }
  }
  await new Promise(r=>setTimeout(r,50));}})();
 return async()=>{active=false;await done;return report;};
}
// Generous walls tolerate a heavily loaded VM; termination cases set their own.
async function run(bootstrap,wallMs=600000,argv=[],extraEnvironment={},secrets){
 const guest=await prepareLinuxGuest({runtime,installation:'/pkg/node_modules',profile:'/profile',cwd:'/disposable',gatewaySocket:'/private-parent/g.sock',modelSocket:'/private-parent/m.sock',gatewayPort:servers[0].address().port,modelPort:servers[1].address().port,bootstrap,argv,environment:{PATH:'/usr/local/bin',HOME:'/profile',LANG:'C',TMPDIR:'/tmp',OPENSSL_CONF:'/dev/null',...extraEnvironment},secrets});
 const {open}=await import('node:fs/promises');await writeFile('/private-parent/filter.bpf',guest.seccomp,{mode:0o600});const filter=await open('/private-parent/filter.bpf','r');let output='',errors='';
 const observe=observeProcesses(secrets?.CHIO_PI_MODEL_TOKEN);
 const child=spawn(guest.launcher,guest.args,{detached:true,stdio:['ignore','pipe','pipe',filter.fd,...(guest.secrets?['pipe']:[])]});child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);
 if(guest.secrets){child.stdio[4].on('error',()=>{});child.stdio[4].end(guest.secrets);}
 const result=await superviseGuest(child,{deadline:Date.now()+wallMs,killGraceMs:100,processGroup:true});await filter.close();return {result,output,errors,filterSha256:hash(guest.seccomp),wrapperPid:child.pid,argv:guest.args,observed:await observe()};
}
try{
 console.log(JSON.stringify({kind:'qualification_setup',stage:'whole-guest-launch'}));const positive=await run(bootstrap);assert.equal(positive.result.code,0,positive.errors);const report=JSON.parse(positive.output.trim());
 for(const name of Object.keys(namespaces))assert.notEqual(report.namespaces[name],namespaces[name]);assert.equal(report.pid,2);
 assert.equal(seen.gateway.length,1);assert.equal(seen.model.length,1);for(const name of ['gateway','model'])assert.equal(seen[name][0].session,'qualified-session');
 await writeFile('/profile/gateway-transport.json',JSON.stringify({schema:'chio.pi.transport.v1',sessionId:'qualified-host',transport:{url:`http://127.0.0.1:${servers[0].address().port}/mcp`,token:'guest-proxy-fixture'},binding:{subjectKey:'ab'.repeat(32),capabilityId:'fixture-cap',serverId:'fixture-server',trustedSigners:['cd'.repeat(32)]},tools,toolMode:'typed',registryDigest:registry.digest,approvals:false}),{mode:0o600});
 console.log(JSON.stringify({kind:'qualification_setup',stage:'native-sdk-launch'}));const modelToken='guest-model-fixture-'+hash(String(Math.random())+Date.now()).slice(0,32);
 const sdk=await run('/pkg/node_modules/@chio/pi-plugin/dist/linux-guest.js',600000,['--config','/profile/gateway-transport.json','--profile','/profile','--cwd','/disposable','--provider','openai','--model','gpt-4.1-mini','--prompt','qualified synthetic-only prompt'],{CHIO_PI_GATEWAY_TRANSPORT:'1',CHIO_PI_MODEL_BASE_URL:`http://127.0.0.1:${servers[1].address().port}/v1`,PI_CODING_AGENT_DIR:'/profile'},{CHIO_PI_MODEL_TOKEN:modelToken});
 assert.equal(sdk.result.code,0,sdk.errors+sdk.output);assert.match(sdk.output,/qualified synthetic response/);assert.match(sdk.output,/["']outcome["']:?["']completed/);
 assert.equal(seen.gateway.length,3);assert.equal(seen.model.length,2);assert.equal(seen.gateway[2].session,'qualified-session');
 // C-I1: the bearer reached the model relay only through inherited FD4.
 assert.equal(seen.model[1].authorization,`Bearer ${modelToken}`);assert.equal(sdk.argv.some(arg=>arg.includes(modelToken)),false);
 assert.ok(sdk.observed.bubblewrapCommandLines>0,'observer saw the bubblewrap wrapper');assert.deepEqual(sdk.observed.secretHits,[]);
 const secretChannel={argvContainsSecret:false,authorizationObserved:true,processSamples:sdk.observed.samples,bubblewrapCommandLines:sdk.observed.bubblewrapCommandLines,secretHits:sdk.observed.secretHits.length};
 const hung='/pkg/node_modules/@chio/pi-plugin/dist/hung-probe.mjs';await writeFile(hung,"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000);");
 const killed=await run(hung,5000);assert.match(killed.output,/ready/);assert.ok(['SIGTERM','SIGKILL'].includes(killed.result.signal));
 const raw=spawn(process.execPath,['-e',`process.title='chio-task6-ignore-parent';process.on('SIGTERM',()=>{});const {spawn}=require('node:child_process');spawn(process.execPath,['-e',\"process.title='chio-task6-ignore-child';process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:'ignore'});setTimeout(()=>console.log('ready'),100);setInterval(()=>{},1000);`],{detached:true,stdio:['ignore','pipe','ignore']});
 await new Promise(r=>raw.stdout.once('data',r));const rawExit=await superviseGuest(raw,{deadline:Date.now()+50,killGraceMs:100,processGroup:true});assert.equal(rawExit.signal,'SIGKILL');
 // Task 8: the actual installed protected launcher's Linux branch, with a
 // scripted kernel fixture and an unreachable provider (network none).
 console.log(JSON.stringify({kind:'qualification_setup',stage:'protected-launcher-launch'}));
 const {nativeFixture}=await import('/input/test/helpers/continuation-fixture.mjs');
 const fixture=await nativeFixture();await fixture.native.close();let protectedLauncher;
 try{
  for(const path of ['/launch','/launch/profile','/launch/cwd'])await mkdir(path,{mode:0o700});
  await writeFile('/private-parent/limits.json',JSON.stringify({maxRequests:1,maxOutputTokens:16,maxTotalOutputTokens:16,providerTimeoutMs:2000,maxResponseBytes:4096,wallMs:600000,killGraceMs:200}),{mode:0o600});
  await writeFile('/private-parent/runtime.json',JSON.stringify(runtime),{mode:0o600});
  const observe=observeProcesses();
  const launcher=spawn(process.execPath,['/pkg/node_modules/@chio/pi-plugin/dist/protected-cli.js','--config',fixture.configPath,'--profile','/launch/profile','--cwd','/launch/cwd','--provider','openai','--model','gpt-4.1-mini','--prompt','qualified synthetic-only prompt','--limits','/private-parent/limits.json','--linux-runtime','/private-parent/runtime.json'],
   {stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/local/bin:/usr/bin:/bin',OPENAI_API_KEY:'synthetic-placeholder-not-a-credential'}});
  let out='',err='';launcher.stdout.on('data',x=>out+=x);launcher.stderr.on('data',x=>err+=x);
  const code=await new Promise(r=>launcher.once('exit',c=>r(c)));const observed=await observe();
  const line=JSON.parse(out.split('\n')[0]);const budgetDirectory=join(fixture.config.journalDir,'pi-run-limits',hash('/launch/profile'));
  const record=JSON.parse(await readFile(join(budgetDirectory,'run.json'),'utf8'));
  assert.equal(line.type,'chio_protected_runtime',err);assert.equal(line.profileIdentity,'chio.pi.linux-whole-guest.v1');
  assert.equal(line.seccompSha256,hash(wholeGuestFilter('arm64')));assert.match(line.profileSha256,/^[a-f0-9]{64}$/);assert.notEqual(line.profileSha256,line.seccompSha256);
  // The relay checks its bearer before reserving: one reservation proves the
  // guest reached the gateway relay and presented the FD4 bearer to the model relay.
  assert.equal(record.usedRequests,1,err+out);
  assert.ok(observed.bubblewrapCommandLines>0,'observer saw the launcher bubblewrap wrapper');assert.deepEqual(observed.secretHits,[]);
  await assert.rejects(lstat(join(budgetDirectory,'owner.json')),{code:'ENOENT'});
  assert.deepEqual((await readdir('/tmp')).filter(name=>name.startsWith('cp-')),[]);
  protectedLauncher={exitCode:code,profileIdentity:line.profileIdentity,seccompSha256:line.seccompSha256,profileSha256:line.profileSha256,usedRequests:record.usedRequests,ownerLockReleased:true,controlDirectoriesRemaining:0,processSamples:observed.samples,bubblewrapCommandLines:observed.bubblewrapCommandLines,secretNameHits:observed.secretHits.length,providerReachable:false};
 }finally{await fixture.close();}
 // Independent observer: no non-zombie task may retain these guest markers.
 const survivors=[],zombies=[];
 for(const pid of (await readdir('/proc')).filter(value=>/^\d+$/.test(value))){
  try{const [stat,cmd]=await Promise.all([readFile(`/proc/${pid}/stat`,'utf8'),readFile(`/proc/${pid}/cmdline`,'utf8')]);
   if(/guest-probe.mjs|hung-probe.mjs|linux-guest.js|protected-cli.js|chio-task6-ignore-parent|chio-task6-ignore-child/.test(cmd)){
    const state=stat.match(/\)\s+([A-Z])/)[1];(state==='Z'?zombies:survivors).push({pid:Number(pid),state});
   }
  }catch(error){if(error.code!=='ENOENT'&&error.code!=='ESRCH')throw error;}
 }
 assert.equal(survivors.length,0,JSON.stringify(survivors));

 console.log(JSON.stringify({schema:'chio.pi.linux-whole-guest-qualification.v1',node:process.version,architecture:process.arch,kernel:execFileSync('/bin/uname',['-r'],{encoding:'utf8'}).trim(),packages,packageLockSha256:hash(await readFile('/input/package-lock.json')),installedTreeSha256:await installedDigest('/pkg/node_modules'),bubblewrapSha256:hash(await readFile('/usr/bin/bwrap')),addonSha256:hash(await readFile('/probe.node')),runtime,filterSha256:positive.filterSha256,parentNamespaces:namespaces,guest:report,observedRequests:{gateway:seen.gateway.length,model:seen.model.length},parentLimits,nativePiSdk:{version:'1.0.2',outcome:'completed',toolEffects:0},secretChannel,protectedLauncher,deadlineCleanup:{confinedWrapper:killed.result,rawIgnoringChild:rawExit,survivors,zombies},outerContainer:{privileged:true,network:'none'},nativeP5:'OPEN',actualX64:'UNMEASURED',ordinaryDocker:'UNMEASURED'},null,2));
}finally{for(const relay of relays)await relay.close();for(const s of [...servers,forbidden])await new Promise(r=>s.close(r));}
