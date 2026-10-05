import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile, unlink, chmod, symlink, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const limitsModule = await import('../dist/run-limits.js').catch(() => ({}));
const binding = {authorityDigest:'a'.repeat(64), registryDigest:'b'.repeat(64), profileIdentity:'test-profile', governanceProfile:'execution-only'};
const limits = {maxRequests:2, maxOutputTokens:32, maxTotalOutputTokens:48, providerTimeoutMs:50, maxResponseBytes:128, wallMs:10000, killGraceMs:100};
async function fixture(fn) {const dir=await realpath(await mkdtemp(join(tmpdir(),'chio-limits-'))); try {await fn(join(dir,'budget'));} finally {await rm(dir,{recursive:true,force:true});}}
test('durable limits implementation exists',()=>assert.equal(typeof limitsModule.openRunBudget,'function'));
test('requests and actual final supported ceilings are spent conservatively across restart',()=>fixture(async path=>{
 const first=await limitsModule.openRunBudget(path,{binding,limits,provider:'openai',model:'gpt-4.1-mini',create:true});
 const body={max_output_tokens:1000}; await first.reserveRequest(body); assert.equal(body.max_output_tokens,32); assert.equal(first.remainingOutputTokens,16);
 await assert.rejects(first.reserveRequest({max_output_tokens:15}),/ceiling|token/);
 await first.close(); const next=await limitsModule.openRunBudget(path,{binding,limits,provider:'openai',model:'gpt-4.1-mini'});
 assert.equal(next.remainingRequests,1); const final={}; await next.reserveRequest(final); assert.equal(final.max_output_tokens,16);
 assert.equal(next.remainingOutputTokens,0); await assert.rejects(next.reserveRequest({}),/limit|budget/); await next.close();
}));
test('Codex keeps honest unavailable token accounting without unsupported API parameter',()=>fixture(async path=>{
 const budget=await limitsModule.openRunBudget(path,{binding,limits,provider:'openai-codex',model:'gpt-5.5',create:true});
 const body={max_output_tokens:99}; await budget.reserveRequest(body); assert.equal(body.max_output_tokens,undefined); assert.equal(budget.remainingOutputTokens,null); assert.equal(budget.hardOutputTokenLimit,null); await budget.close();
}));
test('concurrent owner refuses and concurrent reservations cannot overrun',()=>fixture(async path=>{
 const opts={binding,limits,provider:'openai',model:'gpt-4.1-mini'}; const b=await limitsModule.openRunBudget(path,{...opts,create:true});
 await assert.rejects(limitsModule.openRunBudget(path,opts),/owner|active|lock/);
 const results=await Promise.allSettled([b.reserveRequest({}),b.reserveRequest({}),b.reserveRequest({})]); assert.equal(results.filter(x=>x.status==='fulfilled').length,2); assert.equal(b.remainingOutputTokens,0); await b.close();
}));
test('missing corrupt changed binding and changed limits refuse resume',()=>fixture(async path=>{
 const opts={binding,limits,provider:'openai',model:'gpt-4.1-mini'};
 await assert.rejects(limitsModule.openRunBudget(path,opts),/missing|ENOENT/);
 const b=await limitsModule.openRunBudget(path,{...opts,create:true}); const deadline=b.deadline; await b.close();
 await assert.rejects(limitsModule.openRunBudget(path,{...opts,binding:{...binding,authorityDigest:'c'.repeat(64)}}),/binding/);
 await assert.rejects(limitsModule.openRunBudget(path,{...opts,limits:{...limits,wallMs:20000}}),/binding/);
 const resumed=await limitsModule.openRunBudget(path,opts); assert.equal(resumed.deadline,deadline); await resumed.close();
 await writeFile(join(path,'run.json'),'corrupt'); await assert.rejects(limitsModule.openRunBudget(path,opts),/corrupt|JSON/);
}));
test('storage failure fences further requests and missing state is never recreated',()=>fixture(async path=>{
 const opts={binding,limits,provider:'openai',model:'gpt-4.1-mini'}; const b=await limitsModule.openRunBudget(path,{...opts,create:true});
 await unlink(join(path,'run.json')); await assert.rejects(b.reserveRequest({}),/state|storage|ENOENT/); await assert.rejects(b.reserveRequest({}),/state|storage|fenced/); await b.close();
 await assert.rejects(limitsModule.openRunBudget(path,opts),/missing|ENOENT/);
}));
test('unsafe integer and minimum API ceiling refuse, symlink/private-mode state refuses',()=>fixture(async path=>{
 const opts={binding,limits,provider:'openai',model:'gpt-4.1-mini'};
 for(const patch of [{maxRequests:Number.MAX_SAFE_INTEGER+1},{maxOutputTokens:15},{wallMs:NaN}]) await assert.rejects(limitsModule.openRunBudget(path,{...opts,limits:{...limits,...patch},create:true}));
 const b=await limitsModule.openRunBudget(path,{...opts,create:true}); await b.close(); await chmod(join(path,'run.json'),0o644); await assert.rejects(limitsModule.openRunBudget(path,opts),/private|regular/);
 await unlink(join(path,'run.json')); await symlink('/dev/null',join(path,'run.json')); await assert.rejects(limitsModule.openRunBudget(path,opts),/private|regular/);
}));

