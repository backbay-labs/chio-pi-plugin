import {isAbsolute, dirname, normalize, join} from "node:path";
import {execFile} from "node:child_process";
import {realpath, stat} from "node:fs/promises";
import {promisify} from "node:util";
import {runtimeLibraries} from "../sandbox.js";
import {sha256, type Recipe} from "./config.js";
import {regularFile} from "./paths.js";
import {ToolRefusal} from "./repository.js";

export interface RecipeSandbox {backend: "seatbelt" | "bubblewrap"; launcher: string; runtimeFiles: {path: string; mountPath: string}[]; policy?: (source: string, job: string) => string; seccomp?: Buffer}
// Missing, replaced or permission-changed pinned files are proven no-effect
// refusals before any job exists, never an unresolved transport closure.
async function pinned<T>(code: "recipe_pin" | "unsupported_sandbox", message: string, check: () => Promise<T>): Promise<T> {
  try {return await check();} catch (error) {throw error instanceof ToolRefusal ? error : new ToolRefusal(code, message);}
}
const pinnedFile = async (path: string, options: Parameters<typeof regularFile>[1], message: string) => await pinned("recipe_pin", message, () => regularFile(path, options));
export async function prepareRecipeSandbox(recipe: Recipe): Promise<RecipeSandbox> {
  if (sha256(await pinnedFile(recipe.executable, {executable: true, maxBytes: 256 * 1024 * 1024}, "Operator-pinned recipe executable is unavailable or no longer a safe owned executable")) !== recipe.executableSha256) throw new ToolRefusal("recipe_pin", "Operator-pinned recipe executable hash changed");
  if (process.platform === "darwin") {
    await pinned("unsupported_sandbox", "macOS sandbox-exec is unavailable or unsafe", () => regularFile("/usr/bin/sandbox-exec", {executable: true}));
    const aliases = new Set<string>(); const libraries = await pinned("recipe_pin", "Recipe executable dependency closure is unavailable", () => runtimeLibraries(recipe.executable, aliases));
    const dependencies = new Set(libraries.filter(path => path !== recipe.executable));
    if (recipe.runtimeFiles.length !== dependencies.size || recipe.runtimeFiles.some(file => !dependencies.has(file.path) || file.mountPath !== undefined)) throw new ToolRefusal("recipe_pin", "macOS runtime inventory must match the complete resolved non-system dependency closure without mount aliases");
    for (const file of recipe.runtimeFiles) {
      if (sha256(await pinnedFile(file.path, {runtime: true, maxBytes: 256 * 1024 * 1024}, "Operator-pinned runtime dependency is unavailable or unsafe")) !== file.sha256) throw new ToolRefusal("recipe_pin", "Operator-pinned runtime dependency hash changed");
    }
    // Dyld stats intermediate symlink names, for example the Cellar's
    // libname.major.dylib before reaching libname.major.minor.dylib. Retain
    // only this selected dependency chain, not a readable runtime directory.
    await pinned("recipe_pin", "Recipe dependency alias chain is unavailable", async () => {
      for (const alias of [...aliases]) {
        let prefix = "/";
        for (const component of alias.split("/").filter(Boolean)) {const path = join(prefix, component); aliases.add(path); prefix = await realpath(path);}
      }
    });
    return {backend: "seatbelt", launcher: "/usr/bin/sandbox-exec", runtimeFiles: libraries.map(path => ({path, mountPath: path})), policy: (source, job) => seatbeltPolicy(recipe.executable, libraries, [...aliases], source, job)};
  }
  if (process.platform === "linux") {
    await pinned("unsupported_sandbox", "Linux bubblewrap is unavailable or unsafe", () => regularFile("/usr/bin/bwrap", {executable: true}));
    // Probe before any intent or job: an old or setuid bubblewrap would reject
    // --disable-userns at launch and surface as a recorded failing test.
    await pinned("unsupported_sandbox", "Linux bubblewrap version is unavailable", async () => {
      const {mode} = await stat("/usr/bin/bwrap");
      const {stdout} = await promisify(execFile)("/usr/bin/bwrap", ["--version"], {env: {}, encoding: "utf8", timeout: 5000, maxBuffer: 4096});
      assertBubblewrapSupport(mode, stdout);
    });
    const explicit: {path: string; mountPath: string}[] = [];
    for (const file of recipe.runtimeFiles) {
      if (sha256(await pinnedFile(file.path, {runtime: true, maxBytes: 256 * 1024 * 1024}, "Operator-pinned runtime library is unavailable or unsafe")) !== file.sha256) throw new ToolRefusal("recipe_pin", "Operator-pinned runtime library hash changed");
      const mountPath = file.mountPath ?? file.path;
      if (!isAbsolute(mountPath) || normalize(mountPath) !== mountPath || mountPath.includes("\0") || !["/lib/", "/lib64/", "/usr/lib/", "/usr/local/lib/"].some(prefix => mountPath.startsWith(prefix))) throw new ToolRefusal("recipe_pin", "Runtime mount target must be an exact canonical library path");
      if (explicit.some(file => file.mountPath === mountPath)) throw new ToolRefusal("recipe_pin", "Duplicate runtime library mount target"); explicit.push({path: file.path, mountPath});
    }
    if (!explicit.length) throw new ToolRefusal("recipe_pin", "Linux requires an exact operator-pinned runtime file and loader inventory");
    return {backend: "bubblewrap", launcher: "/usr/bin/bwrap", runtimeFiles: explicit, seccomp: linuxRecipeFilter()};
  }
  throw new ToolRefusal("unsupported_sandbox", "No qualified local recipe sandbox backend on this platform");
}
/** Exported for regression tests; not part of the package exports.
 * `--disable-userns` needs a non-setuid bubblewrap 0.8.0 or later. */
