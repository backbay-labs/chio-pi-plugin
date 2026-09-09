import { createHash } from "node:crypto";
import type { KernelExecutor } from "./extension.js";

/** Structural type of @chio/bridge 0.3.0. Keeping transport implementation in
 * the bridge avoids importing a private checkout or duplicating its verifier. */
export interface McpExecutionClient {
  execute(request: { tool: string; arguments: Record<string, unknown>; requestId: string }, options?: { signal?: AbortSignal }): Promise<{
    state: "not_dispatched" | "unknown" | "denied" | "completed";
    evidence: "unverified" | "verified";
    requestId: string;
    result?: unknown;
    receipt?: unknown;
    reason?: string;
  }>;
}

export function bridgeExecutor(client: McpExecutionClient): KernelExecutor {
  return {
    async execute(request, signal) {
      const requestId = `pi:${createHash("sha256").update(JSON.stringify([request.sessionId, request.toolCallId])).digest("hex")}`;
      const outcome = await client.execute({ tool: request.tool, arguments: request.arguments, requestId }, { signal });
      if (outcome.requestId !== requestId) throw new Error("Substituted Chio request ID; outcome unknown");
      if (outcome.state === "not_dispatched") return { outcome: "not_dispatched", content: outcome.reason ?? "Kernel unavailable before dispatch" };
      if (outcome.state === "unknown" || outcome.evidence !== "verified" || !outcome.receipt) {
        throw new Error(`Chio external outcome unknown: ${outcome.reason ?? "Evidence unverified"}. Reconcile before further protected work.`);
      }
      if (outcome.state === "denied") return { outcome: "denied", content: outcome.reason ?? "Kernel denied the operation; consult receipt for the decision phase", evidence: outcome.receipt };
      if (outcome.state !== "completed" || outcome.result === undefined) throw new Error("No verified completed result; external outcome unknown");
      return { outcome: "completed", content: JSON.stringify(outcome.result), evidence: outcome.receipt };
    },
  };
}
