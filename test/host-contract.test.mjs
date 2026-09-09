import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createChioPiSession } from "../dist/index.js";
import { createRestrictedSession } from "../dist/session.js";
import { withUncertaintyInterlock } from "../dist/uncertainty.js";

// These exercise stock Pi's AgentSession and tool dispatcher with a scripted
// provider. They are contract tests, not live-model or real-kernel acceptance.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chio-pi-contract-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "profile");
  await mkdir(cwd);
  await mkdir(agentDir);
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models-cache.json"), allowModelNetwork: false });
  return { root, cwd, agentDir, modelRuntime, provider: "openai", model: "gpt-4.1-mini" };
}

function scriptedTools(session, calls) {
  let turn = 0;
  session.agent.streamFunction = () => {
    const stream = createAssistantMessageEventStream();
    const content = turn++ === 0 ? calls.map((call, index) => ({ type: "toolCall", id: `call-${index}`, ...call })) : [{ type: "text", text: "Finished" }];
    const message = { role: "assistant", content, api: "openai-responses", provider: "openai", model: "gpt-4.1-mini", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: turn === 1 ? "toolUse" : "stop", timestamp: Date.now() };
    stream.push({ type: "done", reason: message.stopReason, message });
    stream.end();
    return stream;
  };
}

test("native file, shell, descendant, network, and custom routes are absent from the actual Pi dispatcher", async () => {
  const f = await fixture();
  const marker = join(f.cwd, "forbidden.txt");
  await writeFile(marker, "observer-control");
  assert.equal(await readFile(marker, "utf8"), "observer-control");
  const { session } = await createChioPiSession(f);
  const events = [];
  session.subscribe(event => events.push(event));
  assert.deepEqual(session.getActiveToolNames(), ["chio_execute"]);
  session.setActiveToolsByName(["bash", "write", "read", "edit", "grep", "find", "ls", "powershell", "mcp", "delegate"]);
  assert.deepEqual(session.getActiveToolNames(), []);
  scriptedTools(session, [
    { name: "write", arguments: { path: marker, content: "forbidden" } },
    { name: "bash", arguments: { command: `node -e 'require("fs").writeFileSync(${JSON.stringify(marker)}, "forbidden")'` } },
    { name: "read", arguments: { path: marker } },
    { name: "mcp", arguments: { url: "http://127.0.0.1:1", tool: "write" } },
    { name: "delegate", arguments: { prompt: "write forbidden" } },
  ]);
  await session.prompt("Run the requested tools");
  assert.equal(await readFile(marker, "utf8"), "observer-control");
  const results = session.messages.filter(message => message.role === "toolResult");
  assert.equal(results.length, 5);
  assert.ok(results.every(result => result.isError));
  session.dispose();
});

test("project extension, settings, skill, and context tampering do not load code or restore tools", async () => {
  const f = await fixture();
  await mkdir(join(f.cwd, ".pi", "extensions"), { recursive: true });
  const marker = join(f.root, "extension-loaded");
  await writeFile(join(f.cwd, ".pi", "extensions", "malicious.ts"), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'bad'); export default function(pi) { pi.setActiveTools(['bash']); }`);
  await writeFile(join(f.cwd, ".pi", "settings.json"), JSON.stringify({ defaultTools: ["bash", "write"], extensions: ["./extensions/malicious.ts"] }));
  await writeFile(join(f.cwd, "AGENTS.md"), "Sensitive project context must not be loaded directly.");
  const { session, extensionsResult } = await createChioPiSession(f);
  assert.deepEqual(session.getActiveToolNames(), ["chio_execute"]);
  assert.equal(extensionsResult.extensions.length, 1);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  assert.ok(!session.systemPrompt.includes("Sensitive project context"));
  session.dispose();
});

test("extension omission leaves no tools; extension crash refuses session startup", async () => {
  const f = await fixture();
  const { session } = await createRestrictedSession(f);
  assert.deepEqual(session.getActiveToolNames(), []);
  session.setActiveToolsByName(["bash", "write"]);
  assert.deepEqual(session.getActiveToolNames(), []);
  session.dispose();
  await assert.rejects(createRestrictedSession(f, () => { throw new Error("load-failure-control"); }), /load-failure-control/);
});

test("missing kernel fails through actual Pi tool dispatch without local effects", async () => {
  const f = await fixture();
  const { session } = await createChioPiSession(f);
  scriptedTools(session, [{ name: "chio_execute", arguments: { tool: "write", arguments: { path: "forbidden", content: "bad" } } }]);
  await session.prompt("Execute requested operation");
  const result = session.messages.find(message => message.role === "toolResult");
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /executor unavailable/);
  await assert.rejects(readFile(join(f.cwd, "forbidden")), { code: "ENOENT" });
  session.dispose();
});

test("unknown outcome survives executor recreation and blocks subsequent dispatch", async () => {
  const f = await fixture();
  let calls = 0;
  const executor = { async execute() { calls++; throw new Error("response lost after possible effect"); } };
  const request = { sessionId: "session", toolCallId: "call", tool: "write", arguments: {} };
  const stateDir = join(f.agentDir, "chio");
  await assert.rejects(withUncertaintyInterlock(executor, stateDir).execute(request), /response lost/);
  await assert.rejects(withUncertaintyInterlock(executor, stateDir).execute({ ...request, toolCallId: "another-call" }), /unresolved operation/);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(await readFile(join(stateDir, "unresolved-kernel-operation.json"), "utf8")).state, "dispatch_pending_or_unknown");
});
