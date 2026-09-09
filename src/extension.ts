import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** Resource execution belongs to the kernel. This interface is an in-process
 * adapter seam, not a new network protocol or an evidence verifier. */
export interface KernelExecutor {
  execute(request: KernelRequest, signal?: AbortSignal): Promise<KernelResult>;
}

export interface KernelRequest {
  sessionId: string;
  toolCallId: string;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface KernelResult {
  outcome: "completed" | "denied" | "not_dispatched";
  content: string;
  evidence?: unknown;
}

export const CHIO_TOOL_NAME = "chio_execute";

/** Native Pi extension. Use createChioPiSession for the protected profile.
 * Loading this factory into an unrestricted Pi session does not isolate it. */
export function chioExtension(executor: KernelExecutor | undefined) {
  return (pi: ExtensionAPI): void => {
    pi.registerTool({
      name: CHIO_TOOL_NAME,
      label: "Chio kernel tool",
      description: "Invoke a configured Chio kernel tool. The kernel executes the operation and returns its result. Native local tools are disabled in the protected profile.",
      parameters: Type.Object({
        tool: Type.String({ minLength: 1, maxLength: 256 }),
        arguments: Type.Record(Type.String(), Type.Unknown()),
      }, { additionalProperties: false }),
      async execute(toolCallId, params, signal, _onUpdate, ctx) {
        if (!executor) throw new Error("Chio kernel executor unavailable; no operation dispatched");
        if (signal?.aborted) throw new Error("Cancelled before kernel dispatch");
        const result = await executor.execute({
          sessionId: ctx.sessionManager.getSessionId(),
          toolCallId,
          tool: params.tool,
          arguments: params.arguments,
        }, signal);
        if (result.outcome === "not_dispatched") throw new Error(`Chio did not dispatch operation: ${result.content}`);
        if (result.outcome !== "completed" && result.outcome !== "denied") {
          throw new Error("Invalid kernel outcome; external outcome unknown, do not redispatch");
        }
        if (typeof result.content !== "string" || !result.evidence) {
          throw new Error("Kernel evidence missing; external outcome unknown, do not redispatch");
        }
        if (result.outcome === "denied") throw new Error(`Chio denied operation: ${result.content}`);
        return { content: [{ type: "text", text: result.content }], details: { evidence: result.evidence, outcome: result.outcome } };
      },
    });
  };
}
