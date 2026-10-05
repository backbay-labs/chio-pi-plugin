import {randomBytes, timingSafeEqual} from "node:crypto";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {admitsDispatch, createNativeOriginalOperationPort, type NativeDeliveryTransport, type NativeOriginalOperationPort} from "./continuation.js";
import {preparedAuthorityDigest} from "./configured.js";
import {object, OperatorRedactor, readOperatorContext} from "./operator.js";
import {assertNativeGatewayOwner, gatewayIdentity, immutableRequest, leaseParentMappings, openParentMappings, PARENT_MAPPING_LIMIT, type ContinuationBinding} from "./parent-mappings.js";
import {canonicalJson, frozenJson} from "./tool-registry.js";
import {PRIVATE_LIMIT, sha256} from "./private-state.js";
import type {KernelRequest} from "./extension.js";

/** Only the trusted launcher holds this native transport and its credential. */
export interface ParentNativeGateway extends NativeDeliveryTransport {
  readonly url: string;
  readonly port: number;
  readonly token: string;
}
async function boundedResponse(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > PRIVATE_LIMIT) {await reader.cancel(); throw new Error("Bounded native response exceeded");}
      parts.push(next.value);
    }
    return Buffer.concat(parts);
  } finally {reader.releaseLock();}
}
function strictJson(bytes: Buffer): unknown {return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)) as unknown;}
/** The parent and the guest adapter each bound one protected call to 40 s. The
 * native execution timeout must leave 10 s for parent lookups, reservation and
 * framing; a longer native call would outlive both and become an unknown original. */
const UPSTREAM_DEADLINE_MS = 40000;
const MAX_NATIVE_EXECUTION_MS = 30000;

