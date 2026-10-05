import assert from "node:assert/strict";
import test from "node:test";
import * as plugin from "../dist/index.js";
const binding={authorityDomain:"domain",tenant:"tenant",process:"parent",runtime:"runtime",lineage:"lineage",isolationEpoch:"epoch",policy:"policy",contracts:"contracts",installGeneration:"generation"};
function fixture(children){return plugin.createNativeEmbedding({expectedBinding:binding,ports:{async currentInstallation(){return {binding,expiresAt:Date.now()+10000};},children},process:{},context:{},history:[],sink:{},templates:{worker:{}},providerProfile:"profile",credentialGeneration:"credential",limitsIdentity:"limits",purpose:"purpose"});}
test("missing native child authority cannot launch",async()=>{assert.equal(typeof plugin.submitNativeChild,"function","native child submission missing");await assert.rejects(plugin.submitNativeChild(fixture(),"worker",{requestId:"original",payload:{}}),/unavailable/);});
test("native widening refusal gives zero launches and unknown original never relaunches",async()=>{assert.equal(typeof plugin.submitNativeChild,"function","native child submission missing");let launches=0;let submissions=0;const e=fixture({async submit(){submissions++;return {state:"refused",reason:"scope widening"};},async reconcile(){return {state:"unresolved"};},async cancel(){return {state:"unresolved"};}});assert.equal((await plugin.submitNativeChild(e,"worker",{requestId:"original",payload:{}})).state,"refused");assert.equal(launches,0);assert.equal((await plugin.reconcileNativeChild(e,"original")).state,"unresolved");assert.equal(submissions,1);assert.equal((await plugin.cancelNativeChild(e,"original")).state,"unresolved");});
test("substituted or request-selected child templates refuse before native submit",async()=>{assert.equal(typeof plugin.submitNativeChild,"function","native child submission missing");let submissions=0;const e=fixture({async submit(){submissions++;return {state:"completed"};}});await assert.rejects(plugin.submitNativeChild(e,"evil",{requestId:"original",payload:{}}));await assert.rejects(plugin.submitNativeChild(e,"worker",{requestId:"original",payload:{},executable:"/bin/sh"}));assert.equal(submissions,0);});

test("request data cannot override installed executable environment or confinement",async()=>{let submissions=0;const e=fixture({async submit(){submissions++;return {state:"completed"};}});for(const key of ["executable","argv","env","packages","confinement","template"])await assert.rejects(plugin.submitNativeChild(e,"worker",{requestId:key,payload:{[key]:"chosen-by-caller"}}));assert.equal(submissions,0);});

test("native child observations reject verified flags without native outcome state",async()=>{const e=fixture({async submit(){return {verified:true};},async reconcile(){return {verified:true};},async cancel(){return {verified:true};}});await assert.rejects(plugin.submitNativeChild(e,"worker",{requestId:"original",payload:{}}),/native child observation/);await assert.rejects(plugin.reconcileNativeChild(e,"original"),/native child observation/);});

// Scripted native-facade contract fixture. Crypto, retained-state and launch
// observers are independent, but this does not qualify a native process host.
test("native child fixture retains signed parent and budget binding before its launch observer",async()=>{
 const {generateKeyPairSync,sign,verify}=await import("node:crypto");const {canonicalJson}=await import("../dist/tool-registry.js");
 const root=generateKeyPairSync("ed25519"),foreign=generateKeyPairSync("ed25519");
 for(const mode of ["missing","widening","issuer","budget-reset","signature","registry","accounting","template","valid"]){
  const events=[];const registry=new Map();const nativeTemplate={};const expected={issuer:"native-issuer",budgetFamily:"parent-family",parent:"parent",scope:["read"],expires:100};
  const body={issuer:mode==="issuer"?"other":expected.issuer,budgetFamily:mode==="budget-reset"?"fresh-budget":expected.budgetFamily,parent:expected.parent,requestId:"original",scope:mode==="widening"?["read","write"]:["read"],expires:90,hops:1};
  const signature=sign(null,Buffer.from(canonicalJson(body)),mode==="signature"?foreign.privateKey:root.privateKey);
  let launches=0;const children={async submit(_parent,template,request){
   if(mode==="missing"||!verify(null,Buffer.from(canonicalJson(body)),root.publicKey,signature)||body.issuer!==expected.issuer||body.budgetFamily!==expected.budgetFamily||body.parent!==expected.parent||body.requestId!==request.requestId||body.hops!==1||body.expires>expected.expires||body.scope.some(scope=>!expected.scope.includes(scope))||mode==="template"||template!==nativeTemplate)return {state:"refused"};
   if(mode!=="registry")registry.set(request.requestId,{body,signature,budget:expected.budgetFamily});events.push("retained");
   if(!registry.has(request.requestId)||mode==="accounting")return {state:"refused"};events.push("accounting-checked");launches++;events.push("confined-launch");return {state:"completed"};
  },async reconcile(){return {state:"unresolved"};},async cancel(){return {state:"unresolved"};}};
  const e=plugin.createNativeEmbedding({expectedBinding:binding,ports:{async currentInstallation(){return {binding,expiresAt:Date.now()+10000};},children},process:{},context:{},history:[],sink:{},templates:{worker:nativeTemplate},providerProfile:"profile",credentialGeneration:"credential",limitsIdentity:"limits",purpose:"purpose"});
  assert.equal((await plugin.submitNativeChild(e,"worker",{requestId:"original",payload:{task:"bounded"}})).state,mode==="valid"?"completed":"refused");assert.equal(launches,mode==="valid"?1:0);
  if(mode==="valid")assert.deepEqual(events,["retained","accounting-checked","confined-launch"]);
  await plugin.reconcileNativeChild(e,"original");await plugin.cancelNativeChild(e,"original");await assert.rejects(plugin.submitNativeChild(e,"worker",{requestId:"original",payload:{task:"bounded"}}),/reconcile without relaunch/);assert.equal(launches,mode==="valid"?1:0);
 }
});
