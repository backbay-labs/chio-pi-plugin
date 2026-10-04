import {isAbsolute, join, normalize} from "node:path";
import {unicodeFullFoldEntries, unicodeVisibleRanges} from "./unicode-data.js";

const fullFold = new Map(unicodeFullFoldEntries);
function supportedScalar(code: number): boolean {
  let low = 0; let high = unicodeVisibleRanges.length / 2 - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1; const start = unicodeVisibleRanges[middle * 2]; const end = unicodeVisibleRanges[middle * 2 + 1];
    if (code < start) high = middle - 1; else if (code > end) low = middle + 1; else return true;
  }
  return false;
}
function folded(value: string): string {return [...value].map(scalar => fullFold.get(scalar.codePointAt(0)!) ?? scalar).join("").normalize("NFC");}
/** Fixed portable namespace, not a claim of arbitrary host filesystem equality.
 * Keep Unicode version/data independent of a guest, locale or Node's case tables. */
export function canonicalSourcePath(value: string): string {
  if (!value || value.length > 1024 || value.includes("\\") || isAbsolute(value) || normalize(value) !== value)
    throw new Error("Path must be a canonical relative source path without aliases or traversal");
  // A lone surrogate is not a supported scalar. Reject it before UTF-8 conversion
  // can replace it with U+FFFD and change the actual filesystem name.
  if ([...value].some(scalar => !supportedScalar(scalar.codePointAt(0)!)) || value.normalize("NFC") !== value)
    throw new Error("Path must use well-formed NFC visible Unicode 15.1 scalars without controls, private-use or default-ignorable characters");
  const parts = value.split("/");
  if (Buffer.byteLength(value) > 1024 || parts.some(part => !part || part === "." || part === ".." || folded(part) === ".git" || Buffer.byteLength(part) > 255))
    throw new Error("Path must have canonical nonreserved components of at most 255 UTF-8 bytes and at most 1024 relative bytes");
  return value;
}
export function portableFileInventory(paths: Iterable<string>, generationRoot: string): void {
  const prefixes = new Map<string, {spelling: string; kind: "file" | "directory"}>();
  // NAME_MAX=255 on both measured platforms. Their PATH_MAX includes the NUL.
  // Check the full final generation destination, longer than its staging path.
  const absoluteByteLimit = process.platform === "linux" ? 4095 : 1023;
  for (const path of paths) {
    canonicalSourcePath(path);
    if (Buffer.byteLength(join(generationRoot, path)) > absoluteByteLimit) throw new Error("Path must fit the full managed absolute destination byte capacity");
    const parts = path.split("/"); let spelling = ""; let key = "";
    for (let index = 0; index < parts.length; index++) {
      spelling += `${index ? "/" : ""}${parts[index]}`; key += `${index ? "/" : ""}${folded(parts[index])}`;
      const kind = index === parts.length - 1 ? "file" : "directory"; const previous = prefixes.get(key);
      if (previous && (previous.spelling !== spelling || previous.kind !== kind)) throw new Error("Path must retain one canonical spelling and type for every full-folded namespace prefix");
      prefixes.set(key, {spelling, kind});
    }
  }
}
