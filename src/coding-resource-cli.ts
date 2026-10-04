#!/usr/bin/env node
import {pathToFileURL} from "node:url";
import {initializeCodingResource, inspectCodingResource, openCodingResource, recoverCodingOwnerLock} from "./coding-resource/participant.js";
import {serveCodingResource} from "./coding-resource/stdio.js";

const help = `chio-coding-resource init|serve|inspect|export|recover-lock --config ABSOLUTE_PRIVATE_CONFIG
export additionally requires --operation NATIVE_SHA256_OPERATION_ID.
init explicitly imports pinned private source into an immutable managed workspace.
serve refuses missing initialized state. Its stdin/stdout must be exclusively kernel-owned by Chio.
inspect/export are read-only unsigned resource records. They cannot clear a kernel fence.
recover-lock removes only an exact local owner lock proved dead. Durable intent stays intact.
No provider/model credentials or normal Pi profile are read or changed.
`;
export async function runCodingResourceCommand(args: string[]): Promise<number> {
  if (args.length === 0 || args.length === 1 && ["--help", "-h"].includes(args[0])) {process.stdout.write(help); return 0;}
  try {
    const command = args[0]; if (!["init", "serve", "inspect", "export", "recover-lock"].includes(command)) throw new Error("Unknown closed resource command");
    const options = new Map<string, string>();
    for (let index = 1; index < args.length; index += 2) {
      const key = args[index]; const value = args[index + 1];
      if (!value || !["--config", ...(command === "export" ? ["--operation"] : [])].includes(key) || options.has(key)) throw new Error("Only exact command options are supported"); options.set(key, value);
    }
    const config = options.get("--config"); if (!config) throw new Error("Private operator --config is required");
    if (command === "serve") return await serveCodingResource(await openCodingResource(config), process.stdin, process.stdout);
    if (command === "recover-lock") {await recoverCodingOwnerLock(config); process.stdout.write(JSON.stringify({recovered: true, durableIntentsPreserved: true, kernelFenceClearance: false}) + "\n"); return 0;}
    if (command === "export" && !options.get("--operation")) throw new Error("Original native --operation is required");
    const view = command === "init" ? await initializeCodingResource(config) : await inspectCodingResource(config, options.get("--operation"));
    process.stdout.write(JSON.stringify(view) + "\n"); return 0;
  } catch (error) {process.stderr.write((error instanceof Error ? error.message : "Resource command failed") + "\n"); return 1;}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await runCodingResourceCommand(process.argv.slice(2));
