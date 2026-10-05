#!/usr/bin/env node
// Qualify a staged release archive in fresh cold consumers. Installation and
// import evidence only: no protected execution, kernel or provider is involved.
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync} from "node:fs";
import {homedir, release, tmpdir} from "node:os";
import {delimiter, dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {gunzipSync} from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELP = `Usage: node scripts/qualify-release.mjs --release DIR --work NEW_DIR --evidence NEW_DIR [--npm-cli NPM_CLI_JS]
DIR holds exactly one packed .tgz with its .sha256 and .provenance.json from scripts/pack-release.mjs.
Creates two fresh consumers (base: exact Pi, no Pi Durable; durable: exact Pi and exact Pi Durable), each
with an empty npm cache, isolated HOME and Pi profile, and a credential-free environment allowlist. Each
consumer installs the peers first, then the archive through a relative file: dependency, and is replayed
with npm ci from its retained lockfile. Uses the Node running this script and the npm beside it unless
--npm-cli is given. Writes builder and consumer provenance as separate records. Refuses existing work or
evidence directories. Exit 0 passed, 1 failed with evidence retained, 2 usage or precondition.
`;

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const sha512 = bytes => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
export function contained(base, target) {
  const rel = relative(base, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
/** True when `path` appears as an absolute path, not as the tail of a
 * relative name such as `node_modules/tmp`. */
export function containsHostPath(text, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_./@-])${escaped}(?=$|[/"'\\s])`).test(text);
}
/** npm may redact a UUID-like path component. The lock and installed archive
 * already establish identity, so normalize the one selected dependency by its
 * graph location and artifact basename, then reject every remaining absolute
 * file resolution, including redacted paths that cannot match hostPaths. */
export function normalizeConsumerGraph(text, artifactName) {
  const graph = JSON.parse(text); const plugin = graph.dependencies?.["@chio/pi-plugin"];
  const absolute = value => typeof value === "string" && /^file:(?:[/\\]|[A-Za-z]:[/\\])/.test(value);
  let absoluteArtifactResolutions = 0;
  if (absolute(plugin?.resolved) && plugin.resolved.endsWith(`/${artifactName}`)) {
    plugin.resolved = `file:../${artifactName}`; absoluteArtifactResolutions++;
  }
  const problems = absoluteArtifactResolutions === 1 ? [] : ["selected archive lacks exactly one absolute graph resolution"];
  function visit(value) {
    if (absolute(value)) problems.push("graph retains an absolute file resolution");
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  }
  visit(graph);
  return {text: JSON.stringify(graph, null, 2) + "\n", absoluteArtifactResolutions, problems: [...new Set(problems)]};
}
const exact = value => typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);

/** Lists a gzip tar archive without extracting it. Links, devices and paths
 * outside `package/` are reported as problems rather than followed. Members
 * named in `capture` are also returned as UTF-8 text. */
export function listArchive(bytes, capture = []) {
  const tar = gunzipSync(bytes); const entries = []; const problems = []; const files = new Map();
  let offset = 0; let pending;
  const text = (start, length) => tar.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const size = Number.parseInt(text(offset + 124, 12).trim() || "0", 8);
    const mode = Number.parseInt(text(offset + 100, 8).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = text(offset + 345, 155);
    const name = pending ?? (prefix ? `${prefix}/${text(offset, 100)}` : text(offset, 100));
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      for (const record of body.toString("utf8").split("\n")) {const match = /^\d+ path=(.*)$/s.exec(record); if (match) pending = match[1];}
      continue;
    }
    if (type === "L") {pending = body.toString("utf8").replace(/\0.*$/s, ""); continue;}
    if (type === "g") continue;
    pending = undefined;
    if (!name.startsWith("package/") || name.split("/").includes("..")) {problems.push(`entry outside package/: ${name}`); continue;}
    if (type === "5") continue;
    if (type !== "0") {problems.push(`non-regular archive entry ${name} (type ${type})`); continue;}
    const path = name.slice("package/".length);
    entries.push({path, size, mode: (mode & 0o777).toString(8), sha256: sha256(body)});
    if (capture.includes(path)) files.set(path, body.toString("utf8"));
  }
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return {entries, problems, files};
}

const REQUIRED_MEMBERS = ["package.json", "README.md", "LICENSE", "dist/index.js", "dist/index.d.ts", "dist/protected-cli.js",
  "dist/coding-resource-cli.js", "dist/coding-resource/participant.js", "dist/coding-resource/participant.d.ts", "dist/durable.js",
  "dist/durable.d.ts", "dist/linux-guest.js", "dist/coding-resource/unicode-data.js", "node_modules/@chio/bridge/package.json",
  "docs/ROADMAP-IMPLEMENTATION.md", "docs/FINAL-QUALIFICATION.md"];
const FORBIDDEN_PREFIXES = ["docs/superpowers/", "evidence/", "test/", "src/", "scripts/", "artifacts/", ".github/"];
export function archiveProblems(entries, files = new Map()) {
  const paths = new Set(entries.map(entry => entry.path)); const problems = [];
  for (const member of REQUIRED_MEMBERS) if (!paths.has(member)) problems.push(`missing archive member ${member}`);
  for (const path of paths) if (FORBIDDEN_PREFIXES.some(prefix => path.startsWith(prefix))) problems.push(`unexpected archive member ${path}`);
  const unicode = files.get("dist/coding-resource/unicode-data.js");
  if (unicode !== undefined && (!unicode.includes("UNICODE LICENSE V3") || !unicode.includes("Unicode, Inc."))) problems.push("generated Unicode data lacks its license text");
  return problems;
}

/** Bare module specifiers reachable from one declaration file through relative imports. */
export function declarationSpecifiers(entry) {
  const seen = new Set(); const bare = new Set(); const queue = [entry];
  while (queue.length) {
    const file = queue.pop(); if (seen.has(file)) continue; seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) {bare.add(specifier); continue;}
      const target = resolve(dirname(file), specifier).replace(/\.js$/, ".d.ts");
      queue.push(target.endsWith(".d.ts") ? target : `${target}.d.ts`);
    }
  }
  return [...bare].sort();
}