test('absolute deadline is retained after restart and exhaustion does not recreate a run',()=>fixture(async path=>{
 const opts={binding,limits:{...limits,wallMs:30},provider:'openai',model:'gpt-4.1-mini'};const b=await limitsModule.openRunBudget(path,{...opts,create:true});const deadline=b.deadline;await b.close();await new Promise(r=>setTimeout(r,40));const resumed=await limitsModule.openRunBudget(path,opts);assert.equal(resumed.deadline,deadline);await assert.rejects(resumed.reserveRequest({}),/deadline/);await resumed.close();await assert.rejects(limitsModule.openRunBudget(path,{...opts,create:true}),/EEXIST/);
}));
test('dead owner recovery preserves conservative counts and simultaneous recoveries admit one owner',()=>fixture(async path=>{
 const opts={binding,limits,provider:'openai',model:'gpt-4.1-mini'};const b=await limitsModule.openRunBudget(path,{...opts,create:true});await b.reserveRequest({});const {readFile}=await import('node:fs/promises');const originalOwner=JSON.parse(await readFile(join(path,'owner.json'),'utf8'));await b.close();
 for(let i=0;i<10;i++){
  await writeFile(join(path,'owner.json'),JSON.stringify({...originalOwner,pid:2147483647,nonce:'lost-owner'}),{mode:0o600});
  const attempts=await Promise.allSettled(Array.from({length:4},()=>limitsModule.openRunBudget(path,opts)));const successes=attempts.filter(x=>x.status==='fulfilled');assert.equal(successes.length,1);assert.equal(successes[0].value.remainingRequests,1);await successes[0].value.close();
 }
}));

test('absolute deadline and counters are integrity bound, valid JSON edits cannot extend or reset a run',()=>fixture(async path=>{
 const {readFile}=await import('node:fs/promises');const opts={binding,limits,provider:'openai',model:'gpt-4.1-mini'};const b=await limitsModule.openRunBudget(path,{...opts,create:true});await b.reserveRequest({});await b.close();const original=JSON.parse(await readFile(join(path,'run.json'),'utf8'));
 for(const patch of [{deadline:original.deadline+10000},{usedRequests:0},{reservedOutputTokens:0}]){await writeFile(join(path,'run.json'),JSON.stringify({...original,...patch}));await assert.rejects(limitsModule.openRunBudget(path,opts),/integrity|binding|corrupt/);}
}));

test('foreign host owner is never removed using a local dead PID observation',()=>fixture(async path=>{
 const opts={binding,limits,provider:'openai',model:'gpt-4.1-mini'};const b=await limitsModule.openRunBudget(path,{...opts,create:true});await b.close();await writeFile(join(path,'owner.json'),JSON.stringify({schema:'chio.pi.run-owner.v1',pid:2147483647,nonce:'foreign',host:'other-host'}),{mode:0o600});await assert.rejects(limitsModule.openRunBudget(path,opts),/host|owner|lock/);
}));

