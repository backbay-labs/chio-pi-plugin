import { readFile, writeFile, realpath, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const [tracePath, operatorPath, crossHostPath, configPath] = process.argv.slice(2);
if (!configPath) throw new Error("Usage: node scripts/probe-sandbox.mjs actual-protected-host.jsonl /private/operator.json /private/other-host.json /private/prepared-config.json");
const events = (await readFile(tracePath, "utf8")).trim().split("\n").map(JSON.parse);
const launch = events.find(event => event.type === "chio_protected_runtime");
const terminal = events.findLast(event => event.type === "chio_session");
if (!launch || !terminal) throw new Error("An actual completed protected host trace is required");
const policy = await readFile(launch.policyPath, "utf8");
const profile = dirname(dirname(terminal.sessionFile));
const cwd = JSON.parse(policy.match(/\(literal ("[^"]+")\) \(vnode-type DIRECTORY\)/)[1]);
const config = await realpath(configPath);
const kernelUrl = JSON.parse(await readFile(config, "utf8")).execution.endpoint;
const ownControl = join(launch.installation, "chio-probe-readonly-control.txt");
await writeFile(ownControl, "immutable installation probe");
const evidence = resolve(process.env.CHIO_PI_EVIDENCE_DIR ?? "evidence/2026-09-09/sandbox-process");
await mkdir(evidence, { recursive: true });
const files = [await realpath(operatorPath), await realpath(crossHostPath), config];
const before = { config: createHash("sha256").update(await readFile(config)).digest("hex"), installationControl: await readFile(ownControl, "utf8") };
const outside = { requests: 0 };
const server = createServer((_req, res) => { outside.requests++; res.end("observed"); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const probe = `
const fs=require('node:fs'),cp=require('node:child_process');
const result={reads:[],writes:[],links:[],spawns:[],network:[]};
const profile=${JSON.stringify(profile)},config=${JSON.stringify(config)},control=${JSON.stringify(ownControl)};
for(const path of ${JSON.stringify([...files, ...files.map(path => `/System/Volumes/Data${path}`)])}){try{result.reads.push({path,allowed:true,bytes:fs.readFileSync(path).length})}catch(e){result.reads.push({path,allowed:false,code:e.code})}}
for(const [name,path] of [['operator',${JSON.stringify(files[0])}],['config',config],['installation',control]]){const alias=profile+'/probe-symlink-'+name;try{fs.symlinkSync(path,alias)}catch{};try{result.reads.push({path:alias,allowed:true,bytes:fs.readFileSync(alias).length})}catch(e){result.reads.push({path:alias,allowed:false,code:e.code})}}
for(const path of [config,control]){try{fs.writeFileSync(path,'unexpected direct effect');result.writes.push({path,allowed:true})}catch(e){result.writes.push({path,allowed:false,code:e.code})}}
for(const [name,path] of [['config',config],['installation',control]]){const alias=profile+'/probe-hardlink-'+name;try{fs.linkSync(path,alias);fs.writeFileSync(alias,'unexpected hardlink effect');result.links.push({path,allowed:true})}catch(e){result.links.push({path,allowed:false,code:e.code})}}
for(const executable of [process.execPath,'/bin/sh']){const args=executable===process.execPath?['-e','require("node:fs").writeFileSync('+JSON.stringify(profile+'/probe-child-effect')+',"spawned")']:['-c','true'];const r=cp.spawnSync(executable,args);result.spawns.push({executable,status:r.status,error:r.error?.code})}
(async()=>{for(const url of ['http://127.0.0.1:${port}/',${JSON.stringify(kernelUrl)}]){try{const r=await fetch(url,{signal:AbortSignal.timeout(1500)});result.network.push({url,allowed:true,status:r.status})}catch(e){result.network.push({url,allowed:false,code:e.cause?.code||e.code})}}process.stdout.write(JSON.stringify(result)+'\\n')})().catch(()=>process.exitCode=1);
`;
const child = spawn("/usr/bin/sandbox-exec", ["-f", launch.policyPath, launch.node, "-e", probe], { cwd, env: { OPENSSL_CONF: "/dev/null", PI_CODING_AGENT_DIR: profile }, stdio: ["ignore", "pipe", "pipe"] });
const stdout = []; const stderr = [];
child.stdout.on("data", data => stdout.push(data)); child.stderr.on("data", data => stderr.push(data));
const code = await new Promise(resolve => child.on("exit", resolve));
const blockedRequests = outside.requests;
await fetch(`http://127.0.0.1:${port}/`); // independent positive control, after blocked attempt
const positiveControlRequests = outside.requests - blockedRequests;
server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
const after = { config: createHash("sha256").update(await readFile(config)).digest("hex"), installationControl: await readFile(ownControl, "utf8") };
const positiveReadControls = await Promise.all(files.map(async path => ({ path, readableOutsideSandbox: Boolean((await readFile(path)).length) })));
await writeFile(join(evidence, "boundary-probe.json"), JSON.stringify({ code, policySha256: launch.policySha256, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), before, after, blockedRequests, positiveControlRequests, positiveReadControls, scope: "Actual Node process under exact launched Pi sandbox policy. Operator injected hostile process probes; no model prompt bypass claimed." }, null, 2) + "\n");
console.log(JSON.stringify({ code, blockedRequests, positiveControlRequests, unchanged: JSON.stringify(before) === JSON.stringify(after) }));

const observed = JSON.parse(Buffer.concat(stdout).toString());
if (code !== 0 || blockedRequests !== 0 || positiveControlRequests !== 1 || JSON.stringify(before) !== JSON.stringify(after)
  || observed.writes.some(item => item.allowed) || observed.links.some(item => item.allowed)
  || observed.spawns.some(item => item.status === 0 || !item.error) || observed.network.some(item => item.allowed)
  || observed.reads.some(item => item.allowed && !item.path.endsWith('probe-symlink-installation'))) {
  throw new Error("Process boundary probe failed; retain the exact evidence");
}
