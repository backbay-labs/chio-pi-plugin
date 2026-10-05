import {DEFAULT_RUN_LIMITS, providerProfile, type RunBudget} from "./run-limits.js";
import { finishGovernedModelDelivery, releaseGovernedModel, type NativeEmbedding } from "./governance.js";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { zstdDecompressSync } from "node:zlib";
import { lstat, readFile } from "node:fs/promises";
import { canonicalJson, registryInventory, resolveRegistryCall, type ToolRegistry } from "./tool-registry.js";

declare const relayBrand: unique symbol;
export interface GovernedRelayReference {readonly [relayBrand]: true}
const governedRelays = new WeakMap<GovernedRelayReference, {embedding: NativeEmbedding; provider: string; model: string; registryDigest: string; baseUrl: string; token: string; closed: boolean}>();
/** Trusted SDK composition checks ownership, not a lookalike loopback URL. */
export function selectGovernedRelay(reference: GovernedRelayReference | undefined, embedding: NativeEmbedding | undefined, provider: string, model: string, registry: ToolRegistry) {
  const selected = reference && governedRelays.get(reference);
  if (!selected || selected.closed || selected.embedding !== embedding || selected.provider !== provider || selected.model !== model || selected.registryDigest !== registry.digest) throw new Error("Trusted governed model relay unavailable or ownership mismatch");
  return {baseUrl: selected.baseUrl, token: selected.token};
}

export type ModelAuthority = { provider: "openai"; apiKey: string } | { provider: "openai-codex"; accessToken: string; accountId: string };

/** Read native Codex's cache without modifying or refreshing its credentials. */
export async function readCodexAuthority(path: string): Promise<ModelAuthority> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid?.() || stat.size > 1024 * 1024) throw new Error("Native Codex auth must be a private operator-owned file");
  let value;
  try { value = JSON.parse(await readFile(path, "utf8")); }
  catch { throw new Error("Native Codex auth cache is unreadable or malformed"); }
  const token = value?.tokens?.access_token;
  const accountId = value?.tokens?.account_id;
  if (!object(value) || (value.auth_mode !== undefined && value.auth_mode !== "chatgpt") || value.OPENAI_API_KEY != null || typeof token !== "string" || typeof accountId !== "string" || !accountId) throw new Error("Native Codex ChatGPT login required");
  let claims;
  try { claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()); }
  catch { throw new Error("Native Codex access token is malformed"); }
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now() + 60_000) throw new Error("Native Codex login expired; refresh through native Codex before restarting Pi");
  if (claims["https://api.openai.com/auth"]?.chatgpt_account_id !== accountId) throw new Error("Native Codex account binding mismatch");
  return { provider: "openai-codex", accessToken: token, accountId };
}

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: string[]) { return Object.keys(value).every(key => allowed.includes(key)); }
function textContent(value: unknown, output = false): boolean {
  if (typeof value === "string") return true;
  return Array.isArray(value) && value.every(item => object(item) && keys(item, ["type", "text", "annotations"]) && item.type === (output ? "output_text" : "input_text") && typeof item.text === "string" && (item.annotations === undefined || Array.isArray(item.annotations) && item.annotations.length === 0));
}

/** Extract the exact representation emitted by the native Chio extension.
 * This is parsing only. The caller must still validate the signed outcome and
 * match its original private operation before confirming delivery. */
export function nativeToolOutcome(output: unknown): unknown {
  if (Array.isArray(output) && output.length === 1 && output[0]?.type === "input_text") output = output[0].text;
  if (typeof output !== "string") return undefined;
  const prefix = "Chio tool completed with an error: ";
  const prefixed = output.startsWith(prefix);
  try {
    const value: unknown = JSON.parse(prefixed ? output.slice(prefix.length) : output);
    if (prefixed && (!object(value) || value.state !== "completed" || !object(value.result) || value.result.isError !== true)) return undefined;
    return value;
  } catch { return undefined; }
}

