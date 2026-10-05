import type {ChildProcess} from "node:child_process";

/** Trusted parent only. Signals preserve all native requests, journal fences
 * and provider reservations. Sending a signal is not observation of exit. */
export function superviseGuest(child:ChildProcess, options:{deadline:number;killGraceMs:number;processGroup:boolean}):Promise<{code:number|null;signal:NodeJS.Signals|null}> {
  if (!Number.isSafeInteger(options.deadline) || !Number.isSafeInteger(options.killGraceMs) || options.killGraceMs<1 || options.killGraceMs>60000) throw new Error("Invalid guest termination bounds");
  return new Promise((resolve,reject)=>{
    let escalation:ReturnType<typeof setTimeout>|undefined, exited=false;
    const signal=(value:NodeJS.Signals)=>{
      if(!child.pid) return;
      try {if(options.processGroup) process.kill(-child.pid,value); else child.kill(value);}
      catch(error){if((error as NodeJS.ErrnoException).code!=="ESRCH") throw error;}
    };
    const stop=(value:NodeJS.Signals)=>{if(exited || escalation) return; signal(value); escalation=setTimeout(()=>{if(!exited) signal("SIGKILL");},options.killGraceMs);};
    const interrupt=()=>stop("SIGINT"), terminate=()=>stop("SIGTERM");
    const deadline=setTimeout(terminate,Math.max(0,Math.min(2147483647,options.deadline-Date.now())));
    const cleanup=()=>{clearTimeout(deadline);if(escalation)clearTimeout(escalation);process.off("SIGINT",interrupt);process.off("SIGTERM",terminate);};
    process.on("SIGINT",interrupt);process.on("SIGTERM",terminate);
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
