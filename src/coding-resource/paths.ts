import {constants} from "node:fs";
import {chmod, lstat, mkdir, open, readdir, realpath, rename, rm, unlink} from "node:fs/promises";
import {hostname} from "node:os";
import {dirname, isAbsolute, join, normalize, relative, sep} from "node:path";
import {randomUUID} from "node:crypto";
import {canonicalSourcePath} from "./namespace.js";

export function within(base: string, target: string): boolean {
  const value = relative(base, target);
  return value === "" || value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}
export function resourcePath(value: string): string {
  return canonicalSourcePath(value);
}
export async function noSymlinkPath(path: string): Promise<void> {
  if (!isAbsolute(path) || normalize(path) !== path || path.includes("\0")) throw new Error("Paths must be canonical absolute paths");
  let current: string = sep;
  for (const part of path.split(sep).filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("Symlink paths are unavailable");
  }
  if (await realpath(path) !== path) throw new Error("Path aliases are unavailable");
}
export async function privateDirectory(path: string, immutable = false): Promise<void> {
  await noSymlinkPath(path);
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== (immutable ? 0o500 : 0o700)) throw new Error("Directory must be private, owned and have its selected mode");
}
export async function regularFile(path: string, options: {private?: boolean; immutable?: boolean; maxBytes?: number; executable?: boolean; runtime?: boolean} = {}): Promise<Buffer> {
  await noSymlinkPath(path);
  const before = await lstat(path);
  const owner = options.executable || options.runtime ? before.uid === 0 || before.uid === process.getuid?.() : before.uid === process.getuid?.();
  if (!before.isFile() || before.nlink !== 1 || !owner || options.private && (before.mode & 0o777) !== (options.immutable ? 0o400 : 0o600)
    || options.executable && ((before.mode & 0o022) !== 0 || (before.mode & 0o111) === 0)
    || options.runtime && (before.mode & 0o022) !== 0
    || options.maxBytes !== undefined && before.size > options.maxBytes) throw new Error("File must be a bounded owned regular private file without links");
  // Check type before opening, and prevent a raced FIFO from blocking the owner.
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const after = await file.stat();
    if (!after.isFile() || after.nlink !== 1 || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) throw new Error("Regular file changed during open");
    const bytes = await file.readFile();
    if (options.maxBytes !== undefined && bytes.length > options.maxBytes || bytes.length !== before.size) throw new Error("File changed or exceeded bounds while reading");
    return bytes;
  } finally {await file.close();}
}
export async function fsyncDirectory(path: string): Promise<void> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {await file.sync();} finally {await file.close();}
}
export async function durableFile(path: string, bytes: Buffer | string, immutable = false): Promise<void> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {await file.writeFile(bytes); if (immutable) await file.chmod(0o400); await file.sync();} finally {await file.close();}
}
export async function immutableTree(root: string, files: ReadonlyMap<string, Buffer>): Promise<void> {
  await mkdir(root, {mode: 0o700});
  const directories = new Set([root]);
  for (const [path, bytes] of files) {
    const target = join(root, resourcePath(path));
    let directory = dirname(target);
    while (within(root, directory) && !directories.has(directory)) {directories.add(directory); directory = dirname(directory);}
    await mkdir(dirname(target), {recursive: true, mode: 0o700});
    await durableFile(target, bytes, true);
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {await chmod(directory, 0o500); await fsyncDirectory(directory);}
}
export async function installImmutableTree(parent: string, name: string, files: ReadonlyMap<string, Buffer>): Promise<void> {
  const stage = join(parent, `.staging-${randomUUID()}`);
  await immutableTree(stage, files);
  await rename(stage, join(parent, name));
  await fsyncDirectory(parent);
}
export async function removeJob(path: string): Promise<void> {await rm(path, {recursive: true, force: false}); await fsyncDirectory(dirname(path));}

interface OwnerLock {schema: string; pid: number; hostname: string; nonce: string}
export async function acquireOwnerLock(stateRoot: string): Promise<() => Promise<void>> {
  const path = join(stateRoot, "owner.lock");
  const value: OwnerLock = {schema: "chio.coding-owner-lock.v1", pid: process.pid, hostname: hostname(), nonce: randomUUID()};
  try {await durableFile(path, JSON.stringify(value)); await fsyncDirectory(stateRoot);} catch (error) {if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Exclusive resource owner lock exists; explicit proven-dead recovery is required"); throw error;}
  const created = await lstat(path);
  return async () => {
    const current = await lstat(path).catch(error => {if (error.code === "ENOENT") return undefined; throw error;});
    if (!current) return;
    if (created.dev !== current.dev || created.ino !== current.ino || JSON.parse((await regularFile(path, {private: true, maxBytes: 4096})).toString()).nonce !== value.nonce) throw new Error("Refusing to release another owner's lock");
    await unlink(path); await fsyncDirectory(stateRoot);
  };
}
export async function recoverOwnerLock(stateRoot: string): Promise<void> {
  const path = join(stateRoot, "owner.lock"); const original = await lstat(path);
  const value = JSON.parse((await regularFile(path, {private: true, maxBytes: 4096})).toString()) as OwnerLock;
  if (value.schema !== "chio.coding-owner-lock.v1" || value.hostname !== hostname() || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.nonce !== "string") throw new Error("Lock owner cannot be proved dead on this host");
  try {process.kill(value.pid, 0); throw new Error("Lock owner is still alive");} catch (error) {if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;}
  const current = await lstat(path);
  if (original.dev !== current.dev || original.ino !== current.ino) throw new Error("Lock changed during dead-owner recovery");
  await unlink(path); await fsyncDirectory(stateRoot);
}
export async function requireEmpty(path: string): Promise<void> {if ((await readdir(path)).length) throw new Error("Explicit import requires empty private resource roots");}