export function assertBubblewrapSupport(mode: number, version: string): void {
  const match = /^bubblewrap (\d+)\.(\d+)\.(\d+)\s*$/.exec(version);
  if ((mode & 0o4000) !== 0 || !match || Number(match[1]) === 0 && Number(match[2]) < 8) throw new ToolRefusal("unsupported_sandbox", "Linux recipes require a non-setuid bubblewrap 0.8.0 or later for --disable-userns");
}
/** Exported for policy regression tests; not part of the package exports. */
export function seatbeltPolicy(executable: string, libraries: string[], aliases: string[], source: string, job: string): string {
  const quote = (path: string) => JSON.stringify(path);
  const exactAlias = (path: string) => `(literal ${quote(path)})`;
  const ancestors = new Set<string>();
  for (const selected of [source, job, ...libraries]) {
    let parent = dirname(selected);
    while (parent !== "/") {ancestors.add(parent); parent = dirname(parent);}
  }
  const aliasMetadata = new Set(aliases);
  for (const selected of aliases) {let path = dirname(selected); while (path !== "/") {aliasMetadata.add(path); path = dirname(path);}}
  // An SBPL allow rule without a filter matches every path. Official macOS Node
  // builds link only system libraries, so emit alias metadata only when present.
  // File flags and ACLs (for example uchg) could make job output undeletable by
  // its owner after the recipe exits; ordinary modes remain recoverable.
  const aliasRule = aliasMetadata.size ? `(allow file-read-metadata ${[...aliasMetadata].map(exactAlias).join(" ")})\n` : "";
  return `(version 1)
(deny default)
(allow sysctl-read (sysctl-name-prefix "hw.") (sysctl-name "kern.hostname") (sysctl-name "kern.ostype") (sysctl-name "kern.osrelease") (sysctl-name "kern.osversion") (sysctl-name "kern.osproductversion") (sysctl-name "kern.version") (sysctl-name "kern.maxfilesperproc") (sysctl-name "kern.tcsm_available") (sysctl-name "kern.tcsm_enable") (sysctl-name "machdep.cpu.brand_string"))
(allow file-read-metadata (literal "/") (require-all (vnode-type DIRECTORY) (require-any ${[...ancestors].map(path => `(literal ${quote(path)})`).join(" ")})))
${aliasRule}(allow file-read-data (literal "/"))
(allow file-read* (subpath "/System/Library") (subpath "/System/Volumes/Preboot/Cryptexes/OS") (subpath "/usr/lib") (subpath "/Library/Apple/System") (subpath "/private/var/db/dyld") (literal "/dev/null")
  ${libraries.map(path => `(literal ${quote(path)})`).join("\n  ")}
  (subpath ${quote(source)}))
(allow file-read* file-write* (subpath ${quote(job)}) (literal "/dev/null"))
(allow process-exec (literal ${quote(executable)}))
(deny file-link process-fork)
(deny file-write-create (vnode-type SYMLINK))
(deny file-write-flags file-write-acl)
`;
}
export function bubblewrapArguments(recipe: Recipe, sandbox: RecipeSandbox, source: string, job: string): string[] {
  const args = ["--unshare-all", "--unshare-user", "--disable-userns", "--die-with-parent", "--new-session", "--clearenv", "--cap-drop", "ALL"];
  const directories = new Set<string>(["/source", "/job", "/tmp", "/proc", "/dev"]);
  for (const target of [recipe.executable, ...sandbox.runtimeFiles.map(file => file.mountPath)]) {
    let path = dirname(target); while (path !== "/") {directories.add(path); path = dirname(path);}
  }
  for (const path of [...directories].sort((a, b) => a.length - b.length || a.localeCompare(b))) args.push("--dir", path);
  args.push("--ro-bind", source, "/source", "--bind", job, "/job", "--tmpfs", "/tmp", "--proc", "/proc", "--dev", "/dev", "--ro-bind", recipe.executable, recipe.executable);
  for (const file of sandbox.runtimeFiles) args.push("--ro-bind", file.path, file.mountPath);
  for (const [key, value] of Object.entries(minimalRecipeEnvironment(recipe, "/job"))) args.push("--setenv", key, value);
  args.push("--chdir", "/source", "--seccomp", "3", "--", recipe.executable, ...recipe.argv); return args;
}
export function minimalRecipeEnvironment(recipe: Recipe, job: string): Record<string, string> {return {PATH: dirname(recipe.executable), LANG: "C", HOME: job, TMPDIR: job, OPENSSL_CONF: "/dev/null"};}

