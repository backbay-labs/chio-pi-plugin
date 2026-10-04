import { verifyBoundReceipt } from "@chio/bridge";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PreparedPiConfig } from "./configured.js";
import type {NativeOriginalOperationPort} from "./continuation.js";
import { canonicalJson, frozenJson, registryForConfig, validateKernelArguments, type ToolRegistry } from "./tool-registry.js";

interface NativeHistoryTransport {
  acknowledgeReceivedOutcome(outcome: unknown): Promise<{acknowledged: boolean}>;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hash(value: string): string {return createHash("sha256").update(value).digest("hex");}

/** The native bridge has no denial ACK contract. Revalidate its retained original
 * decision without modifying the operation or clearing its uncertainty fence. */
async function verifyRetainedDenial(config: PreparedPiConfig & {journalDir: string}, registry: ToolRegistry, outcome: Record<string, unknown>): Promise<void> {
  try {
    if (outcome.evidence !== "verified" || typeof outcome.requestId !== "string" || !outcome.requestId || outcome.requestId.length > 2048) throw new Error();
    const directory = await lstat(config.journalDir);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.mode & 0o077 || directory.uid !== process.getuid?.()) throw new Error();
    // This is the exact bundled gateway's operation filename and request digest.
    const file = await open(join(config.journalDir, hash(outcome.requestId) + ".json"), constants.O_RDONLY | constants.O_NOFOLLOW);
    let record: unknown;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid?.() || stat.size > 8 * 1024 * 1024) throw new Error();
      record = JSON.parse(await file.readFile("utf8"));
    } finally {await file.close();}
    if (!object(record) || record.state !== "denied" || record.requestId !== outcome.requestId
      || record.acknowledged === true || record.hostDeliveryConfirmed === true
      || !object(record.request) || record.request.requestId !== outcome.requestId || typeof record.request.tool !== "string"
      || !object(record.outcome) || record.outcome.state !== "denied" || record.outcome.evidence !== "verified"
      || record.outcome.requestId !== outcome.requestId || record.outcome.result !== undefined || record.outcome.delivery !== undefined) throw new Error();
    const args = validateKernelArguments(registry, record.request.tool, record.request.arguments);
    if (record.digest !== hash(canonicalJson({name: record.request.tool, args}))
      || canonicalJson(outcome) !== canonicalJson(record.outcome)) throw new Error();
    const receipt = record.outcome.receipt;
    if (!verifyBoundReceipt(receipt, {...config.execution, tool: record.request.tool, parameters: args, requestId: outcome.requestId})
      || receipt.decision?.verdict !== "deny" || record.outcome.reason !== receipt.decision.reason) throw new Error();
  } catch {throw new Error("Native denied history is not the exact trusted retained denial");}
}

/** Install in the trusted parent before model egress. Completed history delegates
 * to the native gateway's exact result proof and ACK; denied history never ACKs. */
export function createHostDeliveryObserver(config: PreparedPiConfig & {journalDir: string}, transport: NativeHistoryTransport, originals?: NativeOriginalOperationPort): (outcomes: unknown[]) => Promise<void> {
  config = frozenJson(config);
  if (resolve(config.journalDir) !== config.journalDir) throw new Error("Trusted parent journal path must be absolute");
  const registry = registryForConfig(config);
  const confirmed = new Set<string>();
  let confirmations = Promise.resolve();
  return async outcomes => {
    confirmations = confirmations.then(async () => {
      for (const outcome of outcomes) {
        if (!object(outcome)) continue;
        if (outcome.state === "denied") {await verifyRetainedDenial(config, registry, outcome); continue;}
        if (outcome.state !== "completed") continue;
        if (outcome.evidence !== "verified" || typeof outcome.requestId !== "string" || !outcome.requestId) throw new Error("Native completed history lacks its verified original identity");
        const identity = hash(JSON.stringify(outcome));
        if (confirmed.has(identity)) continue;
        const result = originals ? await originals.acknowledgeHistory(outcome, transport) : await transport.acknowledgeReceivedOutcome(outcome);
        if (!result.acknowledged) throw new Error("Native host result delivery remains unconfirmed; no next model turn");
        confirmed.add(identity);
      }
    });
    await confirmations;
  };
}
