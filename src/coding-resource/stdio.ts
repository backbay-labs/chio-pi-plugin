import {TextDecoder} from "node:util";
import type {Readable, Writable} from "node:stream";
import type {CodingResource} from "./participant.js";

interface Request {jsonrpc: "2.0"; id?: string | number; method: string; params?: Record<string, unknown>}
export async function serveCodingResource(participant: CodingResource, input: Readable, output: Writable): Promise<number> {
  const queue: Request[] = []; let partial: Buffer[] = []; let partialBytes = 0; let ended = false; let failed = false; let processing = false;
  let finish!: () => void; const completion = new Promise<void>(resolve => finish = resolve);
  const fail = () => {if (failed) return; failed = true; queue.length = 0; partial = []; participant.abort(); input.destroy(); if (!processing) finish();};
  const write = async (message: unknown) => {
    const bytes = Buffer.from(JSON.stringify(message) + "\n"); if (bytes.length > participant.bounds.maxOutputBytes) throw new Error("Bounded output exceeded");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Native output did not drain within bound")), 5000);
      output.write(bytes, error => {clearTimeout(timer); error ? reject(error) : resolve();});
    });
  };
  const dispatch = async (request: Request): Promise<unknown> => {
    const params = request.params ?? {};
    switch (request.method) {
      case "initialize": return {protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18"].includes(params.protocolVersion as string) ? params.protocolVersion : "2024-11-05", capabilities: {tools: {}}, serverInfo: {name: "chio-coding-resource", version: "0.1.0"}};
      case "tools/list": return {tools: participant.tools.inventory};
      case "tools/call": {
        if (typeof params.name !== "string" || Object.keys(params).some(key => !["name", "arguments", "_meta"].includes(key))) throw new Error("Closed native tools/call parameters are required");
        return await participant.call(params.name, params.arguments, params._meta);
      }
      default: return undefined;
    }
  };
  const pump = async () => {
    if (processing) return; processing = true;
    try {
      while (!failed && queue.length) {
        const request = queue.shift()!;
        if (request.id === undefined) {if (request.method !== "notifications/initialized") throw new Error("Only initialized notification is supported"); continue;}
        const value = await dispatch(request);
        if (failed) break;
        await write(value === undefined ? {jsonrpc: "2.0", id: request.id, error: {code: -32601, message: "Method is outside the bounded resource protocol"}} : {jsonrpc: "2.0", id: request.id, result: value});
      }
    } catch {fail();}
    finally {processing = false; if (failed || ended && queue.length === 0) finish();}
  };
  const onData = (chunk: Buffer) => {
    if (failed) return;
    try {
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(10, start); const stop = newline < 0 ? chunk.length : newline;
        const part = chunk.subarray(start, stop);
        if (partialBytes + part.length > participant.bounds.maxInputBytes) throw new Error("Input frame exceeds bound before newline");
        partial.push(part); partialBytes += part.length;
        if (newline < 0) break;
        const line = new TextDecoder("utf8", {fatal: true}).decode(Buffer.concat(partial, partialBytes)); partial = []; partialBytes = 0;
        const message = JSON.parse(line) as Request;
        if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string" || message.method.length > 128 || message.id !== undefined && !(typeof message.id === "string" && message.id.length <= 512 || typeof message.id === "number" && Number.isSafeInteger(message.id)) || message.params !== undefined && (typeof message.params !== "object" || message.params === null || Array.isArray(message.params)) || Object.keys(message).some(key => !["jsonrpc", "id", "method", "params"].includes(key))) throw new Error("Invalid bounded JSONL request");
        if (queue.length >= participant.bounds.maxQueuedCalls) throw new Error("Input queue exceeds bound"); queue.push(message); start = newline + 1;
      }
      void pump();
    } catch {fail();}
  };
  const onEnd = () => {ended = true; if (partialBytes) fail(); else if (!processing) finish();};
  input.on("data", onData); input.once("end", onEnd); input.once("error", fail); output.once("error", fail);
  process.once("SIGTERM", fail); process.once("SIGINT", fail);
  try {await completion;} finally {
    input.off("data", onData); input.off("end", onEnd); input.off("error", fail); output.off("error", fail);
    process.off("SIGTERM", fail); process.off("SIGINT", fail);
    await participant.close().catch(() => {failed = true;});
  }
  return failed ? 1 : 0;
}
