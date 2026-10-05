# Chio Pi Full Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement the complete development-agent roadmap with kernel-owned coding participants, original-operation continuation, current Pi contracts, and explicit native-service activation gates.

**Architecture:** Pi consumes an immutable typed registry through the retained execution bridge. A separate kernel-owned coding MCP participant performs effects and retains resource outcomes. Trusted operator and model-transport surfaces enforce delivery, limits, and native governance without granting authority locally.

**Tech Stack:** TypeScript, Node 22+, Pi coding-agent/pi-ai/Pi Durable 1.0.2, bundled Chio bridge, stdio MCP, node:test, sandbox-exec, bubblewrap.

The design is [the full-roadmap specification](../specs/2026-10-04-full-roadmap-design.md).
Execute tasks in order. Each implementation task gets a fresh implementer, then
spec review and code-quality review. Implementation workers do not run in
parallel. Read-only contract research has already established native boundaries.

## File map

| Unit | Files | Responsibility |
| --- | --- | --- |
| Registry/current host | `src/tool-registry.ts`, extension/session/relay/config files | Native schemas and exact host exposure |
| Operator | `src/operator.ts`, `src/operator-cli.ts`, protected CLI | Trusted diagnostics/native recovery actions |
| Coding resource | `src/coding-resource/*.ts`, `src/coding-resource-cli.ts` | Kernel-owned effects, ledger, tests, artifacts |
| Continuation/Durable | `src/continuation.ts`, `src/durable.ts`, trusted gateway mapping helper, protected launcher | Immutable original identity and host recovery |
| Native governance | `src/governance.ts`, relay, `src/delegation.ts` | Native-port admission and explicit refusal |
| Operational limits | `src/run-limits.ts`, protected CLI, relay | Trusted parent budgets/deadlines |
| Linux guest | `src/linux-sandbox.ts`, `src/unix-relay.ts`, CLI | Network-isolated guest with two fixed Unix relay endpoints |
| Workflow/release | `test/roadmap-workflow.test.mjs`, scripts/docs/CI | Reproducible evidence and package integrity |

## Task 1: Pi 1.0.2 and immutable typed registry

Files: package manifests/lock, `src/tool-registry.ts`, extension/session/config/
HTTP/relay files, index, host/relay/registry tests, CI consumer version.

- [x] Write tests for the actual Pi dispatcher using typed file tools, malformed
  arguments, unknown aliases, poisoned MCP/codemode/deferred discovery, and full
  outcome delivery. Keep existing generic fixtures explicitly legacy.

```js
const registry = createToolRegistry([{name:"read_text_file", inputSchema:{type:"object",properties:{path:{type:"string"}},required:["path"],additionalProperties:false}}]);
assert.equal(registry.tools[0].name, "chio_read");
assert.throws(() => createToolRegistry([{name:"a.b",inputSchema:{}},{name:"a_b",inputSchema:{}}]), /collision/);
```

- [x] Run `npm run build && node --test test/tool-registry.test.mjs` and observe
  failure before implementation.
- [x] Pin all Pi runtime packages at 1.0.2 via `npm install --save-dev --save-exact
  --ignore-scripts --no-audit --no-fund @earendil-works/pi-ai@1.0.2
  @earendil-works/pi-coding-agent@1.0.2`. Implement the registry with deep-cloned
  frozen JSON schemas, deterministic aliases, canonical digest, strict schema
  validation, and explicit `typed`/`legacy` mode. Use this contract:

```ts
export interface ChioToolSpec { name:string; description?:string; inputSchema:Record<string,unknown> }
export interface ToolRegistry { mode:"typed"|"legacy"; digest:string; tools:readonly {name:string; kernelTool:string; description:string; parameters:Record<string,unknown>}[] }
export function createToolRegistry(tools:readonly ChioToolSpec[], mode:"typed"|"legacy"="typed"):ToolRegistry;
```