// Classic BPF seccomp is part of the trusted launcher, never supplied by a
// recipe. Keep Node thread creation but deny processes, links, sockets, nested
// namespaces through unshare (bubblewrap --disable-userns also blocks user
// namespaces) and io_uring, whose operations bypass per-syscall link/socket rules.
function linuxRecipeFilter(): Buffer {
  const ioUring = [425, 426, 427]; // io_uring_setup, io_uring_enter, io_uring_register
  const profiles: Record<string, {arch: number; clone: number; clone3: number; denied: number[]}> = {
    // Deny cross-process access explicitly, independently of optional Yama
    // restrictions. Bubblewrap 0.8.0 also applies seccomp to its reaper, so this
    // is isolation hardening, not evidence of an unfiltered-reaper escape.
    arm64: {arch: 0xc00000b7, clone: 220, clone3: 435, denied: [36, 37, 198, 199, 200, 203, 97, 117, 270, 271, 438, ...ioUring]},
    x64: {arch: 0xc000003e, clone: 56, clone3: 435, denied: [57, 58, 86, 88, 265, 266, 41, 42, 53, 272, 101, 310, 311, 438, ...ioUring]},
  };
  const profile = profiles[process.arch]; if (!profile) throw new ToolRefusal("unsupported_sandbox", "Linux recipe seccomp architecture is unsupported");
  const instructions: [number, number, number, number][] = [[0x20, 0, 0, 4], [0x15, 1, 0, profile.arch], [0x06, 0, 0, 0x80000000], [0x20, 0, 0, 0]];
  // x32 shares AUDIT_ARCH_X86_64. Refuse its syscall-number bit before matching
  // the native x64 syscall inventory, so it cannot bypass process/socket/link rules.
  if (process.arch === "x64") instructions.push([0x45, 0, 1, 0x40000000], [0x06, 0, 0, 0x00050001]);
  for (const syscall of profile.denied) instructions.push([0x15, 0, 1, syscall], [0x06, 0, 0, 0x00050001]);
  instructions.push([0x15, 0, 1, profile.clone3], [0x06, 0, 0, 0x00050026]); // ENOSYS, libc may retry thread-only clone.
  instructions.push([0x15, 0, 4, profile.clone], [0x20, 0, 0, 16], [0x54, 0, 0, 0x10000], [0x15, 1, 0, 0x10000], [0x06, 0, 0, 0x00050001], [0x06, 0, 0, 0x7fff0000]);
  const bytes = Buffer.alloc(instructions.length * 8);
  instructions.forEach(([code, jt, jf, k], index) => {bytes.writeUInt16LE(code, index * 8); bytes[index * 8 + 2] = jt; bytes[index * 8 + 3] = jf; bytes.writeUInt32LE(k, index * 8 + 4);}); return bytes;
}
