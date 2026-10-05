import type {ChildProcess} from "node:child_process";

/** Trusted parent only. Signals preserve all native requests, journal fences
 * and provider reservations. Sending a signal is not observation of exit.
 * SIGHUP and SIGQUIT end the guest like SIGTERM; an exiting parent (including
 * an uncaught exception) hard-kills the guest group before it is gone. */
export function superviseGuest(child:ChildProcess, options:{deadline:number;killGraceMs:number;processGroup:boolean;abort?:AbortSignal}):Promise<{code:number|null;signal:NodeJS.Signals|null}> {
  if (!Number.isSafeInteger(options.deadline) || !Number.isSafeInteger(options.killGraceMs) || options.killGraceMs<1 || options.killGraceMs>60000) throw new Error("Invalid guest termination bounds");
  return new Promise((resolve,reject)=>{
    let escalation:ReturnType<typeof setTimeout>|undefined, exited=false;
    // macOS reports EPERM for a group whose members are all unreaped zombies.
    // Neither absence nor EPERM may escape a timer, signal or exit callback.
    const signal=(value:NodeJS.Signals)=>{
      if(!child.pid) return;
      try {if(options.processGroup) process.kill(-child.pid,value); else child.kill(value);}
      catch(error){if(!["ESRCH","EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;}
    };
    const stop=(value:NodeJS.Signals)=>{if(exited || escalation) return; escalation=setTimeout(()=>{if(!exited) signal("SIGKILL");},options.killGraceMs); signal(value);};
    const interrupt=()=>stop("SIGINT"), terminate=()=>stop("SIGTERM");
    const parentExit=()=>{if(!exited){try {signal("SIGKILL");} catch {}}};
    const deadline=setTimeout(terminate,Math.max(0,Math.min(2147483647,options.deadline-Date.now())));
    const cleanup=()=>{clearTimeout(deadline);if(escalation)clearTimeout(escalation);process.off("SIGINT",interrupt);for(const name of ["SIGTERM","SIGHUP","SIGQUIT"] as const)process.off(name,terminate);process.off("exit",parentExit);options.abort?.removeEventListener("abort",terminate);};
    process.on("SIGINT",interrupt);for(const name of ["SIGTERM","SIGHUP","SIGQUIT"] as const)process.on(name,terminate);process.on("exit",parentExit);
    if(options.abort?.aborted) terminate(); else options.abort?.addEventListener("abort",terminate,{once:true});
    const observed=(code:number|null,value:NodeJS.Signals|null)=>{
      if(exited)return;exited=true;cleanup();
      // A wrapper can exit while its descendants survive. Kill the retained
      // isolated group after observed wrapper exit as well.
      if(options.processGroup) signal("SIGKILL");
      resolve({code,signal:value});
    };
    child.once("exit",observed);child.once("error",error=>{exited=true;cleanup();reject(error);});
    if(child.exitCode!==null || child.signalCode!==null) observed(child.exitCode,child.signalCode);
  });
}

/** Guest side, best effort. The trusted parent keeps the write end of this
 * guest's stdin open and never writes to it. When that parent is gone for any
 * reason, including SIGKILL, the descriptor closes: the guest stops as on
 * SIGTERM and exits after the bounded grace even if it ignores that request.
 * The read handle never keeps an otherwise finished guest alive. Linux guests
 * use bubblewrap's --die-with-parent instead. */
export function exitWithParent(lifeline:NodeJS.ReadableStream & {unref?:()=>void}, graceMs:number):void {
  if(!Number.isSafeInteger(graceMs) || graceMs<1 || graceMs>60000) throw new Error("Invalid parent lifeline grace");
  let lost=false;
  const end=()=>{
    if(lost) return; lost=true;
    setTimeout(()=>process.exit(143),graceMs).unref();
    if(process.listenerCount("SIGTERM")) process.emit("SIGTERM","SIGTERM"); else process.exit(143);
  };
  lifeline.on("data",()=>{}); lifeline.once("end",end); lifeline.once("close",end); lifeline.once("error",end);
  lifeline.resume(); lifeline.unref?.();
}
