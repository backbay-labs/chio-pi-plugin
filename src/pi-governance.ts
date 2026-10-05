import type { AgentSession, ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent, SessionBeforeForkEvent, SessionBeforeSwitchEvent, SessionBeforeTreeEvent } from "@earendil-works/pi-coding-agent";
import { currentNative, nativeHandle, type NativeEmbedding } from "./governance.js";
import type { GovernedRelayReference } from "./model-relay.js";
export interface SessionGovernance {required: boolean; embedding?: NativeEmbedding; relayReference?: GovernedRelayReference}
async function bounded<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Native session custody timeout")), 5000);
      abort = () => reject(new Error("Native session custody cancelled"));
      if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, {once: true});
    })]);
  } finally {if (timer) clearTimeout(timer); if (abort) signal?.removeEventListener("abort", abort);}
}
export async function preflightNativeSession(governance: SessionGovernance | undefined, target: Readonly<Record<string, unknown>>) {
  if (!governance?.required) return;
  const state = await bounded(currentNative(governance.embedding));
  const sessions = state.options.ports.sessions;
  if (!sessions || !governance.embedding) throw new Error("Native Pi session custody unavailable");
  await bounded(sessions.preflight(nativeHandle(governance.embedding, state.process), Object.freeze({...target})));
  await bounded(currentNative(governance.embedding));
}
export function installNativeSessionGates(pi: ExtensionAPI, governance?: SessionGovernance) {
  if (!governance?.required) return;
  const handler = async (event: SessionBeforeCompactEvent | SessionBeforeForkEvent | SessionBeforeSwitchEvent | SessionBeforeTreeEvent, ctx: ExtensionContext) => {
      const action = event.type;
      try {
        const state = await bounded(currentNative(governance.embedding), "signal" in event ? event.signal : undefined);
        const port = state.options.ports.sessions;
        if (!port || !governance.embedding) return {cancel: true};
        if (event.type === "session_before_switch") await preflightNativeSession(governance, {kind: event.reason, ...(event.targetSessionFile ? {path: event.targetSessionFile} : {})});
        const result = await bounded(port.mediate(nativeHandle(governance.embedding, state.process), action, event, ctx.sessionManager.getEntries()), "signal" in event ? event.signal : undefined);
        await bounded(currentNative(governance.embedding));
        if (event.type === "session_before_compact") {
          const c = result.compaction;
          if (!c || typeof c.summary !== "string" || !c.firstKeptEntryId || !Number.isSafeInteger(c.tokensBefore) || c.tokensBefore < 0) return {cancel: true};
          return {compaction: c};
        }
        if (event.type === "session_before_tree" && event.preparation.userWantsSummary) {
          if (!result.summary || typeof result.summary.summary !== "string") return {cancel: true};
          return {summary: result.summary};
        }
        return {};
      } catch {return {cancel: true};} // Pi catches thrown handlers and continues.
    };
  pi.on("session_before_compact", handler);
  pi.on("session_before_fork", handler);
  pi.on("session_before_switch", handler);
  pi.on("session_before_tree", handler);
}
/** Trusted SDK seam at the PUBLIC boundary dispatcher. No arbitrary executable
 * extensions are loaded. Direct SessionManager mutation is outside this seam. */
export function restrictBoundaryDrafts(session: AgentSession, governance?: SessionGovernance) {
  if (!governance?.required) return;
  const original = session.extensionRunner.emitBoundary.bind(session.extensionRunner);
  session.extensionRunner.emitBoundary = async (...args) => {
    const result = await original(...args);
    if (result.entries.length) return {...result, entries: [], continue: false, valid: false};
    return result;
  };
}
/** Invoke Pi's existing public action methods so native lifecycle gates run.
 * Boundary draft objects themselves never carry authority. */
export async function mediatedSessionOperation(session: AgentSession, operation: "compact" | "tree", args: Parameters<AgentSession["navigateTree"]>[0] | undefined, governance: SessionGovernance) {
  await preflightNativeSession(governance, {kind: "boundary_operation", operation});
  if (operation === "compact") return session.compact();
  if (!args) throw new Error("Native tree target required");
  return session.navigateTree(args);
}
