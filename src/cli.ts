#!/usr/bin/env node
import { mkdir, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { configuredExecutor, readPreparedConfig } from "./configured.js";
import { createChioPiSession } from "./session.js";

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
  try {
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models-cache.json"), allowModelNetwork: false });
    ({ session } = await createChioPiSession({ cwd, agentDir, modelRuntime, provider: values.get("--provider")!, model: values.get("--model")!, executor: controlled.executor,
      sessionManager: resume ? SessionManager.open(await realpath(resume), sessions, cwd) : SessionManager.create(cwd, sessions),
      toolInventory: config.tools,
    }));
    const current = session;
    stop = () => { void current.abort(); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    session.subscribe(event => {
      if (event.type === "tool_execution_start" || event.type === "tool_execution_end" || event.type === "message_end") process.stdout.write(JSON.stringify(event) + "\n");
    });
    await session.prompt(values.get("--prompt")!, { expandPromptTemplates: false });
    process.stdout.write(JSON.stringify({ type: "chio_session", sessionFile: session.sessionFile, sessionId: session.sessionId }) + "\n");
  } finally {
    if (stop) { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
    session?.dispose();
    await controlled.close();
  }
}

main().catch(error => { process.stderr.write(`Chio Pi refused or failed: ${error instanceof Error ? error.message : "unknown failure"}\n`); process.exitCode = 1; });
