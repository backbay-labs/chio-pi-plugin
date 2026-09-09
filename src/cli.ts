#!/usr/bin/env node
import { lstat, mkdir, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { configuredExecutor, readPreparedConfig } from "./configured.js";
import { createChioPiSession } from "./session.js";
import { terminalState } from "./terminal.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write("Usage: chio-pi --config /absolute/prepared.json --profile /absolute/profile --cwd /absolute/disposable-workspace --provider openai --model gpt-4.1-mini --prompt 'task' [--resume /absolute/profile/sessions/session.jsonl]\n");
    return;
  }
  const values = new Map<string, string>();
  const names = new Set(["--config", "--profile", "--cwd", "--provider", "--model", "--prompt", "--resume"]);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]; const value = args[index + 1];
    if (!name || !names.has(name) || values.has(name) || !value) throw new Error("Invalid or missing argument; use chio-pi --help");
    values.set(name, value);
  }
  for (const name of [...names].filter(name => name !== "--resume")) if (!values.has(name)) throw new Error(`Required argument ${name}`);
  const config = await readPreparedConfig(values.get("--config")!);
  const agentDir = resolve(values.get("--profile")!);
  const cwd = resolve(values.get("--cwd")!);
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  const sessions = join(agentDir, "sessions");
  await mkdir(sessions, { recursive: true, mode: 0o700 });
  const resume = values.get("--resume");
  if (resume && !(await realpath(resume)).startsWith((await realpath(sessions)) + sep)) throw new Error("Resume must reference this profile's retained session");
  const controlled = await configuredExecutor(config, agentDir);
  let session;
  let stop: (() => void) | undefined;
  let termination: "SIGINT" | "SIGTERM" | undefined;
  let toolErrors = 0;
  try {
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models-cache.json"), allowModelNetwork: false });
    ({ session } = await createChioPiSession({ cwd, agentDir, modelRuntime, provider: values.get("--provider")!, model: values.get("--model")!, executor: controlled.executor,
      modelBaseUrl: process.env.CHIO_PI_MODEL_BASE_URL,
      sessionManager: resume ? SessionManager.open(await realpath(resume), sessions, cwd) : SessionManager.create(cwd, sessions),
      toolInventory: config.tools,
    }));
    const current = session;
    const interrupt = () => { termination = "SIGINT"; void current.abort(); };
    const terminate = () => { termination = "SIGTERM"; void current.abort(); };
    stop = () => { process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); };
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    session.subscribe(event => {
      if (event.type === "tool_execution_end" && event.isError) toolErrors++;
      if (event.type === "tool_execution_start" || event.type === "tool_execution_end" || event.type === "message_end") process.stdout.write(JSON.stringify(event) + "\n");
    });
    await session.prompt(values.get("--prompt")!, { expandPromptTemplates: false });
    const assistant = session.messages.findLast(message => message.role === "assistant");
    const providerStopReason = assistant && "stopReason" in assistant ? assistant.stopReason : undefined;
    let unresolved = false;
    try { await lstat(join(agentDir, "chio", "unresolved-kernel-operation.json")); unresolved = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") unresolved = true; }
    const { outcome, exitCode } = terminalState({ unresolved, termination, providerStopReason, toolErrors });
    process.exitCode = exitCode;
    process.stdout.write(JSON.stringify({ type: "chio_session", sessionFile: session.sessionFile, sessionId: session.sessionId, outcome, toolErrors, providerStopReason }) + "\n");
  } finally {
    stop?.();
    session?.dispose();
    await controlled.close();
  }
}

main().catch(error => { process.stderr.write(`Chio Pi refused or failed: ${error instanceof Error ? error.message : "unknown failure"}\n`); process.exitCode = 1; });
