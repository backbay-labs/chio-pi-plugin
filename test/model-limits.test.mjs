import test from 'node:test'; import assert from 'node:assert/strict';
import {mkdtemp, realpath, rm, unlink} from 'node:fs/promises'; import {join} from 'node:path'; import {tmpdir} from 'node:os';
import {openRunBudget} from '../dist/run-limits.js'; import {startModelRelay} from '../dist/model-relay.js'; import {createToolRegistry} from '../dist/index.js';
const registry=createToolRegistry([], 'typed');
const binding={authorityDigest:'a'.repeat(64),registryDigest:registry.digest,profileIdentity:'private',governanceProfile:'execution-only'};
const limits={maxRequests:2,maxOutputTokens:32,maxTotalOutputTokens:48,providerTimeoutMs:80,maxResponseBytes:128,wallMs:10000,killGraceMs:100};
const nativeFetch=globalThis.fetch;
const body=(provider='openai')=>({model:provider==='openai'?'gpt-4.1-mini':'gpt-5.5',store:false,stream:true,input:[{role:'user',content:'private input'}],max_output_tokens:999});
async function fixture(fn,provider='openai',governanceProfile='execution-only'){const dir=await realpath(await mkdtemp(join(tmpdir(),'chio-model-limits-'))); const budget=await openRunBudget(join(dir,'budget'),{binding:{...binding,governanceProfile},limits,provider,model:body(provider).model,create:true}); const relay=governanceProfile==='required'?undefined:await startModelRelay(provider==='openai'?{provider,apiKey:'PRIVATE_KEY'}:{provider,accessToken:'PRIVATE_TOKEN',accountId:'PRIVATE_ACCOUNT'},body(provider).model,undefined,registry,undefined,budget);try{await fn({relay,budget,dir});}finally{await relay?.close();await budget.close();await rm(dir,{recursive:true,force:true});globalThis.fetch=nativeFetch;}}
const send=relay=>nativeFetch(`http://127.0.0.1:${relay.port}/v1/${relay.token.includes('.')?'codex/':''}responses`,{method:'POST',headers:{authorization:`Bearer ${relay.token}`},body:JSON.stringify(body(relay.token.includes('.')?'openai-codex':'openai'))});
test('relay uses final supported ceiling reservation and storage failure has zero egress',()=>fixture(async({relay,budget,dir})=>{
 let count=0;globalThis.fetch=async(_url,init)=>{count++;assert.equal(JSON.parse(init.body).max_output_tokens,32);return new Response('ok');};
 assert.equal((await send(relay)).status,200);assert.equal(count,1);assert.equal(budget.remainingOutputTokens,16);
 await unlink(join(dir,'budget','run.json'));const refused=await send(relay);assert.equal(refused.status,502);assert.equal(count,1);assert.doesNotMatch(await refused.text(),/PRIVATE|private input/);
}));
test('Codex has byte/request bounds but no unsupported output token cap',()=>fixture(async({relay,budget})=>{globalThis.fetch=async(_url,init)=>{assert.equal(JSON.parse(init.body).max_output_tokens,undefined);return new Response('ok');};assert.equal((await send(relay)).status,200);assert.equal(budget.remainingOutputTokens,null);},'openai-codex'));
test('provider timeout aborts upstream and permanently spends its reservation',()=>fixture(async({relay,budget})=>{
 let aborted=false;globalThis.fetch=async(_url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('PRIVATE_TOKEN'));},{once:true}));
 const reply=await send(relay);assert.equal(reply.status,502);assert.ok(aborted);assert.equal(budget.remainingRequests,1);assert.doesNotMatch(await reply.text(),/PRIVATE/);
}));
test('stream is capped during reading and overflow cancels upstream without unbounded buffering',()=>fixture(async({relay,budget})=>{
 let cancelled=false,pulls=0;globalThis.fetch=async()=>new Response(new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(80));},cancel(){cancelled=true;}}));
 const reply=await send(relay).catch(()=>undefined);if(reply)await assert.rejects(reply.arrayBuffer());assert.ok(cancelled);assert.ok(pulls<=4);assert.equal(budget.remainingRequests,1);
}));
test('disconnect aborts a hung stream, preserving spent reservations',()=>fixture(async({relay,budget})=>{
 let cancelled=false;globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}}));
 const controller=new AbortController();const reply=await nativeFetch(`http://127.0.0.1:${relay.port}/v1/responses`,{signal:controller.signal,method:'POST',headers:{authorization:`Bearer ${relay.token}`},body:JSON.stringify(body())});controller.abort();await new Promise(r=>setTimeout(r,40));assert.ok(cancelled);assert.equal(budget.remainingRequests,1);
}));