- [x] Generate native definitions through `chioExtension(executor, registry)`.
  Preserve KernelRequest identities and exact full KernelResult content. Pin
  registry digest in resume binding. Pass the registry to relay validation for
  declarations, choices, function history and argument binding. Disable all new
  discovery surfaces through native settings/resource-loader/dispatcher contracts.
- [x] Run `npm run typecheck && npm test`; add task evidence to this plan and
  commit `feat: add typed Chio tools on Pi 1.0.2`. Review and fix before Task 2.

## Task 2: Trusted status and recovery console

Files: `src/operator.ts`, `src/operator-cli.ts`, protected CLI, index, operator
tests, README/operator guide.

- [x] Add a fixture for native status with completed/pending-ACK, dispatched
  unknown, approval pending and undispatched operations. Test redaction of
  bearer/session/provider credentials and no model/network side effects.

```js
const view = summarizeGatewayStatus(nativeStatus);
assert.equal(view.operations.find(x => x.requestId === "unknown").state, "unknown_after_dispatch");
assert.equal(JSON.stringify(view).includes("secret-fixture-token"), false);
```

- [x] Run `npm run build && node --test test/operator.test.mjs`, observe failure.
- [x] Resolve the bridge operator entrypoint from installed package metadata,
  verify its installed containment, and delegate trusted actions using argv,
  never shell. Implement `doctor/status/inspect/recover` argument parsing with
  `--config`, `--request`, `--json`, explicit native recovery action/input/output.
  Unknown counters remain `null`; readable actions explain original recovery.
  Missing owner-import/attenuation/semantic/whole-host Linux capabilities refuse
  without mutating state. Quality review additionally reproduced a frozen native
  utility defect: `approval-decide` can retain a signed approved credential for
  an explicit denied request. Gate that action before native invocation or admin
  traffic until a qualified native contract verifies the requested decision and
  approval ID before retention. Keep approval submission and exact original
  signed-resume contracts. Export this programmatic contract:

```ts
export interface OperationSummary { requestId:string; state:string; tool?:string; nextAction:string }
export function summarizeGatewayStatus(status:unknown):{sessionId:string;operations:OperationSummary[]};
export async function runOperatorCommand(args:string[]):Promise<number>;
```

- [x] Run typecheck/full tests, record evidence, commit `feat: add trusted Pi
  operator diagnostics and recovery`. Obtain both reviews and fix findings.

## Task 3: Kernel-owned coding participant

Files: `src/coding-resource/config.ts`, `paths.ts`, `ledger.ts`, `repository.ts`,
`recipes.ts`, `participant.ts`, `src/coding-resource-cli.ts`, package bin,
`test/coding-resource.test.mjs`, `test/coding-confinement.test.mjs`, resource guide.
Focused helper files `schemas.ts`, `stdio.ts` and `recipe-sandbox.ts` are authorized
for the separate schema, bounded framing and confinement responsibilities.

- [x] Add native-stdio dispatch fixtures with exact `_meta` fields. Test missing
  caller, operation conflict, crash after intent, storage failure, path escapes,
  symlinks, stale source, recipe bounds, failed-test publication and replay.

```js
const meta = {chioRequestId:"1".repeat(64),chioOperationId:"1".repeat(64),chioAttemptId:"attempt",chioTransportKeyEpoch:1,chioCallerCapabilitySha256:"a".repeat(64)};
const first = await participant.call("apply_patch", patch, meta);
assert.deepEqual(await participant.call("apply_patch", patch, meta), first);
assert.equal(await independentEffectCount(), 1);
await assert.rejects(participant.call("apply_patch", {...patch, expectedDigest:"b".repeat(64)}, meta), /conflict/);
```

- [x] Run participant tests before implementation; observe failure.
- [x] Implement a bounded JSONL stdio MCP server for the nine named tools in the
  design. It validates native metadata/caller, canonicalizes arguments, acquires
  a private exclusive ledger, fsyncs intent before effects and terminal result
  before reply. Return retained results for exact replay; fence unknown intents.
  Use SQLite `synchronous=FULL`, durable immutable source generations, and an
  atomic transaction for current-generation pointer plus terminal outcome.
  Persist immutable source/test/artifact lineage. Do not interpret locally
  supplied metadata as a substitute for a kernel-owned pipe. Request and
  operation IDs must match the native 64-character lowercase SHA256 identity;
  transport epochs are positive safe integers and caller digests are SHA256.
  Validate initial/current manifests and immutable generation contents before
  serving or advertising tools. Missing/corrupt required source refuses startup.
  Bound fresh and retained replies using both recipe JSON encoding layers and
  the full worst permitted JSON-RPC envelope; preserve original replay identity.
