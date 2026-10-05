#!/usr/bin/env node
import { access, lstat, mkdir, mkdtemp, open, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { startGatewayHttp } from "@chio/bridge";
import { pinHostRegistry, preparedAuthorityDigest, readPreparedConfig, selectGovernanceProfile } from "./configured.js";
import {startParentGatewayProxy} from "./parent-gateway.js";
import { createHostDeliveryObserver } from "./host-delivery.js";
import { canonicalJson, registryForConfig } from "./tool-registry.js";
import { readCodexAuthority, startModelRelay, type ModelAuthority } from "./model-relay.js";
import { buildSandboxPolicy, isWithin, requireSessionCredential } from "./sandbox.js";
import { requireNativeGovernance } from "./governance.js";
import {DEFAULT_RUN_LIMITS, openRunBudget, validateRunLimits, type RunLimits} from "./run-limits.js";
import {auditMountClosure, prepareLinuxGuest, type LinuxRuntime} from "./linux-sandbox.js";
import {createUnixRelay, relayBounds} from "./unix-relay.js";
import {superviseGuest} from "./guest-termination.js";
import {readPrivateJson, ownedDirectory, publishGuestFile, sha256, syncDirectory, writePrivateJson} from "./private-state.js";
import { runOperatorCommand } from "./operator-cli.js";

export function parseProtectedLaunchArguments(args: string[]) {
  const values = new Map<string, string>();
  const names = new Set(["--config", "--profile", "--cwd", "--provider", "--model", "--prompt", "--resume", "--codex-auth", "--governance", "--limits", "--linux-runtime"]);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]; const value = args[index + 1];
    if (!name || !names.has(name) || values.has(name) || !value) throw new Error("Invalid or missing argument; use chio-pi --help");
    values.set(name, value);
  }
  for (const name of [...names].filter(name => !["--resume", "--codex-auth", "--governance", "--limits", "--linux-runtime"].includes(name))) if (!values.has(name)) throw new Error(`Required argument ${name}`);
  const governanceProfile = selectGovernanceProfile(values.get("--governance"));
  const subscription = values.get("--provider") === "openai-codex" && values.get("--model") === "gpt-5.5";
  if (!subscription && (values.get("--provider") !== "openai" || values.get("--model") !== "gpt-4.1-mini")) throw new Error("Model relay supports openai/gpt-4.1-mini or openai-codex/gpt-5.5");
  if (subscription !== values.has("--codex-auth")) throw new Error("--codex-auth is required only for openai-codex");
  return {values, subscription, governanceProfile};
}

/** Refuse a path whose existing components resolve into guest-writable profile
 * state before any missing component is created through them. */