test('durable limits/profile mismatches prevent native release',()=>fixture(async({budget})=>{
 const {createNativeEmbedding}=await import('../dist/governance.js');
 const selected={authorityDomain:'domain',tenant:'tenant',process:'process',runtime:'runtime',lineage:'lineage',isolationEpoch:'epoch',policy:'policy',contracts:'contracts',installGeneration:'generation'};
 let deliveries=0, frozen;
 const make=(identity,profile)=>createNativeEmbedding({expectedBinding:selected,process:{},context:{},history:[],sink:{selected:true},providerProfile:profile,credentialGeneration:'generation',limitsIdentity:identity,purpose:'coding',ports:{currentInstallation:async()=>({binding:selected,expiresAt:Date.now()+10000}),model:{releaseFrozenRequest:async request=>{deliveries++;frozen=request;return {state:'completed',response:new Response('ok')};}}}});
 globalThis.fetch=async()=>{throw new Error('Forbidden adapter egress');};
 for(const [identity,profile] of [['wrong',budget.profile.identity],[budget.identity,'wrong']]){
  const relay=await startModelRelay({provider:'openai',apiKey:'PRIVATE'},'gpt-4.1-mini',undefined,registry,{required:true,embedding:make(identity,profile)},budget);
  try{assert.equal((await send(relay)).status,502);assert.equal(deliveries,0);}finally{await relay.close();}
 }
 // The refused pre-release reservations remain spent. A separate budget is
 // needed for the positive original native submission.
},'openai','required'));

test('native receives one exact final capped immutable JSON string with durable profile and limits identity',()=>fixture(async({budget})=>{
 const {createNativeEmbedding}=await import('../dist/governance.js');const selected={authorityDomain:'domain',tenant:'tenant',process:'process',runtime:'runtime',lineage:'lineage',isolationEpoch:'epoch',policy:'policy',contracts:'contracts',installGeneration:'generation'};let frozen,delivered=0;const sink={installed:true};
 const embedding=createNativeEmbedding({expectedBinding:selected,process:{},context:{},history:[],sink,providerProfile:budget.profile.identity,credentialGeneration:'generation',limitsIdentity:budget.identity,purpose:'coding',ports:{currentInstallation:async()=>({binding:selected,expiresAt:Date.now()+10000}),model:{releaseFrozenRequest:async(request,selectedSink)=>{assert.equal(selectedSink,sink);frozen=request;delivered++;return {state:'completed',response:new Response('ok')};}}}});
 globalThis.fetch=async()=>{assert.fail('independent adapter fetch after native release');};
 const relay=await startModelRelay({provider:'openai',apiKey:'PRIVATE'},'gpt-4.1-mini',undefined,registry,{required:true,embedding},budget);
 try{const reply=await send(relay);assert.equal(await reply.text(),'ok');assert.equal(delivered,1);assert.equal(JSON.parse(frozen.json).max_output_tokens,32);assert.equal(frozen.profile,budget.profile.identity);assert.equal(frozen.limitsIdentity,budget.identity);assert.ok(Object.isFrozen(frozen));assert.equal(Object.hasOwn(frozen,'profileIdentity'),false);assert.equal(budget.remainingOutputTokens,16);}finally{await relay.close();}
},'openai','required'));

