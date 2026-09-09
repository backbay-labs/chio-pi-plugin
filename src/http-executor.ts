import { lstat, readFile } from "node:fs/promises";
import { verifyBoundReceipt } from "@chio/bridge";
import type { KernelExecutor } from "./extension.js";

export interface PiTransportConfig {
  schema: "chio.pi.transport.v1";
  sessionId: string;
  transport: { url: string; token: string };
  binding: { subjectKey: string; capabilityId: string; serverId: string; trustedSigners: string[] };
  tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[];
  approvals: boolean;
}
export async function readTransportConfig(path: string): Promise<PiTransportConfig> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > 1024 * 1024) throw new Error("Private transport configuration required");
  const config = JSON.parse(await readFile(path, "utf8")) as PiTransportConfig;
  const url = new URL(config.transport?.url);
  if (config.schema !== "chio.pi.transport.v1" || !config.sessionId || !config.transport.token
    || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/mcp"
    || url.username || url.password || url.search || url.hash || !Array.isArray(config.tools) || !config.tools.length) throw new Error("Invalid launcher transport configuration");
  return config;
}

/** The trusted launcher owns verification, the durable journal, and kernel ACK.
 * This guest adapter has only an ephemeral HTTP token and no kernel authority.
 * It returns the exact received delivery proof to the launcher, which owns the
 * kernel acknowledgement. It never retries an effecting operation itself. */
export async function gatewayExecutor(config: PiTransportConfig) {
  let session = "";
  const state = { unresolved: false, awaitingApproval: false };
  async function rpc(id: string, method: string, params: unknown, signal?: AbortSignal) {
    const response = await fetch(config.transport.url, {method: "POST", redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(40000)]) : AbortSignal.timeout(40000),
      headers: {"Content-Type": "application/json", Authorization: `Bearer ${config.transport.token}`, ...(session ? {"Mcp-Session-Id": session} : {})},
      body: JSON.stringify({jsonrpc: "2.0", id, method, params})});
    if (!response.ok) throw new Error("Launcher transport unavailable; preserve original operation");
    if (method === "initialize") { session = response.headers.get("mcp-session-id") ?? ""; if (!session) throw new Error("Missing transport session"); }
    const text = await response.text();
    if (text.length > 16 * 1024 * 1024) throw new Error("Transport response exceeds limit");
    const body = JSON.parse(text);
    if (body.jsonrpc !== "2.0" || body.id !== id || body.error || !body.result) throw new Error("Invalid transport response");
    return body.result;
  }
  const initialized = await rpc("initialize", "initialize", {protocolVersion: "2025-11-25"});
  if (initialized.capabilities?.experimental?.chioDeliveryAcknowledgement !== "1") throw new Error("Host delivery acknowledgement transport required");
  const inventory = await rpc("inventory", "tools/list", {});
  const names = [...config.tools.map(tool => tool.name), ...(config.approvals ? ["chio_resume"] : [])].sort();
  if (!Array.isArray(inventory.tools) || JSON.stringify(inventory.tools.map((tool: {name: string}) => tool.name).sort()) !== JSON.stringify(names)) throw new Error("Transport inventory differs from pinned operator tools");
  const executor: KernelExecutor = {
    async execute(request, signal) {
      if (state.unresolved) throw new Error("Prior external outcome remains unknown; no new dispatch");
      if (!names.includes(request.tool)) return {outcome: "not_dispatched", content: "Tool is outside operator allowlist"};
      if (signal?.aborted) return {outcome: "not_dispatched", content: "Cancelled before transport dispatch"};
      try {
        const raw = await rpc(JSON.stringify([request.sessionId, request.toolCallId]), "tools/call", {name: request.tool, arguments: request.arguments}, signal);
        if (raw.content?.length !== 1 || raw.content[0].type !== "text") throw new Error("Missing verified gateway outcome");
        const outcome = JSON.parse(raw.content[0].text);
        if (outcome.state === "awaiting_approval") {
          state.awaitingApproval = true;
          return {outcome: "awaiting_approval", content: JSON.stringify(outcome)};
        }
        if (outcome.state === "not_dispatched") return {outcome: "not_dispatched", content: outcome.reason};
        if (!["completed", "denied"].includes(outcome.state) || outcome.evidence !== "verified") throw new Error("Gateway reports an unknown external outcome");
        const original = request.tool === "chio_resume" ? request.arguments : {tool: request.tool, arguments: request.arguments};
        if (request.tool === "chio_resume" && original.requestId !== outcome.requestId) throw new Error("Approval resume identity mismatch");
        if (!verifyBoundReceipt(outcome.receipt, {...config.binding, tool: String(original.tool), parameters: original.arguments, requestId: outcome.requestId})) throw new Error("Receipt binding differs from requested caller, resource, tool or arguments");
        if (outcome.state === "completed") {
          const acknowledged = await rpc(`ack:${outcome.requestId}`, "chio/acknowledge", outcome.delivery, signal);
          if (acknowledged.schema !== "chio.mcp.delivery-ack.v1" || acknowledged.acknowledged !== true
            || acknowledged.requestId !== outcome.requestId || acknowledged.receiptId !== outcome.receipt.id) throw new Error("Host result received but delivery acknowledgement remains unresolved");
        }
        state.awaitingApproval = false;
        return {outcome: outcome.state, content: outcome.state === "completed" ? JSON.stringify(outcome.result) : outcome.reason,
          evidence: outcome.receipt, toolError: outcome.result?.isError === true};
      } catch (error) { state.unresolved = true; throw error; }
    },
  };
  return {executor, state, tools: inventory.tools as PiTransportConfig["tools"], async close() { /* Launcher owns transport lifetime. */ }};
}