export function validateModelRequest(body: Record<string, unknown>, model: string, provider: ModelAuthority["provider"] = "openai", registry?: ToolRegistry) {
  if (!registry) throw new Error("An explicit pinned tool registry is required");
  registryInventory(registry);
  const allowed = new Set(["model", "input", "instructions", "tools", "tool_choice", "parallel_tool_calls", "stream", "store", "reasoning", "text", "temperature", "top_p", "max_output_tokens", "service_tier", "include", "truncation", "prompt_cache_key", "prompt_cache_retention", "prompt_cache_options"]);
  if (Object.keys(body).some(key => !allowed.has(key)) || body.model !== model || body.store !== false || body.stream !== true || !Array.isArray(body.input)) throw new Error("Model request exceeds selected mode");
  const aliases = new Map(registry.tools.map(tool => [tool.name, tool]));
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools) || body.tools.length !== registry.tools.length) throw new Error("Model declarations differ from the pinned registry");
    const declared = new Set<string>();
    for (const tool of body.tools) {
      if (!object(tool) || !keys(tool, ["type", "name", "description", "parameters", "strict"]) || tool.type !== "function"
        || typeof tool.name !== "string" || declared.has(tool.name)
        || ![undefined, null, false].includes(tool.strict as undefined | null | false)) throw new Error("Hosted, deferred or alternate tools are unavailable");
      const pinned = aliases.get(tool.name);
      if (!pinned || tool.description !== pinned.description || canonicalJson(tool.parameters) !== canonicalJson(pinned.parameters)) throw new Error("Model tool schema or description differs from the pinned registry");
      declared.add(tool.name);
    }
  }
  if (body.include !== undefined && (!Array.isArray(body.include) || body.include.some(value => provider !== "openai-codex" || value !== "reasoning.encrypted_content"))) throw new Error("Alternate provider expansions are unavailable");
  const choice = body.tool_choice;
  if (choice !== undefined && !["auto", "none", "required"].includes(choice as string) && !(object(choice) && keys(choice, ["type", "name"]) && choice.type === "function" && typeof choice.name === "string" && aliases.has(choice.name))) throw new Error("Alternate tool choice is unavailable");
  const calls = new Map<string, {tool: string; arguments: Record<string, unknown>}>();
  const delivered = new Set<string>();
  for (const item of body.input) {
    if (!object(item)) throw new Error("Input must contain complete inline items");
    if ((item.type === undefined || item.type === "message") && keys(item, ["type", "role", "content", "id", "status", "phase"]) && ["system", "developer", "user", "assistant"].includes(item.role as string) && textContent(item.content, item.role === "assistant")) {
      // Never ask the operator's provider account to resolve an item by identifier.
      if (provider === "openai-codex" && item.phase !== undefined && (item.role !== "assistant" || !["commentary", "final_answer"].includes(item.phase as string))) throw new Error("Unsupported native assistant phase");
      delete item.id; delete item.status;
      if (provider !== "openai-codex") delete item.phase;
    } else if (item.type === "function_call" && keys(item, ["type", "id", "call_id", "name", "arguments", "status"]) && typeof item.name === "string" && typeof item.arguments === "string" && typeof item.call_id === "string" && item.call_id.length > 0 && item.call_id.length <= 256) {
      if (calls.has(item.call_id)) throw new Error("Duplicate native function call identity");
      calls.set(item.call_id, resolveRegistryCall(registry, item.name, JSON.parse(item.arguments)));
      delete item.id; delete item.status;
    } else if (item.type === "function_call_output" && keys(item, ["type", "call_id", "output", "id", "status"]) && typeof item.call_id === "string" && textContent(item.output)) {
      const call = calls.get(item.call_id);
      if (!call || delivered.has(item.call_id)) throw new Error("Native function output is missing its exact original call");
      const outcome = nativeToolOutcome(item.output);
      if (object(outcome) && ["completed", "denied"].includes(outcome.state as string)) {
        const original = call.tool === "chio_resume" ? {tool: call.arguments.tool, arguments: call.arguments.arguments} : call;
        if (outcome.evidence !== "verified" || typeof outcome.requestId !== "string" || !outcome.requestId || !object(outcome.receipt)
          || outcome.receipt.tool_name !== original.tool || !object(outcome.receipt.action)
          || canonicalJson(outcome.receipt.action.parameters) !== canonicalJson(original.arguments)
          || outcome.state === "completed" && outcome.result === undefined
          || call.tool === "chio_resume" && outcome.requestId !== call.arguments.requestId) throw new Error("Native outcome differs from the pinned function argument binding");
      }
      delivered.add(item.call_id);
      delete item.id; delete item.status;
    } else if (provider === "openai-codex" && item.type === "reasoning" && keys(item, ["type", "id", "summary", "encrypted_content", "status", "content"])
      && typeof item.encrypted_content === "string" && /^[A-Za-z0-9_=-]+$/.test(item.encrypted_content)
      && (item.content === undefined || Array.isArray(item.content) && item.content.length === 0)
      && Array.isArray(item.summary) && item.summary.every(part => object(part) && keys(part, ["type", "text"]) && part.type === "summary_text" && typeof part.text === "string")) {
      // Complete inline encrypted reasoning is required by the native Codex
      // history contract. Identifier-only reasoning remains forbidden.
      delete item.id; delete item.status;
    } else throw new Error("Only complete inline text and Chio function history are supported");
  }
}