- [x] Implement CAS edits in `apply_patch` as expected full-file digest plus
  exact replacement content or bounded literal edits, not arbitrary shell patch
  commands. Resolve all literal matches against original content and reject
  overlapping ranges across entries before effects. Validate the full candidate
  namespace for file/ancestor and every-prefix spelling/type conflicts. Use a
  documented well-formed NFC Unicode 15.1 naming profile with pinned official
  full case-fold data, explicit unsupported-scalar refusals, component byte bounds
  and actual managed absolute path bounds. Verify newly materialized generations
  before committing the head. Require complete matching
  macOS non-system dylib file/hash pins for the selected executable's dependency
  closure; system OS-runtime qualification remains separate. Reject executable
  Git hooks/config helpers. Add context and bounded
  aggregate reads as ordinary admitted resource tools. Test confinement on this
  macOS host with real sandbox-exec probes for allowed work, forbidden files,
  outbound network and child cleanup. Implement isolated-network Linux recipe
  invocation through bubblewrap; do not call it accepted without Linux evidence.
  Refuse x32 syscall-number variants in the x64 filter and evaluate the actual
  compiled filter independently of real x64 runtime qualification.
- [x] Run typecheck/full tests and stdio binary smoke; record implementation and
  platform acceptance separately; commit `feat: add recoverable coding resource
  participant`. Obtain both reviews and fix findings before Task 4.

## Task 4: Original-operation handoff and Pi Durable

Detailed requirements are [trusted continuation contracts](../specs/2026-10-04-continuation-contracts.md).

Files: `src/continuation.ts`, `src/durable.ts`, a focused trusted gateway mapping
helper and its protected-launch wiring, index/package manifests,
`test/continuation.test.mjs`, `test/durable.test.mjs`, continuation guide.

- [x] Add tamper/caller/arguments/signature/authority mismatch and unknown fence
  tests. Use real Durable registration/memo contract and two host instances.

```js
assert.equal(tool.replay, "unsafe");
const first = await tool.execute(args, api, context);
const recovered = await recoverOriginalOperation(record, executor);
assert.deepEqual(recovered, first.details.originalOutcome);
assert.equal(dispatches, 1);
await assert.rejects(importContinuation(tampered, binding), /binding|digest|verification/);
```

- [x] Run tests before implementation; observe failure. Pin Durable 1.0.2 as
  an optional exact peer plus development dependency with locked graph.
- [x] Define a private bounded `chio.pi.continuation.v1` envelope with public
  authority/registry digest, original KernelRequests, exact retained outcomes,
  unresolved state and content digest. Never include authority credentials. Use
  native `verifyReceivedOutcome`/executor verification for completed results;
  hashing alone proves no trust. Refuse cross-authority adoption.
- [x] Implement native ToolRegistration with Durable memo written before the
  first executor call, immutable conversation/task/call mapping and `unsafe`
  replay. Implement explicit recovery of the original request through native
  retained outcome lookup/verified replay, never a newly generated operation.
  Keep delivery and native ACK separate until full history is observed.
  Capture the exact HTTP gateway request identity in private parent state before
  forwarding the first call. The bundled public gateway has no before-dispatch
  hook, so a fixed-target trusted proxy is permitted for this mapping. Preserve
  the native MCP session/header/ID contract and expose no new execution or admin
  route. Persist original logical request plus actual native request ID outside
  the guest, without adding root-level journal JSON. A changed connection must
  not reconstruct the old identity. Test gateway response loss, parent restart,
  mapping tampering and native status compatibility. Missing original identity
  or missing native original evidence refuses recovery without a new dispatch.
  The guest sees only the fixed parent proxy, never the native gateway port or
  token. Reject guest `chio/acknowledge`; observe the full native committed
  host-history result in the trusted parent before ACK. Durable execute and
  `afterTool` precede the entry commit and cannot prove delivery. Persist and
  reconcile actual committed entry references across restart.
