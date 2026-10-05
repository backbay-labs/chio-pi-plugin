import test from 'node:test'; import assert from 'node:assert/strict'; import {spawn,execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const module=await import('../dist/guest-termination.js').catch(()=>({}));
test('termination supervisor exists',()=>assert.equal(typeof module.superviseGuest,'function'));
test('deadline uses actual exit and hard kills a real child ignoring TERM with descendants',async()=>{
 assert.equal(typeof module.superviseGuest,'function');
 const child=spawn(process.execPath,['-e',`const {spawn}=require('child_process');process.on('SIGTERM',()=>{});const descendant=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});setTimeout(()=>console.log(descendant.pid),50);setInterval(()=>{},1000);`],{detached:true,stdio:['ignore','pipe','ignore']});
 const pid=await new Promise(r=>child.stdout.once('data',x=>r(Number(x.toString().trim()))));child.kill("SIGTERM");assert.equal(child.killed,true);const started=Date.now();
 const result=await module.superviseGuest(child,{deadline:Date.now()+60,killGraceMs:60,processGroup:true});
 assert.equal(result.signal,'SIGKILL');assert.ok(Date.now()-started>=100);assert.ok(child.signalCode);await new Promise(r=>setTimeout(r,50));
 // Observe executing processes independently. A dead zombie waiting on
 // PID 1 is not a surviving descendant and cannot perform further effects.
 let alive=true;
 for(let i=0;i<20;i++){
  try{process.kill(pid,0);
   if(process.platform==='linux'){const stat=await readFile(`/proc/${pid}/stat`,'utf8');alive=!/\)\s+Z/.test(stat);}
   else{alive=!execFileSync('/bin/ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'}).trim().startsWith('Z');}
  }catch(error){if(error.code==='ESRCH'||error.code==='ENOENT'||error.status===1)alive=false;else throw error;}
  if(!alive)break;await new Promise(r=>setTimeout(r,25));
 }
 assert.equal(alive,false,'executing descendant remained');
});
test('natural exit is observed without relying on ChildProcess.killed',async()=>{assert.equal(typeof module.superviseGuest,'function');const child=spawn(process.execPath,['-e','process.exit(7)'],{detached:true,stdio:'ignore'});const result=await module.superviseGuest(child,{deadline:Date.now()+10000,killGraceMs:60,processGroup:true});assert.equal(result.code,7);});

// Task 8 area C. Independent observation of an executing process group: a
// dead zombie waiting to be reaped is not a surviving guest.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function groupExecuting(pgid){
 if(process.platform==='linux'){
  const {readdir}=await import('node:fs/promises');
  for(const pid of (await readdir('/proc')).filter(value=>/^\d+$/.test(value))){
   try{const stat=await readFile(`/proc/${pid}/stat`,'utf8');const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');if(Number(fields[2])===pgid&&fields[0]!=='Z')return true;}
   catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}
  }
  return false;
 }
 return execFileSync('/bin/ps',['-A','-o','pgid=,stat='],{encoding:'utf8'}).split('\n').some(line=>{const [group,state]=line.trim().split(/\s+/);return Number(group)===pgid&&state&&!state.startsWith('Z');});
}
async function settled(pgid,ms=5000){for(const end=Date.now()+ms;Date.now()<end;await sleep(25))if(!await groupExecuting(pgid))return true;return false;}
const killGroup=pgid=>{try{process.kill(-pgid,'SIGKILL');}catch{}};
const lines=stream=>{let buffer='';const waiting=[];const queued=[];stream.setEncoding('utf8');stream.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);const next=waiting.shift();if(next)next(line);else queued.push(line);}});return()=>queued.length?Promise.resolve(queued.shift()):new Promise(r=>waiting.push(r));};
const exited=child=>child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(r=>child.once('exit',r));
const terminationModule=new URL('../dist/guest-termination.js',import.meta.url).href;

test('C-M2: EPERM from a zombie-only group inside timer and exit callbacks never escapes the supervisor',{timeout:30000},async()=>{
 assert.equal(typeof module.superviseGuest,'function');
 const {EventEmitter}=await import('node:events');
 const child=Object.assign(new EventEmitter(),{pid:2147483000,exitCode:null,signalCode:null,kill(){}});
 const original=process.kill;const sent=[];
 // macOS reports EPERM when every member of the group is an unreaped zombie.
 process.kill=(pid,signal)=>{sent.push([pid,signal]);if(pid!==-child.pid)return original.call(process,pid,signal);const error=new Error('kill EPERM');error.code='EPERM';throw error;};
 try{
  const result=module.superviseGuest(child,{deadline:Date.now()+10,killGraceMs:20,processGroup:true});
  await sleep(120);
  child.emit('exit',null,'SIGKILL');
  assert.deepEqual(await result,{code:null,signal:'SIGKILL'});
 }finally{process.kill=original;}
 // Graceful stop, escalation still armed after EPERM, then post-exit group cleanup.
 assert.deepEqual(sent.filter(([pid])=>pid===-child.pid).map(([,signal])=>signal),['SIGTERM','SIGKILL','SIGKILL']);
});

