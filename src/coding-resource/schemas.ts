import {createToolRegistry, registryInventory, validateKernelArguments, type ChioToolSpec} from "../tool-registry.js";
import type {ResourceBounds} from "./config.js";

const digest = {type: "string", pattern: "^[a-f0-9]{64}$"};
const path = {type: "string", minLength: 1, maxLength: 1024};
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({type: "object", properties, required, additionalProperties: false});
const read = obj({path, startLine: {type: "integer", minimum: 1, maximum: 1000000}, endLine: {type: "integer", minimum: 1, maximum: 1000000}});
export function codingToolSchemas(bounds: ResourceBounds) {
  const specs: ChioToolSpec[] = [
    {name: "read_range", description: "Read a bounded exact-source line range with full-file digest.", inputSchema: obj({sourceDigest: digest, ...read.properties})},
    {name: "search", description: "Bounded literal search in the exact immutable source generation.", inputSchema: obj({sourceDigest: digest, literal: {type: "string", minLength: 1, maxLength: 4096}, paths: {type: "array", maxItems: bounds.maxFiles, uniqueItems: true, items: path}, maxMatches: {type: "integer", minimum: 1, maximum: bounds.maxSearchMatches}}, ["sourceDigest", "literal"])},
    {name: "repo_status", description: "Inspect current source status relative to the original imported manifest.", inputSchema: obj({})},
    {name: "repo_diff", description: "Bounded internal diff against the original imported source. Does not invoke Git.", inputSchema: obj({sourceDigest: digest})},
    {name: "apply_patch", description: "All-or-none source CAS using exact source and full-file hashes. Chio owns admission.", inputSchema: obj({sourceDigest: digest, changes: {type: "array", minItems: 1, maxItems: 64, items: obj({path, expectedFileSha256: {anyOf: [digest, {const: null}]}, replacement: {type: "string", maxLength: bounds.maxPatchBytes}, edits: {type: "array", minItems: 1, maxItems: 64, items: obj({oldText: {type: "string", minLength: 1, maxLength: bounds.maxPatchBytes}, newText: {type: "string", maxLength: bounds.maxPatchBytes}})}}, ["path", "expectedFileSha256"])}})},
    {name: "test_recipe", description: "Run one operator-pinned recipe against an exact source in OS confinement.", inputSchema: obj({sourceDigest: digest, recipe: {type: "string", minLength: 1, maxLength: 64}})},
    {name: "publish_artifact", description: "Separate kernel-admitted publication bound to exact retained successful source and test lineage.", inputSchema: obj({sourceDigest: digest, testOperationId: digest, testResultSha256: digest, recipeSha256: digest, destination: {enum: ["review"]}})},
    {name: "repo_context", description: "Requested bounded source structure and provenance as content. Grants no authority.", inputSchema: obj({sourceDigest: digest})},
    {name: "read_many", description: "One admitted read operation with ordered bounded partial child results.", inputSchema: obj({sourceDigest: digest, reads: {type: "array", minItems: 1, maxItems: bounds.maxReadMany, items: read}})},
  ];
  const registry = createToolRegistry(specs);
  return {inventory: registryInventory(registry), validate: (tool: string, args: unknown) => validateKernelArguments(registry, tool, args)};
}