- [x] Run typecheck/full tests, record evidence, commit `feat: add Chio Durable
  tools and original-operation continuation`. Obtain both reviews and fix.

## Task 5: Native semantic and child-authority integration gates

The detailed port requirements are [trusted native embedding contracts](../specs/2026-10-04-native-port-contracts.md).

Files: `src/governance.ts`, `src/delegation.ts`, relay, operator feature table,
index, `test/governance.test.mjs`, `test/delegation.test.mjs`, compatibility guide.

- [x] Add tests that no outbound provider bytes appear without a trusted admission
  when governance is required, and that thrown/expired/mismatched admission or
  child authority fails closed.

```js
await assert.rejects(admitOutbound(request, nativePort), /expiry|binding|signature/);
assert.equal(providerRequests, 0);
await assert.rejects(submitScopedChild(parent, widening, nativePort), /scope|authority/);
```

- [x] Run before implementation; observe failure.
- [x] Define host-only ports using exact recovered native contract information.
  Verify P2 explanation signer/audience/domain/issuer/expiry and keep advisory remedy
  rendering separate from exact native resume or linked continuation. Native
  disclosure admission binds request bytes and provider account/model/purpose;
  the trusted relay awaits independent native verification before egress. Do
  not expose arbitrary guest callbacks as a launchable authorization provider.
  Required governed egress uses the native committed-release path into a selected
  trusted provider sink. An adapter precheck followed by an independent fetch is
  insufficient. Lost native commit acknowledgement withholds bytes. Freeze the
  final outbound payload after all host normalization and provider-limit changes
  before native admission, then deliver those exact bytes through the sink.
- [x] Child submission requires actual native child-capability issuance and
  persisted budget/cancellation identity, not transport filtering. The installed
  bridge's unsupported attenuation yields explicit unavailable status. Protect
  authority scope, child accounting and unknown recovery in the adapter contract.
  Cross-process labeled artifact adoption refuses under current P4 profile.
- [x] Wire documented trusted SDK integration entrypoints and startup refusal for
  required unavailable profiles. Preserve compatibility CLI execution-only mode;
  select required governance explicitly and pin the mode on resume with no
  downgrade or missing-service fallback. Record native service and P5 Linux prerequisites
  as open acceptance rows. Run all tests, commit `feat: gate semantic recovery
  and delegation on native authority`, obtain both reviews and fix.

## Task 6: Trusted parent limits and confinement capability reporting

Detailed requirements are [parent limits and Linux guest contracts](../specs/2026-10-04-limits-and-linux-contracts.md).

Files: `src/run-limits.ts`, `src/linux-sandbox.ts`, `src/unix-relay.ts`, model
relay, protected CLI, guest CLI, config/operator, `test/run-limits.test.mjs`,
`test/linux-sandbox.test.mjs`, operational guide.

- [x] Add provider timeout/cap/token reservation, resume-budget, hung-child kill,
  post-dispatch interruption and native codemode refusal tests.

```js
const budget = await openRunBudget(state, {maxRequests:1,maxOutputTokens:100});
await budget.reserve(100);
await assert.rejects(budget.reserve(1), /limit/);
assert.equal((await openRunBudget(state, limits)).remainingRequests, 0);
```

- [x] Run before implementation; observe failure.
- [x] Persist conservative limits in parent-only state and bind them on resume.
  Reserve requests before network forwarding and retain uncertain reservations.
  The OpenAI API profile also reserves output tokens and forces its supported
  `max_output_tokens` ceiling. The user explicitly selected keeping the Codex
  subscription profile with honest limits: request, timeout and response-byte
  bounds apply, while a hard output-token ceiling and remaining token count are
  unavailable. Do not send unsupported token-cap parameters, infer token usage
  from visible bytes, refuse Codex solely for this limitation, or switch routes.
  Impose provider timeout. Enforce
  a wall deadline in the parent with graceful signal then bounded hard kill;
  never reset the journal or clear outcome uncertainty. Version the existing
  two fixed provider profiles without silently adding a route or fallback.