test('native timeout retains original unknown fence and never releases a replacement after interruption',()=>fixture(async({budget})=>{
 const {createNativeEmbedding}=await import('../dist/governance.js');const selected={authorityDomain:'domain',tenant:'tenant',process:'process',runtime:'runtime',lineage:'lineage',isolationEpoch:'epoch',policy:'policy',contracts:'contracts',installGeneration:'generation'};let calls=0;
 const embedding=createNativeEmbedding({expectedBinding:selected,process:{},context:{},history:[],sink:{},providerProfile:budget.profile.identity,credentialGeneration:'generation',limitsIdentity:budget.identity,purpose:'coding',ports:{currentInstallation:async()=>({binding:selected,expiresAt:Date.now()+10000}),model:{releaseFrozenRequest:async()=>{calls++;return new Promise(()=>{});}}}});
 const relay=await startModelRelay({provider:'openai',apiKey:'PRIVATE'},'gpt-4.1-mini',undefined,registry,{required:true,embedding},budget);
 try{assert.equal((await send(relay)).status,502);assert.equal(calls,1);assert.equal((await send(relay)).status,502);assert.equal(calls,1);assert.equal(budget.remainingRequests,0);assert.equal(budget.remainingOutputTokens,0);}finally{await relay.close();}
},'openai','required'));
test('foreign pinned registry budget is refused before a service is exposed',()=>fixture(async({budget})=>{
 const other=createToolRegistry([{name:'other',inputSchema:{type:'object'}}],'typed');
 await assert.rejects(startModelRelay({provider:'openai',apiKey:'PRIVATE'},'gpt-4.1-mini',undefined,other,undefined,budget),/registry|binding/);
}));

test('native codemode hosted/deferred tools are refused before reservation or provider submission',()=>fixture(async({relay,budget})=>{
 let outbound=0;globalThis.fetch=async()=>{outbound++;return new Response('unreachable');};
 for(const override of [{tools:[{type:'code_interpreter'}]},{tools:[{type:'mcp',server_url:'http://127.0.0.1:1'}]},{tools:[{type:'tool_search'}]},{tools:[{type:'function',name:'deferred',defer_loading:true}]}]){
  const response=await nativeFetch(`http://127.0.0.1:${relay.port}/v1/responses`,{method:'POST',headers:{authorization:`Bearer ${relay.token}`},body:JSON.stringify({...body(),...override})});assert.equal(response.status,502);
 }
 assert.equal(outbound,0);assert.equal(budget.remainingRequests,2);
}));

test('late provider response after timeout is cancelled even when transport ignored abort',()=>fixture(async({relay})=>{
 let cancelled=false;globalThis.fetch=async()=>{await new Promise(r=>setTimeout(r,130));return new Response(new ReadableStream({cancel(){cancelled=true;}}));};
 assert.equal((await send(relay)).status,502);await new Promise(r=>setTimeout(r,80));assert.ok(cancelled);
}));

test('execution-only run cannot be rebound to required native governance',()=>fixture(async({budget})=>{
 await assert.rejects(startModelRelay({provider:'openai',apiKey:'PRIVATE'},'gpt-4.1-mini',undefined,registry,{required:true,embedding:{}},budget),/governance|binding/);
}));

test('upstream failure before first byte returns a bounded generic error while retaining native unknown',()=>fixture(async({budget})=>{
 const {createNativeEmbedding}=await import('../dist/governance.js');const selected={authorityDomain:'domain',tenant:'tenant',process:'process',runtime:'runtime',lineage:'lineage',isolationEpoch:'epoch',policy:'policy',contracts:'contracts',installGeneration:'generation'};let calls=0;
 const embedding=createNativeEmbedding({expectedBinding:selected,process:{},context:{},history:[],sink:{},providerProfile:budget.profile.identity,credentialGeneration:'generation',limitsIdentity:budget.identity,purpose:'coding',ports:{currentInstallation:async()=>({binding:selected,expiresAt:Date.now()+10000}),model:{releaseFrozenRequest:async()=>{calls++;return {state:'completed',response:new Response(new ReadableStream({start(c){c.error(new Error('PRIVATE request'));}}))};}}}});
 const relay=await startModelRelay({provider:'openai',apiKey:'PRIVATE'},'gpt-4.1-mini',undefined,registry,{required:true,embedding},budget);
 try{const failed=await send(relay);assert.equal(failed.status,502);assert.doesNotMatch(await failed.text(),/PRIVATE/);assert.equal((await send(relay)).status,502);assert.equal(calls,1);}finally{await relay.close();}
},'openai','required'));
