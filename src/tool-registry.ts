import { createHash } from "node:crypto";
import { Ajv, type ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

export interface ChioToolSpec {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
export type ToolMode = "typed" | "legacy";
export interface ToolRegistry {
  readonly mode: ToolMode;
  readonly digest: string;
  readonly tools: readonly {
    readonly name: string;
    readonly kernelTool: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  }[];
}

export const CHIO_TOOL_NAME = "chio_execute";
const LEGACY_DESCRIPTION = "Invoke an operator-pinned Chio kernel tool through the legacy comparison wrapper. The kernel owns execution; native local tools are disabled.";
const legacyParameters = {
  type: "object", properties: {
    tool: {type: "string", minLength: 1, maxLength: 256},
    arguments: {type: "object"},
  }, required: ["tool", "arguments"], additionalProperties: false,
};
export const CHIO_RESUME_SPEC: ChioToolSpec = deepFreeze({
  name: "chio_resume",
  description: "Explicitly resume one exact operator-approved proposal, retaining its original request identity. Never retries an unknown effect.",
  inputSchema: {type: "object", properties: {requestId: {type: "string"}, tool: {type: "string"}, arguments: {type: "object"}}, required: ["requestId", "tool", "arguments"], additionalProperties: false},
});

interface RegistryState {
  inventory: readonly ChioToolSpec[];
  validators: Map<string, ValidateFunction>;
  legacyValidator: ValidateFunction;
}
const registries = new WeakMap<ToolRegistry, RegistryState>();
const aliases: Record<string, string> = {
  read_text_file: "chio_read", read_file: "chio_read", read: "chio_read",
  write_file: "chio_write", write: "chio_write",
  edit_file: "chio_edit", edit: "chio_edit",
  list_directory: "chio_list", list: "chio_list",
  chio_resume: "chio_resume",
};
function compare(a: string, b: string) {return a < b ? -1 : a > b ? 1 : 0;}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Canonical, lossless JSON only. Unsupported values cannot disappear while
 * computing a schema or argument binding. No executable schema is admitted. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown, depth: number): string {
    if (depth > 64) throw new Error("JSON exceeds maximum nesting depth");
    if (item === null || typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== "object" || item === null) throw new Error("Only lossless JSON values are supported");
    if (ancestors.has(item)) throw new Error("Circular JSON is unavailable");
    if (Object.getOwnPropertySymbols(item).length) throw new Error("JSON symbols are unavailable");
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.keys(item).length !== item.length) throw new Error("Sparse or decorated JSON arrays are unavailable");
        const encoded: string[] = [];
        for (let index = 0; index < item.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error("Sparse or executable JSON array accessors are unavailable");
          encoded.push(encode(descriptor.value, depth + 1));
        }
        return `[${encoded.join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new Error("Only plain JSON objects are supported");
      return `{${Object.keys(item).sort(compare).map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !("value" in descriptor)) throw new Error("Executable JSON accessors are unavailable");
        return `${JSON.stringify(key)}:${encode(descriptor.value, depth + 1)}`;
      }).join(",")}}`;
    } finally {ancestors.delete(item);}
  }
  const result = encode(value, 0);
  if (Buffer.byteLength(result) > 1024 * 1024) throw new Error("JSON exceeds the 1 MiB binding limit");
  return result;
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
export function frozenJson<T>(value: T): T {return deepFreeze(JSON.parse(canonicalJson(value)) as T);}
function compileSchema(schema: Record<string, unknown>): ValidateFunction {
  try {
    const options = {strict: true, strictRequired: true, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false, ownProperties: true};
    const validator = schema.$schema === "https://json-schema.org/draft/2020-12/schema" ? new Ajv2020(options) : new Ajv(options);
    return validator.compile(schema);
  } catch {throw new Error("Invalid or unsupported pinned JSON schema");}
}
function alias(name: string): string {
  const standard = Object.hasOwn(aliases, name) ? aliases[name] : undefined;
  if (standard) return standard;
  const value = `chio_${name.replace(/[.-]/g, "_")}`;
  return value.length <= 64 ? value : `${value.slice(0, 47)}_${createHash("sha256").update(name).digest("hex").slice(0, 16)}`;
}

/** All model declarations and effect dispatch mappings derive from this exact
 * operator snapshot. Ordering and object key order do not alter its identity. */
export function createToolRegistry(tools: readonly ChioToolSpec[], mode: ToolMode = "typed"): ToolRegistry {
  if (mode !== "typed" && mode !== "legacy") throw new Error("Invalid Chio tool mode");
  if (!Array.isArray(tools) || tools.length > 256) throw new Error("Invalid operator tool inventory");
  const inventory = JSON.parse(canonicalJson(tools)) as ChioToolSpec[];
  if (inventory.some(tool => !isObject(tool) || typeof tool.name !== "string")) throw new Error("Invalid pinned tool specification");
  inventory.sort((a, b) => compare(a.name, b.name));
  deepFreeze(inventory);
  const names = new Set<string>(); const modelNames = new Set<string>();
  const validators = new Map<string, ValidateFunction>();
  const typed = inventory.map(tool => {
    if (!isObject(tool) || typeof tool.name !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name)
      || Object.keys(tool).some(key => !["name", "description", "inputSchema"].includes(key))
      || tool.description !== undefined && (typeof tool.description !== "string" || tool.description.length > 16384)) throw new Error("Invalid pinned tool specification");
    if (names.has(tool.name)) throw new Error("Duplicate kernel tool name");
    names.add(tool.name);
    if (!isObject(tool.inputSchema)) throw new Error("Tool input schema must be a JSON object");
    validators.set(tool.name, compileSchema(tool.inputSchema));
    const name = alias(tool.name);
    if (name === CHIO_TOOL_NAME) throw new Error("Reserved legacy wrapper alias collision");
    if (modelNames.has(name)) throw new Error("Kernel tool alias collision");
    modelNames.add(name);
    return {name, kernelTool: tool.name, description: tool.description ?? `Execute operator-pinned kernel tool ${tool.name}.`, parameters: tool.inputSchema};
  }).sort((a, b) => compare(a.name, b.name));
  const declarations = mode === "typed" ? typed : [{name: CHIO_TOOL_NAME, kernelTool: "*", description: LEGACY_DESCRIPTION, parameters: legacyParameters}];
  const digest = createHash("sha256").update(canonicalJson({schema: "chio.pi.tool-registry.v1", mode, inventory, tools: declarations.map(tool => ({...tool, exposure: "direct"}))})).digest("hex");
  const registry = frozenJson({mode, digest, tools: declarations}) as ToolRegistry;
  registries.set(registry, {inventory, validators, legacyValidator: compileSchema(legacyParameters)});
  return registry;
}
function state(registry: ToolRegistry): RegistryState {
  const value = registries.get(registry);
  if (!value) throw new Error("Registry must be an immutable operator-pinned snapshot");
  return value;
}
export function registryInventory(registry: ToolRegistry): readonly ChioToolSpec[] {return state(registry).inventory;}
export function registryForConfig(config: {tools: readonly ChioToolSpec[]; toolMode?: ToolMode; approval?: unknown; approvals?: boolean}): ToolRegistry {
  return createToolRegistry([...config.tools, ...(config.approval || config.approvals ? [CHIO_RESUME_SPEC] : [])], config.toolMode ?? "typed");
}
export function validateKernelArguments(registry: ToolRegistry, tool: string, args: unknown): Record<string, unknown> {
  const value = state(registry);
  const validator = value.validators.get(tool);
  if (!validator && !(registry.mode === "legacy" && value.inventory.length === 0)) throw new Error("Tool is outside the pinned registry");
  if (!isObject(args)) throw new Error("Tool arguments must be a JSON object");
  const snapshot = JSON.parse(canonicalJson(args)) as Record<string, unknown>;
  if (validator && !validator(snapshot)) throw new Error("Tool arguments differ from the pinned input schema");
  if (tool === CHIO_RESUME_SPEC.name) {
    if (snapshot.tool === CHIO_RESUME_SPEC.name || typeof snapshot.tool !== "string") throw new Error("Original approval tool is outside the pinned registry");
    validateKernelArguments(registry, snapshot.tool, snapshot.arguments);
  }
  return snapshot;
}
export function resolveRegistryCall(registry: ToolRegistry, name: string, args: unknown): {tool: string; arguments: Record<string, unknown>} {
  const value = state(registry);
  const definition = registry.tools.find(tool => tool.name === name);
  if (!definition) throw new Error("Tool alias is outside the pinned registry");
  if (registry.mode === "typed") return {tool: definition.kernelTool, arguments: validateKernelArguments(registry, definition.kernelTool, args)};
  const snapshot = JSON.parse(canonicalJson(args)) as {tool: string; arguments: unknown};
  if (!value.legacyValidator(snapshot)) throw new Error("Invalid legacy wrapper arguments");
  return {tool: snapshot.tool, arguments: validateKernelArguments(registry, snapshot.tool, snapshot.arguments)};
}
