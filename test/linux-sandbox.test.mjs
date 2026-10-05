import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,realpath,rm,mkdir,writeFile,symlink} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createServer} from 'node:net';
const linux=await import('../dist/linux-sandbox.js').catch(()=>({}));
function evaluate(buf,arch,nr,args=[]){const input=Buffer.alloc(64);input.writeUInt32LE(nr>>>0,0);input.writeUInt32LE(arch>>>0,4);args.forEach((v,i)=>input.writeBigUInt64LE(BigInt(v),16+8*i));let a=0;for(let pc=0;pc<buf.length/8;pc++){const code=buf.readUInt16LE(pc*8),jt=buf[pc*8+2],jf=buf[pc*8+3],k=buf.readUInt32LE(pc*8+4);if(code===0x20)a=input.readUInt32LE(k);else if(code===0x15)pc+=a===k?jt:jf;else if(code===0x45)pc+=(a&k)?jt:jf;else if(code===0x54)a&=k;else if(code===0x06)return k;else throw new Error('unexpected BPF');}throw new Error('no return');}
test('whole guest seccomp and mount validators exist separately from recipe profile',()=>{assert.equal(typeof linux.wholeGuestFilter,'function');assert.equal(typeof linux.auditMountClosure,'function');});
test('actual compiled BPF admits relay stream sockets and threads but denies processes namespaces and x32',()=>{
 assert.equal(typeof linux.wholeGuestFilter,'function');
 for(const [architecture,arch,clone,socket,unshare,setns,fork] of [['arm64',0xc00000b7,220,198,97,268,undefined],['x64',0xc000003e,56,41,272,308,57]]){
 const filter=linux.wholeGuestFilter(architecture),evalAt=(nr,args=[])=>evaluate(filter,arch,nr,args);
 assert.equal(evalAt(socket,[1,1,0]),0x7fff0000);assert.equal(evalAt(socket,[2,0x80001,6]),0x7fff0000);
 for(const args of [[10,1,0],[2,2,0],[16,3,0]])assert.equal(evalAt(socket,args),0x50001);
 assert.equal(evalAt(clone,[0x10000]),0x7fff0000);assert.equal(evalAt(435),0x50026);assert.equal(evalAt(clone,[0]),0x50001);
 for(const flag of [0x80,0x20000,0x2000000,0x4000000,0x8000000,0x10000000,0x20000000,0x40000000])assert.equal(evalAt(clone,[0x10000|flag]),0x50001);
 assert.equal(evalAt(unshare),0x50001);assert.equal(evalAt(setns),0x50001);if(fork)assert.equal(evalAt(fork),0x50001);
 assert.equal(evaluate(filter,0,nrSafe(socket)),0x80000000);
 if(architecture==='x64')for(let nr=0;nr<1024;nr++)assert.equal(evalAt(nr|0x40000000),0x50001);
 }
});function nrSafe(nr){return nr;}
test('installed closure refuses escaping links and hidden service sockets but accepts contained package links',async()=>{
 assert.equal(typeof linux.auditMountClosure,'function');const dir=await realpath(await mkdtemp(join(tmpdir(),'chio-closure-')));try{
 await mkdir(join(dir,'code'));await writeFile(join(dir,'code','ok'),'installed');await symlink('code/ok',join(dir,'inside'));await linux.auditMountClosure(dir);
 await symlink('/etc/passwd',join(dir,'escape'));await assert.rejects(linux.auditMountClosure(dir),/closure|link/);await rm(join(dir,'escape'));
 const server=createServer();await new Promise(r=>server.listen(join(dir,'extra.sock'),r));try{await assert.rejects(linux.auditMountClosure(dir),/special|socket/);}finally{await new Promise(r=>server.close(r));}
 }finally{await rm(dir,{recursive:true,force:true});}
});

