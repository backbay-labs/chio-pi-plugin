import { createHash } from "node:crypto";
import type { KernelExecutor, KernelRequest, KernelResult } from "./extension.js";

/** Structural type of @chio/bridge 0.3.0. Keeping transport implementation in
 * the bridge avoids importing a private checkout or duplicating its verifier. */
export interface McpExecutionClient {
  execute(request: ExecutionRequest, options?: { signal?: AbortSignal }): Promise<ExecutionOutcome>;
  acknowledge(outcome: ExecutionOutcome): Promise<{ acknowledged: boolean; reason?: string }>;
}

export interface ExecutionRequest { tool: string; arguments: Record<string, unknown>; requestId: string }
export interface ExecutionOutcome {
    state: "not_dispatched" | "unknown" | "denied" | "completed";
    evidence: "unverified" | "verified";
    requestId: string;
    result?: unknown;
    receipt?: unknown;
    reason?: string;
    delivery?: unknown;
}

function executionRequest(request: KernelRequest): ExecutionRequest {
  return { tool: request.tool, arguments: request.arguments, requestId: `pi:${createHash("sha256").update(JSON.stringify([request.sessionId, request.toolCallId])).digest("hex")}` };
}

export function bridgeExecutor(client: McpExecutionClient, verifyCompleted: (outcome: ExecutionOutcome, request: ExecutionRequest) => boolean, verifyDenied: (outcome: ExecutionOutcome, request: ExecutionRequest) => boolean): KernelExecutor {
  const verifyCached = (request: KernelRequest, result: KernelResult) => {
    const outcome = result.retainedOutcome as ExecutionOutcome | undefined;
    if (!outcome || JSON.stringify(result.evidence) !== JSON.stringify(outcome.receipt)) return false;
    if (result.outcome === "denied") return outcome.state === "denied" && result.content === (outcome.reason ?? "Kernel denied the operation; consult receipt for the decision phase") && verifyDenied(outcome, executionRequest(request));
    return result.outcome === "completed" && outcome.state === "completed" && result.content === JSON.stringify(outcome.result) && result.toolError === (typeof outcome.result === "object" && outcome.result !== null && "isError" in outcome.result && outcome.result.isError === true) && verifyCompleted(outcome, executionRequest(request));
  };
  return {
    async execute(request, signal) {
      const call = executionRequest(request);
      const { requestId } = call;
      const outcome = await client.execute(call, { signal });
      if (outcome.requestId !== requestId) throw new Error("Substituted Chio request ID; outcome unknown");
      if (outcome.state === "not_dispatched") return { outcome: "not_dispatched", content: outcome.reason ?? "Kernel unavailable before dispatch" };
      if (outcome.state === "unknown" || outcome.evidence !== "verified" || !outcome.receipt) {
        throw new Error(`Chio external outcome unknown: ${outcome.reason ?? "Evidence unverified"}. Reconcile before further protected work.`);
      }
      if (outcome.state === "denied") return { outcome: "denied", content: outcome.reason ?? "Kernel denied the operation; consult receipt for the decision phase", evidence: outcome.receipt, retainedOutcome: outcome };
      if (outcome.state !== "completed" || outcome.result === undefined) throw new Error("No verified completed result; external outcome unknown");
      if (!verifyCompleted(outcome, call)) throw new Error("Completed delivery failed exact trusted request verification; profile remains unresolved");
      const toolError = typeof outcome.result === "object" && outcome.result !== null && "isError" in outcome.result && outcome.result.isError === true;
      return { outcome: "completed", content: JSON.stringify(outcome.result), evidence: outcome.receipt, toolError, retainedOutcome: outcome };
    },
    verifyCached,
    async acknowledge(request, result) {
      if (!verifyCached(request, result) || result.outcome !== "completed") throw new Error("Retained completion failed verification; acknowledgement refused");
      const acknowledgement = await client.acknowledge(result.retainedOutcome as ExecutionOutcome);
      if (!acknowledgement.acknowledged) throw new Error("Kernel completion is verified and durably stored, but delivery acknowledgement is unresolved. Retry only acknowledgement, never the resource operation.");
    },
  };
}