/** The consumer depends on the relative artifact and its lock records that
 * artifact's exact npm integrity. An absent integrity is a failure. */
export function consumerLockProblems(manifest, pluginLock, artifactName, integrity, version) {
  return [
    ...(manifest.dependencies?.["@chio/pi-plugin"] === `file:../${artifactName}` ? [] : [`manifest dependency ${manifest.dependencies?.["@chio/pi-plugin"]}`]),
    ...(pluginLock.resolved === `file:../${artifactName}` ? [] : [`lock resolved ${pluginLock.resolved}`]),
    ...(pluginLock.integrity === undefined ? ["lock integrity absent"] : pluginLock.integrity === integrity ? [] : ["lock integrity differs from artifact"]),
    ...(pluginLock.version === version ? [] : [`lock version ${pluginLock.version}`])];
}

/** Staged manifest, export/bin containment and installed file fidelity. */
export function installedPackageProblems(packageRoot, expected) {
  const problems = []; const actualRoot = realpathSync(packageRoot);
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (pkg.name !== expected.name || pkg.version !== expected.version) problems.push(`installed identity ${pkg.name}@${pkg.version}`);
  if (pkg.scripts || pkg.devDependencies) problems.push("staged manifest retains scripts or devDependencies");
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) if (!exact(version)) problems.push(`dependency ${name} is not an exact registry version: ${version}`);
  if (!same(pkg.bundleDependencies, expected.bundled)) problems.push(`bundleDependencies ${JSON.stringify(pkg.bundleDependencies)}`);
  if (!same(pkg.peerDependencies, expected.peerDependencies) || !same(pkg.peerDependenciesMeta, expected.peerDependenciesMeta)) problems.push("peer metadata differs from source");
  if (!same(pkg.exports, expected.exports) || !same(pkg.bin, expected.bin) || !same(pkg.engines, expected.engines)) problems.push("exports, bin or engines differ from source");
  const targets = [pkg.main, pkg.types, ...Object.values(pkg.exports ?? {}), ...Object.values(pkg.bin ?? {})].filter(Boolean);
  for (const target of targets) {
    const path = resolve(packageRoot, target);
    if (!existsSync(path)) {problems.push(`missing entrypoint ${target}`); continue;}
    if (!contained(actualRoot, realpathSync(path))) problems.push(`entrypoint escapes package: ${target}`);
  }
  for (const target of Object.values(pkg.bin ?? {})) {
    const path = resolve(packageRoot, target);
    if (existsSync(path) && (statSync(path).mode & 0o111) === 0) problems.push(`binary is not executable: ${target}`);
  }
  for (const bundled of pkg.bundleDependencies ?? []) if (!existsSync(join(packageRoot, "node_modules", bundled, "package.json"))) problems.push(`bundled dependency missing: ${bundled}`);
  for (const entry of expected.archive ?? []) {
    const path = join(packageRoot, entry.path);
    if (!existsSync(path) || lstatSync(path).isSymbolicLink() || sha256(readFileSync(path)) !== entry.sha256) problems.push(`installed file differs from archive: ${entry.path}`);
  }
  return problems;
}