for(const [name,death] of [['SIGHUP','SIGHUP'],['SIGQUIT','SIGQUIT'],['an uncaught exception','uncaught']])
 test(`C-I2: a guest group does not outlive a trusted parent ending by ${name}`,{timeout:30000},async t=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
  const dir=await mkdtemp(join(tmpdir(),'chio-guest-parent-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const script=join(dir,'parent.mjs');
  await writeFile(script,`import {spawn} from 'node:child_process';import {superviseGuest} from ${JSON.stringify(terminationModule)};
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
const supervised=superviseGuest(child,{deadline:Date.now()+60000,killGraceMs:200,processGroup:true});
console.log(child.pid);
${death==='uncaught'?"setTimeout(()=>{throw new Error('synthetic trusted parent failure');},100);":''}
console.log(JSON.stringify(await supervised));`);
  const parent=spawn(process.execPath,[script],{stdio:['ignore','pipe','ignore']});const next=lines(parent.stdout);
  const guest=Number(await next());t.after(()=>killGroup(guest));
  assert.equal(await groupExecuting(guest),true);
  if(death!=='uncaught')parent.kill(death);
  await exited(parent);
  assert.equal(await settled(guest),true,`guest group ${guest} survived its parent`);
 });

test('C-I2: the guest exits when its parent lifeline closes, including parent SIGKILL',{timeout:30000},async t=>{
 assert.equal(typeof module.exitWithParent,'function');
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const dir=await mkdtemp(join(tmpdir(),'chio-guest-lifeline-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 // An idle guest with a lifeline still exits on its own when its work is done.
 const idle=join(dir,'idle.mjs');await writeFile(idle,`import {exitWithParent} from ${JSON.stringify(terminationModule)};exitWithParent(process.stdin,200);setTimeout(()=>console.log('done'),50);`);
 const natural=spawn(process.execPath,[idle],{stdio:['pipe','pipe','ignore']});const output=lines(natural.stdout);
 assert.equal(await output(),'done');await Promise.race([exited(natural),sleep(5000).then(()=>{throw new Error('lifeline kept an idle guest alive');})]);assert.equal(natural.exitCode,0);natural.stdin.destroy();
 // A guest ignoring SIGTERM is bounded by the lifeline's own hard exit.
 const guestScript=join(dir,'guest.mjs');await writeFile(guestScript,`import {exitWithParent} from ${JSON.stringify(terminationModule)};process.on('SIGTERM',()=>{});exitWithParent(process.stdin,200);setInterval(()=>{},1000);`);
 const parentScript=join(dir,'parent.mjs');await writeFile(parentScript,`import {spawn} from 'node:child_process';
const child=spawn(process.execPath,[${JSON.stringify(guestScript)}],{detached:true,stdio:['pipe','ignore','ignore']});console.log(child.pid);setInterval(()=>{},1000);`);
 const parent=spawn(process.execPath,[parentScript],{stdio:['ignore','pipe','ignore']});const next=lines(parent.stdout);
 const guest=Number(await next());t.after(()=>killGroup(guest));await sleep(300);
 assert.equal(await groupExecuting(guest),true);
 parent.kill('SIGKILL');await exited(parent);
 assert.equal(await settled(guest,3000),true,`guest group ${guest} survived a SIGKILLed parent`);
});

test('C-I2: the real macOS Seatbelt guest policy still lets the lifeline end a guest after parent SIGKILL',{skip:process.platform!=='darwin'&&'macOS Seatbelt only',timeout:30000},async t=>{
 const {mkdtemp,writeFile,rm,realpath,mkdir}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');const {fileURLToPath}=await import('node:url');
 const {buildSandboxPolicy}=await import('../dist/sandbox.js');
 const dir=await realpath(await mkdtemp(join(tmpdir(),'chio-guest-seatbelt-')));t.after(()=>rm(dir,{recursive:true,force:true}));
 const profile=join(dir,'profile'),cwd=join(dir,'cwd');await mkdir(profile,{mode:0o700});await mkdir(cwd,{mode:0o700});
 const executable=await realpath(process.execPath);const installation=await realpath(fileURLToPath(new URL('../dist',import.meta.url)));
 const policy=join(dir,'profile.sb');await writeFile(policy,await buildSandboxPolicy({executable,installation,profile,cwd,gatewayPort:1,modelPort:2}),{mode:0o600});
 const guestScript=join(profile,'guest.mjs');await writeFile(guestScript,`import {exitWithParent} from ${JSON.stringify(terminationModule)};process.on('SIGTERM',()=>{});exitWithParent(process.stdin,200);setInterval(()=>{},1000);`);
 const parentScript=join(dir,'parent.mjs');await writeFile(parentScript,`import {spawn} from 'node:child_process';
const child=spawn('/usr/bin/sandbox-exec',['-f',${JSON.stringify(policy)},${JSON.stringify(executable)},${JSON.stringify(guestScript)}],{cwd:${JSON.stringify(cwd)},detached:true,stdio:['pipe','ignore','pipe'],env:{PATH:'/usr/bin',OPENSSL_CONF:'/dev/null',HOME:${JSON.stringify(profile)}}});
child.stderr.pipe(process.stderr);console.log(child.pid);setInterval(()=>{},1000);`);
 const parent=spawn(process.execPath,[parentScript],{stdio:['ignore','pipe','pipe']});const next=lines(parent.stdout);let errors='';parent.stderr.on('data',x=>errors+=x);
 const guest=Number(await next());t.after(()=>killGroup(guest));await sleep(500);
 assert.equal(await groupExecuting(guest),true,errors);
 parent.kill('SIGKILL');await exited(parent);
 assert.equal(await settled(guest,3000),true,`confined guest group ${guest} survived a SIGKILLed parent ${errors}`);
});

test('C-I2: the shipped guest CLI enables the lifeline before it blocks on the parent gateway',{timeout:60000},async t=>{
 const {mkdtemp,writeFile,rm,realpath,mkdir}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');const {fileURLToPath}=await import('node:url');const {createServer}=await import('node:http');
 const dir=await realpath(await mkdtemp(join(tmpdir(),'chio-guest-cli-lifeline-')));t.after(()=>rm(dir,{recursive:true,force:true}));
 let initialize=0;const held=[];const server=createServer((req,res)=>{initialize++;held.push(res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{for(const res of held)res.destroy();server.close();});
 const profile=join(dir,'profile'),cwd=join(dir,'cwd');await mkdir(profile,{mode:0o700});await mkdir(cwd,{mode:0o700});
 const config=join(profile,'gateway-transport.json');
 await writeFile(config,JSON.stringify({schema:'chio.pi.transport.v1',sessionId:'synthetic-host',transport:{url:`http://127.0.0.1:${server.address().port}/mcp`,token:'synthetic-proxy-fixture'},
  tools:[{name:'read_text_file',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}],toolMode:'typed',approvals:false}),{mode:0o600});
 const cli=fileURLToPath(new URL('../dist/cli.js',import.meta.url));
 const parentScript=join(dir,'parent.mjs');await writeFile(parentScript,`import {spawn} from 'node:child_process';
const child=spawn(process.execPath,[${JSON.stringify(cli)},'--config',${JSON.stringify(config)},'--profile',${JSON.stringify(profile)},'--cwd',${JSON.stringify(cwd)},'--provider','openai','--model','gpt-4.1-mini','--prompt','synthetic'],
 {detached:true,stdio:['pipe','ignore','ignore'],env:{PATH:process.env.PATH,HOME:${JSON.stringify(profile)},CHIO_PI_GATEWAY_TRANSPORT:'1',CHIO_PI_PARENT_LIFELINE_GRACE_MS:'200'}});
console.log(child.pid);setInterval(()=>{},1000);`);
 const parent=spawn(process.execPath,[parentScript],{stdio:['ignore','pipe','ignore']});const next=lines(parent.stdout);
 const guest=Number(await next());t.after(()=>killGroup(guest));
 for(const end=Date.now()+20000;!initialize&&Date.now()<end;)await sleep(25);
 assert.equal(initialize,1,'guest reached the parent gateway');
 parent.kill('SIGKILL');await exited(parent);
 // The guest's own gateway deadline is 40 s; only the lifeline ends it sooner.
 assert.equal(await settled(guest,5000),true,`guest CLI group ${guest} survived a SIGKILLed parent`);
});
