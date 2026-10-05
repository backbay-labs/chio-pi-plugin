#!/usr/bin/env node
// Runnable roadmap qualification for the development workflow. The component
// profile runs the signed bridge fixture with real local recipe confinement and
// independent checks. The native profile is refused unless qualified native
// prerequisites exist; no fixture result is substituted for native acceptance.
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {createReadStream, existsSync, realpathSync} from "node:fs";
import {lstat, readFile, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RESULT_SCHEMA = "chio.pi.roadmap-qualification.v1";
export const EXIT = {passed: 0, failed: 1, usage: 2, refused: 3};
export const NATIVE_PREREQUISITES = [
  ["kernelArtifact", "file", "exact retained native kernel artifact"],
  ["publisherManifest", "file", "publisher-signed nine-tool resource manifest"],
  ["signerPin", "digest", "independently selected kernel signer pin"],
  ["custodyLaunchProfile", "file", "qualified custody and launch profile for the resource owner"],
  ["callerCapabilitySha256", "digest", "native caller binding from the canonical signed capability"],
  ["signedRecoveryFixture", "file", "signed response-loss and original-result recovery fixture"],
];
const SCOPES = {
  signedBridgeFixture: "A scripted kernel signs with an ephemeral fixture key and forwards admitted calls to the real coding participant on its kernel-owned stdio pipe, through the bundled native gateway, the trusted parent proxy, the guest adapter and actual Pi Durable hosts. It measures adapter and host contracts and does not qualify a real kernel or authority installation.",
  localConfinement: "Real OS confinement of the operator-pinned recipe on this host. It is not whole-Pi confinement, P5 acceptance or an ordinary Docker default.",
  nativeKernel: "Native coding-workflow acceptance stays open until the exact kernel, publisher manifest, custody/launch profile, caller binding and signed recovery fixture in docs/NATIVE-PREREQUISITES.md are supplied and qualified.",
};
const NOT_QUALIFIED = [
  "native kernel coding-workflow acceptance and authority installation",
  "publisher-signed manifest, custody and launch profile",
  "resource commit before retained native completion evidence (preserved as an unknown original, never reconciled here)",
  "P4 cross-authority adoption, P5 and whole-Pi Linux confinement",
  "live provider or real kernel service behavior",
];
const USAGE = `Usage: node scripts/qualify-roadmap.mjs [--profile component|native] [--native-profile PATH] [--out PATH]

Build first: npm run build. Requires the development install (Pi Durable, bundled bridge).

--profile component (default)
  Runs the signed bridge fixture development workflow: locate and read the
  isExpired source through admitted resource tools, demonstrate the equality
  bug in real local recipe confinement, refuse forbidden access, apply a
  compare-and-swap patch, rerun the same pinned recipe, review the diff,
  publish, lose the response and recover the exact artifact in a second actual
  host. A second run loses the completion before native retention and must
  preserve that unknown original without replacement. Independent checks read
  the native journal, the artifact store and the import originals directly.
  This is adapter and host contract evidence, not native kernel qualification.
  Refuses (exit 3) when real local confinement is unavailable; never runs
  recipes unconfined.

--profile native
  Native coding-workflow acceptance. Refuses (exit 3) unless --native-profile
  names every prerequisite; this candidate ships no native acceptance runner,
  so a complete profile is still refused and native acceptance stays open.

--out PATH  Write the machine-readable result to a new private file. An
  existing file is never replaced (exit 2).
--trace     Print workflow progress on stderr.

Exit codes: 0 passed, 1 failed (evidence preserved), 2 usage or precondition,
3 refused because a required profile is unavailable.`;

const sha256 = value => createHash("sha256").update(value).digest("hex");
async function fileSha256(path) {
  const digest = createHash("sha256");
  await new Promise((done, fail) => createReadStream(path).on("data", chunk => digest.update(chunk)).once("error", fail).once("end", done));
  return digest.digest("hex");
}
function environment() {
  let sourceCommit = null; let worktreeDirty = null;
  try {
    sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
    worktreeDirty = execFileSync("git", ["status", "--porcelain"], {cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim() !== "";
  } catch { /* Source identity is optional evidence; git may be unavailable. */ }
  return {node: process.version, execPath: realpathSync(process.execPath), platform: process.platform, arch: process.arch, sourceCommit, worktreeDirty};
}

/** Validates an operator-declared native profile without running anything. */
export async function nativeRefusal(profilePath) {
  const prerequisites = NATIVE_PREREQUISITES.map(([name, kind, description]) => ({name, kind, description}));
  if (!profilePath) return {reason: "No native profile was supplied. Native coding-workflow acceptance needs the exact kernel, publisher manifest, custody/launch profile, caller binding and signed recovery fixture; the signed bridge fixture is not substituted.", missing: prerequisites.map(item => item.name), prerequisites};
  let profile;
  try {
    const info = await lstat(profilePath);
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error("not a bounded regular file");
    profile = JSON.parse(await readFile(profilePath, "utf8"));
  } catch (error) {return {reason: `Native profile is unreadable (${error.message}); refusing without a substitute run.`, missing: prerequisites.map(item => item.name), prerequisites};}
  const missing = []; const verified = {};
  for (const {name, kind} of prerequisites) {
    const value = profile?.[name];
    try {
      if (kind === "digest") {if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(); verified[name] = value; continue;}
      if (!value || typeof value.path !== "string" || !isAbsolute(value.path) || !/^[a-f0-9]{64}$/.test(value.sha256 ?? "")) throw new Error();
      if (!(await lstat(value.path)).isFile() || await fileSha256(value.path) !== value.sha256) throw new Error();
      verified[name] = {path: value.path, sha256: value.sha256};
    } catch {missing.push(name);}
  }
  if (missing.length) return {reason: `Native profile is incomplete or does not match its pinned hashes (${missing.join(", ")}); refusing without a substitute run.`, missing, prerequisites};
  return {reason: "Every declared native prerequisite is present and hash-pinned, but this candidate ships no qualified native acceptance runner. Native coding-workflow acceptance remains open; no fixture result is substituted.", missing: ["nativeAcceptanceRunner"], verified, prerequisites};
}

/** Each check is evaluated independently. A stopped or partial workflow yields
 * failed checks citing its retained status instead of throwing. */
function checker(e) {
  const checks = [];
  async function check(name, evaluate) {
    try {
      const value = await evaluate();
      const passed = value === true || value?.passed === true;
      checks.push({name, passed, ...(passed ? {} : {detail: {workflowStatus: e?.status ?? null, ...(value?.detail === undefined ? {} : {observed: value.detail})}})});
    } catch (error) {checks.push({name, passed: false, detail: {workflowStatus: e?.status ?? null, error: error instanceof Error ? error.message : String(error)}});}
  }
  return {checks, check};
}

/** Independent checks over an open recovered run. Reads the native journal,
 * the operator configuration, the artifact store, the unsigned resource ledger
 * and the import originals. */
export async function componentChecks(run, backend) {
  const {verifyCompletedOutcome} = await import("@chio/bridge");
  const {canonicalJson} = await import("../dist/tool-registry.js");
  const {evidence: e, observer, resource, native: f} = run;
  const {checks, check} = checker(e);
  await check("workflow completed every stage through second-host recovery", () => ({passed: e.status === "recovered", detail: e.status}));
  const operator = JSON.parse(await readFile(resource.configPath, "utf8"));
  const {recipeSha256, ...recipeBody} = operator.recipes[0];
  const imported = await readFile(join(operator.repositoryRoot, "src/expiry.mjs"), "utf8");
  const fixed = imported.replace("now > deadline", "now >= deadline");
  const journal = async id => typeof id === "string" ? await f.record(id).catch(() => null) : null;
  const signed = [];
  for (const step of e.steps ?? []) {
    const record = await journal(step.nativeRequestId);
    signed.push({step, record, ok: record?.state === "completed" && record.request?.tool === step.kernelTool && verifyCompletedOutcome(record.outcome, f.config.execution, record.request)
      && record.acknowledged === true && record.hostDeliveryConfirmed === true});
  }
  await check("every admitted step has a verified signed completion delivered and acknowledged at the native gateway",
    () => ({passed: signed.length === 9 && signed.every(item => item.ok), detail: {steps: signed.length, unverified: signed.filter(item => !item.ok).map(item => item.step.name)}}));
  await check("every admitted step was acknowledged by the automatic committed-history observer",
    () => ({passed: signed.length === 9 && signed.every(item => item.step.deliveredBy === "commit-observer"), detail: {deliveredBy: signed.map(item => [item.step.name, item.step.deliveredBy])}}));
  const testData = name => {const item = signed.find(value => value.step.name === name); return item?.record ? JSON.parse(item.record.outcome.result.content[0].text) : null;};
  const before = testData("before-test"); const after = testData("after-test");
  const bound = result => {if (!result) return false; const {resultSha256, ...body} = result; return sha256(canonicalJson(body)) === resultSha256;};
  await check("operator recipe digest recomputes from the operator configuration", () => sha256(canonicalJson(recipeBody)) === recipeSha256);
  await check("first confined run of the pinned recipe fails, only at the equality boundary", () => before?.success === false && before.sandbox === backend && bound(before)
    && /✖ isExpired is true at the exact deadline|not ok \d+ - isExpired is true at the exact deadline/.test(before.stdout) && /(?:#|ℹ) fail 1$/m.test(before.stdout) && /(?:#|ℹ) pass 2$/m.test(before.stdout));
  await check("after the patch the same pinned recipe passes in confinement", () => after?.success === true && after.sandbox === backend && bound(after)
    && before.recipeSha256 === recipeSha256 && after.recipeSha256 === recipeSha256 && after.sourceDigest === e.patch?.sourceDigest);
  await check("patch was a full-file compare-and-swap against the imported original", () => e.patch?.arguments.changes[0].expectedFileSha256 === sha256(imported) && e.patch.previousSourceDigest === e.source?.initialDigest);
  const steps = e.steps ?? []; const forbidden = steps.filter(step => step.name.startsWith("forbidden-"));
  await check("forbidden access was a retained completed tool error, not a native denial, with no fence or artifact", () => forbidden.length === 2
    && forbidden.every(step => signed.find(item => item.step === step)?.record?.outcome.result.isError === true && step.verdict === "allow")
    && e.forbidden?.length === 2 && e.forbidden.every(item => item.nativeDenial === false && item.fencedAfterDelivery === false && item.artifactsAfter === 0));
  await check("legitimate work followed under one unchanged retained authority", () => {
    const legitimateAfter = steps.slice(steps.findIndex(step => step.name.startsWith("forbidden-")) + forbidden.length).filter(step => !step.toolError);
    return forbidden.length === 2 && legitimateAfter.length >= 3 && steps.every(step => canonicalJson(step.authority) === canonicalJson(e.authority))
      && e.authority?.callerCapabilitySha256 === operator.allowedCallerCapabilitySha256[0];
  });
  const publications = await observer.publications();
  const names = await observer.listing();
  const artifact = names.length === 1 ? await observer.artifact(names[0]) : null;
  await check("exactly one actual publication effect exists in the resource ledger and artifact store", () => ({
    passed: publications.published.length === 1 && publications.unresolved.length === 0 && publications.artifacts.length === 1 && names.length === 1
      && publications.published[0].artifactSha256 === names[0] && publications.effects === 1 && e.publicationEffects === 1,
    detail: {ledgerPublished: publications.published.length, ledgerUnresolved: publications.unresolved.length, artifacts: publications.artifacts, listing: names}}));
  await check("artifact is content addressed and equals the recovered artifact", () => artifact?.contentAddressed === true && artifact.sha256 === e.recoveredArtifact?.sha256 && artifact.sha256 === e.originalArtifact?.sha256);
  await check("artifact was never replaced during recovery", () => artifact?.ino === e.originalArtifact?.ino && artifact?.mtimeMs === e.originalArtifact?.mtimeMs && artifact?.fileMode === 0o400 && artifact?.directoryMode === 0o500);
  const bundle = artifact?.bundle;
  await check("bundle binds the exact successfully tested source, test result, recipe and destination", () => bundle?.destination === "review" && bundle.sourceDigest === e.patch?.sourceDigest
    && bundle.testOperationId === e.afterTest?.operationId && bundle.testResultSha256 === after?.resultSha256 && bundle.test.success === true && bound(bundle.test)
    && bundle.recipeSha256 === recipeSha256 && bundle.unsigned === true && bundle.authority === false);
  await check("reviewed diff in the bundle is exactly the equality fix", () => fixed !== imported && bundle !== undefined && bundle.diff.diffSha256 === e.diff?.diffSha256
    && canonicalJson(bundle.diff.changes) === canonicalJson([{path: "src/expiry.mjs", before: imported, after: fixed}]));
  await check("published source is the fixed source and import originals are unchanged", async () => {
    const bundledSource = bundle?.files.find(file => file.path === "src/expiry.mjs");
    return bundledSource !== undefined && Buffer.from(bundledSource.content, "base64").toString("utf8") === fixed && await observer.importedSource() === imported
      && await observer.generationSource(e.source?.initialDigest) === imported && await observer.generationSource(e.patch?.sourceDigest) === fixed;
  });
  const original = await journal(e.firstHost?.nativeRequestId);
  await check("publication response was lost after the native gateway retained a verified completion", () => e.firstHost?.publicationResponse === "lost" && e.firstHost.guestUnresolved === true
    && original?.state === "completed" && verifyCompletedOutcome(original.outcome, f.config.execution, original.request));
  await check("second actual host recovered the original outcome without any dispatch", () => original !== null && e.secondHost?.executorCalls === 0 && e.kernel?.nativeCallsDuringRecovery === 0
    && e.kernel.resourceDispatchesDuringRecovery === 0 && e.secondHost.recoveredOutcomeDigest === sha256(canonicalJson(original.outcome)));
  await check("only the original completion was acknowledged and its fence cleared", () => e.kernel?.acksDuringRecovery === 1 && original?.acknowledged === true
    && original.hostDeliveryConfirmed === true && e.secondHost?.fencedAfterRecovery === false);
  return checks;
}

/** Independent checks over an open run whose completion was lost before native retention. */
export async function uncertainChecks(run) {
  const {canonicalJson} = await import("../dist/tool-registry.js");
  const {evidence: e, observer, native: f} = run;
  const {checks, check} = checker(e);
  await check("workflow preserved the uncertain publication rather than completing", () => ({passed: e.status === "uncertain-preserved", detail: e.status}));
  const record = typeof e.firstHost?.nativeRequestId === "string" ? await f.record(e.firstHost.nativeRequestId).catch(() => null) : null;
  await check("native original remains unknown without a signed completion", () => record?.state === "unknown" && record.outcome?.evidence === "unverified" && record.outcome.receipt === undefined);
  const publications = await observer.publications();
  const names = await observer.listing(); const artifact = names.length === 1 ? await observer.artifact(names[0]) : null;
  await check("the resource committed exactly one publication before native evidence", () => ({
    passed: publications.published.length === 1 && publications.unresolved.length === 0 && publications.artifacts.length === 1 && artifact?.contentAddressed === true
      && publications.published[0].artifactSha256 === artifact.sha256 && artifact.bundle.sourceDigest === e.patch?.sourceDigest && publications.effects === 1 && e.publicationEffects === 1,
    detail: {ledgerPublished: publications.published.length, ledgerUnresolved: publications.unresolved.length, artifacts: publications.artifacts}}));
  await check("second host recovery was refused and no replacement publication was dispatched", () => e.recoveredArtifact === null && /unknown/.test(e.secondHost?.recoveryRefusal ?? "")
    && e.secondHost.replacementAttempt?.dispatched === false && e.kernel?.resourceDispatchesDuringRecovery === 0 && e.kernel.nativeCallsDuringRecovery === 0 && e.kernel.acksDuringRecovery === 0);
  await check("native fence is retained and the unsigned resource ledger cannot clear it", () => e.secondHost?.fencedAfterRecovery === true && e.resourceLedger?.unsigned === true
    && e.resourceLedger.kernelFenceClearance === false && e.resourceLedger.publishCompleted === true);
  await check("scripted kernel saw one refused and one committed publication", () => e.kernel !== undefined && canonicalJson(e.kernel.resourcePublishCalls) === canonicalJson({refusedBeforeEffects: 1, published: 1}));
  return checks;
}

/** workflowOptions is an internal seam for tests (for example selected source
 * files). The CLI never sets it. */
export async function qualifyRoadmap({profile = "component", nativeProfile, trace, workflowOptions = {}} = {}) {
  const base = {schema: RESULT_SCHEMA, profile, generatedAt: new Date().toISOString(), environment: environment(),
    layers: {signedBridgeFixture: {status: "not-run", scope: SCOPES.signedBridgeFixture}, localConfinement: {status: "not-run", backend: null, scope: SCOPES.localConfinement},
      nativeKernel: {status: "open", scope: SCOPES.nativeKernel, prerequisites: NATIVE_PREREQUISITES.map(([name, , description]) => ({name, description}))}},
    workflow: null, uncertainPublication: null, checks: [], notQualified: NOT_QUALIFIED};
  if (profile === "native") return {...base, status: "refused", refusal: await nativeRefusal(nativeProfile)};
  const helper = await import("../test/helpers/roadmap-workflow.mjs");
  const confinement = helper.confinementAvailable();
  if (confinement.skip) return {...base, status: "refused", refusal: {reason: confinement.skip, missing: ["localConfinement"]}};
  const result = {...base, layers: {...base.layers, localConfinement: {...base.layers.localConfinement, backend: confinement.backend}}};
  const strip = ({schema: _schema, ...evidence}) => evidence;
  const scenarios = [["recovered", "after-native-retention", "workflow", run => componentChecks(run, confinement.backend)], ["uncertain", "before-native-retention", "uncertainPublication", uncertainChecks]];
  for (const [scenario, loss, field, checks] of scenarios) {
    try {
      const run = await helper.runRoadmapWorkflow({...workflowOptions, loss, trace: trace && (line => trace(`[${scenario}] ${line}`))});
      try {result[field] = strip(run.evidence); result.checks.push(...(await checks(run)).map(item => ({scenario, ...item})));}
      finally {await run.close();}
    } catch (error) {
      // Preserve the failure and every partial result; never retry or replace.
      (result.errors ??= []).push({scenario, error: error instanceof Error ? error.message : String(error)});
    }
  }
  const passed = result.errors === undefined && result.checks.length > 0 && result.checks.every(item => item.passed);
  const tests = [result.workflow?.beforeTest, result.workflow?.afterTest].filter(Boolean);
  const confined = tests.length > 0 && tests.every(test => test.sandbox === confinement.backend);
  result.layers.signedBridgeFixture.status = passed ? "passed" : "failed";
  result.layers.localConfinement.status = confined ? "passed" : "failed";
  return {...result, status: passed && confined ? "passed" : "failed"};
}

async function main() {
  let values;
  try {
    ({values} = parseArgs({args: process.argv.slice(2), strict: true, allowPositionals: false,
      options: {profile: {type: "string", default: "component"}, out: {type: "string"}, "native-profile": {type: "string"}, trace: {type: "boolean", default: false}, help: {type: "boolean", default: false}}}));
  } catch (error) {process.stderr.write(`Usage error: ${error.message}\n${USAGE}\n`); return EXIT.usage;}
  if (values.help) {process.stdout.write(USAGE + "\n"); return EXIT.passed;}
  if (!["component", "native"].includes(values.profile)) {process.stderr.write(`Usage error: unknown profile ${JSON.stringify(values.profile)}\n${USAGE}\n`); return EXIT.usage;}
  const out = values.out === undefined ? undefined : resolve(values.out);
  if (out && existsSync(out)) {process.stderr.write(`Refusing to replace an existing result: ${out}\n`); return EXIT.usage;}
  if (values.profile === "component" && !existsSync(join(root, "dist", "coding-resource-cli.js"))) {process.stderr.write("Build output is missing; run npm run build first.\n"); return EXIT.usage;}
  const started = Date.now();
  const trace = values.trace ? line => process.stderr.write(`${((Date.now() - started) / 1000).toFixed(1)}s ${line}\n`) : undefined;
  const result = await qualifyRoadmap({profile: values.profile, nativeProfile: values["native-profile"], trace});
  const text = JSON.stringify(result, null, 2) + "\n";
  if (out) await writeFile(out, text, {flag: "wx", mode: 0o600});
  process.stdout.write(text);
  if (result.status === "refused") {process.stderr.write(`Refused ${values.profile} profile: ${result.refusal.reason}\n`); return EXIT.refused;}
  if (result.status !== "passed") {
    const stopped = [result.workflow?.status, result.uncertainPublication?.status].filter(Boolean).join(", ");
    process.stderr.write(`Qualification failed; evidence preserved${stopped ? ` (workflow status: ${stopped})` : ""}${result.errors ? `: ${result.errors.map(item => item.error).join("; ")}` : ""}.\n`);
    return EXIT.failed;
  }
  process.stderr.write("Component qualification passed. Signed bridge fixture evidence only; native kernel acceptance remains open.\n");
  return EXIT.passed;
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await main();