// Task 8 area C (C-I2): a dead owner's recorded guest process group must be gone
// before a second launch can own the same profile accounting.
const {spawn} = await import('node:child_process');
const {readFile: readText} = await import('node:fs/promises');
const pause = ms => new Promise(r => setTimeout(r, ms));
const groupGone = async pgid => {for (let i = 0; i < 200; i++) {try {process.kill(-pgid, 0);} catch (error) {if (error.code === 'ESRCH') return true;} await pause(25);} return false;};
const exited = child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(r => child.once('exit', r));
test('C-I2: stale owner recovery refuses while the recorded guest process group still exists', {timeout: 30000}, () => fixture(async path => {
 const opts = {binding, limits, provider:'openai', model:'gpt-4.1-mini'};
 const b = await limitsModule.openRunBudget(path, {...opts, create:true}); const owner = JSON.parse(await readText(join(path, 'owner.json'), 'utf8')); await b.close();
 const guest = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {detached:true, stdio:'ignore'});
 try {
  const stale = JSON.stringify({...owner, pid:2147483647, nonce:'lost-owner', guestProcessGroup:guest.pid});
  await writeFile(join(path, 'owner.json'), stale, {mode:0o600});
  await assert.rejects(limitsModule.openRunBudget(path, opts), /guest process group/);
  assert.equal(await readText(join(path, 'owner.json'), 'utf8'), stale);
 } finally {try {process.kill(-guest.pid, 'SIGKILL');} catch {} await exited(guest);}
 assert.equal(await groupGone(guest.pid), true);
 const recovered = await limitsModule.openRunBudget(path, opts); assert.equal(recovered.remainingRequests, 2); await recovered.close();
}));

test('C-I2: a real guest surviving its SIGKILLed parent blocks owner recovery until it is gone', {timeout: 30000}, () => fixture(async path => {
 const opts = {binding, limits:{...limits, wallMs:60000}, provider:'openai', model:'gpt-4.1-mini'};
 const first = await limitsModule.openRunBudget(path, {...opts, create:true}); await first.reserveRequest({}); await first.close();
 const parentScript = join(path, '..', 'parent.mjs');
 await writeFile(parentScript, `import {spawn} from 'node:child_process';
import {openRunBudget} from ${JSON.stringify(new URL('../dist/run-limits.js', import.meta.url).href)};
import {superviseGuest} from ${JSON.stringify(new URL('../dist/guest-termination.js', import.meta.url).href)};
const budget = await openRunBudget(process.argv[2], JSON.parse(process.argv[3]));
const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {detached:true, stdio:'ignore'});
const supervised = superviseGuest(child, {deadline:budget.deadline, killGraceMs:100, processGroup:true});
await budget.recordGuest(child.pid); console.log(child.pid); await supervised;`);
 const parent = spawn(process.execPath, [parentScript, path, JSON.stringify(opts)], {stdio:['ignore', 'pipe', 'inherit']});
 const guest = await new Promise((resolve, reject) => {parent.stdout.once('data', x => resolve(Number(x.toString().trim()))); parent.once('exit', code => reject(new Error(`parent exited ${code}`)));});
 try {
  assert.equal(JSON.parse(await readText(join(path, 'owner.json'), 'utf8')).guestProcessGroup, guest);
  parent.kill('SIGKILL'); await exited(parent);
  process.kill(-guest, 0);
  await assert.rejects(limitsModule.openRunBudget(path, opts), /guest process group/);
 } finally {try {process.kill(-guest, 'SIGKILL');} catch {}}
 assert.equal(await groupGone(guest), true);
 const attempts = await Promise.allSettled(Array.from({length:3}, () => limitsModule.openRunBudget(path, opts)));
 const owners = attempts.filter(x => x.status === 'fulfilled'); assert.equal(owners.length, 1); assert.equal(owners[0].value.remainingRequests, 1); await owners[0].value.close();
}));
