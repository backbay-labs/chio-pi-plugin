import {lstat} from "node:fs/promises";
import {join} from "node:path";
import {canonicalJson, frozenJson} from "../tool-registry.js";
import {loadCodingConfig, sha256, type LoadedConfig} from "./config.js";
import {FatalResourceError, ResourceLedger, type McpResult, type NativeMetadata} from "./ledger.js";
import {acquireOwnerLock, fsyncDirectory, installImmutableTree, privateDirectory, regularFile, requireEmpty, recoverOwnerLock} from "./paths.js";
import {Repository, ToolRefusal, createGenerationsDirectory, decodeText, importSource, type SourceGeneration} from "./repository.js";
import {prepareRecipeSandbox} from "./recipe-sandbox.js";
import {runRecipe, type RecipeResult} from "./recipes.js";
import {codingToolSchemas} from "./schemas.js";

export type FaultPoint = "beforeIntent" | "afterIntent" | "afterGeneration" | "afterPublication" | "beforeCommit" | "afterCommit";
/** Test-only injection is an explicit trusted API seam. There are no model,
 * operator configuration, environment or production CLI fault selectors. */
export interface TrustedResourceTestSeam {fault?: (point: FaultPoint) => void}
const result = (body: unknown): McpResult => ({content: [{type: "text", text: canonicalJson(body)}]});
const refusal = (code: string, message: string): McpResult => ({...result({code, message}), isError: true});
function metadata(value: unknown): NativeMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolRefusal("native_metadata", "Exact native dispatch metadata is required on the kernel-owned pipe");
  const input = JSON.parse(canonicalJson(value)) as NativeMetadata;
  if (Object.keys(input).sort().join(",") !== ["chioRequestId", "chioOperationId", "chioAttemptId", "chioTransportKeyEpoch", "chioCallerCapabilitySha256"].sort().join(",")
    || typeof input.chioRequestId !== "string" || !/^[a-f0-9]{64}$/.test(input.chioRequestId) || input.chioRequestId !== input.chioOperationId
    || typeof input.chioAttemptId !== "string" || !input.chioAttemptId.length || input.chioAttemptId.length > 512 || input.chioAttemptId.includes("\0")
    || !Number.isSafeInteger(input.chioTransportKeyEpoch) || input.chioTransportKeyEpoch <= 0
    || typeof input.chioCallerCapabilitySha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.chioCallerCapabilitySha256)) throw new ToolRefusal("native_metadata", "Native request/operation, caller, attempt or transport epoch binding is unavailable");
  return input;
}
interface Prepared {execute: () => Promise<McpResult>; generation?: {digest: string; manifest: string; parent: string}}
export class CodingResource {
  readonly tools;
  readonly bounds;
  private readonly repository: Repository;
  private readonly abortController = new AbortController();
  private pending = false;
  private closed = false;
  constructor(readonly selected: LoadedConfig, readonly ledger: ResourceLedger, private readonly releaseLock: () => Promise<void>, private readonly seam: TrustedResourceTestSeam) {
    this.tools = codingToolSchemas(selected.config.bounds); this.bounds = selected.config.bounds;
    this.repository = new Repository(selected.config, ledger);
  }
  abort(): void {this.abortController.abort();}
  async call(tool: string, rawArguments: unknown, rawMeta: unknown): Promise<McpResult> {
    if (this.closed || this.pending || this.abortController.signal.aborted) throw new FatalResourceError("Resource is closed or a call is already in progress");
    this.pending = true;
    try {return await this.dispatch(tool, rawArguments, rawMeta);} finally {this.pending = false;}
  }
  private async dispatch(tool: string, rawArguments: unknown, rawMeta: unknown): Promise<McpResult> {
    let meta: NativeMetadata; let args: Record<string, unknown>;
    try {meta = metadata(rawMeta);} catch (error) {
      if (this.ledger.fenced()) throw new FatalResourceError();
      return refusal(error instanceof ToolRefusal ? error.code : "native_metadata", error instanceof ToolRefusal ? error.message : "Exact native dispatch metadata is required");
    }
    // Exact historical binding lookup precedes current assignment/source checks.
    const retained = this.ledger.lookup(meta.chioOperationId);
    // Invalid redelivery cannot replace unresolved work with an ACK-able error.
    if (retained && (retained.state !== "completed" || !retained.result) || !retained && this.ledger.fenced()) throw new FatalResourceError();
    try {args = this.tools.validate(tool, rawArguments);} catch {return refusal("invalid_arguments", "Tool or arguments differ from the closed inventory");}
    const binding = sha256(canonicalJson({schema: "chio.coding-operation-binding.v1", resourceOwnerId: this.selected.config.resourceOwnerId, workspaceId: this.selected.config.workspaceId, configDigest: this.selected.digest, caller: meta.chioCallerCapabilitySha256, operationId: meta.chioOperationId, tool, arguments: args, sourceDigest: retained?.sourceDigest ?? this.ledger.sourceDigest}));
    if (retained) {
      if (retained.binding !== binding) return refusal("operation_conflict", "Original operation binding conflict: caller, tool, arguments or operator configuration changed");
      try {await this.ledger.recordReplayAttempt(meta);} catch {throw new FatalResourceError("Replay attempt provenance could not be durably retained");}
      return frozenJson(JSON.parse(retained.result!) as McpResult);
    }
    if (!this.selected.config.allowedCallerCapabilitySha256.includes(meta.chioCallerCapabilitySha256)) return refusal("caller_binding", "Caller capability digest is outside the operator-pinned assignment");
    let prepared: Prepared;
    try {prepared = await this.prepare(tool, args);} catch (error) {
      if (error instanceof ToolRefusal || error instanceof Error && error.message.startsWith("Path must")) {
        const known = refusal(error instanceof ToolRefusal ? error.code : "invalid_path", error.message); prepared = {execute: async () => known};
      } else throw new FatalResourceError("Resource preflight integrity or storage check failed");
    }
    if (this.abortController.signal.aborted) throw new FatalResourceError("Resource disconnected before durable intent");
    try {
      this.seam.fault?.("beforeIntent");
      await this.ledger.intent(binding, tool, args, this.ledger.sourceDigest, meta);
      this.seam.fault?.("afterIntent");
      const outcome = await prepared.execute();
      if (Buffer.byteLength(canonicalJson(outcome)) + 128 > this.bounds.maxOutputBytes) throw new FatalResourceError("Terminal result exceeds the selected transport bound");
      this.seam.fault?.("beforeCommit");
      await this.ledger.complete(meta.chioOperationId, outcome, prepared.generation);
      this.seam.fault?.("afterCommit");
      return frozenJson(outcome);
    } catch (error) {
      this.abort();
      throw error instanceof FatalResourceError ? error : new FatalResourceError("Resource effect or durable storage failed; original intent must remain fenced");
    }
  }
  private async prepare(tool: string, args: Record<string, unknown>): Promise<Prepared> {
    const current = this.ledger.sourceDigest;
    if (args.sourceDigest !== undefined && args.sourceDigest !== current) throw new ToolRefusal("stale_source", "Expected exact source digest differs from the current immutable generation");
    const source = await this.repository.load(current);
    const initial = async () => await this.repository.load(this.ledger.meta("initialDigest")!);
    const ready = (body: unknown): Prepared => {
      const value = result(body); if (Buffer.byteLength(canonicalJson(value)) + 128 > this.bounds.maxOutputBytes) throw new ToolRefusal("result_bound", "Requested tool result exceeds selected output bound");
      return {execute: async () => value};
    };
    switch (tool) {
      case "read_range": return ready(this.repository.read(source, args as unknown as {path: string; startLine: number; endLine: number}));
      case "repo_status": return ready(this.repository.status(await initial(), source));
      case "repo_diff": return ready(this.repository.diff(await initial(), source));
      case "apply_patch": {
        const next = this.repository.patch(source, args.changes);
        const outcome = result({sourceDigest: next.digest, previousSourceDigest: source.digest, manifestSha256: next.digest, changedPaths: (args.changes as {path: string}[]).map(change => change.path)});
        return {generation: {digest: next.digest, manifest: next.manifest, parent: current}, execute: async () => {await this.repository.install(next); this.seam.fault?.("afterGeneration"); return outcome;}};
      }
      case "search": return ready(this.search(source, args));
      case "read_many": {
        let bytes = 0; let partial = false;
        const results = (args.reads as {path: string; startLine: number; endLine: number}[]).map(read => {
          try {
            const child = this.repository.read(source, read); const size = Buffer.byteLength(canonicalJson(child));
            if (bytes + size > this.bounds.maxReadBytes) throw new ToolRefusal("read_many_bound", "Aggregate read bound exhausted"); bytes += size; return child;
          } catch (error) {partial = true; return {ok: false, path: read.path, code: error instanceof ToolRefusal ? error.code : "invalid_path", message: error instanceof Error ? error.message : "Read unavailable"};}
        });
        return ready({sourceDigest: current, partial, results});
      }
      case "repo_context": {
        const manifest = JSON.parse(source.manifest) as {files: unknown[]};
        const context = {authority: false, schema: "chio.coding-context.v1", workspaceId: this.selected.config.workspaceId, resourceOwnerId: this.selected.config.resourceOwnerId, sourceDigest: current, initialDigest: this.ledger.meta("initialDigest"), manifestSha256: current, files: manifest.files, recipes: this.selected.config.recipes.map(recipe => ({name: recipe.name, recipeSha256: recipe.recipeSha256, executableSha256: recipe.executableSha256})), provenance: "operator-imported immutable source; unsigned resource content"};
        if (Buffer.byteLength(canonicalJson(context)) > this.bounds.maxReadBytes) throw new ToolRefusal("context_bound", "Requested source context exceeds selected read byte bound"); return ready(context);
      }
      case "test_recipe": {
        const recipe = this.selected.config.recipes.find(recipe => recipe.name === args.recipe); if (!recipe) throw new ToolRefusal("recipe_assignment", "Recipe is outside the operator-pinned inventory");
        const sandbox = await prepareRecipeSandbox(recipe);
        return {execute: async () => result(await runRecipe(this.selected.config, recipe, sandbox, current, this.repository.path(current), this.abortController.signal))};
      }
      case "publish_artifact": {
        const original = this.ledger.lookup(args.testOperationId as string);
        const recipe = this.selected.config.recipes.find(recipe => recipe.recipeSha256 === args.recipeSha256);
        if (!original || original.tool !== "test_recipe" || original.state !== "completed" || !original.result || !recipe || original.sourceDigest !== current || original.configDigest !== this.selected.digest) throw new ToolRefusal("lineage_mismatch", "Publication requires exact retained successful current-source test and recipe lineage");
        const tested = JSON.parse((JSON.parse(original.result) as McpResult).content[0].text) as RecipeResult;
        const {resultSha256, ...testBody} = tested;
        if (!tested.success || tested.sourceDigest !== current || tested.recipeSha256 !== args.recipeSha256 || tested.resultSha256 !== args.testResultSha256 || sha256(canonicalJson(testBody)) !== resultSha256) throw new ToolRefusal("lineage_mismatch", "Failed, stale or mismatched test result cannot be published");
        const diff = this.repository.diff(await initial(), source);
        const bundle = {schema: "chio.coding-artifact.v1", unsigned: true, authority: false, workspaceId: this.selected.config.workspaceId, resourceOwnerId: this.selected.config.resourceOwnerId, destination: args.destination, sourceDigest: current, initialDigest: this.ledger.meta("initialDigest"), manifest: JSON.parse(source.manifest), files: [...source.files].map(([path, bytes]) => ({path, encoding: "base64", content: bytes.toString("base64")})), diff, testOperationId: original.operationId, testResultSha256: resultSha256, recipeSha256: recipe.recipeSha256, test: tested};
        // This fixed, deterministically ordered artifact structure is stored as
        // bytes, not transported as MCP arguments. Do not apply the registry's
        // 1 MiB argument limit to a bounded base64 source deliverable.
        const encoded = JSON.stringify(bundle); const artifactSha256 = sha256(encoded);
        const artifactByteLimit = this.selected.config.bounds.maxRepositoryBytes * 2 + 1024 * 1024;
        if (Buffer.byteLength(encoded) > artifactByteLimit) throw new ToolRefusal("artifact_bound", "Content-addressed bundle exceeds its selected source-derived byte bound");
        const outcome = result({artifactSha256, sourceDigest: current, diffSha256: diff.diffSha256, testOperationId: original.operationId, testResultSha256: resultSha256, recipeSha256: recipe.recipeSha256, destination: args.destination, unsigned: true, authority: false});
        return {execute: async () => {
          const parent = this.selected.config.artifactRoot; await privateDirectory(parent);
          const artifact = join(parent, artifactSha256);
          try {await lstat(artifact); await privateDirectory(artifact, true); if (sha256(await regularFile(join(artifact, "bundle.json"), {private: true, immutable: true, maxBytes: artifactByteLimit})) !== artifactSha256) throw new Error("Existing artifact content differs");}
          catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await installImmutableTree(parent, artifactSha256, new Map([["bundle.json", Buffer.from(encoded)]]));}
          this.seam.fault?.("afterPublication"); return outcome;
        }};
      }
      default: throw new ToolRefusal("unknown_tool", "Tool is outside closed coding inventory");
    }
  }
  private search(source: SourceGeneration, args: Record<string, unknown>): Record<string, unknown> {
    const selected = args.paths as string[] | undefined;
    if (selected) for (const path of selected) this.repository.read(source, {path, startLine: 1, endLine: 1});
    const matches: Record<string, unknown>[] = []; let bytes = 0; let truncated = false;
    const limit = args.maxMatches as number | undefined ?? this.bounds.maxSearchMatches;
    for (const [path, content] of source.files) {
      if (selected && !selected.includes(path)) continue;
      let text: string; try {text = decodeText(content);} catch {continue;}
      for (const [index, line] of text.split("\n").entries()) {
        const column = line.indexOf(args.literal as string); if (column < 0) continue;
        const match = {path, line: index + 1, column: column + 1, text: line, fileSha256: sha256(content)}; const size = Buffer.byteLength(canonicalJson(match));
        if (matches.length >= limit || bytes + size > this.bounds.maxReadBytes) {truncated = true; continue;} matches.push(match); bytes += size;
      }
    }
    return {sourceDigest: source.digest, literal: args.literal, matches, truncated};
  }
  async close(): Promise<void> {if (this.closed) return; if (this.pending) throw new FatalResourceError("Cannot release the owner lock while a call is running"); this.closed = true; this.abort(); this.ledger.close(); await this.releaseLock();}
}
export async function initializeCodingResource(configPath: string): Promise<Record<string, unknown>> {
  const selected = await loadCodingConfig(configPath);
  for (const root of [selected.config.stateRoot, selected.config.artifactRoot, selected.config.jobRoot]) await requireEmpty(root);
  const source = await importSource(selected.config); const release = await acquireOwnerLock(selected.config.stateRoot); let ledger: ResourceLedger | undefined;
  try {
    ledger = await ResourceLedger.open(selected, {initialize: true}); await createGenerationsDirectory(selected.config);
    await installImmutableTree(join(selected.config.stateRoot, "generations"), source.digest, source.files);
    await fsyncDirectory(selected.config.stateRoot); await ledger.initialize(source.digest, source.manifest);
    return {schema: "chio.coding-resource-import.v1", unsigned: true, sourceDigest: source.digest, files: source.files.size, resourceOwnerId: selected.config.resourceOwnerId, workspaceId: selected.config.workspaceId};
  } finally {ledger?.close(); await release();}
}
export async function openCodingResource(configPath: string, seam: TrustedResourceTestSeam = {}): Promise<CodingResource> {
  const selected = await loadCodingConfig(configPath);
  // Verify initialized state before creating a lock. Never auto-import on serve.
  const check = await ResourceLedger.open(selected, {readonly: true}); check.close();
  const release = await acquireOwnerLock(selected.config.stateRoot);
  try {return new CodingResource(selected, await ResourceLedger.open(selected), release, seam);} catch (error) {await release(); throw error;}
}
export async function inspectCodingResource(configPath: string, operationId?: string): Promise<Record<string, unknown>> {
  const selected = await loadCodingConfig(configPath); const ledger = await ResourceLedger.open(selected, {readonly: true});
  try {if (operationId && !/^[a-f0-9]{64}$/.test(operationId)) throw new Error("Original operation ID must be lowercase SHA256"); return operationId ? ledger.exportOriginal(operationId) : ledger.inspect();} finally {ledger.close();}
}
export async function recoverCodingOwnerLock(configPath: string): Promise<void> {const {config} = await loadCodingConfig(configPath); await recoverOwnerLock(config.stateRoot);}
