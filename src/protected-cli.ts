#!/usr/bin/env node
import { access, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, writeFile } from "node:fs/promises";
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
import {createUnixRelay} from "./unix-relay.js";
import {superviseGuest} from "./guest-termination.js";
import {readPrivateJson, ownedDirectory, publishGuestFile, sha256, syncDirectory} from "./private-state.js";
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
  const limits = values.has("--limits") ? validateRunLimits(await readPrivateJson(await realpath(values.get("--limits")!), 8192) as RunLimits) : DEFAULT_RUN_LIMITS;
  const linuxRuntime = values.has("--linux-runtime") ? await readPrivateJson(await realpath(values.get("--linux-runtime")!), 16384) as LinuxRuntime : undefined;
  values.delete("--limits"); values.delete("--linux-runtime");
  if (!subscription && !process.env.OPENAI_API_KEY) throw new Error("Operator OPENAI_API_KEY required");
  const authPath = subscription ? await realpath(values.get("--codex-auth")!) : undefined;
  const authority: ModelAuthority = authPath ? await readCodexAuthority(authPath) : {provider: "openai", apiKey: process.env.OPENAI_API_KEY!};
  values.delete("--codex-auth");
  await access(process.platform === "darwin" ? "/usr/bin/sandbox-exec" : "/usr/bin/bwrap", constants.X_OK);
  const packageRoot = await realpath(join(dirname(fileURLToPath(import.meta.url)), ".."));
  const installation = dirname(dirname(packageRoot));
  if (basename(dirname(packageRoot)) !== "@chio" || basename(installation) !== "node_modules") throw new Error("Protected launcher requires the installed artifact, not a source checkout");
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
    const markerStat = await lstat(profileMarker);
    if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.mode & 0o077) throw new Error("Existing profile lacks a private Chio ownership marker");
    const marker = JSON.parse(await readFile(profileMarker, "utf8"));
    if (marker.schema !== "chio.pi.profile.v2" || marker.sessionId !== config.execution.sessionId || marker.registryDigest !== registry.digest || marker.piVersion !== "1.0.2" || selectGovernanceProfile(marker.governanceProfile) !== governanceProfile) throw new Error("Profile host, governance or registry binding is incompatible; frozen profiles are not migrated");
  } else {
    const marker = await open(profileMarker, "wx", 0o600);
    try { await marker.writeFile(JSON.stringify({ schema: "chio.pi.profile.v2", sessionId: config.execution.sessionId, registryDigest: registry.digest, piVersion: "1.0.2", governanceProfile })); await marker.sync(); }
    finally { await marker.close(); }
  }
  const requestedCwd = resolve(values.get("--cwd")!);
  await outsideProfile(requestedCwd, profile);
  await mkdir(requestedCwd, { recursive: true, mode: 0o700 });
  const cwd = await realpath(requestedCwd);
  if (authPath && [profile, installation, cwd].some(path => isWithin(path, authPath))) throw new Error("Native Codex credentials must remain outside guest paths");
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
  const budget = await openRunBudget(join(budgetRoot, sha256(profile)), {binding:{...parentBinding, profileIdentity:profile, governanceProfile}, limits, provider:authority.provider, model:values.get("--model")!, create:contents.length === 0});
  if (Date.now() >= budget.deadline) {await budget.close(); throw new Error("Parent run deadline exhausted; operator recovery remains available");}
  let transport: Awaited<ReturnType<typeof startGatewayHttp>> | undefined;
  let proxy: Awaited<ReturnType<typeof startParentGatewayProxy>> | undefined;
  let relay: Awaited<ReturnType<typeof startModelRelay>> | undefined;
  const sockets: Awaited<ReturnType<typeof createUnixRelay>>[] = [];
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
    const control = await realpath(await mkdtemp(join(tmpdir(), "cp-")));
    const temporary = join(profile, "tmp");
    try {await mkdir(temporary, {mode: 0o700});} catch (error) {if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;}
    if (await ownedDirectory(temporary) !== temporary) throw new Error("Guest temporary directory must not be a link");
    const environment = { PATH: dirname(executable), LANG: "C", HOME:profile, TMPDIR: temporary, PI_CODING_AGENT_DIR: profile, OPENSSL_CONF: "/dev/null", CHIO_PI_MODEL_TOKEN: relay.token, CHIO_PI_GATEWAY_TRANSPORT: "1", CHIO_PI_MODEL_BASE_URL: `http://127.0.0.1:${relay.port}/v1` };
    let launcher:string, launchArgs:string[], filter: Awaited<ReturnType<typeof open>> | undefined;
    let profileIdentity:string, profileSha256:string, policyPath:string|undefined;
    if (linuxRuntime) {
      const gatewaySocket=join(control,"g.sock"), modelSocket=join(control,"m.sock");
      sockets.push(await createUnixRelay(gatewaySocket,proxy.port)); sockets.push(await createUnixRelay(modelSocket,relay.port));
      const guest=await prepareLinuxGuest({runtime:linuxRuntime,installation,profile,cwd,gatewaySocket,modelSocket,gatewayPort:proxy.port,modelPort:relay.port,bootstrap:join(packageRoot,"dist","linux-guest.js"),argv:[...[...values].flat()],environment});
      const filterPath=join(control,"guest.bpf");await writeFile(filterPath,guest.seccomp,{mode:0o600});filter=await open(filterPath,constants.O_RDONLY|constants.O_NOFOLLOW);
      launcher=guest.launcher;launchArgs=guest.args;profileIdentity=guest.profile;profileSha256=createHash("sha256").update(guest.seccomp).digest("hex");
    } else {
      const policy = await buildSandboxPolicy({ executable, installation, profile, cwd, gatewayPort: proxy.port, modelPort: relay.port });
      policyPath=join(control,"profile.sb");await writeFile(policyPath,policy,{mode:0o600});
      launcher="/usr/bin/sandbox-exec";launchArgs=["-f",policyPath,executable,join(packageRoot,"dist","cli.js"),...[...values].flat()];profileIdentity="chio.pi.macos-whole-guest.v1";profileSha256=createHash("sha256").update(policy).digest("hex");
    }
    process.stdout.write(JSON.stringify({type:"chio_protected_runtime",governanceProfile,disclosureGoverned:false,knowledgeGoverned:false,profileIdentity,profileSha256,...(policyPath?{policyPath,policySha256:profileSha256}:{}),node:executable,installation,sessionId:config.execution.sessionId,limitsIdentity:budget.identity,deadline:budget.deadline,remainingRequests:budget.remainingRequests,hardOutputTokenLimit:budget.hardOutputTokenLimit,remainingOutputTokens:budget.remainingOutputTokens})+"\n");
    try {
      const child=spawn(launcher,launchArgs,{cwd,detached:true,stdio:filter?["ignore","inherit","inherit",filter.fd]:["ignore","inherit","inherit"],env:environment});
      const result=await superviseGuest(child,{deadline:budget.deadline,killGraceMs:budget.limits.killGraceMs,processGroup:true});
      process.exitCode=result.code ?? (result.signal === "SIGINT" ? 130 : result.signal === "SIGTERM" ? 143 : 1);
    } finally {await filter?.close();}
  } finally { for(const socket of sockets) await socket.close(); await proxy?.close(); await transport?.close(); await relay?.close(); await budget.close(); }
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => undefined) === await realpath(fileURLToPath(import.meta.url)))
  main().catch(error => { process.stderr.write(`Chio Pi protected launch refused: ${error instanceof Error ? error.message : "unknown failure"}\n`); process.exitCode = 1; });
