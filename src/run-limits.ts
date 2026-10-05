import {mkdir, rmdir, unlink, readFile, readlink} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {hostname} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {canonicalJson, frozenJson} from "./tool-registry.js";
import {normalizedPath, ownedDirectory, readPrivateJson, sha256, syncDirectory, writePrivateJson} from "./private-state.js";

export interface RunLimits {
  maxRequests: number; maxOutputTokens: number; maxTotalOutputTokens: number;
  providerTimeoutMs: number; maxResponseBytes: number; wallMs: number; killGraceMs: number;
}
export const DEFAULT_RUN_LIMITS: Readonly<RunLimits> = Object.freeze({maxRequests:32, maxOutputTokens:4096, maxTotalOutputTokens:131072, providerTimeoutMs:120000, maxResponseBytes:8*1024*1024, wallMs:1800000, killGraceMs:1000});
export interface RunBinding {authorityDigest: string; registryDigest: string; profileIdentity: string; governanceProfile: "execution-only" | "required"}
export const PROVIDER_PROFILES = Object.freeze({
  openai: Object.freeze({identity:"chio.pi.provider.openai.gpt-4.1-mini.v1", model:"gpt-4.1-mini", route:"https://api.openai.com/v1/responses", hardOutputTokens:true, minimumOutputTokens:16}),
  "openai-codex": Object.freeze({identity:"chio.pi.provider.openai-codex.gpt-5.5.v1", model:"gpt-5.5", route:"https://chatgpt.com/backend-api/codex/responses", hardOutputTokens:false, minimumOutputTokens:null}),
});
export type FixedProvider = keyof typeof PROVIDER_PROFILES;
export function providerProfile(provider: FixedProvider, model: string) {
  const profile=PROVIDER_PROFILES[provider];
  if (!profile || profile.model!==model) throw new Error("Unsupported fixed provider profile");
  return profile;
}
export function validateRunLimits(input: RunLimits): Readonly<RunLimits> {
  const names=Object.keys(DEFAULT_RUN_LIMITS) as (keyof RunLimits)[];
  if (Object.keys(input).length!==names.length || names.some(key=>!Number.isSafeInteger(input[key]) || input[key]<1)
    || input.maxOutputTokens<16 || input.maxTotalOutputTokens<16 || input.maxOutputTokens>32768
    || input.providerTimeoutMs>2147483647 || input.wallMs>2147483647 || input.killGraceMs>60000 || input.maxResponseBytes>64*1024*1024) throw new Error("Invalid run limit or supported token ceiling");
  return frozenJson(input);
}
interface RecordState {digest:string;schema:"chio.pi.run-limits.v1"; identity:string; deadline:number; usedRequests:number; reservedOutputTokens:number}
export interface RunBudget {
  readonly identity:string; readonly binding:Readonly<RunBinding>; readonly profile: ReturnType<typeof providerProfile>; readonly limits:Readonly<RunLimits>;
  readonly deadline:number; readonly remainingRequests:number; readonly remainingOutputTokens:number|null; readonly hardOutputTokenLimit:number|null;
  reserveRequest(body:Record<string,unknown>):Promise<void>;
  /** Record the spawned guest's isolated process group in the owner lock. */
  recordGuest(processGroup:number):Promise<void>; close():Promise<void>;
}
/** One trusted parent owns this private state for its lifetime. A lost owner can
 * be recovered only when the recorded local PID and its recorded guest process
 * group provably no longer exist. PID or group reuse conservatively refuses;
 * this lock is never a native journal fence. */