/** Operator-owned model transport. It exposes only the selected provider's
 * synchronous function-calling response route, never arbitrary proxying. */
export async function startModelRelay(authority: ModelAuthority, model: string, onToolResults?: (outcomes: unknown[]) => Promise<void>, registry?: ToolRegistry, governance?: {required: boolean; embedding?: NativeEmbedding}, budget?: RunBudget) {
  const profile = providerProfile(authority.provider, model);
  const limits = budget?.limits ?? DEFAULT_RUN_LIMITS;
  if (budget && budget.profile.identity !== profile.identity) throw new Error("Model relay budget profile mismatch");
  authority = Object.freeze({...authority});
  governance = governance ? Object.freeze({...governance}) : undefined;
  if (!registry) throw new Error("An explicit pinned tool registry is required");
  registryInventory(registry);
  if (budget && (budget.binding.registryDigest !== registry.digest || budget.binding.governanceProfile !== (governance?.required ? "required" : "execution-only"))) throw new Error("Model relay budget registry or governance binding mismatch");
  const nonce = randomBytes(32).toString("hex");
  // Native Pi extracts an account claim before making its request. This is
  // an opaque local credential, never an upstream login or signed JWT.
  const token = authority.provider === "openai-codex"
    ? `${Buffer.from('{"typ":"chio-relay"}').toString("base64url")}.${Buffer.from(JSON.stringify({"https://api.openai.com/auth": {chatgpt_account_id: "chio-local-relay"}, nonce})).toString("base64url")}.${nonce}` : nonce;
  const route = authority.provider === "openai-codex" ? "/v1/codex/responses" : "/v1/responses";
  let port = 0;
  const server = createServer(async (request, response) => {
    const controller = new AbortController();
    response.on("close", () => controller.abort());
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      if (request.method !== "POST" || request.url !== route || request.headers.authorization !== `Bearer ${token}` || request.headers.origin || request.headers.host !== `127.0.0.1:${port}`) {
        response.writeHead(403); response.end("Model route refused"); return;
      }
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) throw new Error("Model request too large");
        chunks.push(chunk);
      }
      let raw = Buffer.concat(chunks);
      if (request.headers["content-encoding"] === "zstd" && authority.provider === "openai-codex") raw = zstdDecompressSync(raw, {maxOutputLength: 8 * 1024 * 1024});
      else if (request.headers["content-encoding"]) throw new Error("Unsupported model body encoding");
      const body = JSON.parse(raw.toString()) as Record<string, unknown>;
      validateModelRequest(body, model, authority.provider, registry);
      body.parallel_tool_calls = false;
      const outcomes: unknown[] = [];
      for (const item of body.input as Record<string, unknown>[]) {
        if (item.type !== "function_call_output") continue;
        const outcome = nativeToolOutcome(item.output);
        if (outcome !== undefined) outcomes.push(outcome);
      }
      await onToolResults?.(outcomes);
      const headers: Record<string, string> = {"content-type": "application/json", accept: "text/event-stream"};
      if (authority.provider === "openai-codex") {
        headers.authorization = `Bearer ${authority.accessToken}`;
        headers["ChatGPT-Account-Id"] = authority.accountId;
        headers["OpenAI-Beta"] = "responses=experimental";
        headers.originator = "pi";
      } else headers.authorization = `Bearer ${authority.apiKey}`;
      if (budget) await budget.reserveRequest(body);
      else if (profile.hardOutputTokens) {
        const requested = body.max_output_tokens ?? limits.maxOutputTokens;
        if (!Number.isSafeInteger(requested) || Number(requested) < 16) throw new Error("Unsupported token ceiling");
        body.max_output_tokens = Math.min(Number(requested), limits.maxOutputTokens);
      } else delete body.max_output_tokens;
      const remaining = budget ? budget.deadline - Date.now() : limits.providerTimeoutMs;
      if (remaining <= 0 || controller.signal.aborted) throw new Error("Model deadline reached");
      timeout = setTimeout(() => controller.abort(), Math.min(limits.providerTimeoutMs, remaining));
      const finalJson = JSON.stringify(body);
      const upstreamOperation = governance?.required ? releaseGovernedModel(governance.embedding, finalJson, {provider: authority.provider, model, route: authority.provider === "openai-codex" ? "https://chatgpt.com/backend-api/codex/responses" : "https://api.openai.com/v1/responses", accountId: authority.provider === "openai-codex" ? authority.accountId : null, ...(budget ? {profileIdentity: profile.identity, limitsIdentity: budget.identity} : {})}, controller.signal) : fetch(authority.provider === "openai-codex" ? "https://chatgpt.com/backend-api/codex/responses" : "https://api.openai.com/v1/responses", {
        method: "POST", redirect: "error", signal: controller.signal,
        headers, body: finalJson,
      });
      const upstream = await abortable(upstreamOperation.then(result => {
        if (controller.signal.aborted) {void result.body?.cancel().catch(() => {}); throw new Error("Late model response interrupted");}
        return result;
      }), controller.signal);
      const writeHeaders = () => {if (!response.headersSent) response.writeHead(upstream.status, {"content-type": upstream.headers.get("content-type") ?? "application/json"});};
      if (upstream.body) {
        reader = upstream.body.getReader(); let received = 0;
        while (true) {
          const item = await abortable(reader.read(), controller.signal);
          if (item.done) break;
          received += item.value.byteLength;
          if (received > limits.maxResponseBytes) throw new Error("Provider response size exceeded");
          writeHeaders();
          if (!response.write(item.value)) await abortable(new Promise<void>(resolve => response.once("drain", resolve)), controller.signal);
        }
      }
      if (governance?.required) {
        if (controller.signal.aborted) throw new Error("Original model delivery uncertain");
        finishGovernedModelDelivery(upstream);
      }
      writeHeaders();response.end();
    } catch {
      controller.abort();
      void reader?.cancel().catch(() => {});
      if (!response.headersSent) {response.writeHead(502); response.end("Model relay refused or failed");}
      else response.destroy();
    } finally { if (timeout) clearTimeout(timeout); reader?.releaseLock(); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Model relay failed to bind");
  port = address.port;
  const governanceReference = governance?.required && governance.embedding ? Object.freeze({}) as GovernedRelayReference : undefined;
  if (governanceReference) governedRelays.set(governanceReference, {embedding: governance!.embedding!, provider: authority.provider, model, registryDigest: registry.digest, baseUrl: `http://127.0.0.1:${port}/v1`, token, closed: false});
  return { port, token, governanceReference, async close() {
    if (governanceReference) governedRelays.get(governanceReference)!.closed = true;
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

/** Abort even if a provider implementation ignores the signal. Native
 * release uncertainty stays in its original native fence. */
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("Model request interrupted"));
    if (signal.aborted) {abort(); void operation.catch(() => {}); return;}
    signal.addEventListener("abort", abort, {once:true});
    operation.then(resolve,reject).finally(() => signal.removeEventListener("abort",abort));
  });
}