/** Every executable symlink must resolve inside the consumer's own installation. */
export function binProblems(consumer) {
  const problems = []; const bin = join(consumer, "node_modules", ".bin"); const modules = realpathSync(join(consumer, "node_modules"));
  const names = existsSync(bin) ? readdirSync(bin).sort() : [];
  for (const name of names) {
    const path = join(bin, name);
    if (!lstatSync(path).isSymbolicLink()) {problems.push(`.bin/${name} is not a symlink`); continue;}
    const target = realpathSync(path);
    if (!contained(modules, target)) problems.push(`.bin/${name} escapes node_modules`);
    if ((statSync(target).mode & 0o111) === 0) problems.push(`.bin/${name} target is not executable`);
  }
  return {names, problems};
}

function metadataSnapshot(directory, limit = 20000) {
  if (!existsSync(directory)) return {exists: false, entries: 0, digest: null};
  const rows = []; const stack = [directory];
  while (stack.length && rows.length < limit) {
    const current = stack.pop();
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name); const stat = lstatSync(path);
      rows.push([relative(directory, path), stat.isDirectory() ? "d" : stat.isSymbolicLink() ? "l" : "f", stat.size, stat.mtimeMs, stat.ino]);
      if (stat.isDirectory()) stack.push(path);
    }
  }
  return {exists: true, entries: rows.length, digest: sha256(JSON.stringify(rows))};
}

function findPackageDirs(start, name) {
  const found = []; const stack = [join(start, "node_modules")];
  while (stack.length) {
    const current = stack.pop(); if (!existsSync(current)) continue;
    for (const entry of readdirSync(current, {withFileTypes: true})) {
      if (!entry.isDirectory() || entry.name === ".bin") continue;
      const path = join(current, entry.name);
      if (entry.name.startsWith("@")) {for (const scoped of readdirSync(path, {withFileTypes: true})) if (scoped.isDirectory()) visit(join(path, scoped.name), `${entry.name}/${scoped.name}`);}
      else visit(path, entry.name);
    }
  }
  function visit(path, packageName) {if (packageName === name) found.push(path); stack.push(join(path, "node_modules"));}
  return found;
}

function smokeSource(kind, tools) {
  return `import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtemp, mkdir, readFile, writeFile} from "node:fs/promises";
import {tmpdir, hostname} from "node:os";
import {join} from "node:path";
const report = {kind: ${JSON.stringify(kind)}};
const root = await import("@chio/pi-plugin");
for (const name of ["chioExtension", "createChioPiSession", "createChioPiRuntime", "createToolRegistry", "runOperatorCommand", "summarizeGatewayStatus",
  "startParentGatewayProxy", "exportContinuation", "importContinuation", "recoverOriginalOperation", "createNativeEmbedding", "nativeFeatureAvailability",
  "explainNativeRecovery", "submitNativeChild", "openRunBudget", "prepareLinuxGuest", "createUnixRelay", "superviseGuest"]) assert.equal(typeof root[name], "function", name);
const registry = root.createToolRegistry(${JSON.stringify(tools)});
assert.match(registry.digest, /^[a-f0-9]{64}$/);
report.registryTools = registry.tools.map(tool => tool.name);
const coding = await import("@chio/pi-plugin/coding-resource");
assert.equal(typeof coding.CodingResource, "function");
await assert.rejects(import("@chio/pi-plugin/dist/operator.js"), error => error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED");
report.rootAndCodingImports = true; report.deepImportRefused = true;
if (report.kind === "base") {
  await assert.rejects(import("@chio/pi-plugin/durable"), error => error.code === "ERR_MODULE_NOT_FOUND" && error.message.includes("@earendil-works/pi-durable"));
  report.durableWithoutOptionalPeer = "ERR_MODULE_NOT_FOUND @earendil-works/pi-durable";
} else {
  const durable = await import("@chio/pi-plugin/durable");
  const {Harness, MemoryStorage, createRegistry} = await import("@earendil-works/pi-durable");
  const calls = []; const refuse = name => () => {calls.push(name); throw new Error("registration smoke must not call " + name);};
  const binding = {authorityDigest: "a".repeat(64), registryDigest: registry.digest};
  const originals = {binding, lookup: refuse("lookup"), mappings: {find: refuse("find")}, retainHostCommit: refuse("retainHostCommit"), acknowledgeCommitted: refuse("acknowledgeCommitted")};
  const storage = new MemoryStorage(); const durableRegistry = createRegistry(); const context = {};
  const host = await Harness.open(storage, {models: {}, registry: durableRegistry}, context);
  const provenanceDir = await mkdtemp(join(tmpdir(), "chio-durable-smoke-"));
  // Registration-only owner fixture. No gateway, kernel or delivery is invoked.
  const mappingDirectory = join(provenanceDir, "pi-parent-mappings"); await mkdir(mappingDirectory, {mode: 0o700});
  await writeFile(join(provenanceDir, "gateway.lock"), JSON.stringify({pid: process.pid, hostname: hostname(), sessionId: "consumer-smoke"}), {mode: 0o600});
  Object.assign(originals.mappings, {directory: mappingDirectory, sessionId: "consumer-smoke"});
  const adapter = await durable.createChioDurableTools({storeId: randomBytes(32).toString("hex"), storage, session: host, provenanceDir, binding, registry,
    executor: {execute: refuse("execute")}, originals, transport: {acknowledgeReceivedOutcome: refuse("acknowledgeReceivedOutcome")}, context});
  durableRegistry.install(adapter.extension);
  assert.deepEqual(adapter.tools.map(tool => tool.name), report.registryTools);
  for (const [index, tool] of adapter.tools.entries()) {
    assert.equal(tool.replay, "unsafe"); assert.equal(tool.executionMode, "sequential"); assert.deepEqual(tool.parameters, registry.tools[index].parameters);
  }
  for (const name of ["flush", "close", "requestFor", "bindRecovery"]) assert.equal(typeof adapter[name], "function", name);
  const owner = JSON.parse(await readFile(join(provenanceDir, "store-owner.binding"), "utf8"));
  assert.equal(owner.schema, "chio.pi.durable-store-owner.v1"); assert.deepEqual(owner.binding, binding);
  await adapter.flush(); await adapter.close(); await host.close(context);
  assert.deepEqual(calls, []);
  report.durableRegistration = {tools: adapter.tools.length, replay: "unsafe", executionMode: "sequential", executorCalls: 0, acknowledgements: 0, storeOwnerBinding: owner.schema};
}
process.stdout.write(JSON.stringify(report) + "\\n");
`;
}

