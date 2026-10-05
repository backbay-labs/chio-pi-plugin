import assert from "node:assert/strict";
import test from "node:test";
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import * as plugin from "../dist/index.js";
import {startModelRelay} from "../dist/model-relay.js";
import {createToolRegistry, canonicalJson} from "../dist/tool-registry.js";
import {openRunBudget, DEFAULT_RUN_LIMITS} from "../dist/run-limits.js";
import {mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

export const binding = Object.freeze({authorityDomain:"domain", tenant:"tenant", process:"process", runtime:"runtime", lineage:"lineage", isolationEpoch:"epoch", policy:"policy", contracts:"contracts", installGeneration:"generation"});
export function fixture(overrides = {}) {
 const deliveries = []; const nativeSink = {}; const nativeProcess = {}; const nativeContext = {}; const nativeHistory = [{}];
 const ports = { async currentInstallation() {return {binding, expiresAt:Date.now()+10000};}, model: {async releaseFrozenRequest(request, sink) {assert.equal(sink,nativeSink); deliveries.push(request); return {state:"completed", response:new Response("data: [DONE]\n\n")};}}, ...overrides};
 return {deliveries, ports, nativeSink, options:{expectedBinding:binding, ports, process:nativeProcess, context:nativeContext, history:nativeHistory, sink:nativeSink, providerProfile:"openai-api-v1", credentialGeneration:"credential-generation", limitsIdentity:"limits", purpose:"development"}};
}
const body = {model:"gpt-4.1-mini", store:false, stream:true, input:[{role:"user",content:"secret"}]};
async function send(relay) {return fetch(`http://127.0.0.1:${relay.port}/v1/responses`,{method:"POST",headers:{authorization:`Bearer ${relay.token}`},body:JSON.stringify(body)});}
const pinnedRegistry = createToolRegistry([]);
/** Complete trusted composition: the embedding pins the provider profile and
 * limits identities of the durable run budget that the relay enforces. */
async function governedRelay(f, {prepare} = {}) {
 const dir=await realpath(await mkdtemp(join(tmpdir(),"chio-governed-relay-")));
 const budget=await openRunBudget(join(dir,"budget"),{binding:{authorityDigest:"a".repeat(64),registryDigest:pinnedRegistry.digest,profileIdentity:"fixture",governanceProfile:"required"},limits:{...DEFAULT_RUN_LIMITS},provider:"openai",model:body.model,create:true});
 try {
  const embedding=plugin.createNativeEmbedding({...f.options,providerProfile:budget.profile.identity,limitsIdentity:budget.identity});
  await prepare?.(embedding);
  const governance={required:true,embedding};
  const relay=await startModelRelay({provider:"openai",apiKey:"fixture"},body.model,undefined,pinnedRegistry,governance,budget);
  return {port:relay.port,token:relay.token,embedding,governance,async close(){await relay.close();await budget.close();await rm(dir,{recursive:true,force:true});}};
 } catch (error) {await budget.close();await rm(dir,{recursive:true,force:true});throw error;}
}

test("required native release absent gives zero provider bytes", async () => {
 const original=globalThis.fetch; let outbound=0;
 globalThis.fetch=(url,init)=>String(url).startsWith("http://127.0.0.1:")?original(url,init):(outbound++,Promise.resolve(new Response("leak")));
 try {await assert.rejects(startModelRelay({provider:"openai",apiKey:"fixture"},body.model,undefined,createToolRegistry([]),{required:true}).then(async relay=>{await relay.close();return relay;}),/native embedding/); assert.equal(outbound,0);} finally {globalThis.fetch=original;}
});

test("trusted embedding freezes normalized final bytes and independently selects sink", async () => {
 assert.equal(typeof plugin.createNativeEmbedding,"function","native composition missing");
 const f=fixture(); const relay=await governedRelay(f); const {embedding}=relay;
 assert.deepEqual(Object.keys(embedding),[]); assert.equal(JSON.stringify(embedding),"{}");
 try {assert.equal((await send(relay)).status,200); const r=f.deliveries[0]; assert.ok(Object.isFrozen(r)); assert.equal(r.utf8Size,Buffer.byteLength(r.json));assert.equal(r.digest,createHash("sha256").update(r.json).digest("hex"));assert.equal(JSON.parse(r.json).parallel_tool_calls,false);assert.equal(r.accountId,null);assert.equal(r.history.length,1);} finally {await relay.close();}
});

test("expired or mismatched current native authority never invokes release", async () => {
 assert.equal(typeof plugin.createNativeEmbedding,"function","native composition missing");
 for (const status of [{binding,expiresAt:0},{binding:{...binding,tenant:"other"},expiresAt:Date.now()+10000}]) {
 const f=fixture({async currentInstallation(){return status;}});
 const relay=await governedRelay(f);
 try {assert.equal((await send(relay)).status,502);assert.equal(f.deliveries.length,0);} finally {await relay.close();}
 }
});

test("native release throws or loses commit ACK without independent relay fetch", async () => {
 assert.equal(typeof plugin.createNativeEmbedding,"function","native composition missing");
 for (const failure of ["throws","lost-ack"]) {
 let sinkBytes=0;const f=fixture({model:{async releaseFrozenRequest(){if(failure==="throws")throw Error("native failure");return {state:"proven_undispatched"};}}});
 const original=globalThis.fetch; globalThis.fetch=(url,init)=>String(url).startsWith("http://127.0.0.1:")?original(url,init):(sinkBytes++,Promise.resolve(new Response("leak")));
 const relay=await governedRelay(f);
 try {assert.equal((await send(relay)).status,502);assert.equal(sinkBytes,0);} finally {await relay.close();globalThis.fetch=original;}
 }
});

test("postsubmit uncertainty fences replacement requests", async () => {
 assert.equal(typeof plugin.createNativeEmbedding,"function","native composition missing");let calls=0;
 const f=fixture({model:{async releaseFrozenRequest(){calls++;return {state:"unresolved"};}}});
 const relay=await governedRelay(f);
 try {assert.equal((await send(relay)).status,502);assert.equal((await send(relay)).status,502);assert.equal(calls,1);} finally {await relay.close();}
});

test("P2 exact Ed25519 framing, selected authority and closed public schema", async () => {
 assert.equal(typeof plugin.verifyExplanationView,"function","P2 verifier missing");
 const {publicKey,privateKey}=generateKeyPairSync("ed25519"); const key=publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");const now=Date.now();
 const b={schema:"chio.recovery.explanation-view.v1",version:1,planner_version:"chio.recovery.planner.v1",trust_domain:"domain",issuer:"issuer",recipient:"recipient",report_ref:"report",issued_at_unix_ms:now-1,expires_at_unix_ms:now+1000,projection:{summary:"alternatives_under_snapshot",candidates:[{template_id:"a",assessment:"requires_exact_approval"}]}};
 const signed=body=>({body,authority_key:key,algorithm:"ed25519",signature:sign(null,Buffer.from("chio:recovery-explanation-view:v1\0"+canonicalJson(body)),privateKey).toString("hex")});
 const expected={authorityKey:key,trustDomain:"domain",issuer:"issuer",recipient:"recipient",now};
 assert.deepEqual(plugin.verifyExplanationView(signed(b),expected),b);
 for (const mutation of [{recipient:"other"},{trust_domain:"other"},{issuer:"other"},{expires_at_unix_ms:now},{expires_at_unix_ms:now+30001},{workflow_id:"unbound"},{projection:{summary:"authorized_inspection_required",candidates:b.projection.candidates}},{projection:{summary:b.projection.summary,candidates:[{template_id:"z",assessment:"unknown_outcome"},{template_id:"a",assessment:"unknown_outcome"}]}}]) assert.throws(()=>plugin.verifyExplanationView(signed({...b,...mutation}),expected));
 assert.throws(()=>plugin.verifyExplanationView({...signed(b),signature:"00".repeat(64)},expected));
 assert.throws(()=>plugin.verifyExplanationView({...signed(b),extra:true},expected));
});

test("native knowledge keeps opaque custody and refuses cross-process adoption and raw archives",async()=>{
 let adopted=0;const knowledge={async reserve(){return {};},async adoptLegacy(){adopted++;return {};},async checkpoint(){return {};},async restore_into(){},async copy(){return {};},async export_into(){},async import_archive(){return {};}};
 const a=fixture({knowledge}),b=fixture({knowledge});const ea=plugin.createNativeEmbedding(a.options),eb=plugin.createNativeEmbedding({...b.options,expectedBinding:{...binding,process:"foreign"},ports:{...b.ports,async currentInstallation(){return {binding:{...binding,process:"foreign"},expiresAt:Date.now()+10000};}}});
 assert.equal(typeof plugin.nativeKnowledge,"function","native knowledge custody missing");
 const reservation=await plugin.nativeKnowledge(ea,"reserve",{exact:{requestId:"original"}});assert.deepEqual(Object.keys(reservation),[]);assert.equal(JSON.stringify(reservation),"{}");
 await assert.rejects(plugin.nativeKnowledge(eb,"adoptLegacy",{reference:reservation,exact:{bytes:"raw"}}),/Foreign/);assert.equal(adopted,0);
 await assert.rejects(plugin.nativeKnowledge(ea,"import_archive",{reference:{bytes:"raw"}}),/Foreign/);
 await assert.rejects(plugin.nativeKnowledge(ea,"checkpoint"),/revision CAS/);
});

test("required native account-specific contracts refuse unknown API account mapping",async()=>{
 const f=fixture();f.ports.model.accountSpecific=true;const relay=await governedRelay(f);
 try{assert.equal((await send(relay)).status,502);assert.equal(f.deliveries.length,0);}finally{await relay.close();}
});

test("native ports on class instances survive composition without callback substitution",async()=>{
 class Model{async releaseFrozenRequest(request){return {state:"completed",response:new Response(request.json)};}}
 const f=fixture({model:new Model()});const relay=await governedRelay(f);
 try{assert.equal((await send(relay)).status,200);}finally{await relay.close();}
});

test("advisory output cannot execute a remedy and unknown original cannot use resume",async()=>{
 const calls=[];const f=fixture({recovery:{async invoke(command){calls.push(command);return {state:"unresolved"};}}});const e=plugin.createNativeEmbedding(f.options);
 await assert.rejects(plugin.executeNativeRemedy(e,"unknown",{kind:"resume_original",requestId:"original"}));
 await assert.rejects(plugin.executeNativeRemedy(e,"denied",{kind:"linked_continuation",requestId:"original"}));
 assert.equal((await plugin.executeNativeRemedy(e,"unknown",{kind:"reconcile_original",requestId:"original"})).state,"unresolved");assert.equal(calls.length,1);
});

test("explicit required CLI refuses native governance before profile or credential inspection",async()=>{
 const {execFile}=await import("node:child_process");const {promisify}=await import("node:util");
 await assert.rejects(promisify(execFile)(process.execPath,["dist/protected-cli.js","--config","/missing-config","--profile","/missing-profile","--cwd","/missing-workspace","--provider","openai","--model",body.model,"--prompt","task","--governance","required"],{env:{PATH:process.env.PATH}}),error=>/native.*governance.*unavailable/i.test(error.stderr));
});

test("response loss after provider submission preserves original fence",async()=>{
 let submissions=0;const f=fixture({model:{async releaseFrozenRequest(){submissions++;return {state:"completed",response:new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode("partial"));c.error(Error("postsubmit response loss"));}}))};}}});
 const relay=await governedRelay(f);
 try {await (await send(relay)).text().catch(()=>{});await (await send(relay)).text().catch(()=>{});assert.equal(submissions,1);}finally{await relay.close();}
});

