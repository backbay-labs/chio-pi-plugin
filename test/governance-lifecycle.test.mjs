import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ModelRuntime, SessionManager} from "@earendil-works/pi-coding-agent";
import * as plugin from "../dist/index.js";
import {createRestrictedSession} from "../dist/session.js";
const binding={authorityDomain:"domain",tenant:"tenant",process:"process",runtime:"runtime",lineage:"lineage",isolationEpoch:"epoch",policy:"policy",contracts:"contracts",installGeneration:"generation"};
function embedding(sessions,model,currentInstallation=async()=>({binding,expiresAt:Date.now()+10000})){return plugin.createNativeEmbedding({expectedBinding:binding,ports:{currentInstallation,sessions,model},process:{},context:{},history:[],sink:{},providerProfile:"profile",credentialGeneration:"credential",limitsIdentity:"limits",purpose:"purpose"});}
async function fixture(){const root=await mkdtemp(join(tmpdir(),"chio-governed-host-"));const cwd=join(root,"workspace");const agentDir=join(root,"profile");await mkdir(cwd);await mkdir(agentDir);const authPath=join(agentDir,"auth.json");await writeFile(authPath,JSON.stringify({openai:{type:"api_key",key:"fixture"}}),{mode:0o600});const modelRuntime=await ModelRuntime.create({authPath,modelsPath:null,modelsStorePath:join(agentDir,"models-cache.json"),allowModelNetwork:false});return {cwd,agentDir,modelRuntime,provider:"openai",model:"gpt-4.1-mini"};}


async function governedSession(f,e,extra={}){
 const relay=await plugin.startModelRelay({provider:"openai",apiKey:"fixture"},f.model,undefined,plugin.createToolRegistry([]),{required:true,embedding:e});
 try {const result=await plugin.createChioPiSession({...f,...extra,governance:{required:true,embedding:e,relayReference:relay.governanceReference}});const dispose=result.session.dispose.bind(result.session);result.session.dispose=()=>{dispose();void relay.close();};return result;}catch(error){await relay.close();throw error;}
}
async function governedRuntime(f,e){
 const relay=await plugin.startModelRelay({provider:"openai",apiKey:"fixture"},f.model,undefined,plugin.createToolRegistry([]),{required:true,embedding:e});
 try{const runtime=await plugin.createChioPiRuntime({...f,governance:{required:true,embedding:e,relayReference:relay.governanceReference}});const dispose=runtime.dispose.bind(runtime);runtime.dispose=async()=>{await dispose();await relay.close();};return runtime;}catch(error){await relay.close();throw error;}
}

test("initial native preflight runs before SessionManager open and createAgentSession",async()=>{
 const f=await fixture();let touched=0; const original=SessionManager.open;SessionManager.open=(...args)=>{touched++;return original(...args);};
 try {await assert.rejects(plugin.createChioPiSession({...f,governance:{required:true,embedding:embedding({async preflight(){throw Error("custody refused");}})},sessionTarget:{kind:"resume",path:"/missing-source.jsonl"}}),/custody refused/);assert.equal(touched,0);} finally {SessionManager.open=original;}
});

test("real Pi dispatcher swallows thrown gates but governed handlers explicitly cancel",async()=>{
 const f=await fixture(); const {session:control}=await createRestrictedSession(f,pi=>pi.on("session_before_fork",()=>{throw Error("swallowed");}));
 assert.equal(await control.extensionRunner.emit({type:"session_before_fork",entryId:"entry",position:"at"}),undefined);control.dispose();
 const e=embedding({async preflight(){},async mediate(){throw Error("lost custody");}});
 const {session}=await governedSession(f,e);
 try {for(const event of [{type:"session_before_fork",entryId:"entry",position:"at"},{type:"session_before_switch",reason:"resume",targetSessionFile:"target"},{type:"session_before_compact",signal:new AbortController().signal},{type:"session_before_tree",preparation:{userWantsSummary:true},signal:new AbortController().signal}])assert.deepEqual(await session.extensionRunner.emit(event),{cancel:true});}finally{session.dispose();}
});

