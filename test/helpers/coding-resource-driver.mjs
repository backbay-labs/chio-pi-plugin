// Trusted test runner only. Production configuration and CLI have no fault knob.
import {openCodingResource} from "../../dist/coding-resource/participant.js";
import {serveCodingResource} from "../../dist/coding-resource/stdio.js";
import {chmodSync, readdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
// Poison the owner's inherited recipe environment after Node's own startup.
// Passing NODE_OPTIONS to Node itself would test the trusted native launcher.
Object.assign(process.env, JSON.parse(process.argv[4] ?? "{}"));
const participant = await openCodingResource(process.argv[2], {fault(point) {
  if (point === process.argv[3]) process.exit(92);
  if (`throw:${point}` === process.argv[3]) throw new Error("injected durable storage failure");
  if (`corrupt:${point}` === process.argv[3]) {
    const parent = join(participant.selected.config.stateRoot, "generations");
    const candidate = readdirSync(parent).find(digest => digest !== participant.ledger.sourceDigest);
    const path = join(parent, candidate, "source.txt"); chmodSync(path, 0o600); writeFileSync(path, "corrupt candidate"); chmodSync(path, 0o400);
  }
}});
process.exitCode = await serveCodingResource(participant, process.stdin, process.stdout);
