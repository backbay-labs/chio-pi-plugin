# Task 2 implementation evidence

Scope: trusted status, doctor, original-operation inspection and explicit native
recovery delegation. This is component and bundled-native-utility evidence, not
a new real-kernel, provider or confinement qualification. Independent spec and
quality reviews follow the implementation commit.

## RED observed before implementation

* `npm run build && node --test test/operator.test.mjs` failed its first fixture
  because public `summarizeGatewayStatus` was absent.
* The expanded focused suite failed 17 of 18 tests: the trusted runner was absent
  and first-token operator commands still entered protected-launch parsing.
* The focused binary-symlink test failed with empty output before the main guard
  used realpaths for an npm-style executable symlink.
* The credential-bearing endpoint regression failed because status accepted and
  exposed an endpoint containing userinfo. Bare-origin static validation now
  refuses it before native invocation or console output.
* The proposal-redaction regression failed for `authentication` and singular
  provider credential fields. Sensitive-field handling now covers these names
  while preserving unknown counter values as `null`.

## Implemented boundary

Native utility resolution uses the public installed bridge package metadata,
checks the declared binary and realpath containment, and launches Node with argv
and a bounded environment. It imports no private operator implementation API.
All arguments are validated before native invocation. Diagnostic commands do not
load provider authentication, start Pi/model sessions, contact an endpoint, ACK
delivery or write journal state. Private file ownership, permissions, leaf
symlinks, read bounds, native authority binding and any original host binding are
checked before inspecting retained operations. Child output and parse diagnostics
are never printed directly; reports redact auth fields, approval tokens, private
delivery ACK secrets and known credentials embedded in ordinary text.

Original completions require public `verifyCompletedOutcome`; denials require
public `verifyBoundReceipt`, the exact signed reason and a retained fence. Native
pending/unknown records map conservatively to `unknown_after_dispatch`. Denied
records are never inferred undispatched. Missing records never authorize retry.
Undispatched proposal inspection follows the actual native journal contract,
which retains a proposal without a separate request field.

Native delivery export creates a new private original artifact without ACK or
dispatch. Explicit ACK requires the exact received original outcome and exclusive gateway
ownership; the fixture endpoint sees only `chio/acknowledge`, with no protected
tool replay. Native approval submission uses the retained proposal and the normal
prepare utility's bare-origin execution endpoint. It creates no native resume
credential. Decision retention is unavailable in this frozen adapter because
the native utility lacks requested-decision and approval-ID binding before
retention; the quality review below records that gate. Foreign delivery/approval
outputs inside the authoritative journal are refused before export/admin work.
Dead-owner recovery releases only a provably dead same-host lock and retains all
original operation files, including unresolved fences.

## Verification

The initial focused operator suite passed 21 tests with zero failures or skips. It used
the actual bundled utility, ephemeral Ed25519 keys, private temporary journals,
a scripted resource executor and local HTTP fixtures. It covers actual native
export, ACK, matching approval submission/decision fixtures and dead-lock actions, plus conservative
status, import safety, executable symlinks, exact proof substitution and auth
redaction. Diagnostic fixture counters show no network, model, ACK or protected
dispatch activity; before/after journal snapshots are identical.

`npm run typecheck && npm test && git diff --check` passed 80 tests with zero
failures or skips after the initial implementation and redaction fixes. These
matching decision fixtures did not establish the missing native decision/ID
binding contract; the current gate is recorded below. The focused
command is `npm run build && node --test test/operator.test.mjs`; the final
proposal-redaction gate also passes with
`node --test --test-name-pattern='proposal arguments' test/operator.test.mjs`.

The vendored bridge SHA-256 remains
`7d9e34f7408a316e35125982a23faaecfd2f31f4da6b50ca8eab287c2c918f67`.
The installed native `dist/gateway-operator.js` SHA-256 is
`84602a3f626ecf47283f0ada72fd4d2116104b167adc16eedd02e45d23306ac8`.
These identities were recomputed with `shasum -a 256` on this tree; no native
utility or vendor artifact was modified.

## Spec review correction: public approval bindings

