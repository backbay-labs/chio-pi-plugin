import {constants} from "node:fs";
import {access,lstat,open,readdir,readlink,realpath} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {createHash} from "node:crypto";
import {isWithin} from "./sandbox.js";
import {normalizedPath,ownedDirectory} from "./private-state.js";
import {validateRelaySocket} from "./unix-relay.js";

export interface LinuxRuntimeFile {path:string;mountPath:string;sha256:string}
export interface LinuxRuntime {schema:"chio.pi.linux-runtime.v1";architecture:"arm64"|"x64";node:string;nodeSha256:string;runtimeFiles:LinuxRuntimeFile[]}
/** A selected installed closure has no other host-service leaf. A symlink must
 * resolve inside this very closure, including every intermediate component. */
export async function auditMountClosure(root:string):Promise<void> {
  normalizedPath(root);if(await realpath(root)!==root)throw new Error("Selected mount closure root contains a link");
  let count=0;const pending=[root];
  while(pending.length){const path=pending.pop()!;if(++count>150000)throw new Error("Selected mount closure exceeds entry bound");const stat=await lstat(path);
    if(stat.isSymbolicLink()){
      const target=resolve(dirname(path),await readlink(path));
      if(!isWithin(root,target) || !isWithin(root,await realpath(path)))throw new Error("Selected mount closure has an escaping link");
      // Traverse each lexical target prefix too: a contained final target may
      // otherwise route through a link outside the admitted namespace.
      let prefix=root;for(const part of target.slice(root.length).split('/').filter(Boolean)){prefix=join(prefix,part);if(!isWithin(root,await realpath(prefix)))throw new Error("Selected mount closure has an escaping intermediate link");}
    }else if(stat.isDirectory()){for(const name of await readdir(path))pending.push(join(path,name));}
    else if(!stat.isFile())throw new Error("Selected mount closure includes a socket or special file");
  }
}
async function pinnedFile(path:string,hash:string,executable=false){
  normalizedPath(path);if(!/^[a-f0-9]{64}$/.test(hash))throw new Error("Invalid runtime hash pin");
  const stat=await lstat(path);if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1 || stat.size>256*1024*1024 || await realpath(path)!==path)throw new Error("Runtime pin requires a bounded regular file without links");
  if(executable)await access(path,constants.X_OK);
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const before=await file.stat();if(before.ino!==stat.ino || before.dev!==stat.dev)throw new Error("Runtime pin changed");const bytes=await file.readFile();const after=await file.stat();if(bytes.length!==stat.size || after.size!==stat.size || after.mtimeMs!==stat.mtimeMs || after.ctimeMs!==stat.ctimeMs || createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error("Operator-selected runtime pin changed");}finally{await file.close();}
}
export interface LinuxGuestOptions {runtime:LinuxRuntime;installation:string;profile:string;cwd:string;gatewaySocket:string;modelSocket:string;gatewayPort:number;modelPort:number;bootstrap:string;argv:string[];environment:Record<string,string>}
export async function prepareLinuxGuest(options:LinuxGuestOptions) {
  if(process.platform!=="linux")throw new Error("Whole-Pi bubblewrap requires Linux");
  const launcher="/usr/bin/bwrap";const launcherStat=await lstat(launcher);
  if(!launcherStat.isFile() || launcherStat.isSymbolicLink())throw new Error("Regular bubblewrap launcher required");await access(launcher,constants.X_OK);
  const r=options.runtime;
  if(!r || Object.keys(r).length!==5 || r.schema!=="chio.pi.linux-runtime.v1" || r.architecture!==process.arch || !Array.isArray(r.runtimeFiles) || !r.runtimeFiles.length || r.runtimeFiles.length>64)throw new Error("Actual architecture-pinned Linux runtime manifest required");
  await pinnedFile(r.node,r.nodeSha256,true);
  await auditMountClosure(options.installation);await auditMountClosure(options.profile);
  for(const path of [options.profile,options.cwd])if(await ownedDirectory(path)!==path)throw new Error("Private guest directory contains a link");
  const isolated=[options.profile,options.cwd];
  for(const path of isolated)if(isWithin(options.installation,path) || isWithin(path,options.installation))throw new Error("Guest writable paths overlap installed code");
  if(isWithin(options.profile,options.cwd)||isWithin(options.cwd,options.profile))throw new Error("Guest profile and disposable cwd overlap");
  if(!isWithin(options.installation,options.bootstrap) || !(await lstat(options.bootstrap)).isFile())throw new Error("Installed guest bootstrap required");
  await validateRelaySocket(options.gatewaySocket);await validateRelaySocket(options.modelSocket);
  if(options.gatewaySocket===options.modelSocket || options.gatewayPort===options.modelPort)throw new Error("Exactly two distinct fixed relay routes required");
  for(const port of [options.gatewayPort,options.modelPort])if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error("Invalid fixed guest relay port");
  const destinations=new Set([r.node]);const runtimeFiles:LinuxRuntimeFile[]=[];
  for(const f of r.runtimeFiles){
    if(Object.keys(f).length!==3)throw new Error("Closed runtime file pin required");normalizedPath(f.mountPath);
    if(destinations.has(f.mountPath) || ["/proc","/dev","/tmp","/run",...isolated,options.installation].some(path=>isWithin(path,f.mountPath)||isWithin(f.mountPath,path)))throw new Error("Runtime mount destination overlaps guest boundary");
    await pinnedFile(f.path,f.sha256);destinations.add(f.mountPath);runtimeFiles.push({...f});
  }
  for(const path of [r.node,...runtimeFiles.map(f=>f.path),options.installation])for(const excluded of [...isolated,dirname(options.gatewaySocket),dirname(options.modelSocket)])if(isWithin(path,excluded)||isWithin(excluded,path))throw new Error("Selected code/runtime overlaps private guest or relay state");
  const args=["--unshare-all","--unshare-user","--die-with-parent","--new-session","--clearenv","--cap-drop","ALL", "--tmpfs","/tmp","--proc","/proc","--dev","/dev"];
  const dirs=new Set<string>(["/tmp","/proc","/dev","/run","/run/relays",options.profile,options.cwd,options.installation]);
  for(const target of [r.node,...runtimeFiles.map(f=>f.mountPath),options.installation,options.profile,options.cwd]){let path=dirname(target);while(path!=="/"){dirs.add(path);path=dirname(path);}}
  for(const path of [...dirs].sort((a,b)=>a.length-b.length || a.localeCompare(b)))args.push("--dir",path);
  args.push("--ro-bind",r.node,r.node,"--ro-bind",options.installation,options.installation,"--bind",options.profile,options.profile,"--tmpfs",options.cwd,"--chmod","0700","/run/relays");
  for(const f of runtimeFiles)args.push("--ro-bind",f.path,f.mountPath);
  args.push("--ro-bind",options.gatewaySocket,"/run/relays/gateway.sock","--ro-bind",options.modelSocket,"/run/relays/model.sock");
  for(const [key,value] of Object.entries(options.environment)){if(!/^[A-Z][A-Z0-9_]*$/.test(key)||value.includes('\0'))throw new Error("Invalid minimal guest environment");args.push("--setenv",key,value);}
  args.push("--setenv","CHIO_PI_GATEWAY_SOCKET","/run/relays/gateway.sock","--setenv","CHIO_PI_MODEL_SOCKET","/run/relays/model.sock","--setenv","CHIO_PI_GATEWAY_PORT",String(options.gatewayPort),"--setenv","CHIO_PI_MODEL_PORT",String(options.modelPort),"--chdir",options.cwd,"--seccomp","3","--",r.node,options.bootstrap,...options.argv);
  return {launcher,args,seccomp:wholeGuestFilter(r.architecture),profile:"chio.pi.linux-whole-guest.v1",architecture:r.architecture};
}
/** Distinct from the socket-denying recipe filter. Installed only at bwrap's
 * final FD3 stage, after it creates namespaces and activates loopback. */