function typecheckSource(kind) {
  const durable = kind === "durable" ? `
import {createChioDurableTools, DURABLE_REQUEST_MEMO} from "@chio/pi-plugin/durable";
type DurableAdapter = Awaited<ReturnType<typeof createChioDurableTools>>;
export const durableMemo: string = DURABLE_REQUEST_MEMO;
export type Recovery = DurableAdapter["bindRecovery"];
` : "";
  return `import {createToolRegistry, runOperatorCommand, type ToolRegistry, type KernelRequest, type ContinuationBinding, type RunLimits} from "@chio/pi-plugin";
import {CodingResource} from "@chio/pi-plugin/coding-resource";
export const registry: ToolRegistry = createToolRegistry([{name: "read_file", description: "Read", inputSchema: {type: "object"}}]);
export const operator: (args: string[]) => Promise<number> = runOperatorCommand;
export const binding: ContinuationBinding = {authorityDigest: "a".repeat(64), registryDigest: registry.digest};
export type Request = KernelRequest; export type Limits = RunLimits;
export const resource: typeof CodingResource = CodingResource;
${durable}`;
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === "--help") return {help: true};
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!["--release", "--work", "--evidence", "--npm-cli"].includes(key) || !value || key.slice(2) in options) throw new Error(`invalid arguments; ${HELP}`);
    options[key.slice(2)] = resolve(value);
  }
  if (!options.release || !options.work || !options.evidence) throw new Error(`--release, --work and --evidence are required; ${HELP}`);
  return options;
}

