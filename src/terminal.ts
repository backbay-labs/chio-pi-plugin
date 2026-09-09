/** Conversation completion does not settle an unknown resource outcome. */
export function terminalState(input: {
  unresolved: boolean;
  termination?: "SIGINT" | "SIGTERM";
  providerStopReason?: string;
  toolErrors: number;
  awaitingApproval?: boolean;
}): { outcome: string; exitCode: number } {
  if (input.unresolved) return { outcome: "unresolved", exitCode: 2 };
  if (input.termination || input.providerStopReason === "aborted") {
    return { outcome: "cancelled", exitCode: input.termination === "SIGTERM" ? 143 : 130 };
  }
  if (input.providerStopReason === "error") return { outcome: "failed", exitCode: 1 };
  if (input.providerStopReason !== "stop") return { outcome: "incomplete", exitCode: 1 };
  if (input.awaitingApproval) return {outcome: "awaiting_operator_approval", exitCode: 4};
  return { outcome: input.toolErrors ? "completed_with_tool_errors" : "completed", exitCode: input.toolErrors ? 3 : 0 };
}