// Task 8 area C.
test('C-M3: whole guest filter denies cross-process memory and descriptor access on both architectures',()=>{
 for(const [architecture,arch,denied,allowed] of [['arm64',0xc00000b7,{ptrace:117,process_vm_readv:270,process_vm_writev:271,pidfd_getfd:438},{read:63,getpid:172}],['x64',0xc000003e,{ptrace:101,process_vm_readv:310,process_vm_writev:311,pidfd_getfd:438},{read:0,getpid:39}]]){
  const filter=linux.wholeGuestFilter(architecture);
  for(const [name,nr] of Object.entries(denied))assert.equal(evaluate(filter,arch,nr),0x50001,`${architecture} ${name}`);
  for(const [name,nr] of Object.entries(allowed))assert.equal(evaluate(filter,arch,nr),0x7fff0000,`${architecture} ${name}`);
  if(architecture==='x64')for(const nr of Object.values(denied))assert.equal(evaluate(filter,arch,nr|0x40000000),0x50001,'x32 variant');
 }
});

const {spawn}=await import('node:child_process');
const secretsUrl=new URL('../dist/guest-secrets.js',import.meta.url).href;
function readInChild(payload){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',`import {readGuestSecrets} from ${JSON.stringify(secretsUrl)};try{console.log(JSON.stringify(readGuestSecrets()));}catch(error){console.log('refused: '+error.message);}`],
   {stdio:payload===undefined?['ignore','pipe','inherit']:['ignore','pipe','inherit','ignore','pipe']});
  let out='';child.stdout.on('data',x=>out+=x);child.once('error',reject);child.once('close',()=>resolve(out.trim()));
  if(payload!==undefined){child.stdio[4].on('error',()=>{});child.stdio[4].end(payload);}
 });
}
test('C-I1: guest bearer secrets arrive whole on an inherited descriptor and malformed sets refuse without echoing values',async()=>{
 const secrets=await import(secretsUrl);const token='synthetic-relay-secret-'+'a1'.repeat(16);
 const payload=secrets.encodeGuestSecrets({CHIO_PI_MODEL_TOKEN:token});
 assert.deepEqual(JSON.parse(await readInChild(payload)),{CHIO_PI_MODEL_TOKEN:token});
 for(const [bad,reason] of [[Buffer.alloc(5000,0x61),/bound/],[Buffer.from(JSON.stringify({OPENAI_API_KEY:token})),/secret/],[Buffer.from('not json '+token),/secret/]]){
  const result=await readInChild(bad);assert.match(result,/^refused: /);assert.match(result,reason);assert.doesNotMatch(result,new RegExp(token));
 }
 // An absent descriptor refuses; Node's own descriptors are never read as secrets.
 assert.throws(()=>secrets.readGuestSecrets(1023),/descriptor unavailable/);
 {const {openSync}=await import('node:fs');const file=openSync(new URL(import.meta.url),'r');assert.throws(()=>secrets.readGuestSecrets(file),/descriptor unavailable/);}
 for(const set of [{},{CHIO_PI_MODEL_TOKEN:''},{OTHER:'x'},{CHIO_PI_MODEL_TOKEN:'a\0b'}])assert.throws(()=>secrets.encodeGuestSecrets(set),/secret/);
});