test("public runtime repeats custody checks and refuses import original source before copy",async()=>{
 assert.equal(typeof plugin.createChioPiRuntime,"function","governed runtime missing"); const f=await fixture();let fail=false;const seen=[];
 const e=embedding({async preflight(_p,target){seen.push(target);if(fail)throw Error("custody changed");},async mediate(){return {};}});
 const runtime=await governedRuntime(f,e);
 try {await runtime.newSession();assert.ok(seen.length>=3);fail=true;await assert.rejects(runtime.importFromJsonl("/missing-original.jsonl"),/custody changed/);assert.equal(seen.at(-1).path,"/missing-original.jsonl");assert.equal(seen.at(-1).kind,"import_source");}finally{await runtime.dispose();}
});

test("public boundary dispatcher refuses unmediated draft compaction and context edits",async()=>{
 const f=await fixture();const e=embedding({async preflight(){},async mediate(){return {};}});const {session}=await governedSession(f,e);
 session.extensionRunner.extensions.push({path:"fixture",handlers:new Map([["turn_end",[()=>({entries:[{type:"compaction",summary:"drop history",firstKeptEntryId:"x",tokensBefore:1}],continue:true})]]])});
 try {const result=await session.extensionRunner.emitBoundary({type:"turn_end"},()=>({canContinue:true}));assert.deepEqual(result.entries,[]);assert.equal(result.continue,false);assert.equal(result.valid,false);}finally{session.dispose();}
});

for (const eventType of ["turn_end","agent_before_settle"]) for (const fails of [false,true]) {
 test(`public ${fails?"failed":"successful"} reload preserves ${eventType} restriction and governed provider binding`,async()=>{
  const f=await fixture();let releases=0;const e=embedding({async preflight(){},async mediate(){return {};}},{async releaseFrozenRequest(){releases++;return {state:"refused"};}});
  const {session}=await governedSession(f,e);const originalFetch=globalThis.fetch;let remote=0;
  globalThis.fetch=(url,init)=>{if(!String(url).startsWith("http://127.0.0.1:")){remote++;return Promise.resolve(new Response("refused",{status:401}));}return originalFetch(url,init);};
  // Instrument the public dispatcher only; stock Chio supplies no boundary drafts.
  const instrument=()=>session.extensionRunner.extensions.push({path:"reload-fixture",handlers:new Map([[eventType,[()=>({entries:[{type:"compaction",summary:"drop history",firstKeptEntryId:"x",tokensBefore:1}],continue:true})]]])});
  const boundary=()=>session.extensionRunner.emitBoundary({type:eventType},()=>({canContinue:true}));
  const refused=result=>{assert.deepEqual(result.entries,[]);assert.equal(result.continue,false);assert.equal(result.valid,false);};
  try {
   await session.bindExtensions({onError(){}});instrument();refused(await boundary());const oldRunner=session.extensionRunner;let duringReload;
   const reload=session.reload({async beforeSessionStart(){instrument();duringReload=await boundary();if(fails)throw Error("reload fixture failure");}});
   if(fails)await assert.rejects(reload,/reload fixture failure/);else await reload;
   assert.notEqual(session.extensionRunner,oldRunner);refused(await boundary());refused(duringReload);
   assert.equal(session.model.provider,f.provider);assert.equal(session.model.id,f.model);
   await session.prompt("reload retained native owner");assert.equal(remote,0);assert.equal(releases,1);
  } finally {session.dispose();globalThis.fetch=originalFetch;}
 });
}

test("custom summaries appear only after native checkpoint/release and preserve monotone basis",async()=>{
 const f=await fixture();let knowledge=7;let mediated=0;const e=embedding({async preflight(){},async mediate(_p,action){mediated++;knowledge=Math.max(knowledge,8);return action==="session_before_compact"?{compaction:{summary:"native retained",firstKeptEntryId:"entry",tokensBefore:100}}:{summary:{summary:"native tree"}};}});
 const {session}=await governedSession(f,e);
 try {const compact=await session.extensionRunner.emit({type:"session_before_compact",signal:new AbortController().signal});assert.equal(compact.compaction.summary,"native retained");session.sessionManager.appendMessage({role:"user",content:"projected",timestamp:Date.now()});const first=session.sessionManager.getLeafId();session.sessionManager.appendMessage({role:"user",content:"omitted",timestamp:Date.now()});session.sessionManager.branch(first);const tree=await session.extensionRunner.emit({type:"session_before_tree",preparation:{userWantsSummary:true},signal:new AbortController().signal});assert.equal(tree.summary.summary,"native tree");assert.equal(knowledge,8);assert.equal(mediated,2);}finally{session.dispose();}
});