export async function startParentGatewayProxy(options: {configPath: string; binding: ContinuationBinding; native: ParentNativeGateway}) {
  const binding = frozenJson(options.binding);
  const native = options.native; const target = new URL(native.url);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || target.port !== String(native.port) || target.pathname !== "/mcp"
    || target.username || target.password || target.search || target.hash || !/^[A-Za-z0-9_-]{43}$/.test(native.token)) throw new Error("Trusted proxy requires the exact native loopback gateway target");
  const context = await readOperatorContext(options.configPath, new OperatorRedactor());
  if (canonicalJson(binding) !== canonicalJson({authorityDigest: preparedAuthorityDigest(context.config, context.registry), registryDigest: context.registry.digest})) throw new Error("Trusted proxy authority binding mismatch");
  const nativeTimeout = context.config.execution.timeoutMs ?? MAX_NATIVE_EXECUTION_MS;
  if (!Number.isSafeInteger(nativeTimeout) || nativeTimeout <= 0 || nativeTimeout > MAX_NATIVE_EXECUTION_MS) throw new Error(`Prepared native execution timeoutMs must be at most ${MAX_NATIVE_EXECUTION_MS} so one protected call completes within the parent and guest ${UPSTREAM_DEADLINE_MS} ms deadlines`);
  const mappings = await openParentMappings(context.config.journalDir, binding, context.registry, context.config.sessionId);
  const release = await leaseParentMappings(mappings);
  let originals: NativeOriginalOperationPort;
  try {originals = await createNativeOriginalOperationPort({...options, mappings});}
  catch (error) {await release(); throw error;}
  const token = randomBytes(32).toString("base64url");
  let port = 0; let closed = false; let pending = 0;
  let initialization: "new" | "attempted" | "ready" | "failed" = "new";
  let session = ""; let toolLine = Promise.resolve();
  const controllers = new Set<AbortController>();
  const json = (response: ServerResponse, status: number, value: unknown) => {if (!response.destroyed && !response.writableEnded) response.writeHead(status, {"Content-Type": "application/json", "Cache-Control": "no-store"}).end(JSON.stringify(value));};
  const authorized = (value: string | undefined) => {const expected = Buffer.from(`Bearer ${token}`); const received = Buffer.from(value ?? ""); return received.length === expected.length && timingSafeEqual(received, expected);};
  const server = createServer((request, response) => {
    if (pending >= 32) {json(response, 503, {error: "bounded parent queue full"}); request.resume(); return;}
    pending++;
    void handle(request, response).catch(() => json(response, 500, {error: "parent state or native transport unresolved; retain original identity"})).finally(() => pending--);
  });
  server.requestTimeout = 10000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000; server.maxHeadersCount = 32;
  async function forward(bytes: Buffer, method: string, response: ServerResponse): Promise<unknown> {
    await assertNativeGatewayOwner(mappings);
    if (closed) throw new Error("Parent proxy closed; no native forward");
    const controller = new AbortController(); controllers.add(controller);
    try {
      const upstream = await fetch(target.href, {method: "POST", redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(UPSTREAM_DEADLINE_MS)]),
        headers: {Host: target.host, Authorization: `Bearer ${native.token}`, "Content-Type": "application/json", ...(session && method !== "initialize" ? {"Mcp-Session-Id": session} : {})}, body: new Uint8Array(bytes).buffer});
      const body = await boundedResponse(upstream);
      if (![200, 202].includes(upstream.status)) throw new Error("Native fixed target refused request");
      let message: unknown;
      if (upstream.status === 200) message = strictJson(body);
      if (method === "initialize") {
        const selected = upstream.headers.get("mcp-session-id");
        if (!selected || !/^[A-Za-z0-9_-]{1,256}$/.test(selected) || !object(message) || !object(message.result) || message.error !== undefined) throw new Error("Native initialization is ambiguous");
        session = selected; initialization = "ready";
      }
      if (method !== "tools/call" && !response.destroyed && !response.writableEnded) response.writeHead(upstream.status, {"Content-Type": "application/json", "Cache-Control": "no-store", ...(method === "initialize" ? {"Mcp-Session-Id": session} : {})}).end(body);
      return message;
    } finally {controllers.delete(controller);}
  }
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (closed || request.url !== "/mcp" || request.headers.host !== `127.0.0.1:${port}` || request.headers.origin || !authorized(request.headers.authorization)) {json(response, 403, {error: "restricted parent transport"}); request.resume(); return;}
    if (request.method !== "POST") {json(response, 405, {error: "bounded MCP POST required"}); request.resume(); return;}
    if (request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json" || request.headers["content-encoding"] !== undefined) {json(response, 415, {error: "unencoded JSON required"}); request.resume(); return;}
    const parts: Buffer[] = []; let length = 0;
    const timer = setTimeout(() => request.destroy(), 10000);
    try {
      for await (const chunk of request) {
        length += chunk.length;
        if (length > PRIVATE_LIMIT) {json(response, 413, {error: "bounded request exceeded"}); request.resume(); return;}
        parts.push(Buffer.from(chunk));
      }
    } finally {clearTimeout(timer);}
    const bytes = Buffer.concat(parts); let message: unknown;
    try {message = strictJson(bytes);}
    catch {json(response, 400, {error: "strict UTF-8 JSON required"}); return;}
    if (!object(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string" || Object.keys(message).some(key => !["jsonrpc", "method", "id", "params"].includes(key))) {json(response, 400, {error: "invalid bounded RPC"}); return;}
    const method = message.method; const notification = message.id === undefined;
    const fail = (text: string) => json(response, 200, {jsonrpc: "2.0", id: message.id ?? null, error: {code: -32603, message: text}});
    if (!notification && typeof message.id !== "string" && !Number.isSafeInteger(message.id)) {json(response, 400, {error: "invalid raw RPC identity"}); return;}
    if (method === "initialize") {
      if (notification || initialization !== "new" || request.headers["mcp-session-id"]) {json(response, 409, {error: "parent initialization already attempted"}); return;}
      initialization = "attempted";
      try {await forward(bytes, method, response);} catch {initialization = "failed"; throw new Error("Native initialization unresolved; no replacement transport");}
      return;
    }
    if (initialization !== "ready" || request.headers["mcp-session-id"] !== session) {json(response, 403, {error: "exact native session required"}); return;}
    if (notification) {
      if (!["notifications/initialized", "notifications/cancelled"].includes(method)) {json(response, 403, {error: "notification refused"}); return;}
      await forward(bytes, method, response); return;
    }
    if (method === "ping" || method === "tools/list") {await forward(bytes, method, response); return;}
    // The frozen guest ACK route would set hostDeliveryConfirmed from guest
    // knowledge alone. It is excluded without exception from this transport.
    if (method !== "tools/call") {json(response, 403, {error: "parent method refused"}); return;}
    if (typeof message.id !== "string" || !object(message.params) || Object.keys(message.params).sort().join(",") !== "arguments,name" || typeof message.params.name !== "string") {fail("complete native logical call required"); return;}
    let tuple: unknown;
    try {tuple = JSON.parse(message.id);}
    catch {fail("exact original logical RPC identity required"); return;}
    if (!Array.isArray(tuple) || tuple.length !== 2 || tuple.some(value => typeof value !== "string") || JSON.stringify(tuple) !== message.id) {fail("exact original logical RPC identity required"); return;}
    let logical: KernelRequest;
    try {logical = immutableRequest(context.registry, {sessionId: tuple[0], toolCallId: tuple[1], tool: message.params.name, arguments: message.params.arguments as Record<string, unknown>});}
    catch {fail("arguments or logical caller differ from the immutable registry"); return;}
    const dispatch = async () => {
      const metadata = (nativeRequestId: string) => ({chioPiOriginalIdentity: {schema: "chio.pi.original-identity.v1", binding, rpcId: message.id, requestDigest: sha256(canonicalJson(logical)), nativeRequestId}});
      // Before any reservation the parent has forwarded nothing for this logical
      // request. Answer as the native gateway does for its own pre-dispatch
      // refusals: a definite not_dispatched outcome for the would-be identity.
      const refused = (reason: string) => {
        const nativeRequestId = gatewayIdentity(context.config.sessionId, session, logical).nativeRequestId;
        json(response, 200, {jsonrpc: "2.0", id: message.id, result: {isError: true, content: [{type: "text", text: JSON.stringify({state: "not_dispatched", evidence: "unverified", requestId: nativeRequestId, reason})}], _meta: metadata(nativeRequestId)}});
      };
      // A retained identity may already have completed: report its original,
      // even while closing, and never answer it as not dispatched.
      const prior = await mappings.find(logical);
      if (!prior && closed) {refused("parent closed; no forward"); return;}
      if (prior) {
        const original = await originals.lookup(logical);
        const outcome = original.outcome ?? {state: "unknown", evidence: "unverified", requestId: original.nativeRequestId, reason: "reserved original has no authoritative completion; no automatic retry"};
        json(response, 200, {jsonrpc: "2.0", id: message.id, result: {isError: original.state !== "completed", content: [{type: "text", text: JSON.stringify(outcome)}], _meta: metadata(original.nativeRequestId)}}); return;
      }
      if (logical.tool !== "chio_resume" && (await mappings.all()).length >= PARENT_MAPPING_LIMIT) {refused("parent mapping capacity reached; original recovery remains available; select a new operator-prepared session for fresh work"); return;}
      const inventory = await originals.inventory();
      if (!admitsDispatch(inventory, logical)) {
        refused(logical.tool === "chio_resume" && !inventory.operations.some(op => op.nativeRequestId === logical.arguments.requestId && op.state === "awaiting_approval")
          ? "explicit resume requires the retained original pending approval" : "native original or parent reservation remains fenced; no fresh effect"); return;
      }
      // A queued call whose guest connection already closed would complete with
      // nobody to receive it, leaving an unacknowledged original that fences the
      // session. Nothing is reserved or forwarded for it.
      if (closed || response.destroyed) return;
      const reservation = await mappings.reserve(logical, session);
      if (!reservation.created) {fail("logical identity already retained; never forward again"); return;}
      // This reservation and directory are fsynced before the native request is
      // opened. Response loss or cancellation never proves no dispatch.
      const wire = await forward(bytes, method, response);
      if (!object(wire) || wire.jsonrpc !== "2.0" || wire.id !== message.id || !object(wire.result)) throw new Error("Invalid native original response");
      const original = await originals.lookup(logical);
      await mappings.update(logical, {nativeObserved: {state: original.state, ...(original.outcome === undefined ? {} : {outcomeDigest: sha256(canonicalJson(original.outcome))})}});
      json(response, 200, {...wire, result: {...wire.result, _meta: metadata(reservation.mapping.identity.nativeRequestId)}});
    };
    const job = toolLine.then(dispatch);
    toolLine = job.catch(() => undefined);
    try {await job;} catch {fail("parent reservation or native original unresolved; preserve the original fence");}
  }
  try {
    await new Promise<void>((done, reject) => {server.once("error", reject); server.listen(0, "127.0.0.1", done);});
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing parent proxy address"); port = address.port;
  } catch (error) {await release(); throw error;}
  return {url: `http://127.0.0.1:${port}/mcp`, port, token, originals,
    async close() {
      if (closed) return; closed = true;
      for (const controller of controllers) controller.abort();
      server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await toolLine; await release();
    }};
}