- [x] Implement a bubblewrap guest profile with `--unshare-all`, `--unshare-user`,
  `--die-with-parent`, `--new-session`, a read-only installed Node/runtime,
  writable isolated profile, private `/tmp`, and only two mounted parent-owned
  Unix sockets. A parent `createUnixRelay(socketPath, fixedLoopbackPort)` forwards
  to one fixed service; guest `createLoopbackRelay(socketPath)` supplies the SDK's
  loopback HTTP route. Paths, credentials, gateway and model profiles stay pinned.
  Refuse unavailable user namespaces/bubblewrap, shared-host networking, extra
  host sockets and journal/config/source mounts. Run real namespace probes where
  available and record platform or outer-container restrictions explicitly.
  Native arbitrary codemode/deferred execution
  stays disabled; `read_many` is the enabled bounded aggregate alternative.
- [x] Run full tests, record evidence, commit `feat: enforce parent run limits
  and confinement profiles`, obtain both reviews and fix.

## Task 7: Development workflow and package qualification

Detailed requirements are [workflow and release contracts](../specs/2026-10-04-workflow-release-contracts.md).

Files: `test/roadmap-workflow.test.mjs`, `scripts/qualify-roadmap.mjs`, README,
`docs/ROADMAP-IMPLEMENTATION.md`, coding/operator/continuation guides, CI/packer.

- [x] Write the coding fixture around a real small bug and an independent
  filesystem/artifact observer; first run must demonstrate the bug. Fix via
  participant CAS, test in real local confinement, review diff, publish, lose
  response, recover the exact artifact through original identity in a second
  host. Include forbidden access and subsequent permitted work under unchanged
  authority. Keep scripted executor and native-kernel evidence clearly distinct.

```js
assert.equal(beforeTest.passed, false);
assert.equal(afterTest.passed, true);
assert.equal(originalArtifact.sha256, recoveredArtifact.sha256);
assert.equal(publicationEffects, 1);
```

- [x] Route current README qualification links to FINAL-QUALIFICATION. Write
  twelve-row implementation/evidence/prerequisite crosswalk and runnable docs
  for every shipped entrypoint. Do not change frozen evidence or advertise gates
  as qualified native features. Ensure release archives include resource binary,
  optional Durable entrypoint and exact dependency provenance.
- [x] Run `npm run typecheck && npm test && npm run pack:release -- /tmp/chio-pi-roadmap-release`.
  Install the resulting archive with pinned Pi in a fresh consumer and empty
  cache, run every binary help/import smoke, retain exact consumer lock digest.
  Record current-head acceptance limits and commit `test: qualify Chio Pi
  development workflow and release surface`.

## Task 8: Independent review, fix, final review, fix, open PR

- [ ] Dispatch a whole-range security/spec/quality review against origin/main.
  Fix all valid findings and run focused regressions for each change.
- [ ] Dispatch a fresh final reviewer, fix remaining findings and run fresh
  typecheck, all tests, package and clean-consumer checks on the final commit.
- [ ] Verify clean worktree, preserved primary checkout, conventional commits,
  no credentials, no em dashes in new prose, and full twelve-row coverage.
- [ ] Push `feat/pi-full-roadmap-20261004`, open a PR against main with exact
  behavior, verification and native qualification prerequisites. Verify PR head
  SHA and report hosted checks separately from local evidence. Do not merge.

## Baseline evidence

Worktree: `/Users/connor/.config/superpowers/worktrees/chio-pi-plugin/full-roadmap-20261004`.
Base: `origin/main` at `cd3dbf90974687d30f23f989173bd8c155b016d3`.
Fresh `npm ci --ignore-scripts --no-audit --no-fund`, typecheck, build and all
23 component tests passed with zero failures or skips before implementation.
The dirty primary checkout remains untouched.

