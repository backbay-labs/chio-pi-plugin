import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: string[]) { return Object.keys(value).every(key => allowed.includes(key)); }
function textContent(value: unknown, output = false): boolean {
  if (typeof value === "string") return true;
  return Array.isArray(value) && value.every(item => object(item) && keys(item, ["type", "text", "annotations"]) && item.type === (output ? "output_text" : "input_text") && typeof item.text === "string" && (item.annotations === undefined || Array.isArray(item.annotations) && item.annotations.length === 0));
}

export function validateModelRequest(body: Record<string, unknown>, model: string) {
  const allowed = new Set(["model", "input", "instructions", "tools", "tool_choice", "parallel_tool_calls", "stream", "store", "reasoning", "text", "temperature", "top_p", "max_output_tokens", "service_tier", "include", "truncation", "prompt_cache_key", "prompt_cache_retention", "prompt_cache_options"]);
  if (Object.keys(body).some(key => !allowed.has(key)) || body.model !== model || body.store !== false || body.stream !== true || !Array.isArray(body.input)) throw new Error("Model request exceeds selected mode");
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(tool => !object(tool) || tool.type !== "function" || tool.name !== "chio_execute"))) throw new Error("Hosted or alternate tools are unavailable");
  const choice = body.tool_choice;
  if (choice !== undefined && !["auto", "none", "required"].includes(choice as string) && !(object(choice) && keys(choice, ["type", "name"]) && choice.type === "function" && choice.name === "chio_execute")) throw new Error("Alternate tool choice is unavailable");
  for (const item of body.input) {
    if (!object(item)) throw new Error("Input must contain complete inline items");
    if ((item.type === undefined || item.type === "message") && keys(item, ["type", "role", "content", "id", "status", "phase"]) && ["system", "developer", "user", "assistant"].includes(item.role as string) && textContent(item.content, item.role === "assistant")) {
      // Inline history is sufficient for this non-reasoning model. Never ask
      // the operator's provider account to resolve an item by identifier.
      delete item.id; delete item.status; delete item.phase;
    } else if (item.type === "function_call" && keys(item, ["type", "id", "call_id", "name", "arguments", "status"]) && item.name === "chio_execute" && typeof item.arguments === "string" && typeof item.call_id === "string") {
      delete item.id; delete item.status;
    } else if (item.type === "function_call_output" && keys(item, ["type", "call_id", "output", "id", "status"]) && typeof item.call_id === "string" && textContent(item.output)) {
      delete item.id; delete item.status;
    } else throw new Error("Only complete inline text and Chio function history are supported");
  }
}

/** Operator-owned model transport. It exposes only the selected provider's
 * synchronous function-calling response route, never arbitrary proxying. */
export async function startModelRelay(apiKey: string, model: string) {
  const token = randomBytes(32).toString("hex");
  let port = 0;
  const server = createServer(async (request, response) => {
    const controller = new AbortController();
    response.on("close", () => controller.abort());
    try {
      if (request.method !== "POST" || request.url !== "/v1/responses" || request.headers.authorization !== `Bearer ${token}` || request.headers.origin || request.headers.host !== `127.0.0.1:${port}`) {
        response.writeHead(403); response.end("Model route refused"); return;
      }
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) throw new Error("Model request too large");
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      validateModelRequest(body, model);
      const upstream = await fetch("https://api.openai.com/v1/responses", {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify(body),
      });
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
      if (upstream.body) for await (const data of upstream.body) response.write(data);
      response.end();
    } catch {
      if (!response.headersSent) response.writeHead(502);
      response.end("Model relay refused or failed");
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Model relay failed to bind");
  port = address.port;
  return { port, token, async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
