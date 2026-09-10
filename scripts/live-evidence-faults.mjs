import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const source = JSON.parse(await readFile(process.argv[2], "utf8"));
const directory = await mkdtemp(join(tmpdir(), "chio-pi-evidence-fault-"));
const evidence = resolve(process.env.CHIO_PI_EVIDENCE_DIR ?? "evidence/2026-09-09/final-bridge68b5c466");
await mkdir(evidence, { recursive: true });
const cli = resolve(process.env.CHIO_PI_CANDIDATE_CLI ?? "dist/cli.js");
for (const variant of ["substituted-output", "substituted-request", "lost-response"]) {
  const observations = [];
  const proxy = createServer(async (request, response) => {
    try {
      const body = Buffer.concat(await Array.fromAsync(request)).toString();
      const payload = body ? JSON.parse(body) : {};
      const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !["host", "connection", "content-length", "transfer-encoding"].includes(name)));
      const upstreamUrl = `${new URL(source.execution.endpoint).origin}/${request.url.replace(/^\/+/, "")}`;
      const upstream = await fetch(upstreamUrl, { method: request.method, headers, body: body || undefined, redirect: "error" });
      let text = await upstream.text();
      if (payload.method === "tools/call") {
        await writeFile(join(evidence, `${variant}-upstream-response.txt`), text);
        observations.push({ method: payload.method, requestId: payload.params?._meta?.chioRequestId, upstreamStatus: upstream.status, responseBytes: text.length, variant });
        if (variant === "lost-response") return;
        const transform = message => {
          const envelope = message?.result?._meta?.chioEvidence;
          if (!envelope) throw new Error("Expected execution envelope not present in fault observer");
          if (variant === "substituted-output") envelope.output = { content: [{ type: "text", text: "forged output" }] };
          else envelope.receipt.action.parameters.path = "/workspace/pi-substituted-wrong-path.txt";
          return message;
        };
        if (text.trimStart().startsWith("{")) text = JSON.stringify(transform(JSON.parse(text)));
        else text = text.split("\n").map(line => line.startsWith("data: ") ? `data: ${JSON.stringify(transform(JSON.parse(line.slice(6))))}` : line).join("\n");
      }
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
      response.end(text);
    } catch (error) {
      observations.push({ proxyError: String(error), cause: error.cause?.message });
      response.writeHead(502); response.end("fault proxy failed");
    }
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const config = structuredClone(source);
  const endpoint = new URL(source.execution.endpoint);
  endpoint.port = String(proxy.address().port); endpoint.hostname = "127.0.0.1";
  config.execution.endpoint = endpoint.href.replace(/\/$/, "");
  config.execution.timeoutMs = 2000;
  const configPath = join(directory, `${variant}.json`);
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const profile = join(directory, `${variant}-profile`);
  const prompt = `Call chio_execute exactly once with tool write_file and arguments ${JSON.stringify({ path: `/workspace/pi-${variant}.txt`, content: variant })}. Report the actual result. Do not retry.`;
  async function runHost(suffix, text) {
    const stdout = []; const stderr = [];
    const child = spawn(process.execPath, [cli, "--config", configPath, "--profile", profile, "--cwd", join(directory, "workspace"), "--provider", "openai", "--model", "gpt-4.1-mini", "--prompt", text], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", data => stdout.push(data)); child.stderr.on("data", data => stderr.push(data));
    const timeout = setTimeout(() => child.kill("SIGTERM"), 60_000);
    const exitCode = await new Promise(resolve => child.on("exit", resolve)); clearTimeout(timeout);
    await writeFile(join(evidence, `live-${variant}${suffix}.jsonl`), Buffer.concat(stdout));
    if (stderr.length) await writeFile(join(evidence, `live-${variant}${suffix}.stderr.txt`), Buffer.concat(stderr));
    return exitCode;
  }
  const exitCode = await runHost("", prompt);
  const restartExitCode = await runHost("-restart", `Call chio_execute exactly once with tool write_file and arguments ${JSON.stringify({ path: `/workspace/pi-${variant}-retry.txt`, content: "must not redispatch" })}. Report the actual result. Do not retry.`);
  proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve));
  await writeFile(join(evidence, `${variant}-fault-observer.json`), JSON.stringify({ variant, recordedAt: new Date().toISOString(), exitCode, restartExitCode, observations, profile, outcome: "verify host rejection, single upstream dispatch, and independent resource state; committed effects may exist" }, null, 2) + "\n");
  console.log(JSON.stringify({ variant, exitCode, restartExitCode, observations }));
}
