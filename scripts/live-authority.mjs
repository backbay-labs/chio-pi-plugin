import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createMcpExecutionClient } from "@chio/bridge";

const [templatePath, operatorPath, helper] = process.argv.slice(2);
if (!helper) throw new Error("Usage: node scripts/live-authority.mjs private-prepare-template.json private-operator.json /absolute/operator_capability.py");
const temporary = await mkdtemp(join(tmpdir(), "chio-pi-authority-"));
const evidence = resolve(process.env.CHIO_PI_EVIDENCE_DIR ?? "evidence/2026-09-09/final-kernel04b7-bridge68b5c466/authority");
await mkdir(evidence, { recursive: true });
const template = JSON.parse(await readFile(templatePath, "utf8"));
const require = createRequire(import.meta.url);
const bridgeRoot = dirname(require.resolve("@chio/bridge/package.json"));
const cli = resolve(process.env.CHIO_PI_CANDIDATE_CLI ?? "dist/cli.js");
const selected = new Set((process.env.CHIO_PI_CASES ?? "revoked,budget,fresh-authority").split(","));
const secrets = [];
function collectSecrets(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|api.?key/i.test(key) && typeof item === "string") secrets.push(item);
    else collectSecrets(item);
  }
}
collectSecrets(template);
function redact(text) { for (const secret of secrets) text = text.replaceAll(secret, "[REDACTED]"); return text; }

async function command(executable, args) {
  const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
  const stdout = []; const stderr = [];
  child.stdout.on("data", data => stdout.push(data)); child.stderr.on("data", data => stderr.push(data));
  const exitCode = await new Promise(resolve => child.on("exit", resolve));
  return { exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}
async function prepare(name) {
  const input = { ...template, sessionId: `pi-${name}-${Date.now()}`, journalDir: join(temporary, `${name}-journal`) };
  const path = join(temporary, `${name}-prepare.json`);
  const output = join(temporary, `${name}-gateway.json`);
  await writeFile(path, JSON.stringify(input), { mode: 0o600 });
  const result = await command(process.execPath, [join(bridgeRoot, "dist/prepare-gateway.js"), path, output]);
  if (result.exitCode) {
    await writeFile(join(evidence, `${name}-prepare-error.json`), JSON.stringify({ exitCode: result.exitCode, stdout: redact(result.stdout), stderr: redact(result.stderr) }, null, 2) + "\n");
    throw new Error(`Gateway preparation failed for ${name}; retained redacted diagnostic`);
  }
  const config = JSON.parse(await readFile(output, "utf8"));
  return { path: output, config };
}
async function admin(action, prepared) {
  const result = await command("python3", [helper, action, "--operator-file", operatorPath, "--capability-id", prepared.config.execution.capabilityId, "--base-url", new URL(template.endpoint).origin]);
  if (result.exitCode) throw new Error(`Capability ${action} failed`);
  return JSON.parse(result.stdout);
}
async function host(name, prepared, prompt) {
  const result = await command(process.execPath, [cli, "--config", prepared.path, "--profile", join(temporary, `${name}-profile`), "--cwd", join(temporary, "workspace"), "--provider", "openai", "--model", "gpt-4.1-mini", "--prompt", prompt]);
  await writeFile(join(evidence, `live-${name}.jsonl`), result.stdout);
  if (result.stderr) await writeFile(join(evidence, `live-${name}.stderr.txt`), result.stderr);
  return { exitCode: result.exitCode, configPath: prepared.path, capabilityId: prepared.config.execution.capabilityId, profile: join(temporary, `${name}-profile`) };
}

if (selected.has("revoked")) {
const revoked = await prepare("revoked");
const revocation = await admin("revoke", revoked);
const revokedResult = await host("revoked", revoked, 'Call chio_execute once with tool write_file and arguments {"path":"/workspace/pi-revoked.txt","content":"forbidden revoked effect"}. Do not retry. Report actual result.');
await writeFile(join(evidence, "revocation.json"), JSON.stringify({ revocation, host: revokedResult }, null, 2) + "\n");
console.log("Actual Pi revoked-capability case completed; inspect retained host outcome and resource observer.");
}

if (selected.has("budget")) {
const budget = await prepare("budget");
const client = createMcpExecutionClient(budget.config.execution);
const setup = [];
for (let index = 0; index < 63; index++) {
  const result = await client.execute({ tool: "read_text_file", arguments: { path: "/workspace/pi-final-one.txt" }, requestId: `pi-budget-operator-setup:${budget.config.sessionId}:${index}` });
  setup.push(result);
  if (result.state !== "completed" || result.evidence !== "verified") throw new Error(`Budget setup stopped at ${index}; not accepted`);
  if ((index + 1) % 16 === 0) console.log(`Operator setup recorded ${index + 1} actual kernel reads; this setup is not host acceptance.`);
}
await writeFile(join(evidence, "budget-operator-setup.json"), JSON.stringify({ scope: "63 direct kernel reads prepare the aggregate limit; not counted as real host calls", outcomes: setup, budgetState: await admin("budget", budget) }, null, 2) + "\n");
const budgetResult = await host("budget", budget, 'First call chio_execute read_text_file with {"path":"/workspace/pi-final-one.txt"}. After its result, call chio_execute write_file with {"path":"/workspace/pi-budget-overflow.txt","content":"must be refused by aggregate budget"}. Do not repeat or retry. Report actual results.');
await writeFile(join(evidence, "budget-result.json"), JSON.stringify({ host: budgetResult, budgetState: await admin("budget", budget) }, null, 2) + "\n");
console.log(JSON.stringify({ budget: budgetResult.exitCode }));
}
if (selected.has("fresh-authority")) {
const fresh = await prepare("fresh-authority");
const restored = await host("fresh-authority", fresh, 'Call chio_execute write_file with {"path":"/workspace/pi-fresh-authority.txt","content":"fresh valid authority works"}, then read it back with read_text_file. Use no other paths.');
await writeFile(join(evidence, "fresh-authority.json"), JSON.stringify({ host: restored, budgetState: await admin("budget", fresh) }, null, 2) + "\n");
console.log(JSON.stringify({ fresh: restored.exitCode }));
}