test("real runtime ignores declared skipConversationRestore on fork",async()=>{
 const f=await fixture();const runtime=await plugin.createChioPiRuntime(f);
 try {const s=runtime.session;s.sessionManager.appendMessage({role:"user",content:"preserved-before",timestamp:Date.now()});const id=s.sessionManager.appendMessage({role:"user",content:"selected",timestamp:Date.now()});s.extensionRunner.extensions.push({path:"fixture",handlers:new Map([["session_before_fork",[()=>({skipConversationRestore:true})]]])});await runtime.fork(id,{position:"at"});assert.ok(runtime.session.messages.some(m=>m.role==="user"&&m.content==="preserved-before"));}finally{await runtime.dispose();}
});

test("public tree operation cancels before branch mutation when native custody fails",async()=>{
 const f=await fixture();const e=embedding({async preflight(){},async mediate(){throw Error("custody failure");}});const {session}=await governedSession(f,e);
 try {const first=session.sessionManager.appendMessage({role:"user",content:"first",timestamp:Date.now()});const second=session.sessionManager.appendMessage({role:"user",content:"second",timestamp:Date.now()});const result=await session.navigateTree(first);assert.equal(result.cancelled,true);assert.equal(session.sessionManager.getLeafId(),second);}finally{session.dispose();}
});

for(const summarize of [false,true])test(`public tree abort during final freshness check preserves original projection (${summarize?"custom summary":"no summary"})`,async()=>{
 const f=await fixture();const entered=Promise.withResolvers();const release=Promise.withResolvers();let finalCheck=false;
 const e=embedding({async preflight(){},async mediate(){finalCheck=true;return summarize?{summary:{summary:"native retained summary"}}:{};}},undefined,async()=>{if(finalCheck){entered.resolve();await release.promise;}return {binding,expiresAt:Date.now()+10000};});
 const {session}=await governedSession(f,e);
 try{
  const first=session.sessionManager.appendMessage({role:"user",content:"first",timestamp:Date.now()});const leaf=session.sessionManager.appendMessage({role:"user",content:"second",timestamp:Date.now()});const before=session.sessionManager.getEntries();
  const navigation=session.navigateTree(first,{summarize});await entered.promise;session.abortBranchSummary();release.resolve();
  assert.equal((await navigation).cancelled,true);assert.equal(session.sessionManager.getLeafId(),leaf);assert.deepEqual(session.sessionManager.getEntries(),before);
 }finally{release.resolve();session.dispose();}
});

for(const runtimeFactory of [false,true])test(`${runtimeFactory?"runtime":"session"} factory opens only the immutable target approved before first await`,async()=>{
 const f=await fixture();const approvedDir=join(f.agentDir,"approved");const unapprovedDir=join(f.agentDir,"unapproved");const approved=SessionManager.create(f.cwd,approvedDir);approved.appendMessage({role:"user",content:"approved",timestamp:Date.now()});const unapproved=SessionManager.create(f.cwd,unapprovedDir);unapproved.appendMessage({role:"user",content:"unapproved",timestamp:Date.now()});
 const target={kind:"resume",path:approved.getSessionFile(),sessionsDir:approvedDir};const expected={...target};const entered=Promise.withResolvers();const release=Promise.withResolvers();let paused=false;const seen=[];
 const e=embedding({async preflight(_p,next){seen.push(next);if(!paused){paused=true;entered.resolve();await release.promise;}},async mediate(){return {};}});
 const original=SessionManager.open;const opened=[];SessionManager.open=(...args)=>{opened.push(args);return original(...args);};let result;
 try{
  const creation=runtimeFactory?governedRuntime({...f,sessionTarget:target},e):governedSession({...f,sessionTarget:target},e);await entered.promise;target.path=unapproved.getSessionFile();target.sessionsDir=unapprovedDir;release.resolve();result=await creation;
  assert.deepEqual(seen[0],expected);assert.deepEqual(opened,[[expected.path,expected.sessionsDir,f.cwd]]);assert.equal(result.session.sessionFile,expected.path);assert.ok(result.session.messages.some(m=>m.role==="user"&&m.content==="approved"));assert.ok(!result.session.messages.some(m=>m.role==="user"&&m.content==="unapproved"));
 }finally{release.resolve();SessionManager.open=original;if(result){if(runtimeFactory)await result.dispose();else result.session.dispose();}}
});

