import { currentNative, nativeHandle, type NativeEmbedding, type NativeState } from "./governance.js";
import { frozenJson } from "./tool-registry.js";
function observation(value: {state: NativeState}): {state: NativeState} {
  if (!value || typeof value !== "object" || !["completed", "proven_undispatched", "refused", "unresolved"].includes(value.state)
    || Object.keys(value).some(key => !["state", "reason"].includes(key))) throw new Error("Invalid native child observation; original remains fenced");
  return Object.freeze({state: value.state});
}
const submissions = new WeakMap<NativeEmbedding, Set<string>>();
export async function submitNativeChild(embedding: NativeEmbedding, templateName: string, request: {requestId: string; payload: Record<string, unknown>}) {
  const state = await currentNative(embedding); const port = state.options.ports.children;
  if (!port) throw new Error("Native child authority unavailable; bridge attenuation unsupported");
  if (Object.keys(request).length !== 2 || !request.requestId || typeof request.requestId !== "string" || !request.payload || typeof request.payload !== "object" || Array.isArray(request.payload)) throw new Error("Closed native child request required");
  if (["executable", "argv", "env", "environment", "packages", "confinement", "template", "templateId"].some(key => Object.hasOwn(request.payload, key))) throw new Error("Native child launch selectors cannot be request data");
  const template = state.options.templates?.[templateName];
  if (!template || !Object.hasOwn(state.options.templates!, templateName)) throw new Error("Installed native child template unavailable");
  let originals = submissions.get(embedding); if (!originals) {originals = new Set(); submissions.set(embedding, originals);}
  if (originals.has(request.requestId)) throw new Error("Original child already submitted; reconcile without relaunch");
  originals.add(request.requestId);
  return observation(await port.submit(nativeHandle(embedding, state.process), template, frozenJson(request)));
}
async function original(embedding: NativeEmbedding, requestId: string, operation: "reconcile" | "cancel" | "wait"): Promise<{state: NativeState}> {
  const state = await currentNative(embedding); const port = state.options.ports.children;
  if (!port?.[operation] || typeof requestId !== "string" || !requestId) throw new Error("Native original child operation unavailable");
  return observation(await port[operation]!(nativeHandle(embedding, state.process), requestId));
}
export const reconcileNativeChild = (e: NativeEmbedding, id: string) => original(e, id, "reconcile");
export const cancelNativeChild = (e: NativeEmbedding, id: string) => original(e, id, "cancel");
export const waitNativeChild = (e: NativeEmbedding, id: string) => original(e, id, "wait");
