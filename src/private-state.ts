import {randomBytes, createHash} from "node:crypto";
import {constants} from "node:fs";
import {link, lstat, mkdir, open, realpath, rename, unlink} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import {canonicalJson} from "./tool-registry.js";

export const PRIVATE_LIMIT = 1024 * 1024;
export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
export function normalizedPath(path: string): void {
  if (!path || path.length > 4096 || path.includes("\0") || resolve(path) !== path) throw new Error("Private state requires an absolute normalized path");
}
export async function ownedDirectory(path: string, create = false): Promise<string> {
  normalizedPath(path);
  if (create) await mkdir(path, {mode: 0o700});
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid?.()) throw new Error("Private state requires an owned private directory");
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
  try {await file.writeFile(text, "utf8"); await file.sync();} finally {await file.close();}
  try {
    if (replace) await rename(temporary, target);
    else {await link(temporary, target); await unlink(temporary);}
    await syncDirectory(directory);
  } finally {await unlink(temporary).catch(error => {if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;});}
}
