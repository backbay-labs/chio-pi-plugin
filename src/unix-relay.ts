import {createServer,createConnection,type Socket} from "node:net";
import {lstat,chmod,unlink} from "node:fs/promises";
import {dirname} from "node:path";
import {normalizedPath,ownedDirectory} from "./private-state.js";

export interface RelayBounds {maxConnections:number;maxQueuedBytes:number;idleTimeoutMs?:number}
export const DEFAULT_RELAY_BOUNDS:Readonly<Required<RelayBounds>>=Object.freeze({maxConnections:16,maxQueuedBytes:65536,idleTimeoutMs:120000});
const defaults=DEFAULT_RELAY_BOUNDS;
/** A relayed connection stays open at least as long as one provider request
 * may legitimately be silent, plus a margin for the relay's own response. */
export function relayBounds(providerTimeoutMs:number):Required<RelayBounds> {
  if(!Number.isSafeInteger(providerTimeoutMs) || providerTimeoutMs<1) throw new Error("Invalid provider timeout for relay bounds");
  return {...defaults,idleTimeoutMs:Math.min(2147483647,Math.max(defaults.idleTimeoutMs,providerTimeoutMs+10000))};
}
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
  const idle=bounds.idleTimeoutMs ?? defaults.idleTimeoutMs;
  if(!Number.isSafeInteger(bounds.maxConnections) || bounds.maxConnections<1 || bounds.maxConnections>64 || !Number.isSafeInteger(bounds.maxQueuedBytes) || bounds.maxQueuedBytes<1024 || bounds.maxQueuedBytes>1024*1024
    || !Number.isSafeInteger(idle) || idle<1 || idle>2147483647) throw new Error("Invalid relay queue bounds");
  const sockets=new Set<Socket>();let active=0;
  const server=createServer({allowHalfOpen:false},async incoming=>{
    if(active>=bounds.maxConnections){incoming.destroy();return;}active++;
    incoming.pause();sockets.add(incoming);let outgoing:Socket|undefined;let ended=false;
    const stop=()=>{if(ended)return;ended=true;active--;sockets.delete(incoming);if(outgoing)sockets.delete(outgoing);incoming.destroy();outgoing?.destroy();};
    // A side that ended cleanly closes only after its peer has flushed every
    // queued byte; the peer's idle timeout still bounds that wait.
    const drained=new Set<Socket>();
    const closed=(source:Socket,peer:()=>Socket|undefined)=>()=>{const target=peer();if(!drained.has(source) || !target || target.writableFinished){stop();return;}target.once("finish",stop);};
    incoming.on("error",stop);incoming.on("close",closed(incoming,()=>outgoing));incoming.setTimeout(idle,stop);
    try {outgoing=await destination();}catch{stop();return;}
    if(ended){outgoing.destroy();return;}sockets.add(outgoing);outgoing.on("error",stop);outgoing.on("close",closed(outgoing,()=>incoming));outgoing.setTimeout(idle,stop);
    // The queue bound, not the stream default, is the pause threshold. One read
    // may overshoot it; the source then stays paused until that write flushes,
    // so a queue holds less than the bound plus one read. A queue already over
    // the bound means pausing failed, and only then does the relay disconnect.
    const bridge=(source:Socket,target:Socket)=>{source.on("data",chunk=>{
      if(target.writableLength>bounds.maxQueuedBytes){stop();return;}
      const full=target.writableLength+chunk.length>=bounds.maxQueuedBytes;
      if(full)source.pause();
      target.write(chunk,error=>{if(full && !error && !ended)source.resume();});
    });source.on("end",()=>{drained.add(source);target.end();});};
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
