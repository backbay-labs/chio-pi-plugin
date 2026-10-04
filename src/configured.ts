import { createMcpExecutionClient, verifyCompletedOutcome, verifyBoundReceipt, type ExecutionOutcome as BridgeOutcome, type McpExecutionOptions } from "@chio/bridge";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bridgeExecutor } from "./bridge-executor.js";
import { recoverPendingAcknowledgement } from "./uncertainty.js";
import type { KernelExecutor } from "./extension.js";
import { canonicalJson, frozenJson, registryForConfig, validateKernelArguments, type ChioToolSpec, type ToolMode, type ToolRegistry } from "./tool-registry.js";
import { VERSION } from "@earendil-works/pi-coding-agent";

export interface PreparedPiConfig {
  execution: McpExecutionOptions & { sessionId: string };
  sessionId: string;
  tools: readonly ChioToolSpec[];
  toolMode?: ToolMode;
  approval?: unknown;
}

export async function readPreparedConfig(path: string): Promise<PreparedPiConfig> {
  if (resolve(path) !== path) throw new Error("Operator config path must be absolute");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > 1024 * 1024) throw new Error("Operator config must be a private regular file no larger than 1 MiB");
  const config = JSON.parse(await readFile(path, "utf8")) as PreparedPiConfig;
  if (!config.execution?.sessionId || !config.sessionId || !Array.isArray(config.tools) || !config.tools.length || config.execution.fetchImpl !== undefined) throw new Error("Prepared retained kernel session and explicit tools required");
  const registry = registryForConfig(config);
  return frozenJson({...config, toolMode: registry.mode});
}

export function preparedAuthorityDigest(config: PreparedPiConfig, registry: ToolRegistry): string {
  if (registryForConfig(config).digest !== registry.digest) throw new Error("Registry differs from the prepared authority binding");
  return createHash("sha256").update(canonicalJson({
    schema: "chio.pi.authority-binding.v2", registryDigest: registry.digest,
    sessionId: config.sessionId, kernelSessionId: config.execution.sessionId,
    endpoint: config.execution.endpoint, subjectKey: config.execution.subjectKey,
    capabilityId: config.execution.capabilityId, serverId: config.execution.serverId,
    trustedSigners: config.execution.trustedSigners,
  })).digest("hex");
}

/** The protected launcher's journal is inaccessible to the guest. A writable
 * guest ownership marker alone cannot pin resumed host or tool semantics. */
export async function pinHostRegistry(config: PreparedPiConfig, registry: ToolRegistry, journalDirectory: string): Promise<void> {
  if (VERSION !== "1.0.2") throw new Error("Pi host version differs from the pinned 1.0.2 contract");
  if (resolve(journalDirectory) !== journalDirectory) throw new Error("Trusted parent journal path must be absolute");
  const binding = canonicalJson({schema: "chio.pi.host-binding.v1", piVersion: VERSION, registryDigest: registry.digest,
    authorityDigest: preparedAuthorityDigest(config, registry), sessionId: config.sessionId, kernelSessionId: config.execution.sessionId});
  await mkdir(journalDirectory, {recursive: true, mode: 0o700});
  const directory = await lstat(journalDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.mode & 0o077 || directory.uid !== process.getuid?.()) throw new Error("Trusted parent journal must be a private operator-owned directory");
  const path = join(journalDirectory, "pi-host.binding.json");
  async function check() {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid?.() || stat.size > 1024 * 1024) throw new Error("Trusted host binding must be a private regular file");
    if (canonicalJson(JSON.parse(await readFile(path, "utf8"))) !== binding) throw new Error("Trusted parent host, registry or authority binding is incompatible; no migration or dispatch");
  }
  try {await check();}
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      const file = await open(path, "wx", 0o600);
      try {await file.writeFile(binding + "\n"); await file.sync();} finally {await file.close();}
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await check();
    }
    const dir = await open(journalDirectory, "r");
    try {await dir.sync();} finally {await dir.close();}
  }
}

/** Pin authority across resume/restart before exposing tools to the model.
 * This profile belongs to the trusted operator and must stay outside the
 * kernel tool server's writable filesystem. */
export async function configuredExecutor(config: PreparedPiConfig, profile: string): Promise<{ executor: KernelExecutor; registry: ToolRegistry; close(): Promise<void> }> {
  config = frozenJson(config);
  const registry = registryForConfig(config);
  const binding = preparedAuthorityDigest(config, registry);
  const directory = join(resolve(profile), "chio");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077) throw new Error("Profile state must be a private directory");
  const lockPath = join(directory, "pi.lock");
  const lock = await open(lockPath, "wx", 0o600);
  try { await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); await lock.sync(); }
  finally { await lock.close(); }
  const bindingPath = join(directory, "authority.binding");
  try {
    let previous: string | undefined;
    try { previous = await readFile(bindingPath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (previous && previous !== binding) throw new Error("Profile belongs to different authority, session, signer, or tools");
    if (!previous) {
      const file = await open(bindingPath, "wx", 0o600);
      try { await file.writeFile(binding); await file.sync(); } finally { await file.close(); }
    }
    const dir = await open(directory, "r");
    try { await dir.sync(); } finally { await dir.close(); }
    const client = bridgeExecutor(createMcpExecutionClient(config.execution),
      (outcome, request) => verifyCompletedOutcome(outcome as BridgeOutcome, config.execution, request),
      (outcome, request) => outcome.state === "denied" && outcome.evidence === "verified" && verifyBoundReceipt(outcome.receipt,
        {...config.execution, tool: request.tool, parameters: request.arguments, requestId: request.requestId}));
    await recoverPendingAcknowledgement(client, directory);
    const tools = new Set(config.tools.map(tool => tool.name));
    return {
      registry,
      executor: { ...client, execute(request, signal) {
        if (!tools.has(request.tool)) return Promise.resolve({ outcome: "not_dispatched", content: "Tool is outside operator allowlist" });
        let args;
        try {args = validateKernelArguments(registry, request.tool, request.arguments);}
        catch {return Promise.resolve({outcome: "not_dispatched", content: "Arguments differ from the pinned tool schema"});}
        return client.execute({...request, arguments: args}, signal);
      } },
      async close() {
        await unlink(lockPath);
        const dir = await open(directory, "r");
        try { await dir.sync(); } finally { await dir.close(); }
      },
    };
  } catch (error) {
    await unlink(lockPath);
    throw error;
  }
}