test("retained adopted artifacts join complete model history without permit serialization",async()=>{
 const knowledge={async reserve(){return {};},async adoptLegacy(){return {};}};const f=fixture({knowledge});
 const relay=await governedRelay(f,{async prepare(e){const reservation=await plugin.nativeKnowledge(e,"reserve",{exact:{requestId:"adopt-original"}});await plugin.nativeKnowledge(e,"adoptLegacy",{reference:reservation,exact:{schema:"native-classified-content"}});}});
 try {await (await send(relay)).text();assert.equal(f.deliveries[0].history.length,2);}finally{await relay.close();}
});

test("P2 native explanation port is advisory only and checks independently pinned audience",async()=>{
 assert.equal(typeof plugin.explainNativeRecovery,"function","native explanation path missing");
 const {publicKey,privateKey}=generateKeyPairSync("ed25519");const key=publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");const now=Date.now();
 const body={schema:"chio.recovery.explanation-view.v1",version:1,planner_version:"chio.recovery.planner.v1",trust_domain:"domain",issuer:"issuer",recipient:"recipient",report_ref:"report",issued_at_unix_ms:now-1,expires_at_unix_ms:now+10000,projection:{summary:"no_disclosable_advice",candidates:[]}};
 let requested;const f=fixture({explanation:{async explain(id){requested=id;return {body,authority_key:key,algorithm:"ed25519",signature:sign(null,Buffer.from("chio:recovery-explanation-view:v1\0"+canonicalJson(body)),privateKey).toString("hex")};}}});
 f.options.explanationAuthority={authorityKey:key,trustDomain:"domain",issuer:"issuer",recipient:"recipient"};const e=plugin.createNativeEmbedding(f.options);assert.match(await plugin.explainNativeRecovery(e,"workflow"),/Signed advisory/);assert.equal(requested,"workflow");
 await assert.rejects(plugin.explainNativeRecovery(plugin.createNativeEmbedding({...f.options,explanationAuthority:{...f.options.explanationAuthority,recipient:"other"}}),"workflow"));
});

