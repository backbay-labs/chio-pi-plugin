import {createHash} from "node:crypto";
import {spawn} from "node:child_process";
import {chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalJson} from "../../dist/tool-registry.js";
import {runtimeLibraries} from "../../dist/sandbox.js";

export const cli = fileURLToPath(new URL("../../dist/coding-resource-cli.js", import.meta.url));
export const driver = fileURLToPath(new URL("./coding-resource-driver.mjs", import.meta.url));
export const caller = "a".repeat(64);
export const hash = value => createHash("sha256").update(value).digest("hex");
export const meta = (id = "1", extra = {}) => ({chioRequestId: id.repeat(64), chioOperationId: id.repeat(64), chioAttemptId: "native-attempt", chioTransportKeyEpoch: 1, chioCallerCapabilitySha256: caller, ...extra});
export const data = result => JSON.parse(result.content[0].text);
let macRuntimePins;
async function fixtureRuntimePins(executable) {
  if (process.platform !== "darwin") return JSON.parse(process.env.CHIO_CODING_LINUX_RUNTIME_JSON ?? "[]");
  macRuntimePins ??= runtimeLibraries(executable).then(paths => Promise.all(paths.filter(path => path !== executable).map(async path => ({path, sha256: hash(await readFile(path))}))));
  return (await macRuntimePins).map(file => ({...file}));
}

export async function fixture(options = {}) {
  const base = await mkdtemp(join(await realpath(tmpdir()), "chio-coding-"));
  const root = name => join(base, name);
  for (const name of ["repository", "state", "artifacts", "jobs"]) await mkdir(root(name), {mode: 0o700});
  const files = options.files ?? {"source.txt": "alpha\nbeta\n", "fixture-test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; test('source',()=>assert.match(readFileSync('source.txt','utf8'),/alpha/));"};
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root("repository"), path)), {recursive: true, mode: 0o700});
    await writeFile(join(root("repository"), path), content, {mode: 0o600});
  }
  const executable = await realpath(process.execPath);
  const recipe = {name: "unit", executable, executableSha256: hash(await readFile(executable)), argv: ["fixture-test.mjs"], timeoutMs: options.timeoutMs ?? 2000, outputBytes: options.outputBytes ?? 16384, graceMs: 100, runtimeFiles: options.runtimeFiles ?? await fixtureRuntimePins(executable)};
  recipe.recipeSha256 = hash(canonicalJson(recipe));
  const config = {schema: "chio.coding-resource.v1", resourceOwnerId: "fixture-owner", workspaceId: "fixture-workspace", repositoryRoot: root("repository"), stateRoot: root("state"), artifactRoot: root("artifacts"), jobRoot: root("jobs"), allowedCallerCapabilitySha256: [caller, "b".repeat(64)], bounds: {maxFileBytes: 262144, maxRepositoryBytes: 1048576, maxFiles: 128, maxReadBytes: 65536, maxSearchMatches: 50, maxReadMany: 8, maxPatchBytes: 65536, maxInputBytes: 131072, maxQueuedCalls: 8, maxOutputBytes: 131072, ...options.bounds}, recipes: [recipe]};
  const configPath = join(base, "operator.json");
  await writeFile(configPath, JSON.stringify(config), {mode: 0o600});
  return {base, root, config, configPath, async updateConfig(change) {change(config); await writeFile(configPath, JSON.stringify(config), {mode: 0o600});}, async close() {await chmodTree(root("state")); await chmodTree(root("artifacts")); await rm(base, {recursive: true, force: true});}};
}
async function chmodTree(path) {
  await chmod(path, 0o700).catch(() => {});
  for (const item of await readdir(path, {withFileTypes: true}).catch(() => [])) {
    if (item.isDirectory()) await chmodTree(join(path, item.name));
    else await chmod(join(path, item.name), 0o600).catch(() => {});
  }
}
export async function command(args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [options.entry ?? cli, ...args], {stdio: ["ignore", "pipe", "pipe"], env: {PATH: dirname(process.execPath), LANG: "C", ...options.env}});
    let stdout = ""; let stderr = ""; let timedOut = false;
    const timer = options.timeoutMs ? setTimeout(() => {timedOut = true; child.kill("SIGKILL");}, options.timeoutMs) : undefined;
    child.stdout.on("data", value => stdout += value); child.stderr.on("data", value => stderr += value);
    child.once("error", reject); child.once("close", code => {clearTimeout(timer); resolve({code, stdout, stderr, timedOut});});
  });
}
export async function initialized(options = {}) {
  const f = await fixture(options);
  const result = await command(["init", "--config", f.configPath]);
  if (result.code !== 0) {await f.close(); throw new Error(`Explicit resource init is missing or failed: ${result.stderr}`);}
  const view = JSON.parse(result.stdout);
  return {...f, sourceDigest: view.sourceDigest};
}
export function stdio(f, options = {}) {
  const child = spawn(process.execPath, options.fault || options.env ? [driver, f.configPath, options.fault ?? "", JSON.stringify(options.env ?? {})] : [cli, "serve", "--config", f.configPath], {stdio: ["pipe", "pipe", "pipe"], env: {PATH: dirname(process.execPath), LANG: "C"}});
  let line = ""; let stderr = ""; let stdout = ""; let id = 0; let closed = false;
  const pending = new Map(); const messages = [];
  child.stdout.on("data", value => {
    stdout += value; line += value;
    for (let at; (at = line.indexOf("\n")) >= 0;) {
      const raw = line.slice(0, at); line = line.slice(at + 1);
      if (!raw) continue;
      const message = JSON.parse(raw); messages.push(message);
      const pair = pending.get(message.id);
      if (pair) {pending.delete(message.id); pair.resolve(message);}
    }
  });
  child.stderr.on("data", value => stderr += value);
  child.once("close", () => {closed = true; for (const pair of pending.values()) pair.reject(new Error("resource transport closed")); pending.clear();});
  const exited = new Promise(resolve => child.once("close", code => resolve({code, stderr, stdout, messages})));
  child.stdin.on("error", () => {});
  return {child, messages, exited, async request(method, params = {}, transportId) {
    if (closed) throw new Error("resource transport closed");
    const requestId = transportId ?? ++id;
    const promise = new Promise((resolve, reject) => pending.set(requestId, {resolve, reject}));
    child.stdin.write(JSON.stringify({jsonrpc: "2.0", id: requestId, method, params}) + "\n");
    return await promise;
  }, async call(name, args, nativeMeta = meta(), transportId) {const response = await this.request("tools/call", {name, arguments: args, _meta: nativeMeta}, transportId); if (response.error) throw new Error(response.error.message); return response.result;}, async close() {child.stdin.end(); return await exited;}};
}
export const patch = (sourceDigest, expectedFileSha256, replacement = "changed\nbeta\n") => ({sourceDigest, changes: [{path: "source.txt", expectedFileSha256, replacement}]});