test("required SDK refuses direct provider or forged relay ownership before session creation",async()=>{
 const f=await fixture();const e=embedding({async preflight(){},async mediate(){return {};}});
 for (const extra of [{},{modelBaseUrl:"http://127.0.0.1:1/v1"},{governance:{required:true,embedding:e,relayReference:{}}}]) await assert.rejects(plugin.createChioPiSession({...f,governance:{required:true,embedding:e},...extra}),/governed model relay/);
});

test("installed Pi provider dispatcher reaches only its pinned governed relay",async()=>{
 const f=await fixture();let releases=0;let finalRequest;const e=embedding({async preflight(){},async mediate(){return {};}},{async releaseFrozenRequest(request){releases++;finalRequest=request;return {state:"completed",response:new Response('data: {"type":"response.completed","response":{"id":"fixture-response","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2,"input_tokens_details":{"cached_tokens":0}}}}\n\n',{headers:{"content-type":"text/event-stream"}})};}});
 const original=globalThis.fetch;let remote=0;globalThis.fetch=(url,init)=>{if(!String(url).startsWith("http://127.0.0.1:")){remote++;throw Error("remote provider forbidden");}return original(url,init);};
 const {session}=await governedSession(f,e);try{await session.prompt("native protected secret");assert.equal(releases,1);assert.equal(remote,0);assert.match(finalRequest.json,/native protected secret/);assert.equal(session.model.baseUrl.startsWith("http://127.0.0.1:"),true);}finally{session.dispose();globalThis.fetch=original;}
});

test("required public model switching cannot restore a direct provider route",async()=>{
 const f=await fixture();let releases=0;const e=embedding({async preflight(){},async mediate(){return {};}},{async releaseFrozenRequest(){releases++;return {state:"refused"};}});
 const {session}=await governedSession(f,e);const original=globalThis.fetch;let remote=0;globalThis.fetch=(url,init)=>{if(!String(url).startsWith("http://127.0.0.1:")){remote++;return Promise.resolve(new Response("refused",{status:401}));}return original(url,init);};
 try{await session.setModel(f.modelRuntime.getModel(f.provider,f.model));await session.prompt("same model through public switch");assert.equal(remote,0);assert.equal(releases,1);await session.summarizeForBugReport({signal:new AbortController().signal}).catch(()=>{});assert.equal(remote,0);assert.equal(releases,2);}finally{session.dispose();globalThis.fetch=original;}
});

test("required changed catalog model refuses before ordinary or summary provider bytes",async()=>{
 const f=await fixture();let releases=0;const e=embedding({async preflight(){},async mediate(){return {};}},{async releaseFrozenRequest(){releases++;return {state:"refused"};}});const {session}=await governedSession(f,e);const original=globalThis.fetch;let remote=0;globalThis.fetch=(url,init)=>{if(!String(url).startsWith("http://127.0.0.1:")){remote++;return Promise.resolve(new Response("refused",{status:401}));}return original(url,init);};
 try{await session.setModel(f.modelRuntime.getModel("openai","gpt-4.1"));await session.prompt("changed profile");await session.summarizeForBugReport({signal:new AbortController().signal}).catch(()=>{});assert.equal(remote,0);assert.equal(releases,0);}finally{session.dispose();globalThis.fetch=original;}
});