test("concurrent native account lookup cannot create sibling replacement submissions",async()=>{
 let submissions=0;const f=fixture({model:{async resolveApiAccount(){await new Promise(r=>setTimeout(r,20));return "native-account";},async releaseFrozenRequest(){submissions++;return {state:"unresolved"};}}});
 const relay=await governedRelay(f);try{await Promise.all([send(relay),send(relay)]);assert.equal(submissions,1);}finally{await relay.close();}
});

test("native feature availability requires callable installed methods and current checks",async()=>{
 const f=fixture({model:{accountSpecific:true},sessions:{async preflight(){}}});const e=plugin.createNativeEmbedding(f.options);
 assert.equal((await plugin.nativeFeatureAvailability(e)).model,"unavailable");assert.equal((await plugin.nativeFeatureAvailability(e)).sessions,"unavailable");assert.equal((await plugin.nativeFeatureAvailability()).children,"unavailable");
});

test("prepared JSON cannot choose native executable verifier callbacks or sink",async()=>{
 const {nativeFixture}=await import("./helpers/continuation-fixture.mjs");const {writeFile}=await import("node:fs/promises");const f=await nativeFixture();
 try{for(const key of ["nativeEmbedding","nativePorts","nativeModule","nativeExecutable","nativeVerifier","nativeSink"]){await writeFile(f.configPath,JSON.stringify({...f.config,[key]:{module:"guest-controlled"}}));await assert.rejects(plugin.readPreparedConfig(f.configPath),/programmatic native/);}}finally{await f.close();}
});

