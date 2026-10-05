import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {canonicalJson} from "../dist/tool-registry.js";
import {BUGGY_SOURCE, FIXED_SOURCE, LAYERS, SOURCE_PATH, confinementAvailable, runRoadmapWorkflow} from "./helpers/roadmap-workflow.mjs";
import {componentChecks, uncertainChecks} from "../scripts/qualify-roadmap.mjs";

// Evidence layer: signed bridge fixture. A scripted kernel signs with an
// ephemeral fixture key and forwards to the real coding participant over its
// kernel-owned stdio pipe. Recipes run in real local OS confinement. This
// measures adapter and host contracts only; it does not qualify a real kernel.
const confined = confinementAvailable();
const script = fileURLToPath(new URL("../scripts/qualify-roadmap.mjs", import.meta.url));
const hash = value => createHash("sha256").update(value).digest("hex");
const failedChecks = checks => JSON.stringify(checks.filter(check => !check.passed));

test("signed bridge fixture: confined bug fix, reviewed publication, response loss and second-host original recovery", {skip: confined.skip, timeout: 300000}, async () => {
  const run = await runRoadmapWorkflow({loss: "after-native-retention"});
  try {
    const {evidence, observer} = run;
    const {beforeTest, afterTest, originalArtifact, recoveredArtifact, publicationEffects} = evidence;
    assert.equal(evidence.status, "recovered");
    assert.equal(evidence.layer, LAYERS.component);
    assert.equal(evidence.nativeKernel.status, "open", "signed bridge fixture evidence never qualifies a native kernel");

    // The first real confined run demonstrates the bug at equality only.
    assert.equal(beforeTest.passed, false);
    assert.equal(beforeTest.sandbox, confined.backend, "the failing run is real local OS confinement, not an unconfined process");
    assert.equal(beforeTest.failedAtEquality, true, beforeTest.output);
    assert.deepEqual(beforeTest.counts, {pass: 2, fail: 1}, beforeTest.output);
    assert.deepEqual(beforeTest.failedTests, ["isExpired is true at the exact deadline"]);
    assert.equal(beforeTest.resultBound, true);
    assert.equal(beforeTest.sourceDigest, evidence.source.initialDigest);

    // Source located and read through admitted resource tools, then CAS patch.
    assert.deepEqual(evidence.steps.slice(0, 3).map(step => step.kernelTool), ["repo_status", "search", "read_range"]);
    assert.equal(evidence.located.path, SOURCE_PATH);
    assert.equal(evidence.read.fileSha256, hash(BUGGY_SOURCE));
    assert.equal(evidence.patch.arguments.changes[0].expectedFileSha256, hash(BUGGY_SOURCE), "patch is a full-file compare-and-swap");
    assert.equal(evidence.patch.previousSourceDigest, evidence.source.initialDigest);
    assert.notEqual(evidence.patch.sourceDigest, evidence.source.initialDigest);

    // Forbidden resource access, then legitimate work under the same retained authority.
    assert.deepEqual(evidence.forbidden.map(item => [item.kernelTool, item.state, item.toolError, item.code]),
      [["read_range", "completed", true, "invalid_path"], ["publish_artifact", "completed", true, "lineage_mismatch"]]);
    for (const item of evidence.forbidden) {
      assert.equal(item.layer, LAYERS.forbidden);
      assert.equal(item.nativeDenial, false, "a retained resource refusal is not a native signed denial");
      assert.equal(item.verdict, "allow");
      assert.equal(item.fencedAfterDelivery, false, "the delivered refusal leaves no native fence for later legitimate work");
      assert.equal(item.artifactsAfter, 0);
    }
    const authorities = new Set(evidence.steps.map(step => canonicalJson(step.authority)));
    assert.equal(authorities.size, 1, "every step, forbidden or legitimate, uses one unchanged retained authority");
    assert.deepEqual(JSON.parse([...authorities][0]), evidence.authority);
    const lastForbidden = evidence.steps.findIndex(step => step.name === "forbidden-failed-publication");
    assert.deepEqual(evidence.steps.slice(lastForbidden + 1).map(step => [step.kernelTool, step.toolError]),
      [["apply_patch", false], ["test_recipe", false], ["repo_diff", false]]);

    // Same pinned recipe, now passing in confinement; diff reviewed before publishing.
    assert.equal(afterTest.passed, true, afterTest.output);
    assert.equal(afterTest.sandbox, confined.backend);
    assert.equal(afterTest.recipeSha256, beforeTest.recipeSha256);
    assert.equal(afterTest.recipeSha256, evidence.recipe.recipeSha256);
    assert.equal(afterTest.sourceDigest, evidence.patch.sourceDigest);
    assert.deepEqual(evidence.diff.changes, [{path: SOURCE_PATH, before: BUGGY_SOURCE, after: FIXED_SOURCE}]);
    assert.equal(evidence.diff.reviewed, true);
    assert.deepEqual(evidence.publication.arguments, {sourceDigest: evidence.patch.sourceDigest, testOperationId: afterTest.operationId,
      testResultSha256: afterTest.resultSha256, recipeSha256: afterTest.recipeSha256, destination: "review"});

    // First host lost the publication response after native retention.
    assert.equal(evidence.firstHost.publicationResponse, "lost");
    assert.equal(evidence.firstHost.guestUnresolved, true);
    assert.equal(evidence.firstHost.nativeOriginalState, "completed");
    assert.equal(evidence.firstHost.resourceDispatches, 1);
    assert.match(evidence.firstHost.flushError, /terminal|committed|completion/);

    // A second actual host instance recovers the exact original artifact.
    assert.equal(evidence.secondHost.restartedNativeGateway, true);
    assert.equal(evidence.secondHost.executorCalls, 0, "recovery never reaches an executor");
    assert.equal(evidence.secondHost.recoveredOutcomeMatchesOriginal, true);
    assert.equal(evidence.secondHost.fencedAfterRecovery, false);
    assert.equal(evidence.kernel.nativeCallsDuringRecovery, 0);
    assert.equal(evidence.kernel.resourceDispatchesDuringRecovery, 0);
    assert.equal(evidence.kernel.acksDuringRecovery, 1, "only the original completion is acknowledged");
    assert.equal(originalArtifact.sha256, recoveredArtifact.sha256);
    assert.equal(publicationEffects, 1);
    assert.deepEqual(evidence.kernel.resourcePublishCalls, {refusedBeforeEffects: 1, published: 1});

    // Independent filesystem observer, outside the participant and kernel fixture.
    assert.deepEqual(await observer.listing(), [originalArtifact.sha256]);
    const now = await observer.artifact(originalArtifact.sha256);
    assert.equal(now.sha256, originalArtifact.sha256);
    assert.equal(now.ino, originalArtifact.ino, "the published artifact was never replaced");
    assert.equal(now.mtimeMs, originalArtifact.mtimeMs);
    assert.equal(now.bundle.destination, "review");
    assert.equal(now.bundle.sourceDigest, evidence.patch.sourceDigest);
    assert.equal(now.bundle.testOperationId, afterTest.operationId);
    assert.equal(now.bundle.testResultSha256, afterTest.resultSha256);
    assert.equal(now.bundle.recipeSha256, evidence.recipe.recipeSha256);
    assert.equal(now.bundle.diff.diffSha256, evidence.diff.diffSha256);
    assert.equal(now.bundle.test.success, true);
    assert.equal(Buffer.from(now.bundle.files.find(file => file.path === SOURCE_PATH).content, "base64").toString("utf8"), FIXED_SOURCE);
    assert.equal(await observer.importedSource(), BUGGY_SOURCE, "operator import originals are never edited");
    assert.equal(await observer.generationSource(evidence.source.initialDigest), BUGGY_SOURCE);
    assert.equal(await observer.generationSource(evidence.patch.sourceDigest), FIXED_SOURCE);
    assert.deepEqual(observer.publicationNames(), [originalArtifact.sha256]);

    // The shipped qualification command's independent checks agree.
    const checks = await componentChecks(run, confined.backend);
    assert.ok(checks.length >= 15);
    assert.ok(checks.every(check => check.passed), failedChecks(checks));
  } finally {await run.close();}
});

