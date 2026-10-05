#!/usr/bin/env node
import {createLoopbackRelay,DEFAULT_RELAY_BOUNDS} from "./unix-relay.js";
import {GUEST_SECRET_FD,readGuestSecrets} from "./guest-secrets.js";

// This is the one final Node exec. Both relays and native Pi SDK run here;
// the no-fork seccomp profile does not require helper child processes.
const relays:Awaited<ReturnType<typeof createLoopbackRelay>>[]=[];
let secrets:string[]=[];
try {
  // Bearer secrets arrive on an inherited descriptor, read before the CLI loads.
  if(process.env.CHIO_PI_SECRET_FD!==undefined){
    if(process.env.CHIO_PI_SECRET_FD!==String(GUEST_SECRET_FD))throw new Error("Unexpected guest secret descriptor");
    delete process.env.CHIO_PI_SECRET_FD;
    const values=readGuestSecrets();secrets=Object.values(values);Object.assign(process.env,values);
  }
  // The parent derives the relay idle bound from the provider timeout.
  const bounds={...DEFAULT_RELAY_BOUNDS,...(process.env.CHIO_PI_RELAY_IDLE_MS===undefined?{}:{idleTimeoutMs:Number(process.env.CHIO_PI_RELAY_IDLE_MS)})};
  relays.push(await createLoopbackRelay(process.env.CHIO_PI_GATEWAY_SOCKET!,Number(process.env.CHIO_PI_GATEWAY_PORT),bounds));
  relays.push(await createLoopbackRelay(process.env.CHIO_PI_MODEL_SOCKET!,Number(process.env.CHIO_PI_MODEL_PORT),bounds));
  const {runGuestMain}=await import("./cli.js");
  await runGuestMain();
} catch (error) {
  let reason=error instanceof Error?error.message:"unknown failure";
  for(const secret of secrets)reason=reason.replaceAll(secret,"[redacted]");
  process.stderr.write(`Confined Linux Pi guest refused or failed: ${reason.replace(/\s+/g," ").slice(0,512)}\n`);process.exitCode=1;
} finally {for(const relay of relays)await relay.close();}