test("doctor reports native egress and knowledge unavailable without trusting JSON claims",async()=>{
 const {nativeFixture}=await import("./helpers/continuation-fixture.mjs");const {execFile}=await import("node:child_process");const {promisify}=await import("node:util");const f=await nativeFixture();
 try{const {stdout}=await promisify(execFile)(process.execPath,["dist/protected-cli.js","doctor","--config",f.configPath,"--json"]);const doctor=JSON.parse(stdout);for(const id of ["native-model-egress","native-knowledge","native-pi-custody"]){const c=doctor.capabilities.find(c=>c.id===id);assert.equal(c?.status,"unavailable");assert.equal(c?.available,false);}assert.equal(f.counts().nativeCalls,0);}finally{await f.close();}
});

test("denied recovery selects opaque native semantic custody before linked continuation",async()=>{
 assert.equal(typeof plugin.prepareNativeContinuation,"function","native semantic custody acquisition missing");const nativeStep={};const calls=[];const f=fixture({recovery:{async selectSemanticStep(_p,id){assert.equal(id,"original");return nativeStep;},async invoke(command,step){assert.equal(step,nativeStep);calls.push(command);return {state:"completed"};}}});const e=plugin.createNativeEmbedding(f.options);const step=await plugin.prepareNativeContinuation(e,"original");assert.equal(JSON.stringify(step),"{}");assert.equal((await plugin.executeNativeRemedy(e,"denied",{kind:"linked_continuation",requestId:"original",step})).state,"completed");assert.equal(calls.length,1);
});

