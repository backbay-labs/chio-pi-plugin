import {createHash} from "node:crypto";
import {Ajv} from "ajv";
import {canonicalJson, frozenJson} from "../tool-registry.js";
import {privateDirectory, regularFile, within} from "./paths.js";

export const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");
export const MAX_JSONRPC_ID_LENGTH = 512;
// Include the longest serialized admitted ID, fixed JSON-RPC result wrapper and
// trailing newline. Payload capacity must survive any later native redelivery ID.
export const MCP_RESULT_ENVELOPE_BYTES = Buffer.byteLength(JSON.stringify({jsonrpc: "2.0", id: "\0".repeat(MAX_JSONRPC_ID_LENGTH), result: null}) + "\n") - 4;
export function fitsMcpTransport(value: unknown, maxOutputBytes: number): boolean {return Buffer.byteLength(JSON.stringify(value)) + MCP_RESULT_ENVELOPE_BYTES <= maxOutputBytes;}
/** Serialized byte length of plain JSON data. Equal to its canonical encoding's
 * length (key order does not change size), without the 1 MiB binding limit. */
export function jsonBytes(value: unknown): number {return Buffer.byteLength(JSON.stringify(value));}
// Largest admitted tools/call request around its arguments: the longest
// JSON-RPC ID and attempt ID with six-byte escapes, the longest tool name, the
// native metadata and the trailing newline.
export const MCP_REQUEST_ENVELOPE_BYTES = jsonBytes({jsonrpc: "2.0", id: "\0".repeat(MAX_JSONRPC_ID_LENGTH), method: "tools/call", params: {name: "publish_artifact", arguments: null, _meta: {chioRequestId: "0".repeat(64), chioOperationId: "0".repeat(64), chioAttemptId: "\0".repeat(512), chioTransportKeyEpoch: Number.MAX_SAFE_INTEGER, chioCallerCapabilitySha256: "0".repeat(64)}}}) + 1 - 4;
// The input reader carries every argument object within Chio's 1 MiB canonical
// argument binding, so the configured maxInputBytes is answered with a known
// input_bound refusal instead of closing the transport. Longer lines still close.
export const MAX_REQUEST_FRAME_BYTES = 1024 * 1024 + MCP_REQUEST_ENVELOPE_BYTES;
export interface Recipe {name: string; executable: string; executableSha256: string; argv: string[]; timeoutMs: number; outputBytes: number; graceMs: number; runtimeFiles: {path: string; sha256: string; mountPath?: string}[]; recipeSha256: string}
export interface ResourceBounds {maxFileBytes: number; maxRepositoryBytes: number; maxFiles: number; maxReadBytes: number; maxSearchMatches: number; maxReadMany: number; maxPatchBytes: number; maxInputBytes: number; maxQueuedCalls: number; maxOutputBytes: number}
export interface CodingConfig {schema: "chio.coding-resource.v1"; resourceOwnerId: string; workspaceId: string; repositoryRoot: string; stateRoot: string; artifactRoot: string; jobRoot: string; allowedCallerCapabilitySha256: string[]; bounds: ResourceBounds; recipes: Recipe[]}
export interface LoadedConfig {config: Readonly<CodingConfig>; digest: string}
const digestSchema = {type: "string", pattern: "^[a-f0-9]{64}$"};
const text = {type: "string", minLength: 1, maxLength: 1024};
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({type: "object", properties, required, additionalProperties: false});
const boundLimits: Record<keyof ResourceBounds, [number, number]> = {
  maxFileBytes: [1, 4 * 1024 * 1024], maxRepositoryBytes: [1, 64 * 1024 * 1024], maxFiles: [1, 10000], maxReadBytes: [1, 256 * 1024], maxSearchMatches: [1, 1000], maxReadMany: [1, 64], maxPatchBytes: [1, 512 * 1024], maxInputBytes: [1024, 1024 * 1024], maxQueuedCalls: [1, 32], maxOutputBytes: [4096, 1024 * 1024],
};
const recipeProperties = {name: {type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"}, executable: text, executableSha256: digestSchema, argv: {type: "array", maxItems: 32, items: {type: "string", maxLength: 1024}}, timeoutMs: {type: "integer", minimum: 1, maximum: 600000}, outputBytes: {type: "integer", minimum: 1, maximum: 256 * 1024}, graceMs: {type: "integer", minimum: 1, maximum: 5000}, runtimeFiles: {type: "array", maxItems: 256, items: object({path: text, sha256: digestSchema, mountPath: text}, ["path", "sha256"])}, recipeSha256: digestSchema};
const schema = object({schema: {const: "chio.coding-resource.v1"}, resourceOwnerId: text, workspaceId: text, repositoryRoot: text, stateRoot: text, artifactRoot: text, jobRoot: text, allowedCallerCapabilitySha256: {type: "array", minItems: 1, maxItems: 64, uniqueItems: true, items: digestSchema}, bounds: object(Object.fromEntries(Object.entries(boundLimits).map(([key, [minimum, maximum]]) => [key, {type: "integer", minimum, maximum}]))), recipes: {type: "array", maxItems: 32, items: object(recipeProperties)}});
const validate = new Ajv({strict: true, ownProperties: true}).compile(schema);
export function recipeDigest(recipe: Omit<Recipe, "recipeSha256"> | Recipe): string {const {recipeSha256: _ignored, ...body} = recipe as Recipe; return sha256(canonicalJson(body));}
export async function loadCodingConfig(path: string): Promise<LoadedConfig> {
  const bytes = await regularFile(path, {private: true, maxBytes: 256 * 1024});
  let input: unknown;
  try {input = JSON.parse(bytes.toString("utf8"));} catch {throw new Error("Invalid private operator JSON; input bytes are withheld");}
  if (!validate(input)) throw new Error("Operator configuration differs from its closed schema");
  const config = frozenJson(input as unknown as CodingConfig);
  const roots = [config.repositoryRoot, config.stateRoot, config.artifactRoot, config.jobRoot];
  for (const root of roots) await privateDirectory(root);
  for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) if (within(roots[i], roots[j]) || within(roots[j], roots[i])) throw new Error("Repository, state, artifact and job roots must be disjoint");
  if (roots.some(root => within(root, path))) throw new Error("Private operator configuration must be outside resource roots");
  // The input bound charges every call the fixed request envelope, so the patch
  // reserve keeps its 8192 structural bytes after that charge.
  if (config.bounds.maxReadBytes + 8192 + MCP_RESULT_ENVELOPE_BYTES > config.bounds.maxOutputBytes || config.bounds.maxPatchBytes + 8192 + MCP_REQUEST_ENVELOPE_BYTES > config.bounds.maxInputBytes) throw new Error("Configured input and output bounds cannot contain admitted work");
  const names = new Set<string>();
  for (const recipe of config.recipes) {
    // Stdout/stderr are encoded into RecipeResult JSON, then content.text JSON.
    // A NUL input byte needs seven wire bytes after both encodings.
    if (names.has(recipe.name) || recipeDigest(recipe) !== recipe.recipeSha256 || recipe.outputBytes * 7 + 8192 + MCP_RESULT_ENVELOPE_BYTES > config.bounds.maxOutputBytes) throw new Error("Recipe identity, digest or output bounds differ from selected pins");
    names.add(recipe.name);
    if (roots.some(root => within(root, recipe.executable))) throw new Error("Recipe executable cannot be resource-controlled");
    const files = new Set<string>();
    for (const file of recipe.runtimeFiles) {if (files.has(file.path) || roots.some(root => within(root, file.path))) throw new Error("Runtime library inventory must be exact and outside resource roots"); files.add(file.path);}
  }
  return {config, digest: sha256(canonicalJson(config))};
}
