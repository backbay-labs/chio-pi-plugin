import assert from "node:assert/strict";
import test from "node:test";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import * as cli from "../dist/protected-cli.js";
import {pinHostRegistry} from "../dist/configured.js";
import {createToolRegistry} from "../dist/index.js";
const args=["--config","/missing-config","--profile","/missing-profile","--cwd","/missing-cwd","--provider","openai","--model","gpt-4.1-mini","--prompt","task"];
const config={sessionId:"host",execution:{sessionId:"kernel",endpoint:"http://127.0.0.1:1/mcp",subjectKey:"ab".repeat(32),capabilityId:"cap",serverId:"server",trustedSigners:["cd".repeat(32)]},tools:[{name:"read",inputSchema:{type:"object"}}]};
const run=extra=>promisify(execFile)(process.execPath,["dist/protected-cli.js",...args,...extra],{env:{PATH:process.env.PATH}});

test("protected operator parser defaults to execution-only and closes governance selection",()=>{
 assert.equal(typeof cli.parseProtectedLaunchArguments,"function");
 assert.equal(cli.parseProtectedLaunchArguments(args).governanceProfile,"execution-only");
 for(const profile of ["execution-only","required"])assert.equal(cli.parseProtectedLaunchArguments([...args,"--governance",profile]).governanceProfile,profile);
 for(const extra of [["--governance","automatic"],["--governance",""],["--governance","required","--governance","execution-only"],["--governance"]])assert.throws(()=>cli.parseProtectedLaunchArguments([...args,...extra]),/governance|argument/i);
});

test("execution-only default launch progresses to existing credential or platform checks",async()=>{
 const expected=process.platform==="darwin"
  ? /Operator OPENAI_API_KEY required/
  : process.platform==="linux"
   ? /Protected Linux candidate requires --linux-runtime pins/
   : /Protected candidate requires macOS sandbox-exec or Linux bubblewrap/;
 for(const extra of [[],["--governance","execution-only"]])await assert.rejects(run(extra),error=>expected.test(error.stderr));
});

test("required and invalid CLI governance refuse before credential or path access",async()=>{
 await assert.rejects(run(["--governance","required"]),error=>/native.*governance.*unavailable/i.test(error.stderr));
 await assert.rejects(run(["--governance","automatic"]),error=>/governance profile/i.test(error.stderr));
});

test("trusted resume binding prevents either governance profile switch",async()=>{
 const registry=createToolRegistry(config.tools);
 for(const initial of ["execution-only","required"]){const dir=await mkdtemp(join(tmpdir(),"chio-governance-binding-"));try{
  await pinHostRegistry(config,registry,dir,initial);const path=join(dir,"pi-host.binding");const before=await readFile(path,"utf8");assert.equal(JSON.parse(before).governanceProfile,initial);
  await pinHostRegistry(config,registry,dir,initial);
  await assert.rejects(pinHostRegistry(config,registry,dir,initial==="required"?"execution-only":"required"),/binding|governance/);
  await assert.rejects(pinHostRegistry(config,registry,dir,"automatic"),/governance/);assert.equal(await readFile(path,"utf8"),before);
 }finally{await rm(dir,{recursive:true,force:true});}}
});

test("historical absent governance bindings retain execution-only without implicit upgrade",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"chio-legacy-governance-binding-"));const registry=createToolRegistry(config.tools);try{
  await pinHostRegistry(config,registry,dir);const path=join(dir,"pi-host.binding");const previous=JSON.parse(await readFile(path,"utf8"));delete previous.governanceProfile;const text=JSON.stringify(previous);await writeFile(path,text);
  await pinHostRegistry(config,registry,dir,"execution-only");assert.equal(await readFile(path,"utf8"),text);
  await assert.rejects(pinHostRegistry(config,registry,dir,"required"),/binding|governance/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test("operator diagnostics validate both governance bindings and historical execution-only",async()=>{
 const {nativeFixture}=await import("./helpers/continuation-fixture.mjs");const f=await nativeFixture();const path=join(f.config.journalDir,"pi-host.binding");const binding=JSON.parse(await readFile(path,"utf8"));
 const diagnose=()=>promisify(execFile)(process.execPath,["dist/protected-cli.js","doctor","--config",f.configPath,"--json"],{env:{PATH:process.env.PATH}});
 try {
  for(const profile of ["execution-only","required",undefined]){const previous={...binding};if(profile===undefined)delete previous.governanceProfile;else previous.governanceProfile=profile;const text=JSON.stringify(previous);await writeFile(path,text);assert.equal(JSON.parse((await diagnose()).stdout).schema,"chio.pi.operator.doctor.v1");assert.equal(await readFile(path,"utf8"),text);}
  await writeFile(path,JSON.stringify({...binding,governanceProfile:"automatic"}));await assert.rejects(diagnose(),error=>/host_binding_mismatch/.test(error.stderr));assert.equal(f.counts().nativeCalls,0);
 }finally{await f.close();}
});

test('operator limits and Linux runtime pins are optional closed operator selections',()=>{
 const selected=cli.parseProtectedLaunchArguments([...args,'--limits','/private/limits.json','--linux-runtime','/private/runtime.json']);
 assert.equal(selected.values.get('--limits'),'/private/limits.json');
 assert.equal(selected.values.get('--linux-runtime'),'/private/runtime.json');
 assert.throws(()=>cli.parseProtectedLaunchArguments([...args,'--limits','x','--limits','y']),/argument/);
});