Spec review of `f1319d3` found that recursive secret collection marked every
string in an approval credential as secret. Its public original request ID,
caller and signer then disappeared from otherwise successful diagnostics.

RED was observed with
`npm run build && node --test --test-name-pattern='approved completed diagnostics' test/operator.test.mjs`:
doctor did not preserve the original request ID. The new fixture creates a
proposal through the actual bundled gateway, supplies a genuine ephemeral
signed approval artifact, and resumes the exact original request. Public
`verifyCompletedOutcome` confirms the signed completion and real approval-bound
native request hash before testing its redaction.

Credential objects are still hidden wholesale. Global replacement now collects
only actual secret fields and credential signature material, without treating
public binding values as secrets because they are inside a credential. The
regression covers doctor/status/inspect in JSON and readable modes, exact original
request/caller/resource/tool/argument bindings, public schema and receipt proofs,
whole nested approval credential hiding, and a genuine approval-signature echo
inside the signed result. Diagnostic network/dispatch/ACK counters and journal
snapshots remain unchanged. The focused approval/proposal regression command
passes two tests with zero failures or skips. Fresh
`npm run typecheck && npm test && git diff --check` passes all 81 tests, including
22 operator tests, with zero failures or skips after this correction.

## Quality review corrections: decision retention and nonregular files

Quality review found that the frozen native utility verifies an approval
credential's signature and exact request but does not compare its signed decision
and ID with the operator's requested decision and approval ID before writing the
native activation artifact. Post-write checking cannot close that boundary.

RED was observed with
`npm run build && node --test --test-name-pattern='approval-decide .*unavailable|private .*FIFO' test/operator.test.mjs`:
both decision cases returned code 0, launched two real native children, made an
admin request, retained an activation artifact, and caused actual native
`chio_resume` to call the scripted protected executor once. Requested denial
received a genuinely signed approved token; requested approval received a
genuinely signed token for a different approval ID. The fixture used the actual
bundled operator and gateway, ephemeral Ed25519 authority and a local admin
endpoint. No real protected resource or credential was involved.

The adapter now refuses `approval-decide` during argument parsing for both
directions, before configuration reads, any native child/admin request or any
artifact creation. The native action union and recovery dispatch no longer
include decision retention. Doctor and help report it unavailable, with a
separately qualified native operator required to verify the requested decision
and approval ID against the signed credential before retention. Submission and
the gateway's exact original signed-resume contract remain intact. No vendor or
installed native code, journal migration, local authority substitute, artifact
quarantine or fence clearing was introduced.

The same RED command also bounded and hard-killed all four FIFO cases after six
seconds: config, journal operation, received ACK input and operator/admin input.
The shared reader now checks regular-file type, ownership, mode and size before
opening, then uses `O_NONBLOCK | O_NOFOLLOW` and descriptor revalidation to reject
nonregular replacements. All four GREEN subprocess cases refuse in under one
second, without admin requests or output artifacts. Tests clean up killed
processes and private temporary FIFOs explicitly.

Fresh `npm run build && node --test test/operator.test.mjs` passes 29 operator
tests with zero failures or skips. The decision refusal regressions observe zero
native children without replacing native code; the original proposal/journal and
fence remain identical, no credential artifact exists, and native resume performs
no protected dispatch. The public help/doctor distinction is tested separately.

Fresh `npm run typecheck && npm test && git diff --check` passes all 88 tests,
including 29 operator tests, with zero failures or skips after both quality
corrections. These are component/native-utility checks, not live-kernel,
provider or whole-host confinement qualification.

## Honest unavailable capabilities

Doctor reports unknown token/budget counters as `null` and configured expiry
without live validation. The frozen operator lacks qualified approval decision/ID
binding; the current bridge lacks owner-result import and native capability
attenuation. Semantic recovery, coding-resource delivery, cross-host
Durable recovery and whole-Pi Linux confinement remain later tasks or separately
qualified native prerequisites. No DTO or retained-session transport token is
treated as child authority. No historical qualification record, real credential
cache or normal Pi profile was changed.
