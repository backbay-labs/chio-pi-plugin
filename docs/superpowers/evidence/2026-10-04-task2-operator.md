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
tool replay. Native approval submission and signed decision use the retained
proposal and the normal prepare utility's bare-origin execution endpoint. The
private decision artifact is native-owned under `approvals/`; the original
operation remains unchanged until native resume. Foreign delivery/approval
outputs inside the authoritative journal are refused before export/admin work.
Dead-owner recovery releases only a provably dead same-host lock and retains all
original operation files, including unresolved fences.

## Verification

The focused operator suite passes 21 tests with zero failures or skips. It uses
the actual bundled utility, ephemeral Ed25519 keys, private temporary journals,
a scripted resource executor and local HTTP fixtures. It covers actual native
export, ACK, approval submit/decision and dead-lock actions, plus conservative
status, import safety, executable symlinks, exact proof substitution and auth
redaction. Diagnostic fixture counters show no network, model, ACK or protected
dispatch activity; before/after journal snapshots are identical.

`npm run typecheck && npm test && git diff --check` passes 80 tests with zero
failures or skips after the final implementation and redaction fixes. The focused
command is `npm run build && node --test test/operator.test.mjs`; the final
proposal-redaction gate also passes with
`node --test --test-name-pattern='proposal arguments' test/operator.test.mjs`.

The vendored bridge SHA-256 remains
`7d9e34f7408a316e35125982a23faaecfd2f31f4da6b50ca8eab287c2c918f67`.
The installed native `dist/gateway-operator.js` SHA-256 is
`84602a3f626ecf47283f0ada72fd4d2116104b167adc16eedd02e45d23306ac8`.
These identities were recomputed with `shasum -a 256` on this tree; no native
utility or vendor artifact was modified.

## Honest unavailable capabilities

Doctor reports unknown token/budget counters as `null` and configured expiry
without live validation. The current bridge lacks owner-result import and native
capability attenuation. Semantic recovery, coding-resource delivery, cross-host
Durable recovery and whole-Pi Linux confinement remain later tasks or separately
qualified native prerequisites. No DTO or retained-session transport token is
treated as child authority. No historical qualification record, real credential
cache or normal Pi profile was changed.