## Task 1 review closure

Implementation: `c9270b3`; boundary fixes: `263bb9b`. Independent spec
re-review passed, then a fresh quality/security review approved at `263bb9b`.
Fresh typecheck and all 59 tests passed with zero skips. Fixes cover native
journal metadata isolation, trusted denial verification without ACK, and async
schema refusal. See [the task record](../evidence/2026-10-04-task1-typed-host.md).
This closes component/stock-host Task 1; it does not requalify the frozen kernel.

## Task 2 review closure

Implementation: `f1319d3`; redaction fix: `b5961f7`; decision/input fixes:
`a0660c7`. Independent spec re-review passed at `a0660c7`, followed by a fresh
quality review approving that exact commit. Both independently passed typecheck
and all 88 tests, including 29 operator cases, with zero failures or skips.
The original approved-operation bindings remain visible, unsafe native decision
retention is gated before invocation, and private FIFOs are refused promptly.
The native archive and installed operator hashes remain unchanged. See
[the task record](../evidence/2026-10-04-task2-operator.md). This closes the amended
console component scope; it does not qualify a replacement approval utility.


## Task 3 review closure

Implementation: `b873af9`; first specification fixes: `987875a`; namespace,
framing and filter fixes: `ecddf826bc3c37879d5eea5dbec77db0ab961faf`. The
accepted portable namespace and delivery-capacity requirements are explicit in
`623ee1b`. Independent specification re-review passed at `ecddf82`, followed
by independent quality re-review approving that exact commit. Both passed
typecheck and all 170 macOS tests, plus all 78 pinned Linux arm64 resource tests,
with zero failures, cancellations or skips.

Both reviewers reproduced retained known namespace refusals without candidate
materialization, large control-byte output and ID delivery with exact restart
replay, bounded mutation refusal before effects, and corruption preserving the
old head and original unknown intent. Independent regeneration reproduced the
Unicode module byte for byte from four official pinned inputs; independent BPF
evaluation refused 1,024 x32-number variants. These are component and measured
local-confinement results. Native coding-kernel/P5, system OS-runtime and actual
x64 runtime acceptance remain separate open prerequisites. See
[the task record](../evidence/2026-10-04-task3-coding-resource.md).


## Task 4 review closure

Implementation: `4fc686b`; custody fixes: `86edea3`; credential-screening fixes:
`60546d700e8a07a44f254499c9a7b01e189d9b11`. Independent specification
re-review passed at `60546d7`, followed by quality re-review approving that
exact commit. Fresh typecheck, build and all 283 tests passed with zero failures,
skips or cancellations. Both reviewers independently exercised the selected
retained-approval and JSON-member-name regressions while preserving one original
effect, one native call, zero ACKs and the unresolved fence. Valid handoffs retain
the exact full signed original outcome.

The accepted scope includes actual Pi Durable registration, committed-entry
observation, immutable parent mappings, selected-store lifecycle binding and
original-operation recovery. Credential screening covers selected known material,
standard labels and Bearer strings; it does not classify unknown secrets in
unlabeled prose. Native service, cross-authority, provider and P4/P5 qualification
remain separate. See [the task record](../evidence/2026-10-04-task4-continuation.md).


## Task 5 review closure

Implementation: `4423ee6`; reload and explicit CLI compatibility fixes:
`4b2b984`; lifecycle cancellation and immutable startup-target fixes:
`610c575e6c83a130e284f3388c66d4ab7453e6e0`. Independent specification
re-review passed at `610c575`, followed by quality re-review approving that
exact commit. Fresh typecheck, build and all 336 tests passed. Specification
review independently passed 57 focused cases and an unresolved-freshness abort
probe; quality re-review independently passed 19 lifecycle cases and four
additional public-API probes. No failures, skips or cancellations in these
accepted checks. The evidence records an earlier timeout-versus-output result
in the unchanged 300 ms confinement specimen, its isolated pass and fresh full
suite passes.

