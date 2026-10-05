# Native governance compatibility

The default `chio-pi` model launcher refuses required governance before reading
provider credentials, opening a Pi session, starting gateway services or sending
provider bytes. The frozen bridge archive does not implement a compatible native
model-release, knowledge, semantic or child-process facade. Prepared JSON cannot
select native modules, executables, verifiers, callbacks or provider sinks.
`doctor` reports native model egress, knowledge and Pi custody as unavailable.
Its existing native operator commands retain their separately documented scope.

## Trusted programmatic embedding

`createNativeEmbedding` accepts operator-selected native ports and installed
opaque process, model-context, history, provider-sink and child-template handles.
It snapshots selected callbacks and binding fields. WeakMap-owned references
expose no permit serialization or byte getter. Ownership branding detects
substitution; it proves no native authority. Native services must perform their
own cryptographic and retained-state verification on every operation.

The expected binding independently pins authority domain, tenant, process,
runtime, lineage, isolation epoch, policy, contracts and installation generation.
`currentInstallation` must resolve the currently installed native authority,
return its binding and a fresh safe-integer expiry. Every adapter entrypoint
checks that binding. Native operations must recheck it atomically with their
actual knowledge commit, release or confined launch. A callback that merely
returns the expected DTO does not qualify a native service.

`nativeFeatureAvailability` reports absent, incomplete or stale ports as
`unavailable`. Complete programmatic ports remain `native-qualification-required`.
The adapter does not upgrade a callback or prepared-config claim into qualified
native availability. Existing doctor capabilities use `available` only for the
inspected installed operator utility, with explicit scope and qualification text.

## Exact model release

`startModelRelay(authority, model, historyObserver, registry,
{required: true, embedding})` returns an opaque `governanceReference` in addition
to its private local transport credentials. Required `createChioPiSession` and
`createChioPiRuntime` receive that reference in `governance.relayReference`. They
validate the exact embedding, provider, model, registry and still-open relay.
A loopback URL or forged reference is insufficient. Required sessions construct
a read-only relay credential runtime and pin the model base URL to that relay,
including runtime replacements and Pi's summarization paths. The public Agent
stream seam repins the route after `setModel` of the same catalog model and
refuses changed provider/model/API before provider execution. Arbitrary trusted
host replacement of SDK stream functions is outside this seam, just as direct
SessionManager mutation is outside lifecycle mediation.

After registry validation, normalization and provider-specific changes, the
relay serializes exactly once. Native release receives the frozen JSON string,
UTF-8 size, SHA256, original request ID, fixed provider route/profile/model,
purpose, native process/context/history references, credential generation,
limits identity and independently selected provider sink. Task 6 integrates its
provider caps before this final serialization point.

The native `releaseFrozenRequest` implementation owns publication, current
knowledge join, retained intent, commit acknowledgement and provider submission.
It must deliver zero sink bytes after lost commit acknowledgement. There is no
adapter fetch following an admission permit. The native host must reject changed
identities, contexts, purposes, installations or credential assignments at the
actual release boundary. Missing responses and post-submission stream failures
preserve the original fence. The adapter also retains an in-process interlock;
restart-proof fencing and accounting belong to the native durable service.
Concurrent requests cannot bypass the interlock during an asynchronous account
lookup. Successful full response observation clears only this additional local
interlock. Reconciliation and replacement authority remain native responsibilities.

Codex release uses the account in the operator-held `ModelAuthority`, never the
guest's `chio-local-relay` account claim. OpenAI API account identity remains
unknown unless the native port independently verifies a mapping. No API-key hash
or credential-profile label is treated as an account ID. Account-specific
contracts refuse unknown mappings. The native provider sink pins its own actual
credential profile and generation.

Explicitly ungoverned legacy transport fixtures remain available for adapter
comparisons. Their local fetch path is outside required native governance and
cannot be described as protected disclosure acceptance.

## Knowledge and Pi lifecycle

