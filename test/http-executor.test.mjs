import {gatewayExecutor} from "../dist/http-executor.js";
import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync} from "node:crypto";
const sdk=await import(new URL("../node_modules/@chio-protocol/sdk/dist/invariants/index.js",import.meta.resolve("@chio/bridge")));
const {canonicalizeJson,sha256Hex,signUtf8MessageEd25519}=sdk;
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const signer=publicKey.export({type:"spki",format:"der"}).subarray(-32).toString("hex");
const seed=privateKey.export({type:"pkcs8",format:"der"}).subarray(-32).toString("hex");
const binding={subjectKey:"ab".repeat(32),capabilityId:"cap-guest",serverId:"fs",trustedSigners:[signer]};
const args={path:"/workspace/approved.txt"};
function outcome(requestId){
 const result={content:[{type:"text",text:"actual result"}],isError:false};
 const body={timestamp:1783000000,capability_id:binding.capabilityId,tool_server:"fs",tool_name:"read_text_file",
  action:{parameters:args,parameter_hash:sha256Hex(canonicalizeJson(args))},decision:{verdict:"allow"},
  receipt_kind:"mediated_decision",boundary_class:"prevent",trust_level:"mediated",tool_origin:"caller_executed",redaction_mode:"none",
  content_hash:sha256Hex(canonicalizeJson(result)),policy_hash:"cd".repeat(32),kernel_key:signer,
  metadata:{receipt_context:{request_id:requestId},attribution:{subject_key:binding.subjectKey},admission_operation:{schema:"chio.admission-receipt.v1",request_id:requestId,projected_state:"completed",projected_dispatch_state:"terminal",tool_outcome_id:"ef".repeat(32)}}};
 const id=sha256Hex(canonicalizeJson(body));
 const receipt={...body,id,signature:signUtf8MessageEd25519(canonicalizeJson({id,body}),seed).signature_hex};
 return {state:"completed",evidence:"verified",requestId,result,receipt,delivery:{schema:"chio.mcp.delivery-ack.v1",requestId,requestHash:"aa".repeat(32),receiptId:id,resultHash:body.content_hash,acknowledgement:"a".repeat(43)}};
}
for(const fault of ["none","result","stale-request","signature"]){
 test(`guest delivery verification: ${fault}`,async()=>{
  let calls=0,acks=0;
  const original=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{
   const rpc=JSON.parse(init.body);let result;
   if(rpc.method==="initialize") result={capabilities:{experimental:{chioDeliveryAcknowledgement:{version:"1"}}}};
   else if(rpc.method==="tools/list") result={tools:[{name:"read_text_file",inputSchema:{type:"object"}}]};
   else if(rpc.method==="chio/acknowledge"){acks++;result={schema:"chio.mcp.delivery-ack.v1",acknowledged:true,requestId:rpc.params.requestId,receiptId:rpc.params.receiptId};}
   else{calls++;const expected=`gateway:${createHash("sha256").update(JSON.stringify({id:`mcp-session:${JSON.stringify(rpc.id)}`})).digest("hex")}`;
    const value=outcome(fault==="stale-request"?"prior-valid-operation":expected);
    if(fault==="result")value.result={content:[{type:"text",text:"forged"}],isError:false};
    if(fault==="signature")value.receipt.signature="00".repeat(64);
    result={content:[{type:"text",text:JSON.stringify(value)}]};}
   return new Response(JSON.stringify({jsonrpc:"2.0",id:rpc.id,result}),{headers:{"mcp-session-id":"mcp-session"}});
  };
  try{const client=await gatewayExecutor({schema:"chio.pi.transport.v1",sessionId:"gateway",transport:{url:"http://127.0.0.1:12345/mcp",token:"local-test"},binding,tools:[{name:"read_text_file",inputSchema:{type:"object"}}],approvals:false});
   const request={sessionId:"host",toolCallId:"call",tool:"read_text_file",arguments:args};
   if(fault==="none")assert.equal((await client.executor.execute(request)).outcome,"completed");
   else{await assert.rejects(client.executor.execute(request));assert.equal(client.state.unresolved,true);await assert.rejects(client.executor.execute({...request,toolCallId:"replacement"}));}
   assert.equal(calls,1);assert.equal(acks,fault==="none"?1:0);
  }finally{globalThis.fetch=original;}
 });
}
