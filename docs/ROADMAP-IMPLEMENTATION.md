# Roadmap implementation crosswalk

This page maps the twelve ideas in the [October 4 research memo](RESEARCH-2026-10-04.md)
to the `@chio-protocol/pi-plugin@0.2.0` candidate. Each row names the shipped entrypoints,
the current component or host evidence and its command, the native acceptance
prerequisites and the remaining limitations. It routes readers to records; it is
not itself a qualification record.

## Qualification scope

[FINAL-QUALIFICATION.md](FINAL-QUALIFICATION.md) remains the current qualification
record. Its scope is the frozen `@chio/pi-plugin@0.1.0` archive
`ec6095390b9eae233540b73aee0ad2fef6977c36122dd30aa2779329b1897aa1`, built from
source `2ccc027b42b837f3df2889863273df2c1e2d5669`, with Pi 0.85.1, the bundled
bridge archive `7d9e34f7408a...` and the kernel binaries it lists. The
[static-kernel follow-up](STATIC-KERNEL-QUALIFICATION.md) adds observations for
that same frozen archive on kernel `c03a8a711dbb...`. Neither record transfers to
the 0.2.0 candidate, to Pi 1.0.2 or to any rebuilt archive. Historical acceptance,
subscription and qualification records are preserved unchanged.

Publishing the 0.2.0 candidate to npm as `@chio-protocol/pi-plugin` distributes it;
it does not qualify it. Its evidence has four separate layers:

- **Component and stock-host tests.** `npm test` drives the installed Pi 1.0.2
  and Pi Durable 1.0.2 public contracts, the bundled bridge gateway and scripted
  providers. Signed fixtures use ephemeral keys.
- **Signed bridge fixture.** The development workflow drives the real coding
  participant through a scripted kernel. It measures adapter and host contracts.
  It does not qualify a real kernel or authority installation.
- **Measured local confinement.** macOS `sandbox-exec` recipes and guests, and
  Linux arm64 bubblewrap in disposable `--privileged --network none` outer
  containers. This is not P5, actual x64 runtime or ordinary Docker defaults.
- **Package and cold consumer checks.** The staged archive installed in fresh
  consumers. This is installation evidence, not runtime acceptance.

Native acceptance remains open for every row until the exact compatible kernel
and the native services in [native prerequisites](NATIVE-PREREQUISITES.md) are
supplied and qualified. An interface or an unavailable gate is not a qualified
native feature. `chio-pi doctor` and `--governance required` report unavailable
native services explicitly instead of substituting a local path.

