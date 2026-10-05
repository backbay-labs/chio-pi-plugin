import {createServer,createConnection,type Socket} from "node:net";
import {lstat,chmod,unlink} from "node:fs/promises";
import {dirname} from "node:path";
import {normalizedPath,ownedDirectory} from "./private-state.js";

export interface RelayBounds {maxConnections:number;maxQueuedBytes:number}
const defaults:Readonly<RelayBounds>=Object.freeze({maxConnections:16,maxQueuedBytes:65536});
export async function validateRelaySocket(path:string) {
  await socketParent(path);
  const stat=await lstat(path);
  if(!stat.isSocket() || stat.isSymbolicLink() || stat.mode&0o077 || stat.uid!==process.getuid?.() || stat.nlink!==1) throw new Error("Private parent-owned relay socket required");
  return stat;
}
async function socketParent(path:string) {
  normalizedPath(path);
  // Darwin's sockaddr_un has 104 bytes including its terminator. Use the
  // conservative common bound; never truncate or hash into colliding names.
  if(Buffer.byteLength(path)>100) throw new Error("Unix relay socket path exceeds platform length");
  if(await ownedDirectory(dirname(path))!==dirname(path)) throw new Error("Relay socket parent path contains a link");
}
function fixedPort(port:number) {if(!Number.isSafeInteger(port) || port<1 || port>65535) throw new Error("Invalid fixed relay port");}
async function start(address:string|number, destination:()=>Socket|Promise<Socket>,bounds:RelayBounds,cleanup?:()=>Promise<void>) {
  if(!Number.isSafeInteger(bounds.maxConnections) || bounds.maxConnections<1 || bounds.maxConnections>64 || !Number.isSafeInteger(bounds.maxQueuedBytes) || bounds.maxQueuedBytes<1024 || bounds.maxQueuedBytes>1024*1024) throw new Error("Invalid relay queue bounds");
  const sockets=new Set<Socket>();let active=0;
  const server=createServer({allowHalfOpen:false},async incoming=>{
    if(active>=bounds.maxConnections){incoming.destroy();return;}active++;
    incoming.pause();sockets.add(incoming);let outgoing:Socket|undefined;let ended=false;
    const stop=()=>{if(ended)return;ended=true;active--;sockets.delete(incoming);if(outgoing)sockets.delete(outgoing);incoming.destroy();outgoing?.destroy();};
    incoming.on("error",stop);incoming.on("close",stop);incoming.setTimeout(120000,stop);
    try {outgoing=await destination();}catch{stop();return;}
    if(ended){outgoing.destroy();return;}sockets.add(outgoing);outgoing.on("error",stop);outgoing.on("close",stop);outgoing.setTimeout(120000,stop);
    // Pause before writes grow the userspace queue. A single accepted chunk
    // cannot exceed this bound and both directions share disconnect cleanup.
    const bridge=(source:Socket,target:Socket)=>{source.on("data",chunk=>{
      if(chunk.length+target.writableLength>bounds.maxQueuedBytes){stop();return;}
      if(!target.write(chunk)){source.pause();target.once("drain",()=>{if(!ended)source.resume();});}
    });source.on("end",()=>target.end());};
    bridge(incoming,outgoing);bridge(outgoing,incoming);incoming.resume();
  });
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);if(typeof address==="string")server.listen(address,resolve);else server.listen(address,"127.0.0.1",resolve);});
  return {get activeConnections(){return active;},async close(){for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));await cleanup?.();}};
}
/** Parent-owned destination. Guest bytes cannot select a host, port or socket.
 * HTTP route/method/Host/authentication policy is enforced again by the fixed
 * gateway proxy or model service, including CONNECT/redirect refusal. */
export async function createUnixRelay(socketPath:string,fixedLoopbackPort:number,bounds:RelayBounds=defaults) {
  fixedPort(fixedLoopbackPort);await socketParent(socketPath);
  try {await lstat(socketPath);throw new Error("Relay socket already exists");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  let identity:Awaited<ReturnType<typeof lstat>>|undefined;
  const relay=await start(socketPath,()=>createConnection({host:"127.0.0.1",port:fixedLoopbackPort}),bounds,async()=>{
    const current=await lstat(socketPath).catch(()=>undefined);
    if(current && identity && current.ino===identity.ino && current.dev===identity.dev) await unlink(socketPath);
  });
  try{await chmod(socketPath,0o600);identity=await validateRelaySocket(socketPath);return relay;}catch(error){await relay.close();throw error;}
}
/** Guest binds the parent's expected HTTP Host port, in its private network
 * namespace, and reaches exactly its selected mounted Unix socket leaf. */
export async function createLoopbackRelay(socketPath:string,expectedPort:number,bounds:RelayBounds=defaults) {
  fixedPort(expectedPort);const identity=await validateRelaySocket(socketPath);
  return start(expectedPort,async()=>{
    const current=await validateRelaySocket(socketPath);
    if(current.dev!==identity.dev || current.ino!==identity.ino)throw new Error("Selected relay socket identity changed");
    return createConnection({path:socketPath});
  },bounds);
}
