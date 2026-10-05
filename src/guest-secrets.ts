import {closeSync, fstatSync, readSync} from "node:fs";

/** Linux guests receive bearer secrets on this inherited descriptor, never in
 * bubblewrap arguments or another world-readable process attribute. */
export const GUEST_SECRET_FD = 4;
export const GUEST_SECRET_KEYS: readonly string[] = Object.freeze(["CHIO_PI_MODEL_TOKEN"]);
const MAX_SECRET_BYTES = 4096;

/** Environment names that must never travel as bubblewrap --setenv arguments. */
export function credentialName(key: string): boolean {
  return GUEST_SECRET_KEYS.includes(key) || key === "CHIO_PI_SECRET_FD" || /TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY/.test(key);
}
function validSecrets(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([key, secret]) => GUEST_SECRET_KEYS.includes(key) && typeof secret === "string" && secret.length > 0 && !secret.includes("\0"));
}
export function encodeGuestSecrets(secrets: Record<string, string>): Buffer {
  if (!validSecrets(secrets)) throw new Error("Invalid guest secret set");
  const bytes = Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(secrets).sort().map(key => [key, secrets[key]]))));
  if (bytes.length > MAX_SECRET_BYTES) throw new Error("Guest secret set exceeds its bound");
  return bytes;
}
/** Guest bootstrap only: read the inherited descriptor to end of file, bounded,
 * and close it before any other guest code loads. Errors never echo values. */
export function readGuestSecrets(fd = GUEST_SECRET_FD): Record<string, string> {
  const buffer = Buffer.alloc(MAX_SECRET_BYTES + 1); let length = 0;
  try {
    const stat = fstatSync(fd);
    if (!stat.isSocket() && !stat.isFIFO()) throw new Error("not a stream");
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (!read) break;
      length += read;
    }
  } catch {throw new Error("Guest secret descriptor unavailable");}
  finally {try {closeSync(fd);} catch {}}
  if (length > MAX_SECRET_BYTES) throw new Error("Guest secret set exceeds its bound");
  let value: unknown;
  try {value = JSON.parse(buffer.subarray(0, length).toString("utf8"));} catch {value = undefined;}
  if (!validSecrets(value)) throw new Error("Invalid guest secret set");
  return value;
}
