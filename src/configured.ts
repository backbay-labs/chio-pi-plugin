import { createMcpExecutionClient, verifyCompletedOutcome, verifyBoundReceipt, type ExecutionOutcome as BridgeOutcome, type McpExecutionOptions } from "@chio/bridge";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bridgeExecutor } from "./bridge-executor.js";
import { recoverPendingAcknowledgement } from "./uncertainty.js";
import type { KernelExecutor } from "./extension.js";

export interface PreparedPiConfig {
  execution: McpExecutionOptions & { sessionId: string };
  sessionId: string;
  tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[];
}

export async function readPreparedConfig(path: string): Promise<PreparedPiConfig> {
  if (resolve(path) !== path) throw new Error("Operator config path must be absolute");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > 1024 * 1024) throw new Error("Operator config must be a private regular file no larger than 1 MiB");
  const config = JSON.parse(await readFile(path, "utf8")) as PreparedPiConfig;
  if (!config.execution?.sessionId || !config.sessionId || !Array.isArray(config.tools) || !config.tools.length || config.execution.fetchImpl !== undefined) throw new Error("Prepared retained kernel session and explicit tools required");
  if (new Set(config.tools.map(tool => tool.name)).size !== config.tools.length || config.tools.some(tool => !/^[a-zA-Z0-9_.-]{1,128}$/.test(tool.name))) throw new Error("Invalid operator tool allowlist");
  return config;
}

/** Pin authority across resume/restart before exposing tools to the model.
 * This profile belongs to the trusted operator and must stay outside the
 * kernel tool server's writable filesystem. */
export async function configuredExecutor(config: PreparedPiConfig, profile: string): Promise<{ executor: KernelExecutor; close(): Promise<void> }> {
  const directory = join(resolve(profile), "chio");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077) throw new Error("Profile state must be a private directory");
  const lockPath = join(directory, "pi.lock");
  const lock = await open(lockPath, "wx", 0o600);
  try { await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); await lock.sync(); }
  finally { await lock.close(); }
  const binding = createHash("sha256").update(JSON.stringify({
    sessionId: config.sessionId, kernelSessionId: config.execution.sessionId,
    endpoint: config.execution.endpoint, subjectKey: config.execution.subjectKey,
    capabilityId: config.execution.capabilityId, serverId: config.execution.serverId,
    trustedSigners: config.execution.trustedSigners, tools: config.tools,
  })).digest("hex");
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
      executor: { ...client, execute(request, signal) {
        if (!tools.has(request.tool)) return Promise.resolve({ outcome: "not_dispatched", content: "Tool is outside operator allowlist" });
        return client.execute(request, signal);
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
