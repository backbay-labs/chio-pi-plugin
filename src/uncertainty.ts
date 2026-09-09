import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { KernelExecutor } from "./extension.js";

/** Client uncertainty interlock. This is not an authoritative dispatch ledger
 * and does not claim exactly-once external execution. A crash, cancellation,
 * transport failure, or invalid result leaves the profile locked for review. */
export function withUncertaintyInterlock(executor: KernelExecutor, stateDir: string): KernelExecutor {
  const marker = join(stateDir, "unresolved-kernel-operation.json");
  return {
    async execute(request, signal) {
      if (signal?.aborted) throw new Error("Cancelled before kernel dispatch");
      await mkdir(stateDir, { recursive: true, mode: 0o700 });
      const operationId = createHash("sha256").update(JSON.stringify([request.sessionId, request.toolCallId])).digest("hex");
      const digest = createHash("sha256").update(JSON.stringify(request)).digest("hex");
      const record = join(stateDir, `${operationId}.json`);
      let previous;
      try { previous = JSON.parse(await readFile(record, "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (previous) {
        if (previous.digest !== digest) throw new Error("Operation ID reused with changed request; no dispatch");
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
      if (result.outcome !== "not_dispatched") {
        const completed = await open(record, "wx", 0o600);
        try {
          await completed.writeFile(`${JSON.stringify({ digest, result })}\n`);
          await completed.sync();
        } finally { await completed.close(); }
        const retainedDirectory = await open(stateDir, "r");
        try { await retainedDirectory.sync(); } finally { await retainedDirectory.close(); }
      }
      // A signed denial can originate after a tool effect (for example an
      // output guard). Until the shared contract proves its phase, preserve
      // the interlock rather than treating it as a safe retry permission.
      if (result.outcome === "denied") return result;
      // The executor contract requires trusted request/caller/result verification
      // before returning. Removal acknowledges a known outcome, not permission
      // to redispatch the original operation.
      await unlink(marker);
      const updatedDirectory = await open(stateDir, "r");
      try { await updatedDirectory.sync(); } finally { await updatedDirectory.close(); }
      return result;
    },
  };
}
