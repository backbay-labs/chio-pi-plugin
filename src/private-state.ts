import {randomBytes, createHash} from "node:crypto";
import {constants, type Stats} from "node:fs";
import {link, lstat, mkdir, open, readdir, realpath, rename, unlink} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import {canonicalJson} from "./tool-registry.js";

export const PRIVATE_LIMIT = 1024 * 1024;
export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
export function normalizedPath(path: string): void {
  if (!path || path.length > 4096 || path.includes("\0") || resolve(path) !== path) throw new Error("Private state requires an absolute normalized path");
}
function privateDirectory(stat: Stats): boolean {
  return stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077) && stat.uid === process.getuid?.();
}
export async function ownedDirectory(path: string, create = false): Promise<string> {
  normalizedPath(path);
  if (create) await mkdir(path, {mode: 0o700});
  const stat = await lstat(path);
  if (!privateDirectory(stat)) throw new Error("Private state requires an owned private directory");
  return realpath(path);
}
/** NOFOLLOW and NONBLOCK apply before a bounded read. UTF-8 replacement is not
 * permitted in an identity, signature or content binding. */
export async function readPrivateText(path: string, limit = PRIVATE_LIMIT): Promise<{path: string; text: string}> {
  normalizedPath(path);
  const wanted = await lstat(path);
  const valid = (stat: typeof wanted) => stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077) && stat.uid === process.getuid?.() && stat.nlink === 1 && stat.size <= limit;
  if (!valid(wanted)) throw new Error("Private regular bounded file required");
  const directory = await ownedDirectory(dirname(path));
  const admittedDirectory = await lstat(directory);
  if (!privateDirectory(admittedDirectory)) throw new Error("Private state requires an owned private directory");
  const file = await open(join(directory, basename(path)), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!valid(before) || before.ino !== wanted.ino || before.dev !== wanted.dev) throw new Error("Private regular bounded file changed before reading");
    const bytes = Buffer.alloc(Math.min(limit + 1, before.size + 1));
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await file.stat();
    const current = await lstat(path);
    if (length !== before.size || length > limit || !valid(after) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || !valid(current) || current.ino !== before.ino || current.dev !== before.dev || current.size !== before.size
      || current.mtimeMs !== before.mtimeMs || current.ctimeMs !== before.ctimeMs) throw new Error("Private bounded state changed while reading");
    const currentDirectory = await lstat(directory);
    const requestedDirectory = await lstat(dirname(path));
    const sameDirectory = (stat: Stats) => privateDirectory(stat) && stat.ino === admittedDirectory.ino && stat.dev === admittedDirectory.dev
      && stat.mode === admittedDirectory.mode && stat.uid === admittedDirectory.uid && stat.gid === admittedDirectory.gid;
    if (!sameDirectory(currentDirectory) || !sameDirectory(requestedDirectory)) throw new Error("Private bounded directory state changed while reading");
    let text: string;
    try {text = new TextDecoder("utf-8", {fatal: true}).decode(bytes.subarray(0, length));}
    catch {throw new Error("Private JSON requires strict UTF-8");}
    return {path: join(directory, basename(path)), text};
  } finally {await file.close();}
}
export async function readPrivateJson(path: string, limit = PRIVATE_LIMIT): Promise<unknown> {
  const loaded = await readPrivateText(path, limit);
  try {return JSON.parse(loaded.text) as unknown;}
  catch {throw new Error("Invalid private JSON");}
}
export async function syncDirectory(path: string): Promise<void> {
  const file = await open(await ownedDirectory(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {await file.sync();} finally {await file.close();}
}
/** Call only while holding the directory's exclusive writer ownership, before
 * admitting work. Temporary bytes are never authoritative: publication and its
 * directory fsync precede dispatch. An interrupted update retains the previous
 * published original. A crash between link and unlink leaves exactly two links;
 * require the other one to be a published record in this same private directory.
 * Never promote a temporary or remove any published reservation or outcome. */
export async function recoverPrivateWrites(directory: string): Promise<void> {
  if (await ownedDirectory(directory) !== directory) throw new Error("Private recovery directory contains a link");
  const names = await readdir(directory);
  let changed = false;
  for (const name of names.filter(name => /^\.chio-[a-f0-9]{32}\.tmp$/.test(name))) {
    const path = join(directory, name); const stat = await lstat(path);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.mode & 0o077 || stat.size > PRIVATE_LIMIT || ![1, 2].includes(stat.nlink))
      throw new Error("Interrupted private publication has unsafe file identity");
    if (stat.nlink === 2) {
      let published = false;
      for (const candidate of names.filter(value => /^[a-f0-9]{64}\.json$/.test(value) || value === "store-owner.binding")) {
        const other = await lstat(join(directory, candidate));
        if (other.isFile() && other.ino === stat.ino && other.dev === stat.dev) {published = true; break;}
      }
      if (!published) throw new Error("Interrupted private publication has an external hardlink");
    }
    const current = await lstat(path);
    if (current.ino !== stat.ino || current.dev !== stat.dev || current.nlink !== stat.nlink || current.ctimeMs !== stat.ctimeMs)
      throw new Error("Interrupted private publication changed during recovery");
    await unlink(path); changed = true;
  }
  if (changed) await syncDirectory(directory);
}
/** A same-directory temporary is fully flushed before atomic publication. New
 * files use link's exclusive publication, then remove the temporary hardlink.
 * An interrupted publication remains a reservation, never permission to retry. */
export async function writePrivateJson(path: string, value: unknown, replace = false): Promise<void> {
  normalizedPath(path);
  const directory = await ownedDirectory(dirname(path));
  const target = join(directory, basename(path));
  if (replace) await readPrivateJson(target);
  const temporary = join(directory, `.chio-${randomBytes(16).toString("hex")}.tmp`);
  const text = canonicalJson(value) + "\n";
  if (Buffer.byteLength(text) > PRIVATE_LIMIT) throw new Error("Private JSON exceeds bounded size");
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try {await file.writeFile(text, "utf8"); await file.sync();} finally {await file.close();}
    if (replace) await rename(temporary, target);
    else {await link(temporary, target); await unlink(temporary);}
    await syncDirectory(directory);
  } finally {await unlink(temporary).catch(error => {if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;});}
}
/** Parent publication into a guest-writable private directory. A guest may leave
 * a link at the published name between launches, so an existing entry must be a
 * single-link regular file; links and special files refuse before any write. The
 * bytes go only through an exclusive NOFOLLOW temporary descriptor, and rename
 * replaces the directory entry itself, never the target of a raced-in link. */
export async function publishGuestFile(path: string, text: string): Promise<void> {
  normalizedPath(path);
  const directory = await ownedDirectory(dirname(path));
  if (directory !== dirname(path)) throw new Error("Guest publication directory contains a link");
  const single = (stat: Stats) => stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid?.();
  const same = (stat: Stats, identity: Stats) => single(stat) && stat.ino === identity.ino && stat.dev === identity.dev;
  const existing = await lstat(path).catch(error => {if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error;});
  if (existing && !single(existing)) throw new Error("Guest publication path is a link or special file; parent write refused");
  const temporary = join(directory, `.chio-${randomBytes(16).toString("hex")}.tmp`);
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    let created: Stats;
    try {
      created = await file.stat();
      if (!single(created)) throw new Error("Guest publication temporary is not a private single-link file");
      await file.writeFile(text, "utf8"); await file.sync();
    } finally {await file.close();}
    if (!same(await lstat(temporary), created)) throw new Error("Guest publication temporary changed before rename");
    await rename(temporary, path);
    if (!same(await lstat(path), created)) throw new Error("Guest publication changed after rename");
    await syncDirectory(directory);
  } finally {await unlink(temporary).catch(error => {if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;});}
}