async function outsideProfile(path: string, profile: string): Promise<void> {
  for (let prefix = path; ; prefix = dirname(prefix)) {
    const resolved = await realpath(prefix).catch(error => {if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined; throw error;});
    if (resolved && isWithin(profile, resolved)) throw new Error("Disposable workspace cannot overlap guest profile state");
    if (prefix === dirname(prefix)) return;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (["doctor", "status", "inspect", "recover"].includes(args[0])) {
    process.exitCode = await runOperatorCommand(args);
    return;
  }
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write("Usage: chio-pi --config /absolute/delegated.json --profile /absolute/profile --cwd /absolute/disposable-workspace --provider openai|openai-codex --model gpt-4.1-mini|gpt-5.5 --prompt 'task' [--governance execution-only|required] [--codex-auth /absolute/private/codex/auth.json] [--resume /absolute/profile/sessions/session.jsonl] [--limits /absolute/private/limits.json] [--linux-runtime /absolute/private/runtime.json]\nDefault execution-only preserves kernel-mediated tool execution and the fixed credential relay. Model disclosure and Pi knowledge custody are not native governed. Required native governance is unavailable in this CLI and refuses before provider credential access, with no fallback. Protected candidate requires macOS sandbox-exec or Linux bubblewrap with an explicit pinned --linux-runtime manifest, an installed package, and delegated retained-session credentials. Parent durable limits preserve counts and absolute deadline across resume. Codex hard output tokens and remaining token budget are unavailable. Codex subscription mode requires --codex-auth; API mode requires operator OPENAI_API_KEY.\nTrusted diagnostics and recovery: chio-pi doctor|status|inspect|recover --help. Operator commands launch no model and require no provider credentials.\n");
    return;
  }
  const {values, subscription, governanceProfile} = parseProtectedLaunchArguments(args);
  values.delete("--governance");
  // No compatible trusted host facade is shipped with the frozen bridge.
  // Prepared JSON cannot activate missing governance or choose a native sink.
  if (governanceProfile === "required") await requireNativeGovernance();
  if (!["darwin", "linux"].includes(process.platform)) throw new Error("Protected candidate requires macOS sandbox-exec or Linux bubblewrap");
  if (process.platform === "linux" && !values.has("--linux-runtime")) throw new Error("Protected Linux candidate requires --linux-runtime pins");
  if (process.platform === "darwin" && values.has("--linux-runtime")) throw new Error("Linux runtime pins require Linux");
  const limitsPath = values.has("--limits") ? await realpath(values.get("--limits")!) : undefined;
  const runtimePath = values.has("--linux-runtime") ? await realpath(values.get("--linux-runtime")!) : undefined;
  const limits = limitsPath ? validateRunLimits(await readPrivateJson(limitsPath, 8192) as RunLimits) : DEFAULT_RUN_LIMITS;
  const linuxRuntime = runtimePath ? await readPrivateJson(runtimePath, 16384) as LinuxRuntime : undefined;
  values.delete("--limits"); values.delete("--linux-runtime");
  if (!subscription && !process.env.OPENAI_API_KEY) throw new Error("Operator OPENAI_API_KEY required");
  const authPath = subscription ? await realpath(values.get("--codex-auth")!) : undefined;
  const authority: ModelAuthority = authPath ? await readCodexAuthority(authPath) : {provider: "openai", apiKey: process.env.OPENAI_API_KEY!};
  values.delete("--codex-auth");
  await access(process.platform === "darwin" ? "/usr/bin/sandbox-exec" : "/usr/bin/bwrap", constants.X_OK);
  const packageRoot = await realpath(join(dirname(fileURLToPath(import.meta.url)), ".."));
  const installation = dirname(dirname(packageRoot));
  // npm installs this scoped package at node_modules/<scope>/<name>; bind that
  // layout to the package's own manifest name rather than a second literal.
  const packageName = (JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {name?: unknown}).name;
  if (typeof packageName !== "string" || !packageName.startsWith("@") || `${basename(dirname(packageRoot))}/${basename(packageRoot)}` !== packageName
    || basename(installation) !== "node_modules") throw new Error("Protected launcher requires the installed artifact, not a source checkout");
  const executable = await realpath(process.execPath);
  const configPath = await realpath(values.get("--config")!);
  const prepared = await readPreparedConfig(configPath);
  const config = await requireSessionCredential(configPath);
  if (canonicalJson({...config, toolMode: config.toolMode ?? "typed"}) !== canonicalJson(prepared)) throw new Error("Prepared operator configuration changed during launch");
  const registry = registryForConfig(prepared);
  const endpoint = new URL(config.execution.endpoint);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port || endpoint.username || endpoint.password) throw new Error("Protected candidate requires an explicit local kernel HTTP endpoint");
  const requestedProfile = resolve(values.get("--profile")!);
  await mkdir(requestedProfile, { recursive: true, mode: 0o700 });
  // A macOS guest can replace its writable profile root with a link; never follow it.
  if ((await lstat(requestedProfile)).isSymbolicLink()) throw new Error("Profile path must name the private directory itself, not a link");
  const profile = await realpath(requestedProfile);
  const profileStat = await lstat(profile);
  if (profileStat.mode & 0o077 || isWithin(installation, profile) || isWithin(profile, installation) || isWithin(profile, configPath) || isWithin(installation, configPath)) throw new Error("Profile, immutable configuration and installed code require separate private paths");
  // A guest can leave links or special files in its writable profile. Refuse them
  // before any parent mutation of the resumed profile or a workspace inside it.
  await auditMountClosure(profile).catch(error => {throw new Error(`Guest profile refused before parent mutation: ${error instanceof Error ? error.message : "audit failed"}`);});
  const profileMarker = join(profile, ".chio-pi-profile.json");
  const contents = await readdir(profile);
  if (contents.length) {
    // Guest-controlled bytes: private, single-link, bounded no-follow read.
    const marker = await readPrivateJson(profileMarker, 4096).catch(() => {throw new Error("Existing profile lacks a private Chio ownership marker");}) as Record<string, unknown>;
    if (marker.schema !== "chio.pi.profile.v2" || marker.sessionId !== config.execution.sessionId || marker.registryDigest !== registry.digest || marker.piVersion !== "1.0.2" || selectGovernanceProfile(marker.governanceProfile as string | undefined) !== governanceProfile) throw new Error("Profile host, governance or registry binding is incompatible; frozen profiles are not migrated");
  }
  const requestedCwd = resolve(values.get("--cwd")!);
  await outsideProfile(requestedCwd, profile);
  await mkdir(requestedCwd, { recursive: true, mode: 0o700 });
  const cwd = await realpath(requestedCwd);
  if (authPath && [profile, installation, cwd].some(path => isWithin(path, authPath))) throw new Error("Native Codex credentials must remain outside guest paths");
  if ([limitsPath, runtimePath].some(pin => pin && [profile, installation, cwd].some(path => isWithin(path, pin)))) throw new Error("Run limits and Linux runtime pins must remain outside guest paths");
  if (isWithin(cwd, profile) || isWithin(cwd, configPath) || isWithin(cwd, installation)) throw new Error("Disposable workspace cannot contain private state or installed code");
  const journal = resolve(config.journalDir);
  if (journal !== config.journalDir || isWithin(profile, journal) || isWithin(installation, journal)
    || isWithin(journal, profile) || isWithin(journal, installation) || isWithin(journal, configPath)) throw new Error("Authoritative gateway journal must be outside guest-readable and writable state");
  values.set("--config", configPath); values.set("--profile", profile); values.set("--cwd", cwd);
  await pinHostRegistry(prepared, registry, journal, governanceProfile);
  const parentBinding = {authorityDigest: preparedAuthorityDigest(prepared, registry), registryDigest: registry.digest};
  const budgetRoot = join(journal, "pi-run-limits");
  try {await mkdir(budgetRoot, {mode:0o700}); await syncDirectory(journal);} catch(error) {if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;}
  await ownedDirectory(budgetRoot);
  const budgetPath = join(budgetRoot, sha256(profile)), fresh = contents.length === 0;
  const budgetOptions = {binding:{...parentBinding, profileIdentity:profile, governanceProfile}, limits, provider:authority.provider, model:values.get("--model")!};
  // An empty profile whose record exists (an interrupted first launch, or a guest
  // that emptied its profile) resumes that accounting; it is never recreated.
  const budget = await openRunBudget(budgetPath, {...budgetOptions, create:fresh}).catch(error => {
    if (!fresh || (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return openRunBudget(budgetPath, budgetOptions);
  });
  try {
    // The ownership marker follows its run record and is published atomically.
    if (fresh) await writePrivateJson(profileMarker, {schema: "chio.pi.profile.v2", sessionId: config.execution.sessionId, registryDigest: registry.digest, piVersion: "1.0.2", governanceProfile});
    if (Date.now() >= budget.deadline) throw new Error("Parent run deadline exhausted; operator recovery remains available");
  } catch (error) {await budget.close(); throw error;}
  let transport: Awaited<ReturnType<typeof startGatewayHttp>> | undefined;
  let proxy: Awaited<ReturnType<typeof startParentGatewayProxy>> | undefined;
  let relay: Awaited<ReturnType<typeof startModelRelay>> | undefined;
  const sockets: Awaited<ReturnType<typeof createUnixRelay>>[] = [];
  let control: string | undefined;
  try {
    transport = await startGatewayHttp(config);
    proxy = await startParentGatewayProxy({configPath, binding: parentBinding, native: transport});
    relay = await startModelRelay(authority, values.get("--model")!, createHostDeliveryObserver({...prepared, journalDir: journal}, transport, proxy.originals), registry, undefined, budget);
    const guestConfig = join(profile, "gateway-transport.json");
    await publishGuestFile(guestConfig, JSON.stringify({schema: "chio.pi.transport.v1", sessionId: config.sessionId,
      transport: {url: proxy.url, token: proxy.token}, parentBinding, tools: config.tools, approvals: Boolean(config.approval),
      toolMode: registry.mode, registryDigest: registry.digest,
      binding: {subjectKey: config.execution.subjectKey, capabilityId: config.execution.capabilityId, serverId: config.execution.serverId, trustedSigners: config.execution.trustedSigners}}));
    values.set("--config", guestConfig);
    control = await realpath(await mkdtemp(join(tmpdir(), "cp-")));
    const temporary = join(profile, "tmp");
    try {await mkdir(temporary, {mode: 0o700});} catch (error) {if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;}
    if (await ownedDirectory(temporary) !== temporary) throw new Error("Guest temporary directory must not be a link");
    // Public guest environment. The relay bearer is a secret: macOS passes it in
    // the owner-only environment, Linux only on inherited FD4, never in argv.
    const environment: Record<string, string> = { PATH: dirname(executable), LANG: "C", HOME:profile, TMPDIR: temporary, PI_CODING_AGENT_DIR: profile, OPENSSL_CONF: "/dev/null", CHIO_PI_GATEWAY_TRANSPORT: "1", CHIO_PI_MODEL_BASE_URL: `http://127.0.0.1:${relay.port}/v1` };
    const secrets = {CHIO_PI_MODEL_TOKEN: relay.token};
    let launcher:string, launchArgs:string[], filter: Awaited<ReturnType<typeof open>> | undefined, secretPayload: Buffer | undefined;
    let profileIdentity:string, profileSha256:string, policyPath:string|undefined, policy:string|undefined, seccompSha256:string|undefined;
    let guestEnvironment: Record<string, string>, stdio: ("ignore" | "inherit" | "pipe" | number)[];
    if (linuxRuntime) {
      const gatewaySocket=join(control,"g.sock"), modelSocket=join(control,"m.sock"), bounds=relayBounds(budget.limits.providerTimeoutMs);
      sockets.push(await createUnixRelay(gatewaySocket,proxy.port,bounds)); sockets.push(await createUnixRelay(modelSocket,relay.port,bounds));
      const guest=await prepareLinuxGuest({runtime:linuxRuntime,installation,profile,cwd,gatewaySocket,modelSocket,gatewayPort:proxy.port,modelPort:relay.port,bootstrap:join(packageRoot,"dist","linux-guest.js"),argv:[...[...values].flat()],environment:{...environment,CHIO_PI_RELAY_IDLE_MS:String(bounds.idleTimeoutMs)},secrets});
      const filterPath=join(control,"guest.bpf");await writeFile(filterPath,guest.seccomp,{mode:0o600});filter=await open(filterPath,constants.O_RDONLY|constants.O_NOFOLLOW);
      launcher=guest.launcher;launchArgs=guest.args;profileIdentity=guest.profile;secretPayload=guest.secrets;
      // The identity covers the complete mount, namespace and environment set.
      seccompSha256=createHash("sha256").update(guest.seccomp).digest("hex");profileSha256=sha256(canonicalJson({launcher,args:guest.args,seccompSha256}));
      guestEnvironment=environment;stdio=["ignore","inherit","inherit",filter.fd,"pipe"];
    } else {
      policy = await buildSandboxPolicy({ executable, installation, profile, cwd, gatewayPort: proxy.port, modelPort: relay.port });
      policyPath=join(control,"profile.sb");await writeFile(policyPath,policy,{mode:0o600});
      launcher="/usr/bin/sandbox-exec";launchArgs=["-f",policyPath,executable,join(packageRoot,"dist","cli.js"),...[...values].flat()];profileIdentity="chio.pi.macos-whole-guest.v1";profileSha256=createHash("sha256").update(policy).digest("hex");
      // stdin is a lifeline: the guest stops when this parent is gone, even by SIGKILL.
      guestEnvironment={...environment,...secrets,CHIO_PI_PARENT_LIFELINE_GRACE_MS:String(budget.limits.killGraceMs)};stdio=["pipe","inherit","inherit"];
    }
    // The policy file is removed with the control directory; the record keeps its text.
    process.stdout.write(JSON.stringify({type:"chio_protected_runtime",governanceProfile,disclosureGoverned:false,knowledgeGoverned:false,profileIdentity,profileSha256,...(policyPath?{policyPath,policySha256:profileSha256,policy}:{}),...(seccompSha256?{seccompSha256}:{}),node:executable,installation,sessionId:config.execution.sessionId,limitsIdentity:budget.identity,deadline:budget.deadline,remainingRequests:budget.remainingRequests,hardOutputTokenLimit:budget.hardOutputTokenLimit,remainingOutputTokens:budget.remainingOutputTokens})+"\n");
    try {
      const child=spawn(launcher,launchArgs,{cwd,detached:true,stdio,env:guestEnvironment});
      const abort=new AbortController();
      const supervised=superviseGuest(child,{deadline:budget.deadline,killGraceMs:budget.limits.killGraceMs,processGroup:true,abort:abort.signal});
      supervised.catch(()=>{});
      for(const stream of [child.stdin,child.stdio[4]])stream?.on("error",()=>{});
      if(secretPayload)(child.stdio[4] as NodeJS.WritableStream).end(secretPayload);
      // A later launch refuses stale-owner recovery while this group exists.
      let unrecorded=false;
      if(child.pid)await budget.recordGuest(child.pid).catch(()=>{unrecorded=true;abort.abort();});
      const result=await supervised;
      if(unrecorded)throw new Error("Guest process group could not be recorded in the run owner lock; the guest was stopped");
      process.exitCode=result.code ?? (result.signal === "SIGINT" ? 130 : result.signal === "SIGTERM" ? 143 : 1);
    } finally {await filter?.close();}
  } finally { for(const socket of sockets) await socket.close(); if(control) await rm(control,{recursive:true,force:true}); await proxy?.close(); await transport?.close(); await relay?.close(); await budget.close(); }
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => undefined) === await realpath(fileURLToPath(import.meta.url)))
  main().catch(error => { process.stderr.write(`Chio Pi protected launch refused: ${error instanceof Error ? error.message : "unknown failure"}\n`); process.exitCode = 1; });
