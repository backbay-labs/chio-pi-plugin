import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { CHIO_TOOL_NAME, createToolRegistry, resolveRegistryCall, type ToolRegistry } from "./tool-registry.js";

/** Resource execution belongs to the kernel. This interface is an in-process
 * adapter seam, not a new network protocol or an evidence verifier. */
export interface KernelExecutor {
  execute(request: KernelRequest, signal?: AbortSignal): Promise<KernelResult>;
  verifyCached?(request: KernelRequest, result: KernelResult): boolean | Promise<boolean>;
  /** Called only after the verified outcome has been durably retained. */
  acknowledge?(request: KernelRequest, result: KernelResult): Promise<void>;
}

export interface KernelRequest {
  sessionId: string;
  toolCallId: string;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface KernelResult {
  outcome: "completed" | "denied" | "not_dispatched" | "awaiting_approval";
  content: string;
  evidence?: unknown;
  toolError?: boolean;
  /** Opaque verified bridge outcome for durable recovery, not model input. */
  retainedOutcome?: unknown;
}

export { CHIO_TOOL_NAME };

/** Native Pi extension. Use createChioPiSession for the protected profile.
 * Loading this factory into an unrestricted Pi session does not isolate it. */
export function chioExtension(executor: KernelExecutor | undefined, registry: ToolRegistry = createToolRegistry([])) {
  return (pi: ExtensionAPI): void => {
    const aliases = new Set(registry.tools.map(tool => tool.name));
    // Nested partial delivery has no compatible gateway acknowledgement contract.
    pi.on("tool_call", event => {
      if (aliases.has(event.toolName) && event.parentToolCallId) return {block: true, reason: "Nested Chio calls require a qualified delivery contract"};
    });
    // Preserve the receipt in native tool results while keeping failures visible
    // to stock Pi. Throwing here discards structured evidence in the host.
    pi.on("tool_result", event => {
      const details = event.details as {outcome?: string; toolError?: boolean} | undefined;
      if (aliases.has(event.toolName) && (details?.outcome === "denied" || details?.toolError === true)) return {isError: true};
    });
    for (const tool of registry.tools) pi.registerTool({
      name: tool.name,
      label: "Chio kernel tool",
      description: tool.description,
      parameters: tool.parameters as TSchema,
      exposure: "direct",
      async execute(toolCallId, params, signal, _onUpdate, ctx) {
        if (!executor) throw new Error("Chio kernel executor unavailable; no operation dispatched");
        if (signal?.aborted) throw new Error("Cancelled before kernel dispatch");
        const call = resolveRegistryCall(registry, tool.name, params);
        const result = await executor.execute({
          sessionId: ctx.sessionManager.getSessionId(),
          toolCallId,
          ...call,
        }, signal);
        if (result.outcome === "awaiting_approval") return {content: [{type: "text", text: result.content}], details: {outcome: result.outcome}};
        if (result.outcome === "not_dispatched") throw new Error(`Chio did not dispatch operation: ${result.content}`);
        if (result.outcome !== "completed" && result.outcome !== "denied") {
          throw new Error("Invalid kernel outcome; external outcome unknown, do not redispatch");
        }
        if (typeof result.content !== "string" || !result.evidence) {
          throw new Error("Kernel evidence missing; external outcome unknown, do not redispatch");
        }
        return { content: [{ type: "text", text: result.content }], details: { evidence: result.evidence, outcome: result.outcome, toolError: result.toolError === true,
          ...(result.retainedOutcome === undefined ? {} : {retainedOutcome: result.retainedOutcome}) } };
      },
    });
  };
}
