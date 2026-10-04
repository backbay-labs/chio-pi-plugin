import {createHash} from "node:crypto";
import {Ajv} from "ajv";
import {canonicalJson, frozenJson} from "../tool-registry.js";
import {privateDirectory, regularFile, within} from "./paths.js";

export const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");
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
  if (config.bounds.maxReadBytes + 8192 > config.bounds.maxOutputBytes || config.bounds.maxPatchBytes + 8192 > config.bounds.maxInputBytes) throw new Error("Configured input and output bounds cannot contain admitted work");
  const names = new Set<string>();
  for (const recipe of config.recipes) {
    if (names.has(recipe.name) || recipeDigest(recipe) !== recipe.recipeSha256 || recipe.outputBytes * 6 + 8192 > config.bounds.maxOutputBytes) throw new Error("Recipe identity, digest or output bounds differ from selected pins");
    names.add(recipe.name);
    if (roots.some(root => within(root, recipe.executable))) throw new Error("Recipe executable cannot be resource-controlled");
    const files = new Set<string>();
    for (const file of recipe.runtimeFiles) {if (files.has(file.path) || roots.some(root => within(root, file.path))) throw new Error("Runtime library inventory must be exact and outside resource roots"); files.add(file.path);}
  }
  return {config, digest: sha256(canonicalJson(config))};
}