test("caller mutation cannot disable required governance after relay installation",async()=>{
 const original=globalThis.fetch;let remote=0;let releases=0;globalThis.fetch=(url,init)=>String(url).startsWith("http://127.0.0.1:")?original(url,init):(remote++,Promise.resolve(new Response("leak")));
 const relay=await governedRelay(fixture({model:{async releaseFrozenRequest(){releases++;return {state:"refused"};}}}));relay.governance.required=false;delete relay.governance.embedding;
 try{assert.equal((await send(relay)).status,502);assert.equal(remote,0);assert.equal(releases,1);}finally{await relay.close();globalThis.fetch=original;}
});

test("P2 rendering refuses unverified DTOs",()=>{
 assert.throws(()=>plugin.renderExplanation({projection:{summary:"no_disclosable_advice",candidates:[]}}),/verified explanation/);
});

test("native P2 explanation uses current time despite stale fixture time",async()=>{
 const {publicKey,privateKey}=generateKeyPairSync("ed25519");const key=publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");const past=Date.now()-60000;
 const body={schema:"chio.recovery.explanation-view.v1",version:1,planner_version:"chio.recovery.planner.v1",trust_domain:"domain",issuer:"issuer",recipient:"recipient",report_ref:"report",issued_at_unix_ms:past,expires_at_unix_ms:past+1000,projection:{summary:"no_disclosable_advice",candidates:[]}};
 const signed={body,authority_key:key,algorithm:"ed25519",signature:sign(null,Buffer.from("chio:recovery-explanation-view:v1\0"+canonicalJson(body)),privateKey).toString("hex")};const f=fixture({explanation:{async explain(){return signed;}}});f.options.explanationAuthority={authorityKey:key,trustDomain:"domain",issuer:"issuer",recipient:"recipient",now:past};
 await assert.rejects(plugin.explainNativeRecovery(plugin.createNativeEmbedding(f.options),"workflow"),/validity mismatch/);
});

test("A1-M3: required relay refuses incomplete native composition before listening", async () => {
 const {mkdtemp,realpath,rm}=await import("node:fs/promises");const {tmpdir}=await import("node:os");const {join}=await import("node:path");const {openRunBudget,DEFAULT_RUN_LIMITS}=await import("../dist/run-limits.js");
 const original=globalThis.fetch;let outbound=0;globalThis.fetch=(url,init)=>String(url).startsWith("http://127.0.0.1:")?original(url,init):(outbound++,Promise.resolve(new Response("leak")));
 const registry=createToolRegistry([]);const dir=await realpath(await mkdtemp(join(tmpdir(),"chio-incomplete-governance-")));
 const budget=await openRunBudget(join(dir,"budget"),{binding:{authorityDigest:"a".repeat(64),registryDigest:registry.digest,profileIdentity:"fixture",governanceProfile:"required"},limits:{...DEFAULT_RUN_LIMITS},provider:"openai",model:body.model,create:true});
 const f=fixture();const embedding=plugin.createNativeEmbedding({...f.options,providerProfile:budget.profile.identity,limitsIdentity:budget.identity});
 try{
  for(const [governance,selected] of [[{required:true},undefined],[{required:true},budget],[{required:true,embedding},undefined]])
   await assert.rejects(startModelRelay({provider:"openai",apiKey:"fixture"},body.model,undefined,registry,governance,selected).then(async relay=>{await relay.close();return relay;}),/native embedding and durable run budget/);
  assert.equal(outbound,0);assert.equal(f.deliveries.length,0);
 }finally{await budget.close();await rm(dir,{recursive:true,force:true});globalThis.fetch=original;}
});
