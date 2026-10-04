import {constants} from "node:fs";
import {lstat, open} from "node:fs/promises";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {canonicalJson} from "../tool-registry.js";
import {sha256, type LoadedConfig} from "./config.js";
import {durableFile, fsyncDirectory, regularFile} from "./paths.js";

export interface NativeMetadata {chioRequestId: string; chioOperationId: string; chioAttemptId: string; chioTransportKeyEpoch: number; chioCallerCapabilitySha256: string}
export interface McpResult {content: {type: "text"; text: string}[]; isError?: true}
export interface Operation {operationId: string; binding: string; caller: string; tool: string; arguments: string; configDigest: string; sourceDigest: string; state: "intent" | "completed"; result: string | null}
export class FatalResourceError extends Error {constructor(message = "Unresolved durable resource intent; native reconciliation is required") {super(message); this.name = "FatalResourceError";}}
function rootBinding({config}: LoadedConfig) {return sha256(canonicalJson({workspaceId: config.workspaceId, resourceOwnerId: config.resourceOwnerId, repositoryRoot: config.repositoryRoot, stateRoot: config.stateRoot, artifactRoot: config.artifactRoot, jobRoot: config.jobRoot}));}
export class ResourceLedger {
  private constructor(readonly path: string, private readonly db: DatabaseSync, readonly selected: LoadedConfig) {}
  static async open(selected: LoadedConfig, options: {initialize?: boolean; readonly?: boolean} = {}): Promise<ResourceLedger> {
    const path = join(selected.config.stateRoot, "ledger.sqlite");
    if (options.initialize) {await durableFile(path, Buffer.alloc(0)); await fsyncDirectory(selected.config.stateRoot);}
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600) throw new Error("Ledger must be a private regular owned file without links");
      await regularFile(path, {private: true, maxBytes: 256 * 1024 * 1024});
      // SQLite may open these during hot-journal recovery even for read-only
      // inspection. Reject special files before passing the database to SQLite.
      for (const suffix of ["-journal", "-wal", "-shm"]) {
        const sidecar = path + suffix;
        try {await regularFile(sidecar, {private: true, maxBytes: 256 * 1024 * 1024});}
        catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("SQLite sidecar must be a private owned regular file without links");}
      }
    } catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Resource is not initialized; explicit operator init/import is required"); throw error;}
    const db = new DatabaseSync(path, {readOnly: options.readonly ?? false, enableForeignKeyConstraints: true, allowExtension: false});
    try {
      db.exec("PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;");
      if (!options.readonly) db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON; PRAGMA checkpoint_fullfsync=ON;");
      const ledger = new ResourceLedger(path, db, selected);
      if (options.initialize) {
        db.exec("CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT; CREATE TABLE generations(digest TEXT PRIMARY KEY, manifest TEXT NOT NULL, parent TEXT, operation_id TEXT) STRICT; CREATE TABLE operations(operation_id TEXT PRIMARY KEY, binding TEXT NOT NULL, caller TEXT NOT NULL, tool TEXT NOT NULL, arguments TEXT NOT NULL, config_digest TEXT NOT NULL, source_digest TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('intent','completed')), result TEXT) STRICT; CREATE TABLE attempts(operation_id TEXT NOT NULL REFERENCES operations(operation_id), attempt_id TEXT NOT NULL, epoch INTEGER NOT NULL, metadata TEXT NOT NULL, PRIMARY KEY(operation_id,attempt_id,epoch)) STRICT;");
        ledger.setMeta("schema", "chio.coding-resource-ledger.v1"); ledger.setMeta("rootBinding", rootBinding(selected));
      } else if (ledger.meta("schema") !== "chio.coding-resource-ledger.v1" || ledger.meta("rootBinding") !== rootBinding(selected) || !ledger.meta("currentDigest")) throw new Error("Initialized resource identity differs from operator-selected roots and owner");
      return ledger;
    } catch (error) {db.close(); throw error;}
  }
  meta(key: string): string | undefined {return (this.db.prepare("SELECT value FROM metadata WHERE key=?").get(key) as {value: string} | undefined)?.value;}
  private setMeta(key: string, value: string): void {this.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);}
  get sourceDigest(): string {const digest = this.meta("currentDigest"); if (!digest) throw new FatalResourceError("Initialized current source is unavailable"); return digest;}
  manifest(digest: string): string {const row = this.db.prepare("SELECT manifest FROM generations WHERE digest=?").get(digest) as {manifest: string} | undefined; if (!row) throw new Error("Source generation is outside retained lineage"); return row.manifest;}
  async initialize(digest: string, manifest: string): Promise<void> {
    this.transaction(() => {this.db.prepare("INSERT INTO generations(digest,manifest,parent,operation_id) VALUES(?,?,NULL,NULL)").run(digest, manifest); this.setMeta("initialDigest", digest); this.setMeta("currentDigest", digest);}); await this.flush();
  }
  lookup(operationId: string): Operation | undefined {
    const row = this.db.prepare("SELECT operation_id AS operationId,binding,caller,tool,arguments,config_digest AS configDigest,source_digest AS sourceDigest,state,result FROM operations WHERE operation_id=?").get(operationId);
    return row as unknown as Operation | undefined;
  }
  fenced(): boolean {return Boolean(this.db.prepare("SELECT 1 FROM operations WHERE state='intent' LIMIT 1").get());}
  async intent(binding: string, tool: string, args: Record<string, unknown>, sourceDigest: string, meta: NativeMetadata): Promise<void> {
    this.transaction(() => {this.db.prepare("INSERT INTO operations(operation_id,binding,caller,tool,arguments,config_digest,source_digest,state,result) VALUES(?,?,?,?,?,?,?,'intent',NULL)").run(meta.chioOperationId, binding, meta.chioCallerCapabilitySha256, tool, canonicalJson(args), this.selected.digest, sourceDigest); this.addAttempt(meta);});
    await this.flush();
  }
  private addAttempt(meta: NativeMetadata): void {this.db.prepare("INSERT OR IGNORE INTO attempts(operation_id,attempt_id,epoch,metadata) VALUES(?,?,?,?)").run(meta.chioOperationId, meta.chioAttemptId, meta.chioTransportKeyEpoch, canonicalJson(meta));}
  async recordReplayAttempt(meta: NativeMetadata): Promise<void> {this.addAttempt(meta); await this.flush();}
  async complete(operationId: string, result: McpResult, generation?: {digest: string; manifest: string; parent: string}): Promise<void> {
    this.transaction(() => {
      if (generation) {
        this.db.prepare("INSERT OR IGNORE INTO generations(digest,manifest,parent,operation_id) VALUES(?,?,?,?)").run(generation.digest, generation.manifest, generation.parent, operationId);
        if (this.sourceDigest !== generation.parent) throw new FatalResourceError("Current generation changed before atomic final commit");
        this.setMeta("currentDigest", generation.digest);
      }
      const changed = this.db.prepare("UPDATE operations SET state='completed',result=? WHERE operation_id=? AND state='intent'").run(canonicalJson(result), operationId);
      if (changed.changes !== 1) throw new FatalResourceError("Original durable intent is unavailable for terminal commit");
    });
    await this.flush();
  }
  private transaction(action: () => void): void {this.db.exec("BEGIN IMMEDIATE"); try {action(); this.db.exec("COMMIT");} catch (error) {this.db.exec("ROLLBACK"); throw error;}}
  private async flush(): Promise<void> {
    const file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {await file.sync();} finally {await file.close();} await fsyncDirectory(this.selected.config.stateRoot);
  }
  inspect(): Record<string, unknown> {
    const operations = this.db.prepare("SELECT operation_id AS operationId,caller,tool,config_digest AS configDigest,source_digest AS sourceDigest,state FROM operations ORDER BY rowid").all();
    return {schema: "chio.coding-resource-inspection.v1", unsigned: true, kernelFenceClearance: false, resourceOwnerId: this.selected.config.resourceOwnerId, workspaceId: this.selected.config.workspaceId, sourceDigest: this.sourceDigest, initialDigest: this.meta("initialDigest"), fenced: this.fenced(), operations};
  }
  exportOriginal(operationId: string): Record<string, unknown> {
    const operation = this.lookup(operationId); if (!operation) throw new Error("Original resource operation is unavailable");
    const attempts = this.db.prepare("SELECT metadata FROM attempts WHERE operation_id=? ORDER BY rowid").all(operationId) as {metadata: string}[];
    const {result: originalResult, ...retained} = operation;
    return {schema: "chio.coding-resource-original.v1", unsigned: true, kernelFenceClearance: false, resourceOwnerId: this.selected.config.resourceOwnerId, workspaceId: this.selected.config.workspaceId, operation: {...retained, arguments: JSON.parse(operation.arguments)}, attempts: attempts.map(row => JSON.parse(row.metadata)), result: originalResult ? JSON.parse(originalResult) : null};
  }
  close(): void {this.db.close();}
}