async function acquire(directory:string):Promise<{release:()=>Promise<void>;recordGuest:(processGroup:number)=>Promise<void>}> {
  const boot=process.platform==="linux" ? (await readFile("/proc/sys/kernel/random/boot_id","utf8")).trim()
    : process.platform==="darwin" ? execFileSync("/usr/sbin/sysctl",["-n","kern.bootsessionuuid"],{encoding:"utf8"}).trim() : "";
  if(!/^[a-f0-9-]{36}$/i.test(boot))throw new Error("Run owner host identity unavailable");
  const host=sha256(canonicalJson({hostname:hostname(),boot,pidNamespace:process.platform==="linux"?await readlink("/proc/self/ns/pid"):null}));
  const path=join(directory,"owner.json"); const nonce=randomUUID();
  const create=async()=>writePrivateJson(path,{schema:"chio.pi.run-owner.v1",pid:process.pid,nonce,host});
  try {await create();}
  catch (error) {
    if ((error as NodeJS.ErrnoException).code!=="EEXIST") throw error;
    const owner=await readPrivateJson(path) as {schema?:unknown;pid?:unknown;nonce?:unknown;host?:unknown;guestProcessGroup?:unknown};
    if (owner.host!==host)throw new Error("Run owner belongs to another host or PID namespace");
    if (owner.schema!=="chio.pi.run-owner.v1" || !Number.isSafeInteger(owner.pid) || Number(owner.pid)<1 || typeof owner.nonce!=="string"
      || owner.guestProcessGroup!==undefined && (!Number.isSafeInteger(owner.guestProcessGroup) || Number(owner.guestProcessGroup)<2)) throw new Error("Invalid run owner lock");
    try {process.kill(Number(owner.pid),0); throw new Error("Run budget has an active owner lock");}
    catch (check) {if ((check as NodeJS.ErrnoException).code!=="ESRCH") throw check;}
    // A parent killed without cleanup can leave its detached guest running with
    // profile write access. Only proven group absence admits a second owner.
    const guestGone=(group:unknown)=>{
      if(group===undefined) return;
      try {process.kill(-Number(group),0);}
      catch (check) {if((check as NodeJS.ErrnoException).code==="ESRCH") return;}
      throw new Error(`Run owner's guest process group ${group} still exists or is unverifiable; stop it before recovery`);
    };
    guestGone(owner.guestProcessGroup);
    const recovery=join(directory,"owner-recovery");
    try {await mkdir(recovery,{mode:0o700});}
    catch {throw new Error("Run owner recovery lock unavailable");}
    try {
      const current=await readPrivateJson(path) as {nonce?:unknown;pid?:unknown;host?:unknown;guestProcessGroup?:unknown};
      if(current.host!==host || current.nonce!==owner.nonce || current.pid!==owner.pid || current.guestProcessGroup!==owner.guestProcessGroup)throw new Error("Run owner lock changed during recovery");
      try {process.kill(Number(current.pid),0);throw new Error("Run owner lock is active");}
      catch (check) {if((check as NodeJS.ErrnoException).code!=="ESRCH")throw check;}
      guestGone(current.guestProcessGroup);
      await unlink(path);await syncDirectory(directory);await create();
    } finally {await rmdir(recovery);await syncDirectory(directory);}
  }
  const owned=async()=>{const current=await readPrivateJson(path) as Record<string,unknown>; if(current.nonce!==nonce) throw new Error("Run owner lock changed"); return current;};
  return {
    release:async()=>{await owned(); await unlink(path); await syncDirectory(directory);},
    recordGuest:async(processGroup:number)=>{
      if(!Number.isSafeInteger(processGroup) || processGroup<2) throw new Error("Invalid guest process group");
      await writePrivateJson(path,{...await owned(),guestProcessGroup:processGroup},true);
    },
  };
}
export async function openRunBudget(directory:string, options:{binding:RunBinding;limits:RunLimits;provider:FixedProvider;model:string;create?:boolean}):Promise<RunBudget> {
  normalizedPath(directory);
  const limits=validateRunLimits(options.limits); const profile=providerProfile(options.provider,options.model); const binding=frozenJson(options.binding);
  if (Object.keys(binding).length!==4 || !/^[a-f0-9]{64}$/.test(binding.authorityDigest) || !/^[a-f0-9]{64}$/.test(binding.registryDigest)
    || typeof binding.profileIdentity!=="string" || !binding.profileIdentity || binding.profileIdentity.length>4096 || !["execution-only","required"].includes(binding.governanceProfile)) throw new Error("Invalid run binding");
  const bindingIdentity=sha256(canonicalJson({schema:"chio.pi.run-binding.v1",binding,profile:profile.identity,limits}));
  const deadlineIdentity=(deadline:number)=>sha256(canonicalJson({bindingIdentity,deadline}));
  const seal=(value:Omit<RecordState,"digest">):RecordState=>({...value,digest:sha256(canonicalJson(value))});
  if(options.create) {try {await mkdir(directory,{mode:0o700});} catch(e) {if((e as NodeJS.ErrnoException).code!=="EEXIST") throw e;}}
  const canonical=await ownedDirectory(directory); if(canonical!==directory) throw new Error("Run state path contains a symlink");
  const {release,recordGuest}=await acquire(directory); const path=join(directory,"run.json");
  let state:RecordState; let closed=false, failed=false; let serial=Promise.resolve();
  const read=async()=>{
    const value=await readPrivateJson(path,8192) as RecordState;
    const {digest,...original}=value;
    if (Object.keys(value).length!==6 || value.schema!=="chio.pi.run-limits.v1" || value.identity!==deadlineIdentity(value.deadline) || digest!==sha256(canonicalJson(original))) throw new Error("Run state integrity or binding mismatch or corruption");
    if (![value.deadline,value.usedRequests,value.reservedOutputTokens].every(Number.isSafeInteger) || value.deadline<1 || value.usedRequests<0 || value.usedRequests>limits.maxRequests
      || value.reservedOutputTokens<0 || value.reservedOutputTokens>limits.maxTotalOutputTokens || !profile.hardOutputTokens && value.reservedOutputTokens!==0) throw new Error("Run state corrupt counters");
    return value;
  };
  try {
    if(options.create) {
      const deadline=Date.now()+limits.wallMs; if(!Number.isSafeInteger(deadline)) throw new Error("Invalid absolute deadline");
      // Exclusive publication prevents explicit first-create from resetting state.
      await writePrivateJson(path,seal({schema:"chio.pi.run-limits.v1",identity:deadlineIdentity(deadline),deadline,usedRequests:0,reservedOutputTokens:0}));
    }
    state=await read();
  } catch(error) {await release(); throw error;}
  return Object.freeze({
    get identity(){return state.identity;},binding,profile,limits,
    get deadline(){return state.deadline;}, get remainingRequests(){return limits.maxRequests-state.usedRequests;},
    get remainingOutputTokens(){return profile.hardOutputTokens?limits.maxTotalOutputTokens-state.reservedOutputTokens:null;},
    get hardOutputTokenLimit(){return profile.hardOutputTokens?limits.maxOutputTokens:null;},
    reserveRequest(body:Record<string,unknown>) {
      const operation=serial.then(async()=>{
        if(closed || failed) throw new Error("Run budget closed or storage fenced");
        try {const disk=await read(); if(canonicalJson(disk)!==canonicalJson(state)) throw new Error("Run state changed");}
        catch {failed=true; throw new Error("Run state storage failure; reservations fenced");}
        if(Date.now()>=state.deadline || state.usedRequests>=limits.maxRequests) throw new Error("Run deadline or request limit exhausted");
        let tokens=0;
        if(profile.hardOutputTokens) {
          const requested=body.max_output_tokens ?? limits.maxOutputTokens;
          if(!Number.isSafeInteger(requested) || Number(requested)<16) throw new Error("Invalid supported output token ceiling");
          tokens=Math.min(Number(requested),limits.maxOutputTokens,limits.maxTotalOutputTokens-state.reservedOutputTokens);
          if(tokens<16) throw new Error("Output token budget limit exhausted");
        }
        const {digest,...original}=state;
        const next=seal({...original,usedRequests:state.usedRequests+1,reservedOutputTokens:state.reservedOutputTokens+tokens});
        // Never roll a reservation back, including an ambiguous fsync failure.
        try {await writePrivateJson(path,next,true); state=next;}
        catch {failed=true; throw new Error("Run state storage failure; reservations fenced");}
        if(profile.hardOutputTokens) body.max_output_tokens=tokens; else delete body.max_output_tokens;
      });
      serial=operation.catch(()=>{}); return operation;
    },
    async recordGuest(processGroup:number){if(closed) throw new Error("Run budget closed"); await recordGuest(processGroup);},
    async close(){await serial; if(!closed){closed=true; await release();}},
  });
}