export function wholeGuestFilter(architecture:"arm64"|"x64"=process.arch as "arm64"|"x64"):Buffer {
  const profiles={arm64:{arch:0xc00000b7,clone:220,socket:198,socketpair:199,denied:[97,268,40,39,41,425]},x64:{arch:0xc000003e,clone:56,socket:41,socketpair:53,denied:[57,58,272,308,165,166,155,425]}};
  const p=profiles[architecture];if(!p)throw new Error("Whole guest seccomp architecture unsupported");
  const ins:[number,number,number,number][]=[];const labels=new Map<string,number>();const jumps:{index:number;yes:string;no:string}[]=[];
  const load=(offset:number)=>ins.push([0x20,0,0,offset]),ret=(value:number)=>ins.push([0x06,0,0,value]);
  const eq=(value:number,yes:string,no:string)=>{jumps.push({index:ins.length,yes,no});ins.push([0x15,0,0,value]);};
  const label=(name:string)=>labels.set(name,ins.length);
  load(4);eq(p.arch,"nr","kill");label("kill");ret(0x80000000);label("nr");load(0);
  if(architecture==="x64")ins.push([0x45,0,1,0x40000000],[0x06,0,0,0x50001]);
  for(const nr of p.denied)ins.push([0x15,0,1,nr],[0x06,0,0,0x50001]);
  ins.push([0x15,0,1,435],[0x06,0,0,0x50026]);
  eq(p.clone,"clone","socket-check");label("socket-check");eq(p.socket,"socket","socketpair-check");label("socketpair-check");eq(p.socketpair,"socket","allow");
  label("clone");load(20);eq(0,"clone-low","deny");label("clone-low");load(16);ins.push([0x45,0,1,0x7e020080],[0x06,0,0,0x50001]);ins.push([0x54,0,0,0x10000]);eq(0x10000,"allow","deny");
  label("socket");load(16);eq(1,"socket-type","inet-check");label("inet-check");eq(2,"socket-type","deny");label("socket-type");load(24);ins.push([0x54,0,0,~(0x80000|0x800)>>>0]);eq(1,"socket-protocol","deny");label("socket-protocol");load(32);eq(0,"allow","tcp-check");label("tcp-check");eq(6,"allow","deny");
  label("deny");ret(0x50001);label("allow");ret(0x7fff0000);
  for(const j of jumps){const instruction=ins[j.index];instruction[1]=labels.get(j.yes)!-j.index-1;instruction[2]=labels.get(j.no)!-j.index-1;if(instruction[1]<0 || instruction[2]<0 || instruction[1]>255 || instruction[2]>255)throw new Error("Invalid whole guest BPF jump");}
  const bytes=Buffer.alloc(ins.length*8);ins.forEach(([code,jt,jf,k],i)=>{bytes.writeUInt16LE(code,i*8);bytes[i*8+2]=jt;bytes[i*8+3]=jf;bytes.writeUInt32LE(k,i*8+4);});return bytes;
}
