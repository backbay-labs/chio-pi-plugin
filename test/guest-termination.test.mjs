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
