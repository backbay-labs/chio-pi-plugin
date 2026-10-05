import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {connect,createServer as netServer} from 'node:net';import {mkdtemp,realpath,rm,chmod,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const relay=await import('../dist/unix-relay.js').catch(()=>({}));
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));const close=s=>new Promise(r=>s.close(r));
test('fixed Unix and guest-loopback routes exist',()=>{assert.equal(typeof relay.createUnixRelay,'function');assert.equal(typeof relay.createLoopbackRelay,'function');});
test('Unix parent relay fixes destination and preserves Host/session bytes',async()=>{
 assert.equal(typeof relay.createUnixRelay,'function');const dir=await realpath(await mkdtemp(join(tmpdir(),'chio-ur-')));let observed;
 const service=createServer((req,res)=>{observed={host:req.headers.host,session:req.headers['mcp-session-id'],url:req.url};res.end('fixed');});await listen(service);const port=service.address().port;
 const parent=await relay.createUnixRelay(join(dir,'g.sock'),port);
 try{const {request}=await import('node:http');const data=await new Promise((resolve,reject)=>{const req=request({socketPath:join(dir,'g.sock'),method:'POST',path:'/mcp',headers:{host:`127.0.0.1:${port}`,'mcp-session-id':'exact-session'}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve(text));});req.on('error',reject);req.end('{}');});assert.equal(data,'fixed');assert.deepEqual(observed,{host:`127.0.0.1:${port}`,session:'exact-session',url:'/mcp'});}
 finally{await parent.close();await close(service);await rm(dir,{recursive:true,force:true});}
});
test('socket selection rejects public parents, long paths and link substitutions',async()=>{
 assert.equal(typeof relay.createUnixRelay,'function');const dir=await realpath(await mkdtemp(join(tmpdir(),'chio-ur-')));try{
 await assert.rejects(relay.createUnixRelay(join(dir,'x'.repeat(120)),1234),/path|length/);await chmod(dir,0o755);await assert.rejects(relay.createUnixRelay(join(dir,'g.sock'),1234),/private/);await chmod(dir,0o700);await symlink('/tmp/extra',join(dir,'g.sock'));await assert.rejects(relay.createUnixRelay(join(dir,'g.sock'),1234),/exist|socket|link/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('bound active relay connections and disconnected sockets clean up',async()=>{
 assert.equal(typeof relay.createUnixRelay,'function');const dir=await realpath(await mkdtemp(join(tmpdir(),'chio-ur-')));const service=netServer(s=>s.on('error',()=>{}));await listen(service);const parent=await relay.createUnixRelay(join(dir,'g.sock'),service.address().port,{maxConnections:2,maxQueuedBytes:4096});const clients=[];try{
 for(let i=0;i<3;i++){const c=connect(join(dir,'g.sock'));c.on('error',()=>{});clients.push(c);await new Promise(r=>setTimeout(r,20));}assert.ok(parent.activeConnections<=2);assert.ok(clients[2].destroyed);clients.forEach(c=>c.destroy());await new Promise(r=>setTimeout(r,30));assert.equal(parent.activeConnections,0);
 }finally{clients.forEach(c=>c.destroy());await parent.close();await close(service);await rm(dir,{recursive:true,force:true});}
});

// Task 8 area C (C-M1): ordinary backpressure pauses; it never disconnects.
async function transfer(bounds,bytes,consumer){
 const dir=await realpath(await mkdtemp(join(tmpdir(),'chio-ur-')));const payload=Buffer.alloc(bytes,0x5a);
 const service=netServer(s=>{s.on('error',()=>{});s.end(payload);});await listen(service);
 const parent=await relay.createUnixRelay(join(dir,'g.sock'),service.address().port,bounds);
 try{return await new Promise((resolve,reject)=>{let received=0;const client=connect(join(dir,'g.sock'));client.on('error',reject);
  client.on('data',chunk=>{received+=chunk.length;consumer?.(client);});client.on('close',()=>resolve(received));});}
 finally{await parent.close();await close(service);await rm(dir,{recursive:true,force:true});}
}
const stutter=client=>{if(!client.isPaused()){client.pause();setTimeout(()=>client.resume(),5);}};
test('C-M1: a read larger than a small queue bound pauses instead of disconnecting',{timeout:60000},async()=>{
 assert.equal(await transfer({maxConnections:2,maxQueuedBytes:4096},1024*1024,stutter),1024*1024);
});
test('C-M1: a stuttering consumer receives every byte of large transfers at the default bound',{timeout:120000},async()=>{
 const sizes=await Promise.all(Array.from({length:4},()=>transfer(undefined,4*1024*1024,stutter)));
 assert.deepEqual(sizes,Array(4).fill(4*1024*1024));
});
test('C-M1: relay idle timeout derives from the provider timeout',{timeout:30000},async()=>{
 assert.equal(typeof relay.relayBounds,'function');
 assert.equal(relay.relayBounds(120000).idleTimeoutMs,130000);assert.equal(relay.relayBounds(1000).idleTimeoutMs,120000);assert.equal(relay.relayBounds(2147483647).idleTimeoutMs,2147483647);
 const dir=await realpath(await mkdtemp(join(tmpdir(),'chio-ur-')));const service=netServer(s=>s.on('error',()=>{}));await listen(service);
 const parent=await relay.createUnixRelay(join(dir,'g.sock'),service.address().port,{maxConnections:2,maxQueuedBytes:4096,idleTimeoutMs:200});
 try{const client=connect(join(dir,'g.sock'));client.on('error',()=>{});const started=Date.now();await new Promise(r=>client.once('close',r));const elapsed=Date.now()-started;assert.ok(elapsed>=150&&elapsed<5000,String(elapsed));}
 finally{await parent.close();await close(service);await rm(dir,{recursive:true,force:true});}
});
