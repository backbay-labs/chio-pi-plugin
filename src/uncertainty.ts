import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { KernelExecutor, KernelRequest, KernelResult } from "./extension.js";

type RetainedRecord = { digest: string; request?: KernelRequest; result: KernelResult; phase?: "verified_unacknowledged" | "acknowledged" | "decision_held" };
const requestDigest = (request: KernelRequest) => createHash("sha256").update(JSON.stringify(request)).digest("hex");
const operationId = (request: KernelRequest) => createHash("sha256").update(JSON.stringify([request.sessionId, request.toolCallId])).digest("hex");

async function syncDirectory(path: string) {
  const directory = await open(path, "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

async function markAcknowledged(path: string, record: RetainedRecord, directory: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(`${JSON.stringify({ ...record, phase: "acknowledged" })}\n`); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, path);
  await syncDirectory(directory);
}

async function clearOwnMarker(marker: string, request: KernelRequest, directory: string) {
  let pending;
  try { pending = JSON.parse(await readFile(marker, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (!pending?.request || requestDigest(pending.request) !== requestDigest(request)) throw new Error("Another unresolved operation owns the profile marker; no marker removed");
  await unlink(marker);
  await syncDirectory(directory);
}

/** Recover only a durably saved, verified completion. This function has no
 * execution path and can never redispatch an unknown operation. */
export async function recoverPendingAcknowledgement(executor: KernelExecutor, stateDir: string): Promise<void> {
  const marker = join(stateDir, "unresolved-kernel-operation.json");
  let pending;
  try { pending = JSON.parse(await readFile(marker, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (!pending?.request) throw new Error("Invalid pending operation; operator reconciliation required");
  const recordPath = join(stateDir, `${operationId(pending.request)}.json`);
  let record: RetainedRecord;
  try { record = JSON.parse(await readFile(recordPath, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (record.digest !== requestDigest(pending.request) || !executor.verifyCached || !await executor.verifyCached(pending.request, record.result)) throw new Error("Cached evidence failed trusted request verification; profile remains locked");
  if (record.phase === "verified_unacknowledged") {
    if (!executor.acknowledge) throw new Error("Delivery acknowledgement capability unavailable");
    await executor.acknowledge(pending.request, record.result);
    await markAcknowledged(recordPath, record, stateDir);
    await clearOwnMarker(marker, pending.request, stateDir);
  } else if (record.phase === "acknowledged") await clearOwnMarker(marker, pending.request, stateDir);
}

/** Client uncertainty interlock. This is not an authoritative dispatch ledger
 * and does not claim exactly-once external execution. A crash, cancellation,
 * transport failure, or invalid result leaves the profile locked for review. */
export function withUncertaintyInterlock(executor: KernelExecutor, stateDir: string): KernelExecutor {
  const marker = join(stateDir, "unresolved-kernel-operation.json");
  return {
    async execute(request, signal) {
      if (signal?.aborted) throw new Error("Cancelled before kernel dispatch");
      await mkdir(stateDir, { recursive: true, mode: 0o700 });
      const digest = requestDigest(request);
      const record = join(stateDir, `${operationId(request)}.json`);
      let previous: RetainedRecord | undefined;
      try { previous = JSON.parse(await readFile(record, "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (previous) {
        if (previous.digest !== digest) throw new Error("Operation ID reused with changed request; no dispatch");
        if (executor.verifyCached && !await executor.verifyCached(request, previous.result)) throw new Error("Cached evidence failed trusted request verification; no dispatch");
        if (previous.phase === "verified_unacknowledged") {
          if (!executor.acknowledge) throw new Error("Delivery acknowledgement capability unavailable");
          await executor.acknowledge(request, previous.result);
          await markAcknowledged(record, previous, stateDir);
          await clearOwnMarker(marker, request, stateDir);
        }
        return previous.result;
      }
      let file;
      try {
        file = await open(marker, "wx", 0o600);
      } catch {
        throw new Error(`Chio profile has an unresolved operation or cannot store intent: ${marker}. No operation dispatched.`);
      }
      try {
        await file.writeFile(`${JSON.stringify({ state: "dispatch_pending_or_unknown", request, recordedAt: new Date().toISOString() })}\n`);
        await file.sync();
      } finally {
        await file.close();
      }
      const directory = await open(stateDir, "r");
      try { await directory.sync(); } finally { await directory.close(); }
      const result = await executor.execute(request, signal);
      if ((result.outcome !== "completed" && result.outcome !== "denied" && result.outcome !== "not_dispatched") || typeof result.content !== "string" || (result.outcome !== "not_dispatched" && !result.evidence)) {
        throw new Error("Invalid kernel evidence; external outcome unknown. Profile remains locked.");
      }
      if (result.outcome !== "not_dispatched" && executor.verifyCached && !await executor.verifyCached(request, result)) throw new Error("Kernel outcome failed trusted request verification; profile remains locked");
      const retained: RetainedRecord = { digest, request, result, phase: result.outcome === "denied" ? "decision_held" : executor.acknowledge ? "verified_unacknowledged" : "acknowledged" };
      if (result.outcome !== "not_dispatched") {
        const completed = await open(record, "wx", 0o600);
        try {
          await completed.writeFile(`${JSON.stringify(retained)}\n`);
          await completed.sync();
        } finally { await completed.close(); }
        const retainedDirectory = await open(stateDir, "r");
        try { await retainedDirectory.sync(); } finally { await retainedDirectory.close(); }
      }
      // A signed denial can originate after a tool effect (for example an
      // output guard). Until the shared contract proves its phase, preserve
      // the interlock rather than treating it as a safe retry permission.
      if (result.outcome === "denied") return result;
      if (result.outcome === "completed" && executor.acknowledge) {
        await executor.acknowledge(request, result);
        await markAcknowledged(record, retained, stateDir);
      }
      // The executor contract requires trusted request/caller/result verification
      // before returning. Removal acknowledges a known outcome, not permission
      // to redispatch the original operation.
      await clearOwnMarker(marker, request, stateDir);
      return result;
    },
  };
}