`nativeKnowledge` maps reservation/adoption, revision-CAS checkpoint,
`restore_into`, copy, `export_into` and `import_archive` to native operations.
Reservation and artifact references remain opaque and scoped to one embedding.
Foreign references and raw archive objects refuse before the native call.
Adoption needs native `knowledge.adopt`, the original reservation, independently
selected classifier roots, exact reserved bytes/schema/dependencies and current
installation checks. Native archive import validates framing, complete provenance
DAG and original retained records. Current P4 permits only the same native
process, tenant and authority. Native sinks own committed restore/export delivery.
There is no local classifier, raw-blob fallback or independent artifact fetch.
New retained artifacts join the complete available model history references.
Native monotone knowledge stays outside Pi's visible transcript and must be
rechecked at model release.

The required session factory preflights before opening or restoring its initial
SessionManager and before `createAgentSession`. Preopened initial managers are
refused. The public runtime factory repeats preflight for replacements, and its
import wrapper validates the original input file before Pi copies it. A switch
hook sees the destination and cannot substitute for that source check.

Trusted handlers catch failures and explicitly return `{cancel: true}` from
`session_before_compact`, `session_before_fork`, `session_before_switch` and
`session_before_tree`. Native custody timeouts, aborts, unavailable ports and
changed bindings cancel. Custom compaction/tree summaries are returned only after
the native mediation operation has retained provenance/checkpoint and released
that summary. Pi 1.0.2 catches thrown handlers; `session_start` cannot veto initial
restore. Its declaration's `skipConversationRestore` is ignored by runtime fork.

The trusted public boundary-dispatcher seam refuses drafts returned by `turn_end`
or `agent_before_settle`; mediated SDK operations invoke Pi's existing public
compact/tree methods and therefore run the lifecycle gates. Executable discovery
remains disabled. This seam cannot intercept arbitrary direct SessionManager
mutation by trusted host code. Context/provider hooks are transformation hooks,
not disclosure gates; all required provider calls use the governed relay.

## Explanations, remedies and children

`explainNativeRecovery` uses the native scoped inspection port and independently
pinned P2 authority, then verifies the closed view before rendering advisory
text. The Ed25519 message is UTF-8 `chio:recovery-explanation-view:v1`, NUL,
RFC 8785 canonical body JSON. Public keys and signatures are bare lowercase hex
of 32 and 64 bytes; version is numeric 1. The verifier checks the selected signer,
domain, issuer, recipient, safe timestamps, maximum 30-second lifetime, candidate
bounds, strict order and closed enums/schema. Public views have no workflow ID
or private graph binding and never authorize a candidate effect. Rendering accepts
only verifier-owned views and checks freshness again; the native explanation path
always uses current time instead of an offline fixture clock.

Pending work accepts only `resume_original`; denied work requires
`linked_continuation` and native accepted semantic-step custody; unknown effects
accept only `reconcile_original`. `prepareNativeContinuation` asks the native
semantic runtime to select and retain that step. Native installation, plan
acceptance, exact capture/framing, proof acquisition and `invoke_known_only`
remain mandatory. No new remedy-grant wire message or local fallback is created.

`submitNativeChild` passes one original request and an installed opaque template
to the native process host. Request data cannot select executable, argv,
environment, packages or confinement. Native submission must durably retain and
verify issuer/signature/capability/parent/request/budget before confined launch,
check the independent registry/accounting, enforce narrower scope/validity and
the same issuer/budget family, and refuse template substitution. The adapter
never spawns a child after a precheck. Repeated original submission refuses;
reconcile, cancel and optional wait operate on the original native subtree.
Unknown reconciliation cannot relaunch. Cancellation preserves effects,
uncertainty and accounting. `verified: true` or a token is no outcome contract.
The installed bridge's attenuation remains unsupported and unavailable.

## Evidence boundaries

Run:

```sh
npm run typecheck
npm run build
node --test test/governance.test.mjs test/delegation.test.mjs test/governance-lifecycle.test.mjs
npm test
```

These tests use real Ed25519 P2 signatures, the installed Pi 1.0.2 public
provider/session/extension dispatcher, and native callback fixtures. They prove
adapter ordering, immutable binding, cancellation and absence of adapter
fallback effects. They do not qualify native custody, retained accounting,
provider effects, a running kernel or Linux cage acceptance. Native qualification
requires the exact installed facade, writer/broker/admission store, authority and
actor assignments, provider/artifact sinks, confined templates and restart proof.
See [native prerequisites](NATIVE-PREREQUISITES.md) and the immutable historical
[qualification record](FINAL-QUALIFICATION.md).