test("signed bridge fixture: resource commit before native completion evidence stays an unknown original and is never replaced", {skip: confined.skip, timeout: 300000}, async () => {
  const run = await runRoadmapWorkflow({loss: "before-native-retention"});
  try {
    const {evidence, observer} = run;
    assert.equal(evidence.beforeTest.passed, false);
    assert.equal(evidence.afterTest.passed, true);
    assert.equal(evidence.firstHost.publicationResponse, "unknown-native-outcome");
    assert.equal(evidence.firstHost.nativeOriginalState, "unknown");
    assert.equal(evidence.firstHost.guestUnresolved, true);
    assert.equal(evidence.status, "uncertain-preserved");
    assert.equal(evidence.publicationEffects, 1, "the resource committed one publication before native evidence was retained");
    assert.equal(evidence.originalArtifact.contentAddressed, true);
    assert.equal(evidence.recoveredArtifact, null);
    assert.match(evidence.secondHost.recoveryRefusal, /unknown/);
    assert.equal(evidence.secondHost.replacementAttempt.dispatched, false, "a replacement publication would make the demo finish; it stays refused");
    assert.match(evidence.secondHost.replacementAttempt.parentRefusal, /fenced/);
    assert.equal(evidence.secondHost.fencedAfterRecovery, true, "uncertainty keeps its native fence");
    assert.equal(evidence.kernel.resourceDispatchesDuringRecovery, 0);
    assert.equal(evidence.kernel.nativeCallsDuringRecovery, 0);
    assert.equal(evidence.kernel.acksDuringRecovery, 0);
    assert.equal(evidence.resourceLedger.unsigned, true, "the resource ledger is unsigned and cannot clear the native fence");
    assert.equal(evidence.resourceLedger.kernelFenceClearance, false);
    assert.equal(evidence.resourceLedger.publishCompleted, true);
    assert.deepEqual(await observer.listing(), [evidence.originalArtifact.sha256]);
    assert.deepEqual(evidence.kernel.resourcePublishCalls, {refusedBeforeEffects: 1, published: 1});
    const checks = await uncertainChecks(run);
    assert.ok(checks.length >= 5);
    assert.ok(checks.every(check => check.passed), failedChecks(checks));
  } finally {await run.close();}
});

function runScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {stdio: ["ignore", "pipe", "pipe"], env: {PATH: dirname(process.execPath), LANG: "C"}});
    let stdout = ""; let stderr = "";
    child.stdout.on("data", value => stdout += value); child.stderr.on("data", value => stderr += value);
    child.once("error", reject); child.once("close", code => resolve({code, stdout, stderr}));
  });
}

test("qualification command labels layers and refuses an unavailable native profile without a substitute run", async t => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "chio-roadmap-refusal-")); t.after(() => rm(directory, {recursive: true, force: true}));
  const help = await runScript(["--help"]);
  assert.equal(help.code, 0); assert.match(help.stdout, /signed bridge fixture/); assert.match(help.stdout, /not native kernel qualification/);
  const out = join(directory, "native-result.json");
  const refused = await runScript(["--profile", "native", "--out", out]);
  assert.equal(refused.code, 3, refused.stderr);
  assert.match(refused.stderr, /Refused native profile/);
  const result = JSON.parse(await readFile(out, "utf8"));
  assert.equal(result.schema, "chio.pi.roadmap-qualification.v1");
  assert.equal(result.status, "refused"); assert.equal(result.profile, "native");
  assert.equal(result.workflow, null, "no downgraded component run substitutes for native acceptance");
  assert.equal(result.layers.nativeKernel.status, "open");
  assert.match(result.layers.signedBridgeFixture.scope, /does not qualify a real kernel/);
  assert.deepEqual(result.refusal.missing, ["kernelArtifact", "publisherManifest", "signerPin", "custodyLaunchProfile", "callerCapabilitySha256", "signedRecoveryFixture"]);

  const artifact = join(directory, "declared-kernel"); await writeFile(artifact, "not a qualified kernel", {mode: 0o600});
  const profile = join(directory, "native-profile.json");
  await writeFile(profile, JSON.stringify({kernelArtifact: {path: artifact, sha256: "0".repeat(64)}, signerPin: "a".repeat(64)}), {mode: 0o600});
  const incomplete = await runScript(["--profile", "native", "--native-profile", profile]);
  assert.equal(incomplete.code, 3);
  const partial = JSON.parse(incomplete.stdout);
  assert.equal(partial.status, "refused"); assert.equal(partial.refusal.missing.includes("kernelArtifact"), true, "a mismatched pinned hash is refused");
  assert.equal(partial.refusal.missing.includes("signerPin"), false);

  const complete = join(directory, "complete-profile.json"); const pinned = {path: artifact, sha256: hash("not a qualified kernel")};
  await writeFile(complete, JSON.stringify({kernelArtifact: pinned, publisherManifest: pinned, signerPin: "a".repeat(64), custodyLaunchProfile: pinned,
    callerCapabilitySha256: "b".repeat(64), signedRecoveryFixture: pinned}), {mode: 0o600});
  const runner = await runScript(["--profile", "native", "--native-profile", complete]);
  assert.equal(runner.code, 3, "declared prerequisites alone are not native acceptance");
  assert.deepEqual(JSON.parse(runner.stdout).refusal.missing, ["nativeAcceptanceRunner"]);

  assert.equal((await runScript(["--profile", "replacement"])).code, 2);
  assert.equal((await runScript(["--unknown-flag"])).code, 2);
  const before = await readFile(out, "utf8");
  const again = await runScript(["--profile", "native", "--out", out]);
  assert.equal(again.code, 2, "an existing result is never replaced"); assert.equal(await readFile(out, "utf8"), before);
});
