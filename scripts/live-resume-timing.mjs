import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";

const configPath = process.argv[2];
const evidence = resolve(process.env.CHIO_PI_EVIDENCE_DIR ?? "evidence/2026-09-09/final-kernel04b7-bridge68b5c466");
const previous = (await readFile(join(evidence, "live-installed-useful.jsonl"), "utf8")).trim().split("\n").map(JSON.parse).findLast(event => event.type === "chio_session");
if (!previous?.sessionFile) throw new Error("Prior real Pi session evidence required");
const profile = dirname(dirname(previous.sessionFile));
const cli = resolve(process.env.CHIO_PI_CANDIDATE_CLI ?? "dist/cli.js");
const started = performance.now();
const starts = new Map(); const durations = []; const records = []; const errors = [];
const child = spawn(process.execPath, [cli, "--config", configPath, "--profile", profile, "--cwd", "/tmp/chio-pi-disposable-workspace-20260909", "--provider", "openai", "--model", "gpt-4.1-mini", "--resume", previous.sessionFile, "--prompt", "Read /workspace/pi-final-one.txt exactly once through chio_execute read_text_file. Do not write, use other paths, or retry. Report actual readback."], { stdio: ["ignore", "pipe", "pipe"] });
const reader = createInterface({ input: child.stdout });
reader.on("line", line => {
  records.push(line);
  const event = JSON.parse(line);
  if (event.type === "tool_execution_start") starts.set(event.toolCallId, performance.now());
  if (event.type === "tool_execution_end" && starts.has(event.toolCallId)) durations.push({ toolCallId: event.toolCallId, elapsedMs: performance.now() - starts.get(event.toolCallId), isError: event.isError });
});
child.stderr.on("data", data => errors.push(data));
const exitCode = await new Promise(resolve => child.on("exit", resolve));
const finalSession = records.map(JSON.parse).findLast(event => event.type === "chio_session");
await writeFile(join(evidence, "live-resume.jsonl"), records.join("\n") + "\n");
if (errors.length) await writeFile(join(evidence, "live-resume.stderr.txt"), Buffer.concat(errors));
await writeFile(join(evidence, "live-resume-timing.json"), JSON.stringify({ recordedAt: new Date().toISOString(), exitCode, previousSessionId: previous.sessionId, resumedSessionId: finalSession?.sessionId, processElapsedMs: performance.now() - started, toolDurations: durations, interpretation: "Single actual host observation. Tool interval includes bridge/kernel/resource/verification and local fsync. It is not isolated incremental overhead versus native Pi." }, null, 2) + "\n");
console.log(JSON.stringify({ exitCode, sameSession: previous.sessionId === finalSession?.sessionId, durations }));
