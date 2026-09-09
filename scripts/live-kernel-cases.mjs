import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/live-kernel-cases.mjs /absolute/private/pi-gateway.json");
const original = JSON.parse(await readFile(source, "utf8"));
const temporary = await mkdtemp(join(tmpdir(), "chio-pi-live-cases-"));
const evidence = resolve(process.env.CHIO_PI_EVIDENCE_DIR ?? "evidence/2026-09-09");
await mkdir(evidence, { recursive: true });
const cli = resolve(process.env.CHIO_PI_CANDIDATE_CLI ?? "dist/cli.js");
const cases = [
  { name: "wrong-subject", change: execution => { execution.subjectKey = "01".repeat(32); } },
  { name: "wrong-capability", change: execution => { execution.capabilityId = "not-the-session-capability"; } },
  { name: "wrong-session", change: execution => { execution.sessionId = "00000000-0000-4000-8000-000000000000"; } },
  { name: "kernel-unreachable", change: execution => { execution.endpoint = "http://127.0.0.1:1"; execution.timeoutMs = 1000; } },
];
const malformed = createServer((_request, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end("{broken"); });
await new Promise(resolve => malformed.listen(0, "127.0.0.1", resolve));
cases.push({ name: "kernel-malformed", change: execution => { execution.endpoint = `http://127.0.0.1:${malformed.address().port}`; execution.timeoutMs = 1000; } });
cases.push({ name: "wrong-signer", change: execution => { execution.trustedSigners = ["02".repeat(32)]; } });
const outcomes = [];
try {
  for (const item of cases) {
    const config = structuredClone(original);
    item.change(config.execution);
    const configPath = join(temporary, `${item.name}.json`);
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    const target = `/workspace/pi-${item.name}.txt`;
    const prompt = `Call chio_execute exactly once with tool write_file and arguments ${JSON.stringify({ path: target, content: `Pi ${item.name} probe\n` })}. Report the actual result. Do not retry or use another path.`;
    const outcome = await run(item.name, configPath, prompt);
    outcomes.push({ ...outcome, target, expectedEffect: item.name === "wrong-signer" ? "may occur; result must be rejected and profile fenced" : "absent" });
    if (item.name === "wrong-signer") {
      outcomes.push(await run("wrong-signer-restart", configPath, 'Call chio_execute exactly once with tool write_file and arguments {"path":"/workspace/pi-wrong-signer-retry.txt","content":"must not dispatch"}. Report the actual result. Do not retry.', join(temporary, "wrong-signer-profile")));
    }
  }
} finally { await new Promise(resolve => malformed.close(resolve)); }
await writeFile(join(evidence, "live-kernel-cases-summary.json"), JSON.stringify({ recordedAt: new Date().toISOString(), candidateCli: cli, temporary, cases: outcomes, status: "bounded observations; independently inspect resources before assigning results" }, null, 2) + "\n");
console.log(JSON.stringify(outcomes.map(({ name, exitCode, toolCalls, toolErrors }) => ({ name, exitCode, toolCalls, toolErrors }))));

async function run(name, configPath, prompt, profile = join(temporary, `${name}-profile`)) {
  const stdout = [];
  const stderr = [];
  const child = spawn(process.execPath, [cli, "--config", configPath, "--profile", profile, "--cwd", join(temporary, "workspace"), "--provider", "openai", "--model", "gpt-4.1-mini", "--prompt", prompt], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", data => stdout.push(data));
  child.stderr.on("data", data => stderr.push(data));
  const timer = setTimeout(() => child.kill("SIGTERM"), 60_000);
  const exitCode = await new Promise(resolve => child.on("exit", resolve));
  clearTimeout(timer);
  const text = Buffer.concat(stdout).toString();
  const errors = Buffer.concat(stderr).toString();
  await writeFile(join(evidence, `live-${name}.jsonl`), text);
  if (errors) await writeFile(join(evidence, `live-${name}.stderr.txt`), errors);
  const events = text.trim().split("\n").filter(Boolean).map(JSON.parse);
  const tools = events.filter(event => event.type === "tool_execution_end");
  return { name, exitCode, toolCalls: tools.length, toolErrors: tools.filter(tool => tool.isError).length, profile };
}