Required SDK provider calls remain on the native-owned relay through model
switching and stock summarizers. Cancellation, reload and startup target binding
use actual Pi public contracts. CLI execution-only compatibility remains available;
explicit required governance refuses before credentials without a compatible
facade, with the mode pinned on resume. Native embedding, knowledge, child and
P2 advisory seams remain unqualified native integrations. Callback fixtures and
real Ed25519 verification establish adapter behavior; they do not install or
qualify missing native services or P5. See
[the task record](../evidence/2026-10-04-task5-governance.md).


## Task 6 review closure

Implementation: `c879b4e`; specification-review test correction: `049408a`;
quality-review security fix: `d7feeeb`. Quality review of `049408a` reproduced a
P1 in the pinned Linux image: a guest-planted link at
`profile/gateway-transport.json` made a resumed parent overwrite a host file
before the late profile closure audit. The fix also found that macOS guests could
plant escaping symlinks and replace the profile root under the shipped Seatbelt
policy. The parent now audits the resumed profile before any profile mutation on
both platforms, refuses a linked profile root, workspace overlap and a linked
`tmp`, and publishes the transport file through an exclusive no-follow temporary
plus verified rename. The Seatbelt policy and recorded policy identity are unchanged.

TDD: the new `test/guest-profile.test.mjs` failed 8 cases before the fix on macOS
and the pinned Linux image, then passed 9 of 9. The full macOS suite passed 381
of 381 on Homebrew Node 25.5.0, and the seven Linux suites passed 50 of 50 in the
pinned image. A real confined guest in a disposable privileged, network-none
container planted a symlink and a hardlink; both resumed launches refused with
the outside sentinel unchanged. An independent scoped re-review at `d7feeeb`
found the finding addressed and no new critical or important breakage. Residual
minor items (concurrent or nested same-profile launches, operator `TMPDIR`
inside the profile on macOS, documentation wording) remain recorded for the
final review. The host default `node` is now v26.7.0, under which five
pre-existing coding-confinement cases fail for lack of a pinned dylib closure;
recorded macOS results use Node 25.5.0. See
[the task record](../evidence/2026-10-04-task6-limits-linux.md). This closes
component and measured local Task 6 evidence; native service, P5, actual x64,
ordinary Docker and live provider acceptance remain open.


## Task 7 review closure

Task 7 ran as two reviewed parts. Workflow fixture: `70a228a` and `da102b6`;
review found that the independent observer could not count a duplicate
content-addressed publication and that stopped workflows crashed the
qualification command, fixed in `193ea5e` and `e3c72fe`. A scoped re-review at
`e3c72fe` found both addressed. With Homebrew Node 25.5.0 the full suite passed
386 of 386 and `scripts/qualify-roadmap.mjs --profile component` passed 23 of 23
independent checks; the pinned Linux image passed the workflow file 5 of 5.
Scripted executor and signed bridge fixture evidence remains labeled as adapter
and host evidence, not native kernel qualification. See
[the workflow record](../evidence/2026-10-04-task7-workflow.md).

Release surface: `ced0f96`, `14b94d9`, `1e611c5`, `2059150` and `9bd5f22`. Cold
consumers exposed two shipped defects, both fixed with regressions that fail on
the old code: the installed `chio-coding-resource` binary did nothing through
npm executable symlinks, and the macOS recipe policy emitted an unfiltered
metadata rule for runtimes with no non-system dylib closure, so a confined recipe
could stat any path. That rule, not a missing closure, explains the earlier
Node 26.7.0 confinement failures. The task review approved `9bd5f22` with no
critical or important findings. The full suite passed 394 of 394 on Node 25.5.0;
both cold consumers passed on Node 25.5.0 with npm 11.8.0 and on Node 22.19.0 with
npm 10.9.3 and 11.8.0. The candidate recorded there was built from `2059150`
before review; Task 8 rebuilds the candidate on the final reviewed commit. See
[the release record](../evidence/2026-10-04-task7-release.md) and
[the roadmap crosswalk](../../ROADMAP-IMPLEMENTATION.md).