Task evidence records live under `docs/superpowers/evidence/` in the source
repository. The release archive excludes `docs/superpowers/` so that recording a
candidate's hashes never changes that candidate (see
[release qualification](RELEASE-QUALIFICATION.md#candidate-020)). Links to those
records resolve in the source repository at the recorded source commit.

## Summary

| # | Idea | Shipped entrypoints | Current evidence | Native acceptance |
| --- | --- | --- | --- | --- |
| 1 | Typed native tools | `createToolRegistry`, prepared `toolMode`, `chio-pi` | Component, stock Pi 1.0.2 | Open |
| 2 | Trusted operator console | `chio-pi doctor`, `status`, `inspect`, `recover` | Component, bundled native utility | Open; `approval-decide` refused |
| 3 | Constrained coding workspace | `chio-coding-resource`, `@chio-protocol/pi-plugin/coding-resource` | Component, signed bridge fixture, measured local confinement | Open |
| 4 | Pi 1.0.2 compatibility lane | Exact Pi 1.0.2 peer, `createChioPiSession`, `createChioPiRuntime`, `chio-pi` | Component, stock Pi 1.0.2, cold consumers | Open |
| 5 | Governed repository context | `repo_context` resource tool; executable discovery disabled | Component | Open |
| 6 | Explanations and authorized continuations | `explainNativeRecovery`, `verifyExplanationView`, `prepareNativeContinuation`, `executeNativeRemedy` | Real Ed25519 P2 views, callback fixtures | Interface only; native services absent |
| 7 | Pi Durable adapter | `@chio-protocol/pi-plugin/durable` | Component, actual Durable contracts, cold consumer registration | Open |
| 8 | Model context and labeled artifacts | `createNativeEmbedding`, `releaseGovernedModel`, `nativeKnowledge`, `--governance required` | Callback fixtures | Interface only; CLI refuses |
| 9 | Cross-host original-operation continuation | `exportContinuation`, `importContinuation`, `recoverOriginalOperation`, Durable `bindRecovery` | Component, signed bridge fixture | Open; same authority only |
| 10 | Bounded native delegation | `submitNativeChild`, `reconcileNativeChild`, `cancelNativeChild`, `waitNativeChild` | Callback fixtures | Interface only; attenuation unsupported |
| 11 | Governed codemode and bounded aggregation | Codemode disabled; `read_many` resource tool | Component | Codemode not offered |
| 12 | Parent run limits and portable confinement | `chio-pi --limits`, `--linux-runtime`, `openRunBudget`, `prepareLinuxGuest` | Component, measured macOS and Linux arm64 confinement | Open; P5 open |

## 1. Typed native tools

**Shipped.** Root export `createToolRegistry(tools, "typed" | "legacy")`. Prepared
operator JSON accepts `"toolMode": "typed"` (default) or `"legacy"`. The protected
`chio-pi` launcher passes one immutable registry to the model relay and guest
transport. Standard names map to `chio_read`, `chio_write`, `chio_edit` and
`chio_list`. See [typed tools](TYPED-TOOLS.md).

**Breaking change.** In 0.2.0, `chioExtension(executor)` without a registry throws;
0.1.0 registered `chio_execute`. Pass `createToolRegistry(tools, "legacy")` for that
public surface.

**Evidence.** [Task 1 record](superpowers/evidence/2026-10-04-task1-typed-host.md):
actual Pi 1.0.2 dispatcher and callable inventories, strict original arguments,
relay declaration, choice and history refusal before egress, and signed gateway
fixtures. Command:
`npm run build && node --test test/tool-registry.test.mjs test/typed-relay.test.mjs test/host-contract.test.mjs test/http-executor.test.mjs test/host-delivery.test.mjs`.

**Native prerequisites.** A compatible kernel and installed-host run with a typed
inventory. The frozen record covers only `chio_execute` on Pi 0.85.1.

**Limitations.** The research comparison of wrapper and typed definitions on
identical tasks was not run, so no task-success gain is claimed. Namespaced and
deferred discovery are not implemented.

## 2. Trusted operator console

**Shipped.** `chio-pi doctor|status|inspect|recover`, plus root exports
`runOperatorCommand` and `summarizeGatewayStatus`. Recovery actions are
`recover-lock`, `delivery-export`, `delivery-acknowledge` and `approval-submit`.
See [operator console](OPERATOR.md).

**Evidence.** [Task 2 record](superpowers/evidence/2026-10-04-task2-operator.md):
the actual bundled native utility, ephemeral Ed25519 keys, private journals, a
scripted resource executor and local HTTP fixtures. Diagnostics show no network,
model, ACK or dispatch activity. Command:
`npm run build && node --test test/operator.test.mjs`.

**Native prerequisites.** A separately qualified native operator that binds the
requested decision and approval ID before retention. Owner-result import uses
the separately pinned utility in the frozen procedure. A live kernel run.

**Limitations.** `approval-decide` is refused before any native call because the
bundled utility can retain a mismatched signed decision. Token and budget
counters are reported as `null`. There is no interactive console, and the
research usability experiment with another developer was not run.

## 3. Constrained coding workspace

**Shipped.** The `chio-coding-resource init|serve|inspect|export|recover-lock`
binary and the `@chio-protocol/pi-plugin/coding-resource` export. Nine closed tools:
`read_range`, `search`, `repo_status`, `repo_diff`, `apply_patch`, `test_recipe`,
`publish_artifact`, `repo_context` and `read_many`. See
[coding resource](CODING-RESOURCE.md).

**Evidence.** [Task 3 record](superpowers/evidence/2026-10-04-task3-coding-resource.md):
real participant, SQLite ledger, stdio and recipe confinement on macOS and in the
pinned Linux arm64 image. [Task 7 workflow record](superpowers/evidence/2026-10-04-task7-workflow.md):
the expiry-boundary bug fails in real confinement, a CAS patch passes the same
recipe, the reviewed diff is published once, and a second Durable host recovers
the original after response loss. Commands:
`npm run build && node --test test/coding-resource.test.mjs test/coding-confinement.test.mjs test/roadmap-workflow.test.mjs`
and `node scripts/qualify-roadmap.mjs --profile component --out NEW_RESULT.json`
from a source checkout.

**Native prerequisites.** The exact kernel, publisher-signed nine-tool manifest,
signer pin, custody and launch profile, caller binding through
`chioCallerCapabilitySha256` and a signed recovery fixture.
`qualify-roadmap.mjs --profile native` reports them missing and refuses; it
also refuses a complete profile, because this candidate ships no native
acceptance runner.

**Limitations.** Fixture native metadata is fabricated. Resource commit before
retained native completion evidence stays an unknown original. Only the `review`
destination exists; GitHub publication is not implemented. Recipes must be
measured with their actual runtime. Actual x64 runtime is unmeasured.

## 4. Pi 1.0.2 compatibility lane

**Shipped.** The exact peer `@earendil-works/pi-coding-agent@1.0.2`, root exports
`createChioPiSession` and `createChioPiRuntime`, and the `chio-pi` launcher.

**Evidence.** All component suites run against installed Pi 1.0.2; the Task 1
record confirms 1.0.2 throughout the installed Pi graph. The
[Task 6 record](superpowers/evidence/2026-10-04-task6-limits-linux.md) starts an
actual Pi 1.0.2 SDK session inside the Linux guest with synthetic services. The
[release record](superpowers/evidence/2026-10-04-task7-release.md) installs the
0.2.0 archive with exact Pi 1.0.2 in fresh consumers. Commands: `npm test`, and
`node scripts/qualify-release.mjs` as described in
[release qualification](RELEASE-QUALIFICATION.md#candidate-020).

**Native prerequisites.** The real installed-host I01 to I08 matrix on Pi 1.0.2
with a compatible kernel and live provider.

**Limitations.** No live-provider or live-kernel Pi 1.0.2 run exists. Pinning the
exact peer does not freeze Pi's transitive graph; each consumer lockfile records
its own resolution. Native MCP startup, nested and deferred tools stay disabled.

## 5. Governed repository context

**Shipped.** The `repo_context` resource tool returns requested structure,
manifest provenance and recipe digests as unsigned content with
`authority: false`. Pi sessions keep AGENTS files, skills, prompt templates and
project extension discovery disabled.

**Evidence.** Task 3 resource tests and the Task 1 poisoned discovery host test.
Command:
`npm run build && node --test test/coding-resource.test.mjs test/host-contract.test.mjs`.

**Native prerequisites.** Signed context and disclosure labels require the P3 and
P4 native services and a compatible kernel.

**Limitations.** Context is not authority and is not bound into checkpoints by a
native label. The research comparison with and without a context package, and
the malicious-instruction experiment, were not run.

## 6. Explanations and authorized continuations

**Shipped.** Root exports `explainNativeRecovery`, `verifyExplanationView`,
`renderExplanation`, `prepareNativeContinuation` and `executeNativeRemedy`.
Pending work accepts only `resume_original`, denied work only
`linked_continuation`, unknown effects only `reconcile_original`. See
[native compatibility](NATIVE-COMPATIBILITY.md#explanations-remedies-and-children).

**Evidence.** [Task 5 record](superpowers/evidence/2026-10-04-task5-governance.md):
real Ed25519 P2 views with exact framing, closed schema and freshness checks,
and native callback fixtures. Command:
`npm run build && node --test test/governance.test.mjs`.

**Native prerequisites.** The native scoped inspection port with pinned P2
authority, an installed P3 semantic runtime and deployment, and a native host
facade. The inspected SDK has no semantic routes.

**Limitations.** These are interfaces. No native explanation or remedy service is
installed or qualified. Explanations are advisory and never authorize an effect.

## 7. Pi Durable adapter

**Shipped.** `createChioDurableTools` from `@chio-protocol/pi-plugin/durable`, with
`flush`, `close`, `requestFor` and `bindRecovery`. `@earendil-works/pi-durable@1.0.2`
is an optional exact peer; the root entrypoint and its declarations never load
it. Tools use `replay: "unsafe"` and sequential execution. See
[continuation](CONTINUATION.md#native-pi-durable-tools).

**Evidence.** [Task 4 record](superpowers/evidence/2026-10-04-task4-continuation.md):
actual Durable ToolTask, memo, Session, Harness, MemoryStorage and fsynced JSONL
contracts with independent effect counts. The Task 7 workflow uses two actual
Durable hosts. The release record imports, typechecks and registers the Durable
entrypoint in a consumer with exact Durable 1.0.2. Command:
`npm run build && node --test test/durable.test.mjs`.

**Native prerequisites.** Real coding-kernel lifecycle, and native owner-result
import for resource commits that precede signed completion.

**Limitations.** No automatic recover-or-execute replay. The trusted owner must
preserve the `storeId` association with its persistent backend. Pi Durable's API
is experimental. The research comparison with ordinary Pi Durable was not run.

## 8. Model context and labeled artifact governance

**Shipped.** Root exports `createNativeEmbedding`, `nativeFeatureAvailability`,
`releaseGovernedModel`, `nativeKnowledge`, `preflightNativeSession`,
`mediatedSessionOperation` and `startModelRelay` with `{required: true, embedding}`
and a required durable run budget.
`chio-pi --governance required` refuses before credentials, sessions, services or
provider bytes when native governance is unavailable, with no fallback. See
[native compatibility](NATIVE-COMPATIBILITY.md).

**Evidence.** Task 5 record: the installed Pi 1.0.2 provider, session and
extension dispatcher with native callback fixtures; lost commit acknowledgement
withholds provider bytes. Command:
`npm run build && node --test test/governance.test.mjs test/governance-lifecycle.test.mjs test/governance-cli.test.mjs`.

**Native prerequisites.** P4 knowledge runtime, a native provider-effect contract
for prompt egress, classifier roots, artifact and provider sinks, and a native
host facade.

**Limitations.** These are interfaces; callbacks prove adapter ordering only. The
default `execution-only` mode forwards permitted inline text without
confidentiality rules. Credential screening covers selected known material and
labels, not unknown secrets in prose.

## 9. Cross-host original-operation continuation

**Shipped.** Root exports `startParentGatewayProxy`,
`createNativeOriginalOperationPort`, `recoverOriginalOperation`,
`exportContinuation` and `importContinuation`, plus Durable `bindRecovery`. See
[continuation](CONTINUATION.md).

**Evidence.** Task 4 record: immutable parent mappings, private handoff and two
host instances with one effect across response loss. Task 7 workflow: a second
actual Pi Durable host recovers the original without another publication, and
an unknown original refuses recovery. Command:
`npm run build && node --test test/continuation.test.mjs test/durable.test.mjs test/roadmap-workflow.test.mjs`.

**Native prerequisites.** Same-authority recovery only. Cross-authority P4
adoption, native owner-result import and a real kernel remain open.

**Limitations.** The second host in the workflow fixture runs in the same Node
process with a separate Harness, store and proxy. Handoff to a non-Pi Chio host
was not exercised. Unknown originals are not reconciled.

## 10. Bounded native delegation

**Shipped.** Root exports `submitNativeChild`, `reconcileNativeChild`,
`cancelNativeChild` and `waitNativeChild`. Request data cannot select an
executable, argv, environment, packages or confinement.

**Evidence.** Task 5 child-facade fixture with real Ed25519 signatures and
independent registry, accounting and launch observers; widening, wrong issuer
and substituted templates produce zero fixture launches. Command:
`npm run build && node --test test/delegation.test.mjs`.

**Native prerequisites.** A compatible native process host with `spawn_<template>`,
durable admission mode `all`, retained parent authority, signers outside the
guest, a qualified admission store and confined child launchers.

**Limitations.** These are interfaces. The candidate launches no child. The
bundled bridge's attenuation returns `unsupported_authority_operation`; tool-name
filtering is not attenuation.

## 11. Governed codemode and bounded aggregation

**Shipped.** Arbitrary native codemode and deferred execution remain disabled.
The relay refuses codemode, hosted and deferred tools before any reservation or
provider submission. The implemented aggregate alternative is the bounded
`read_many` resource tool: one admitted operation with ordered per-read results,
individual errors and explicit partial truth.

**Evidence.** Task 1 host test that codemode, MCP and deferred tools are absent;
Task 6 relay refusal test; Task 3 `read_many` test. Command:
`npm run build && node --test test/host-contract.test.mjs test/model-limits.test.mjs test/coding-resource.test.mjs`.

**Native prerequisites.** Independently verified nested-call delivery or a
kernel-owned compound operation with child identities. Neither native contract
exists.

**Limitations.** `read_many` is read-only and is not codemode. Mixed-effect plans
and scripted composition are not offered.

## 12. Parent run limits and portable confinement

**Shipped.** `chio-pi --limits` and `--linux-runtime`, root exports
`openRunBudget`, `PROVIDER_PROFILES`, `prepareLinuxGuest`, `createUnixRelay` and
`superviseGuest`, and the packaged Linux bootstrap `dist/linux-guest.js`, which
only the launcher starts. See [run limits and Linux](RUN-LIMITS-LINUX.md).

**Evidence.** Task 6 record: durable parent reservations, Codex limits with an
unavailable token ceiling, termination evidence, and an actual whole-Pi guest in
the pinned Linux arm64 image. Commands: `npm run build && node --test test/run-limits.test.mjs test/model-limits.test.mjs test/unix-relay.test.mjs test/linux-sandbox.test.mjs test/guest-termination.test.mjs test/guest-profile.test.mjs`,
and `node scripts/qualify-linux-guest.mjs` from a source checkout.

**Native prerequisites.** P5 cage acceptance, live provider accounting, actual
x64 runtime and ordinary Docker defaults.

**Limitations.** The measured Linux guest needed a disposable privileged,
network-none outer container. Codex hard output-token and remaining token budget
are `null`. Stream bytes are not token measurements or a spending ceiling.

## Shipped entrypoints

Run these from a consumer that installed the package as described in the
[README](../README.md#build-and-install).

| Entrypoint | Runnable check | Guide |
| --- | --- | --- |
| `chio-pi` launcher | `./node_modules/.bin/chio-pi --help` | [README](../README.md#run-a-task) |
| `chio-pi` operator console | `./node_modules/.bin/chio-pi doctor --help` | [Operator](OPERATOR.md) |
| `chio-coding-resource` | `./node_modules/.bin/chio-coding-resource --help` | [Coding resource](CODING-RESOURCE.md) |
| `@chio-protocol/pi-plugin` | `node --input-type=module -e "import('@chio-protocol/pi-plugin').then(m => console.log(typeof m.createToolRegistry))"` | [Typed tools](TYPED-TOOLS.md) |
| `@chio-protocol/pi-plugin/coding-resource` | `node --input-type=module -e "import('@chio-protocol/pi-plugin/coding-resource').then(m => console.log(typeof m.CodingResource))"` | [Coding resource](CODING-RESOURCE.md) |
| `@chio-protocol/pi-plugin/durable` | `node --input-type=module -e "import('@chio-protocol/pi-plugin/durable').then(m => console.log(typeof m.createChioDurableTools))"` with Pi Durable 1.0.2 installed | [Continuation](CONTINUATION.md) |
| Linux guest bootstrap | Started only by `chio-pi --linux-runtime` | [Run limits and Linux](RUN-LIMITS-LINUX.md) |

The qualification commands `scripts/pack-release.mjs`, `scripts/qualify-release.mjs`,
`scripts/qualify-roadmap.mjs` and `scripts/qualify-linux-guest.mjs` run from a
clean source checkout. They depend on test fixtures and Docker build files and
are not part of the archive.
