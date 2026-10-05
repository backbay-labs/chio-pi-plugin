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
