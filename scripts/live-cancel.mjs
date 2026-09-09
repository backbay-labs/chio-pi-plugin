import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { configuredExecutor, readPreparedConfig, createChioPiSession } from "../dist/index.js";

const config = await readPreparedConfig(process.argv[2]);
const directory = await mkdtemp(join(tmpdir(), "chio-pi-live-cancel-"));
const agentDir = join(directory, "profile");
const cwd = join(directory, "workspace");
await mkdir(cwd);
const controlled = await configuredExecutor(config, agentDir);
const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models-cache.json"), allowModelNetwork: false });
const { session } = await createChioPiSession({ cwd, agentDir, modelRuntime, provider: "openai", model: "gpt-4.1-mini", executor: controlled.executor, toolInventory: config.tools });
const events = [];
let cancelled = false;
session.subscribe(event => {
  if (["tool_execution_start", "tool_execution_end", "message_end"].includes(event.type)) events.push(event);
  if (event.type === "tool_execution_start" && !cancelled) {
    cancelled = true;
    void session.abort();
  }
});
let error;
try {
  await session.prompt('Call chio_execute exactly once with tool write_file and arguments {"path":"/workspace/pi-cancelled.txt","content":"must not dispatch"}. Do not retry.', { expandPromptTemplates: false });
} catch (cause) { error = String(cause); }
finally { session.dispose(); await controlled.close(); }
const evidence = resolve(process.env.CHIO_PI_EVIDENCE_DIR ?? "evidence/2026-09-09");
await mkdir(evidence, { recursive: true });
await writeFile(join(evidence, "live-cancel.json"), JSON.stringify({ recordedAt: new Date().toISOString(), cutpoint: "actual Pi tool_execution_start subscriber aborts before executor dispatch", cancelled, error, events, agentDir }, null, 2) + "\n");
console.log(JSON.stringify({ cancelled, error, toolResults: events.filter(event => event.type === "tool_execution_end").map(event => ({ isError: event.isError, result: event.result })) }));