function selectNpm(override) {
  if (override) return override;
  const binDir = dirname(process.execPath); const candidates = [];
  if (existsSync(join(binDir, "npm"))) candidates.push(realpathSync(join(binDir, "npm")));
  candidates.push(join(binDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"));
  const found = candidates.find(path => path.endsWith("npm-cli.js") && existsSync(path));
  if (!found) throw new Error("npm-cli.js beside the selected Node was not found; pass --npm-cli");
  return realpathSync(found);
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {options = parseArgs(argv);} catch (error) {process.stderr.write(`${error.message}\n`); return 2;}
  if (options.help) {process.stdout.write(HELP); return 0;}
  if (process.platform === "win32") {process.stderr.write("unsupported platform\n"); return 2;}
  for (const path of [options.work, options.evidence]) if (existsSync(path)) {process.stderr.write(`refusing existing directory ${path}\n`); return 2;}
  const tgz = existsSync(options.release) ? readdirSync(options.release).filter(name => name.endsWith(".tgz")) : [];
  if (tgz.length !== 1) {process.stderr.write("release directory must hold exactly one .tgz\n"); return 2;}
  const artifactName = tgz[0]; const artifactPath = join(options.release, artifactName);
  const artifact = readFileSync(artifactPath); const artifactSha256 = sha256(artifact);
  const shaFile = readFileSync(`${artifactPath}.sha256`, "utf8");
  if (shaFile !== `${artifactSha256}  ${artifactName}\n`) {process.stderr.write("artifact does not match its .sha256 file\n"); return 2;}
  const provenanceBytes = readFileSync(`${artifactPath}.provenance.json`); const provenance = JSON.parse(provenanceBytes);
  if (provenance.sha256 !== artifactSha256 || provenance.artifact !== artifactName) {process.stderr.write("artifact does not match its provenance\n"); return 2;}
  const source = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (provenance.name !== source.name || provenance.version !== source.version) {process.stderr.write("provenance identity differs from this checkout\n"); return 2;}
  const npmCli = selectNpm(options["npm-cli"]);

  mkdirSync(options.work, {recursive: true, mode: 0o700}); const work = realpathSync(options.work);
  mkdirSync(options.evidence, {recursive: true});
  copyFileSync(artifactPath, join(work, artifactName));
  const userPiProfile = join(homedir(), ".pi"); const profileBefore = metadataSnapshot(userPiProfile);
  const hostPaths = [...new Set([work, realpathSync(tmpdir()), tmpdir(), homedir(), root, dirname(process.execPath), realpathSync(options.release)])].filter(path => path.length > 1);

  const checks = []; const check = (scope, name, problems, detail) => {
    checks.push({scope, name, passed: problems.length === 0, ...(problems.length ? {problems} : {}), ...(detail === undefined ? {} : {detail})});
  };

  const {entries, problems: tarProblems, files: archiveFiles} = listArchive(artifact, ["dist/coding-resource/unicode-data.js"]);
  check("builder", "archive members, regular files and exclusions", [...tarProblems, ...archiveProblems(entries, archiveFiles)], {entries: entries.length});

  const nodeIdentity = {version: process.version, sha256: sha256(readFileSync(realpathSync(process.execPath)))};
  const npmVersion = spawnSync(process.execPath, [npmCli, "--version"], {encoding: "utf8", env: {PATH: `${dirname(process.execPath)}${delimiter}/usr/bin${delimiter}/bin`, HOME: work}}).stdout.trim();
  const platform = {platform: process.platform, arch: process.arch, release: release()};
  const peers = source.peerDependencies; const tooling = ["typescript", "@types/node"].map(name => `${name}@${source.devDependencies[name]}`);
  const expected = {name: source.name, version: source.version, bundled: ["@chio/bridge"], peerDependencies: peers, peerDependenciesMeta: source.peerDependenciesMeta,
    exports: source.exports, bin: source.bin, engines: source.engines, archive: entries};
  const tools = [{name: "read_file", description: "Read one workspace file", inputSchema: {type: "object", properties: {path: {type: "string"}}, required: ["path"], additionalProperties: false}},
    {name: "write_file", description: "Write one workspace file", inputSchema: {type: "object", properties: {path: {type: "string"}, content: {type: "string"}}, required: ["path", "content"], additionalProperties: false}}];

  function environment(name) {
    const dirs = Object.fromEntries(["home", "pi-profile", "npm-cache", "tmp"].map(part => {const path = join(work, `${name}-${part}`); mkdirSync(path, {mode: 0o700}); return [part, path];}));
    return {dirs, env: {PATH: `${dirname(process.execPath)}${delimiter}/usr/bin${delimiter}/bin`, HOME: dirs.home, TMPDIR: dirs.tmp, LANG: "C", LC_ALL: "C", TZ: "UTC",
      PI_CODING_AGENT_DIR: dirs["pi-profile"], npm_config_cache: dirs["npm-cache"], npm_config_userconfig: join(dirs.home, ".npmrc"),
      npm_config_globalconfig: join(work, "no-global-npmrc"), npm_config_registry: "https://registry.npmjs.org/", npm_config_update_notifier: "false",
      npm_config_fund: "false", npm_config_audit: "false", NO_UPDATE_NOTIFIER: "1"}};
  }
  function run(cwd, env, command, args, log) {
    const started = Date.now();
    const result = spawnSync(command, args, {cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600_000});
    writeFileSync(join(work, `${log}.log`), `${result.stdout ?? ""}\n--- stderr ---\n${result.stderr ?? ""}`);
    return {status: result.status, signal: result.signal, stdout: result.stdout ?? "", stderr: result.stderr ?? "", ms: Date.now() - started};
  }
  const npmArgs = ["--ignore-scripts", "--install-strategy=nested", "--no-audit", "--no-fund"];
  const summary = {schema: "chio.pi.cold-consumers.v1", artifact: artifactName, artifactSha256, sourceCommit: provenance.sourceCommit, sourceDirty: provenance.sourceDirty,
    node: nodeIdentity, npm: npmVersion, platform, consumers: []};

  for (const kind of ["base", "durable"]) {
    const consumer = join(work, `consumer-${kind}`); mkdirSync(consumer);
    const {env, dirs} = environment(`consumer-${kind}`);
    writeFileSync(join(consumer, "package.json"), `${JSON.stringify({name: `chio-pi-consumer-${kind}`, version: "0.0.0", private: true, type: "module"}, null, 2)}\n`);
    const peerSpecs = [`@earendil-works/pi-coding-agent@${peers["@earendil-works/pi-coding-agent"]}`, ...(kind === "durable" ? [`@earendil-works/pi-durable@${peers["@earendil-works/pi-durable"]}`] : [])];
    const commands = [
      ["install", ...npmArgs, "--save-exact", ...peerSpecs],
      ["install", ...npmArgs, `../${artifactName}`],
      ["install", ...npmArgs, "--save-exact", "--save-dev", ...tooling],
    ];
    const installs = commands.map((args, index) => ({command: `npm ${args.join(" ")}`, ...run(consumer, env, process.execPath, [npmCli, ...args], `consumer-${kind}-install-${index + 1}`)}));
    const installed = installs.every(step => step.status === 0);
    check(kind, "peer-first nested installation from an empty cache", installs.filter(step => step.status !== 0).map(step => `${step.command} exited ${step.status}`),
      installs.map(step => ({command: step.command, ms: step.ms})));
    const record = {schema: "chio.pi.consumer-provenance.v1", kind, artifact: artifactName, artifactSha256, sourceCommit: provenance.sourceCommit,
      builderProvenanceSha256: sha256(provenanceBytes), node: nodeIdentity, npm: npmVersion, platform,
      environment: {keys: Object.keys(env).sort(), isolatedHome: true, isolatedPiProfile: true, emptyNpmCache: true, credentials: "none passed"},
      installCommands: installs.map(step => step.command), dependency: `file:../${artifactName}`};
    if (installed) {
      const lockBytes = readFileSync(join(consumer, "package-lock.json")); const lock = JSON.parse(lockBytes);
      const manifest = JSON.parse(readFileSync(join(consumer, "package.json"), "utf8"));
      const pluginLock = lock.packages?.["node_modules/@chio/pi-plugin"] ?? {};
      check(kind, "relative artifact dependency and lock integrity", consumerLockProblems(manifest, pluginLock, artifactName, sha512(artifact), source.version),
        {lockIntegrityRecorded: pluginLock.integrity !== undefined});
      const ls = run(consumer, env, process.execPath, [npmCli, "ls", "--all", "--json"], `consumer-${kind}-ls`);
      let graph = {}; try {graph = JSON.parse(ls.stdout);} catch {}
      check(kind, "npm ls resolves the complete graph without problems", ls.status === 0 && !graph.problems ? [] : [`npm ls exited ${ls.status}`, ...(graph.problems ?? [])]);
      const packageRoot = join(consumer, "node_modules", "@chio", "pi-plugin");
      check(kind, "staged metadata, containment and installed file fidelity", installedPackageProblems(packageRoot, expected));
      const pi = JSON.parse(readFileSync(join(consumer, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"), "utf8"));
      const durableDirs = findPackageDirs(consumer, "@earendil-works/pi-durable");
      const durableVersions = durableDirs.map(path => JSON.parse(readFileSync(join(path, "package.json"), "utf8")).version);
      check(kind, "exact host peers", [
        ...(pi.version === peers["@earendil-works/pi-coding-agent"] ? [] : [`Pi ${pi.version}`]),
        ...(kind === "base" ? durableDirs.map(path => `Pi Durable present at ${relative(consumer, path)}`) : durableVersions.length === 1 && durableVersions[0] === peers["@earendil-works/pi-durable"] ? [] : [`Pi Durable ${durableVersions.join(",") || "absent"}`])],
        {pi: pi.version, piDurable: kind === "base" ? "absent" : durableVersions[0]});
      const bins = binProblems(consumer);
      const helps = [];
      for (const name of bins.names) helps.push({bin: name, args: ["--help"]});
      for (const command of ["doctor", "status", "inspect", "recover"]) helps.push({bin: "chio-pi", args: [command, "--help"]});
      const helpResults = helps.map(({bin, args}) => {
        const result = run(consumer, env, join(consumer, "node_modules", ".bin", bin), args, `consumer-${kind}-help-${bin}-${args.join("-")}`);
        return {bin, args, status: result.status, stdoutSha256: sha256(result.stdout), firstLine: result.stdout.split("\n")[0].slice(0, 120)};
      });
      const required = ["chio-pi", "chio-coding-resource", "pi"].filter(name => !bins.names.includes(name)).map(name => `missing .bin/${name}`);
      check(kind, "npm executable symlinks run every help path", [...bins.problems, ...required,
        ...helpResults.filter(item => item.status !== 0 || !item.firstLine).map(item => `${item.bin} ${item.args.join(" ")} exited ${item.status}`)], helpResults);
      writeFileSync(join(consumer, "smoke.mjs"), smokeSource(kind, tools));
      const smoke = run(consumer, env, process.execPath, ["smoke.mjs"], `consumer-${kind}-smoke`);
      let smokeReport; try {smokeReport = JSON.parse(smoke.stdout.trim().split("\n").at(-1));} catch {}
      check(kind, kind === "base" ? "root and coding imports; Durable entrypoint needs its optional peer" : "Durable import and registration smoke",
        smoke.status === 0 && smokeReport ? [] : [`smoke exited ${smoke.status}: ${smoke.stderr.split("\n").filter(Boolean).slice(-3).join(" | ")}`], smokeReport);
      // Two runs: strict library checking must report nothing in this package's
      // declarations or the consumer file (upstream Pi declarations are recorded,
      // not excused silently); the ordinary skipLibCheck consumer build must pass.
      writeFileSync(join(consumer, "consumer.ts"), typecheckSource(kind));
      const tsconfig = skipLibCheck => ({compilerOptions: {target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true,
        types: ["node"], skipLibCheck}, files: ["consumer.ts"]});
      writeFileSync(join(consumer, "tsconfig.strict-lib.json"), `${JSON.stringify(tsconfig(false), null, 2)}\n`);
      writeFileSync(join(consumer, "tsconfig.json"), `${JSON.stringify(tsconfig(true), null, 2)}\n`);
      const tscBin = join(consumer, "node_modules", ".bin", "tsc");
      const strict = run(consumer, env, tscBin, ["-p", "tsconfig.strict-lib.json", "--pretty", "false"], `consumer-${kind}-tsc-strict-lib`);
      const diagnostics = strict.stdout.split("\n").filter(line => /error TS\d+/.test(line) && !/^\s/.test(line));
      const located = diagnostics.map(line => /^(.+?)\(\d+,\d+\): error (TS\d+)/.exec(line));
      const ours = diagnostics.filter((line, index) => !located[index] || !located[index][1].startsWith("node_modules/") || located[index][1].startsWith("node_modules/@chio/pi-plugin/"));
      const upstream = [...new Set(located.filter(Boolean).filter(match => !match[1].startsWith("node_modules/@chio/pi-plugin/")).map(match => `${match[2]} ${match[1].split("/").slice(0, match[1].startsWith("node_modules/@") ? 3 : 2).join("/")}`))].sort();
      const tsc = run(consumer, env, tscBin, ["-p", "tsconfig.json", "--pretty", "false"], `consumer-${kind}-tsc`);
      check(kind, kind === "base" ? "typecheck root and coding declarations without Pi Durable" : "typecheck the Durable entrypoint", [
        ...ours.map(line => `strict library check: ${line.slice(0, 200)}`),
        ...(tsc.status === 0 ? [] : [`tsc exited ${tsc.status}: ${tsc.stdout.split("\n").filter(Boolean).slice(0, 5).join(" | ")}`])],
        {strictLibraryCheck: {exit: strict.status, diagnostics: diagnostics.length, inThisPackageOrConsumer: ours.length, upstreamCodesByPackage: upstream}, skipLibCheckBuild: {exit: tsc.status}});
      const rootSpecifiers = [...new Set([...declarationSpecifiers(join(packageRoot, "dist", "index.d.ts")), ...declarationSpecifiers(join(packageRoot, "dist", "coding-resource", "participant.d.ts"))])].sort();
      const durableSpecifiers = declarationSpecifiers(join(packageRoot, "dist", "durable.d.ts"));
      check(kind, "root declaration closure excludes Pi Durable", [
        ...rootSpecifiers.filter(name => name.startsWith("@earendil-works/pi-durable")).map(name => `root declarations reference ${name}`),
        ...(durableSpecifiers.includes("@earendil-works/pi-durable") ? [] : ["durable declarations do not reference Pi Durable"])], {rootSpecifiers});

      // Replay the retained fixture: npm ci from the exact manifest and lockfile.
      const replay = join(work, `replay-${kind}`); mkdirSync(replay);
      const replayEnv = environment(`replay-${kind}`).env;
      copyFileSync(join(consumer, "package.json"), join(replay, "package.json")); copyFileSync(join(consumer, "package-lock.json"), join(replay, "package-lock.json"));
      const ci = run(replay, replayEnv, process.execPath, [npmCli, "ci", ...npmArgs], `replay-${kind}-ci`);
      const replayLs = run(replay, replayEnv, process.execPath, [npmCli, "ls", "--all", "--json"], `replay-${kind}-ls`);
      const replayHelp = ci.status === 0 ? run(replay, replayEnv, join(replay, "node_modules", ".bin", "chio-pi"), ["--help"], `replay-${kind}-help`) : {status: null};
      check(kind, "retained lockfile replays with npm ci from an empty cache", [
        ...(ci.status === 0 ? [] : [`npm ci exited ${ci.status}`]),
        ...(ci.status === 0 && readFileSync(join(replay, "package-lock.json")).equals(lockBytes) ? [] : ["replayed lockfile changed"]),
        ...(replayLs.status === 0 && replayLs.stdout === ls.stdout ? [] : ["replayed graph differs"]),
        ...(replayHelp.status === 0 ? [] : ["replayed chio-pi --help failed"])], {npmCi: `npm ci ${npmArgs.join(" ")}`});

      const out = join(options.evidence, `consumer-${kind}`); mkdirSync(out);
      copyFileSync(join(consumer, "package.json"), join(out, "package.json")); copyFileSync(join(consumer, "package-lock.json"), join(out, "package-lock.json"));
      // npm ls reports the local archive as an absolute file: URL; retain the
      // consumer-relative dependency the manifest and lockfile actually use.
      const normalized = normalizeConsumerGraph(ls.stdout, artifactName); const graphText = normalized.text;
      check(kind, "resolved graph excludes absolute file paths including npm redactions", normalized.problems);
      record.resolvedGraphNormalization = {absoluteArtifactResolutions: normalized.absoluteArtifactResolutions, retainedAs: `file:../${artifactName}`};
      writeFileSync(join(out, "resolved-graph.json"), graphText.endsWith("\n") ? graphText : `${graphText}\n`);
      Object.assign(record, {lockfileSha256: sha256(lockBytes), packageJsonSha256: sha256(readFileSync(join(consumer, "package.json"))), resolvedGraphSha256: sha256(readFileSync(join(out, "resolved-graph.json"))),
        lockPackages: Object.keys(lock.packages ?? {}).length - 1, pi: pi.version, piDurable: kind === "base" ? null : durableVersions[0], isolatedPiProfileEntries: metadataSnapshot(dirs["pi-profile"]).entries});
    }
    record.checks = checks.filter(item => item.scope === kind);
    record.status = record.checks.every(item => item.passed) && record.checks.length > 1 ? "passed" : "failed";
    const out = join(options.evidence, `consumer-${kind}`); mkdirSync(out, {recursive: true});
    writeFileSync(join(out, "consumer-provenance.json"), `${JSON.stringify(record, null, 2)}\n`);
    summary.consumers.push({kind, status: record.status});
  }

  const profileAfter = metadataSnapshot(userPiProfile);
  check("host", "normal Pi profile metadata unchanged", profileBefore.digest === profileAfter.digest && profileBefore.exists === profileAfter.exists ? []
    : [`normal Pi profile metadata changed (${profileBefore.entries} entries before, ${profileAfter.entries} after)`], {exists: profileAfter.exists, entries: profileAfter.entries});
  const builder = join(options.evidence, "builder"); mkdirSync(builder);
  writeFileSync(join(builder, "provenance.json"), provenanceBytes); writeFileSync(join(builder, `${artifactName}.sha256`), shaFile);
  writeFileSync(join(builder, "archive-manifest.json"), `${JSON.stringify({artifact: artifactName, sha256: artifactSha256, integrity: sha512(artifact), entries}, null, 2)}\n`);
  const leaks = [];
  for (const file of [join(builder, "provenance.json"), join(builder, "archive-manifest.json"), ...["base", "durable"].flatMap(kind => ["package.json", "package-lock.json", "resolved-graph.json", "consumer-provenance.json"].map(name => join(options.evidence, `consumer-${kind}`, name)))]) {
    if (!existsSync(file)) continue; const text = readFileSync(file, "utf8");
    for (const path of hostPaths) if (containsHostPath(text, path)) leaks.push(`${relative(options.evidence, file)} contains a host path`);
  }
  check("host", "retained evidence has no host-specific absolute paths", [...new Set(leaks)]);
  summary.checks = checks.filter(item => item.scope === "builder" || item.scope === "host");
  summary.status = checks.every(item => item.passed) && summary.consumers.every(item => item.status === "passed") ? "passed" : "failed";
  writeFileSync(join(options.evidence, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({status: summary.status, artifactSha256, consumers: summary.consumers, failed: checks.filter(item => !item.passed).map(item => `${item.scope}: ${item.name}`)})}\n`);
  return summary.status === "passed" ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await main();
