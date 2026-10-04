import {spawn} from "node:child_process";
import {mkdtemp} from "node:fs/promises";
import {join} from "node:path";
import {canonicalJson} from "../tool-registry.js";
import {sha256, type CodingConfig, type Recipe} from "./config.js";
import {FatalResourceError} from "./ledger.js";
import {durableFile, fsyncDirectory, removeJob} from "./paths.js";
import {bubblewrapArguments, minimalRecipeEnvironment, type RecipeSandbox} from "./recipe-sandbox.js";

export interface RecipeResult {sourceDigest: string; recipe: string; recipeSha256: string; executableSha256: string; success: boolean; exitCode: number | null; signal: string | null; stdout: string; stderr: string; limit: "timeout" | "output" | null; sandbox: string; resultSha256: string}
function groupExists(pid: number): boolean {try {process.kill(-pid, 0); return true;} catch (error) {if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw new FatalResourceError("Recipe process group absence cannot be proved");}}
function killGroup(pid: number, signal: NodeJS.Signals): void {try {process.kill(-pid, signal);} catch (error) {if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw new FatalResourceError("Recipe process group termination cannot be proved");}}
export async function runRecipe(config: Readonly<CodingConfig>, recipe: Recipe, sandbox: RecipeSandbox, sourceDigest: string, sourcePath: string, abort: AbortSignal): Promise<RecipeResult> {
  const job = await mkdtemp(join(config.jobRoot, "job-")); await fsyncDirectory(config.jobRoot);
  let limit: "timeout" | "output" | null = null; let disconnected = abort.aborted;
  const stdout: Buffer[] = []; const stderr: Buffer[] = []; let totalBytes = 0;
  let argv: string[];
  if (sandbox.backend === "seatbelt") {const profile = join(job, "recipe.sb"); await durableFile(profile, sandbox.policy!(sourcePath, job)); argv = ["-f", profile, "--", recipe.executable, ...recipe.argv];}
  else argv = bubblewrapArguments(recipe, sandbox, sourcePath, job);
  const child = spawn(sandbox.launcher, argv, {shell: false, detached: true, cwd: sourcePath, env: minimalRecipeEnvironment(recipe, job), stdio: sandbox.backend === "bubblewrap" ? ["ignore", "pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]});
  let hardTimer: NodeJS.Timeout | undefined; let terminationRequested = false;
  const terminate = () => {if (!child.pid || terminationRequested) return; terminationRequested = true; killGroup(child.pid, "SIGTERM"); hardTimer = setTimeout(() => {if (child.pid && groupExists(child.pid)) killGroup(child.pid, "SIGKILL");}, recipe.graceMs);};
  const timeout = setTimeout(() => {limit ??= "timeout"; terminate();}, recipe.timeoutMs);
  const onAbort = () => {disconnected = true; terminate();}; abort.addEventListener("abort", onAbort, {once: true}); if (abort.aborted) onAbort();
  const capture = (chunks: Buffer[]) => (bytes: Buffer) => {
    const remaining = Math.max(0, recipe.outputBytes - totalBytes); if (remaining) {const kept = bytes.subarray(0, remaining); chunks.push(Buffer.from(kept)); totalBytes += kept.length;}
    if (bytes.length > remaining) {limit ??= "output"; terminate();}
  };
  child.stdout!.on("data", capture(stdout)); child.stderr!.on("data", capture(stderr));
  if (sandbox.seccomp) {
    const pipe = child.stdio[3] as import("node:stream").Writable; pipe.on("error", () => {}); pipe.end(sandbox.seccomp);
  }
  try {
    const exited = await new Promise<{code: number | null; signal: NodeJS.Signals | null}>((resolve, reject) => {child.once("error", reject); child.once("close", (code, signal) => resolve({code, signal}));});
    clearTimeout(timeout); clearTimeout(hardTimer); abort.removeEventListener("abort", onAbort);
    if (child.pid && groupExists(child.pid)) {
      killGroup(child.pid, "SIGKILL");
      for (let index = 0; index < 10 && groupExists(child.pid); index++) await new Promise(resolve => setTimeout(resolve, 25));
      if (groupExists(child.pid)) throw new FatalResourceError("Recipe descendants may remain; resource intent is unresolved");
    }
    await removeJob(job);
    if (disconnected) throw new FatalResourceError("Recipe disconnected after intent; original outcome remains unresolved");
    const body = {sourceDigest, recipe: recipe.name, recipeSha256: recipe.recipeSha256, executableSha256: recipe.executableSha256, success: exited.code === 0 && !limit, exitCode: exited.code, signal: exited.signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), limit, sandbox: sandbox.backend};
    return {...body, resultSha256: sha256(canonicalJson(body))};
  } catch (error) {
    clearTimeout(timeout); clearTimeout(hardTimer); abort.removeEventListener("abort", onAbort);
    if (child.pid && groupExists(child.pid)) killGroup(child.pid, "SIGKILL");
    // On ambiguous launch/cleanup, do not claim completion or delete durable intent.
    throw error instanceof FatalResourceError ? error : new FatalResourceError("Recipe launch, termination or cleanup failed after durable intent");
  }
}