test('C-I1 and C-M8: actual bubblewrap arguments carry no secret, no extra bind and exactly two relay socket leaves',{skip:process.platform!=='linux'&&'Linux bubblewrap only'},async t=>{
 const {execFileSync}=await import('node:child_process');const {createHash,randomBytes}=await import('node:crypto');const {readFile,lstat}=await import('node:fs/promises');
 const relay=await import('../dist/unix-relay.js');
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const node=await realpath(process.execPath);const ldd=execFileSync('/usr/bin/ldd',[node],{encoding:'utf8'});
 const runtimeFiles=await Promise.all([...new Set([...ldd.matchAll(/(?:=>\s+)?(\/[^\s]+)\s+\(/g)].map(x=>x[1]))].map(async target=>({path:await realpath(target),mountPath:target,sha256:hash(await readFile(target))})));
 const runtime={schema:'chio.pi.linux-runtime.v1',architecture:process.arch,node,nodeSha256:hash(await readFile(node)),runtimeFiles};
 const dir=await realpath(await mkdtemp(join(tmpdir(),'chio-bwrap-args-')));t.after(()=>rm(dir,{recursive:true,force:true}));
 const installation=join(dir,'installed'),profile=join(dir,'profile'),cwd=join(dir,'cwd'),relays=join(dir,'relays');
 for(const path of [installation,profile,cwd,relays])await mkdir(path,{mode:0o700});
 const bootstrap=join(installation,'linux-guest.js');await writeFile(bootstrap,'');
 const services=[createServer(),createServer()];for(const s of services)await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>services.forEach(s=>s.close()));
 const [gatewayPort,modelPort]=services.map(s=>s.address().port);const gatewaySocket=join(relays,'g.sock'),modelSocket=join(relays,'m.sock');
 const parents=[await relay.createUnixRelay(gatewaySocket,gatewayPort),await relay.createUnixRelay(modelSocket,modelPort)];t.after(()=>Promise.all(parents.map(p=>p.close())));
 const token='synthetic-relay-secret-'+randomBytes(16).toString('hex');
 const base={runtime,installation,profile,cwd,gatewaySocket,modelSocket,gatewayPort,modelPort,bootstrap,argv:['--config',join(profile,'gateway-transport.json')],environment:{PATH:'/usr/local/bin',HOME:profile,LANG:'C',CHIO_PI_GATEWAY_TRANSPORT:'1'}};
 for(const environment of [{CHIO_PI_MODEL_TOKEN:token},{OPENAI_API_KEY:token},{CHIO_PI_SECRET_FD:'4'}])
  await assert.rejects(linux.prepareLinuxGuest({...base,environment:{...base.environment,...environment}}),/secret|credential/);
 const guest=await linux.prepareLinuxGuest({...base,secrets:{CHIO_PI_MODEL_TOKEN:token}});
 assert.equal(guest.args.some(arg=>arg.includes(token)),false,'secret in bubblewrap argv');
 assert.equal(JSON.parse(guest.secrets.toString()).CHIO_PI_MODEL_TOKEN,token);
 const arity={'--unshare-all':0,'--unshare-user':0,'--die-with-parent':0,'--new-session':0,'--clearenv':0,'--cap-drop':1,'--tmpfs':1,'--proc':1,'--dev':1,'--dir':1,'--chdir':1,'--seccomp':1,'--ro-bind':2,'--bind':2,'--chmod':2,'--setenv':2};
 const ops=[];let index=0;
 for(;guest.args[index]!=='--';){const name=guest.args[index];assert.ok(name in arity,`unexpected bubblewrap option ${name}`);ops.push([name,...guest.args.slice(index+1,index+1+arity[name])]);index+=1+arity[name];}
 assert.deepEqual(guest.args.slice(index+1),[node,bootstrap,...base.argv]);
 for(const flag of ['--unshare-all','--unshare-user','--die-with-parent','--new-session','--clearenv'])assert.ok(ops.some(([name])=>name===flag),flag);
 assert.deepEqual(ops.filter(([name])=>['--cap-drop','--seccomp','--proc','--dev','--chdir'].includes(name)),[['--cap-drop','ALL'],['--proc','/proc'],['--dev','/dev'],['--chdir',cwd],['--seccomp','3']]);
 assert.deepEqual(ops.filter(([name])=>name==='--tmpfs').map(([,path])=>path),['/tmp',cwd]);
 const binds=ops.filter(([name])=>name==='--bind'||name==='--ro-bind');
 assert.deepEqual(binds,[['--ro-bind',node,node],['--ro-bind',installation,installation],['--bind',profile,profile],...runtimeFiles.map(f=>['--ro-bind',f.path,f.mountPath]),['--ro-bind',gatewaySocket,'/run/relays/gateway.sock'],['--ro-bind',modelSocket,'/run/relays/model.sock']]);
 const sockets=[];for(const [,source] of binds)if((await lstat(source)).isSocket())sockets.push(source);
 assert.deepEqual(sockets,[gatewaySocket,modelSocket]);
 const environment=Object.fromEntries(ops.filter(([name])=>name==='--setenv').map(([,key,value])=>[key,value]));
 assert.deepEqual(Object.keys(environment).sort(),[...Object.keys(base.environment),'CHIO_PI_GATEWAY_PORT','CHIO_PI_GATEWAY_SOCKET','CHIO_PI_MODEL_PORT','CHIO_PI_MODEL_SOCKET','CHIO_PI_SECRET_FD'].sort());
 assert.equal(environment.CHIO_PI_SECRET_FD,'4');
});
