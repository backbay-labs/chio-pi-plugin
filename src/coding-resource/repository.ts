import {lstat, mkdir, readdir} from "node:fs/promises";
import {join} from "node:path";
import {canonicalJson} from "../tool-registry.js";
import {sha256, type CodingConfig} from "./config.js";
import {installImmutableTree, privateDirectory, regularFile, resourcePath} from "./paths.js";
import type {ResourceLedger} from "./ledger.js";

export interface ManifestFile {path: string; sha256: string; bytes: number}
export interface SourceManifest {schema: "chio.coding-source.v1"; files: ManifestFile[]}
export interface SourceGeneration {digest: string; manifest: string; files: Map<string, Buffer>}
export class ToolRefusal extends Error {constructor(readonly code: string, message: string) {super(message); this.name = "ToolRefusal";}}
export function generationFor(files: Map<string, Buffer>, config: Readonly<CodingConfig>): SourceGeneration {
  let bytes = 0;
  const manifest: SourceManifest = {schema: "chio.coding-source.v1", files: [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, value]) => {
    resourcePath(path); if (value.length > config.bounds.maxFileBytes) throw new ToolRefusal("source_bound", "Source file exceeds selected byte limit"); bytes += value.length;
    return {path, sha256: sha256(value), bytes: value.length};
  })};
  if (files.size > config.bounds.maxFiles || bytes > config.bounds.maxRepositoryBytes) throw new ToolRefusal("source_bound", "Source generation exceeds selected repository bounds");
  const encoded = canonicalJson(manifest); return {digest: sha256(encoded), manifest: encoded, files};
}
export async function importSource(config: Readonly<CodingConfig>): Promise<SourceGeneration> {
  const files = new Map<string, Buffer>(); let bytes = 0;
  async function visit(directory: string, prefix: string): Promise<void> {
    await privateDirectory(directory);
    for (const item of (await readdir(directory)).sort()) {
      if (item === ".git") continue; // Never ingest or inspect executable repository discovery.
      const path = resourcePath(prefix ? `${prefix}/${item}` : item); const full = join(config.repositoryRoot, path); const info = await lstat(full);
      if (info.isDirectory()) await visit(full, path);
      else {
        const content = await regularFile(full, {private: true, maxBytes: config.bounds.maxFileBytes}); files.set(path, content); bytes += content.length;
        if (files.size > config.bounds.maxFiles || bytes > config.bounds.maxRepositoryBytes) throw new ToolRefusal("source_bound", "Import exceeds selected repository bounds");
      }
    }
  }
  await visit(config.repositoryRoot, ""); return generationFor(files, config);
}
export class Repository {
  constructor(readonly config: Readonly<CodingConfig>, private readonly ledger: ResourceLedger) {}
  path(digest: string): string {return join(this.config.stateRoot, "generations", digest);}
  async load(digest: string): Promise<SourceGeneration> {
    const manifest = this.ledger.manifest(digest);
    if (sha256(manifest) !== digest) throw new Error("Retained source manifest digest is corrupt");
    const parsed = JSON.parse(manifest) as SourceManifest;
    if (parsed.schema !== "chio.coding-source.v1" || !Array.isArray(parsed.files)) throw new Error("Retained source manifest is corrupt");
    const files = new Map<string, Buffer>(); const root = this.path(digest);
    await privateDirectory(root, true);
    for (const file of parsed.files) {
      const value = await regularFile(join(root, resourcePath(file.path)), {private: true, immutable: true, maxBytes: this.config.bounds.maxFileBytes});
      if (value.length !== file.bytes || sha256(value) !== file.sha256 || files.has(file.path)) throw new Error("Immutable retained source generation changed"); files.set(file.path, value);
    }
    const actual = generationFor(files, this.config); if (actual.digest !== digest) throw new Error("Immutable retained source manifest differs");
    // Hidden or substituted files must not become readable/executable in a recipe.
    const observed: string[] = [];
    async function enumerate(directory: string, prefix: string): Promise<void> {
      await privateDirectory(directory, true);
      for (const name of await readdir(directory)) {const path = prefix ? `${prefix}/${name}` : name; const full = join(root, resourcePath(path)); const info = await lstat(full); if (info.isDirectory()) await enumerate(full, path); else {if (!files.has(path)) throw new Error("Unmanifested source file is unavailable"); observed.push(path);}}
    }
    await enumerate(root, ""); if (observed.length !== files.size) throw new Error("Source generation structure differs"); return actual;
  }
  async install(generation: SourceGeneration): Promise<void> {
    const parent = join(this.config.stateRoot, "generations"); await privateDirectory(parent);
    try {await lstat(this.path(generation.digest)); await this.load(generation.digest);}
    catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await installImmutableTree(parent, generation.digest, generation.files);}
  }
  patch(source: SourceGeneration, changes: unknown): SourceGeneration {
    if (!Array.isArray(changes)) throw new ToolRefusal("invalid_patch", "Patch changes are unavailable");
    const files = new Map(source.files); const seen = new Set<string>(); let changedBytes = 0;
    for (const change of changes as {path: string; expectedFileSha256: string | null; replacement?: string; edits?: {oldText: string; newText: string}[]}[]) {
      const path = resourcePath(change.path);
      if (seen.has(path) || (change.replacement === undefined) === (change.edits === undefined)) throw new ToolRefusal("invalid_patch", "Each unique file requires exactly replacement or bounded literal edits"); seen.add(path);
      const original = files.get(path);
      if (change.expectedFileSha256 === null ? original !== undefined : original === undefined || sha256(original) !== change.expectedFileSha256) throw new ToolRefusal("stale_file", "Expected full-file digest or explicit absent precondition differs");
      if (!original && change.edits) throw new ToolRefusal("invalid_patch", "An absent file requires explicit replacement");
      let replacement = change.replacement;
      if (change.edits) {
        const text = decodeText(original!);
        const ranges = change.edits.map(edit => {
          const start = text.indexOf(edit.oldText);
          if (start < 0 || text.indexOf(edit.oldText, start + 1) >= 0) throw new ToolRefusal("ambiguous_edit", "Literal edit requires exactly one matching old text in the original file");
          changedBytes += Buffer.byteLength(edit.oldText) + Buffer.byteLength(edit.newText);
          return {start, end: start + edit.oldText.length, replacement: edit.newText};
        }).sort((a, b) => a.start - b.start);
        for (let index = 1; index < ranges.length; index++) if (ranges[index].start < ranges[index - 1].end) throw new ToolRefusal("overlapping_edit", "Literal edit ranges overlap in the original file");
        replacement = text;
        for (const range of ranges.reverse()) replacement = replacement.slice(0, range.start) + range.replacement + replacement.slice(range.end);
      } else changedBytes += Buffer.byteLength(replacement!);
      if (changedBytes > this.config.bounds.maxPatchBytes) throw new ToolRefusal("patch_bound", "Patch exceeds selected byte bound");
      files.set(path, Buffer.from(replacement!, "utf8"));
    }
    return generationFor(files, this.config);
  }
  read(source: SourceGeneration, read: {path: string; startLine: number; endLine: number}): Record<string, unknown> {
    const path = resourcePath(read.path); const value = source.files.get(path); if (!value) throw new ToolRefusal("missing_file", "Requested source file is absent");
    if (read.endLine < read.startLine) throw new ToolRefusal("range_bound", "Requested line range is reversed");
    const lines = decodeText(value).match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const text = lines.slice(read.startLine - 1, read.endLine).join(""); if (Buffer.byteLength(text) > this.config.bounds.maxReadBytes) throw new ToolRefusal("read_bound", "Requested range exceeds selected read byte bound");
    return {ok: true, path, sourceDigest: source.digest, fileSha256: sha256(value), startLine: read.startLine, endLine: Math.min(read.endLine, lines.length), text, bytes: Buffer.byteLength(text)};
  }
  status(initial: SourceGeneration, current: SourceGeneration): Record<string, unknown> {
    const changed = [...new Set([...initial.files.keys(), ...current.files.keys()])].sort().filter(path => sha256(initial.files.get(path) ?? "") !== sha256(current.files.get(path) ?? "") || initial.files.has(path) !== current.files.has(path)).map(path => ({path, beforeSha256: initial.files.has(path) ? sha256(initial.files.get(path)!) : null, afterSha256: current.files.has(path) ? sha256(current.files.get(path)!) : null}));
    return {sourceDigest: current.digest, initialDigest: initial.digest, changed};
  }
  diff(initial: SourceGeneration, current: SourceGeneration): Record<string, unknown> {
    const changed = (this.status(initial, current).changed as {path: string}[]).map(({path}) => ({path, before: initial.files.has(path) ? decodeText(initial.files.get(path)!) : null, after: current.files.has(path) ? decodeText(current.files.get(path)!) : null}));
    const encoded = canonicalJson(changed); if (Buffer.byteLength(encoded) > this.config.bounds.maxReadBytes) throw new ToolRefusal("diff_bound", "Diff exceeds selected read byte bound");
    return {sourceDigest: current.digest, initialDigest: initial.digest, diffSha256: sha256(encoded), changes: changed};
  }
}
export function decodeText(bytes: Buffer): string {try {return new TextDecoder("utf8", {fatal: true}).decode(bytes);} catch {throw new ToolRefusal("binary_source", "Requested source content is not UTF-8 text");}}
export async function createGenerationsDirectory(config: Readonly<CodingConfig>): Promise<void> {await mkdir(join(config.stateRoot, "generations"), {mode: 0o700});}
