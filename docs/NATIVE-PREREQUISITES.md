# Native roadmap prerequisites

This crosswalk records contracts inspected on October 4, 2026. It is not a
qualification of a Pi service or a new kernel build. Source implementations in
the recovery worktree remain distinct from the bridge archive bundled here.

## Installed execution boundary

The bundled bridge artifact is `chio-bridge-0.3.0-7d9e34f7408a.tgz`, SHA256
`7d9e34f7408a316e35125982a23faaecfd2f31f4da6b50ca8eab287c2c918f67`.
It provides native execution, receipt/result verification, delegated retained
session validation, approvals, and delivery ACK. Public APIs include
`createMcpExecutionClient`, `verifyBoundReceipt`, `verifyReceivedOutcome`,
`verifyCompletedOutcome`, and `startGatewayHttp`.

Its trusted operator binary supports status, dead-lock recovery, delivery export,
delivery acknowledgement, approval submission and approval decision. It does not
support owner-result import or capability attenuation. All inspected bridge
variants report version 0.3.0; compare archive and code identities, not only
semver.

Task 2 quality review reproduced a defect in this exact archive's decision
utility. It checks an approval token's exact request and signature but accepts
either signed decision without comparing it to the operator's requested
decision or approval ID. An admin response with a genuine signed approved token
and a displayed denied status was saved after `--decision denied`; the bundled
gateway then selected it during `chio_resume` and invoked the scripted resource
executor. This is a native-utility/component reproduction, not a live-kernel
observation. The adapter gates `approval-decide` before native invocation and
admin traffic. Post-write validation would leave a usable credential behind.
Activation requires a separately qualified utility that checks the requested
decision and approval ID before retention. Approval submission and verification
of the original signed resume are independent supported paths.

Owner-result import was added in bridge commit
`52f80517af3fce948a3cbc9c9bb485fcdac7dd04`. The frozen qualification references a
separate operator archive with SHA256
`02a0e4ad4e61ffb989302cae8774a9ae9ab8f647473f1926d1e671673169a37b` and a separate
read-only kernel exporter with SHA256
`b795973deadfa255768a4e4eb07e9755decc4de1f75746e49f6a19f2f4ba12fb`.
The exporter does not grant trust: the native importer verifies the kernel-signed
record, original caller/request, receipt/result and delivery proof. See
[the frozen procedure](FINAL-QUALIFICATION.md).

## Resource participant binding

Native stdio `tools/call` metadata is:

```json
{
  "chioRequestId": "1111111111111111111111111111111111111111111111111111111111111111",
  "chioOperationId": "1111111111111111111111111111111111111111111111111111111111111111",
  "chioAttemptId": "native-attempt-id",
  "chioTransportKeyEpoch": 1,
  "chioCallerCapabilitySha256": "64-lowercase-hex-characters"
}
```

The operation ID is the kernel admission identity, not the Pi call identity.
Request and operation IDs are equal lowercase SHA256 values. The native provider
attempt validator requires that shape and a positive transport-key epoch. The
process host's connection descriptor supplies the public caller digest from the
canonical signed capability; a transport token is not that capability identity.
This metadata is connection binding on an exclusively kernel-owned pipe. A
resource must not treat the same bytes arriving from an arbitrary caller as a
signed credential. The resource returns ordinary MCP results; the kernel supplies
receipts and delivery evidence.

The existing shared-resource-swarm example uses caller-bound SQLite CAS and
retained exact outcomes. The required-agent filesystem wrapper is only an
independent dispatch observer. The mini-SWE repository server ignores native
operation metadata in its current execute path and cannot be substituted
unchanged for an idempotent coding participant.

## P2 explanations

The current recovery source provides `RecoveryClient.explain(capability,
workflowId)` and `POST /v1/recovery/explain`. Its HTTP client validates shape,
not signatures. A public signed view has exactly `body`, `authority_key`,
`algorithm`, and `signature`. The Ed25519 profile signs UTF-8
`chio:recovery-explanation-view:v1`, NUL, then RFC 8785 canonical JSON of `body`.

The view body contains `schema`, `version`, `planner_version`, `trust_domain`,
`issuer`, `recipient`, `report_ref`, `issued_at_unix_ms`, `expires_at_unix_ms`,
and `projection`. The schema is `chio.recovery.explanation-view.v1`. Projection
contains a summary and candidates with `template_id` and `assessment`. Native
validity is at most 30 seconds. Independently select the advisory signer, domain,
issuer and recipient. Advisory and disclosure signers are separate.

The planner version is `chio.recovery.planner.v1`. Opaque identifiers match
`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`. Timestamps are safe unsigned integers,
with `issued <= now < expires` and a positive interval of at most 30,000 ms.
Candidates are strictly sorted by `template_id`, unique, and limited to sixteen.
Summary values are `authorized_inspection_required`, `no_disclosable_advice`,
`alternatives_under_snapshot`, and `search_bound_reached`; the first two have
no candidates. Candidate assessments are `feasible_under_snapshot`,
`requires_exact_approval`, `requires_transformation`, `requires_prerequisite`,
`needs_fresh_evidence`, `blocked_by_capability`, `unknown_outcome`,
`no_registered_remedy`, and `search_bound_reached`.

The public view contains no workflow ID, private scope, intent digest, complete
graph digest or report signature. Verifying that view cannot recompute the private
graph or bind a selected workflow independently. The native protected-report
path additionally checks authorized scope, policy, deployment, contract and intent
and recomputes the report. `report_ref` is not a graph lookup capability.

## P3 semantic remedies

Available native Rust composition includes `NativeSemanticRuntime`,
`PinnedSemanticConnector`, `SemanticTransportRouter` and
`configure_semantic_deployment`. Install the signed deployment and packages with
independently selected operator/publisher roots, exact inventory, native authority
and host-issued security context before activation.

`SemanticInvocationV1` binds action, payload, audience, endorsements, annotations,
transformation and prerequisites. The action binds current source versions,
labels, request identity/semantics, capability, generation, destination, plan/step,
output disposition and expiry. Evidence validity is at most 60 seconds. Native
capture and final submission recheck current source, authority, ACL and
prerequisites. Execution uses `invoke_known_only` semantics.

The implemented transport profile supports bounded support reads, issue creation
and field projection. It does not enable model, shell, file, log or streaming
channels. A provider's complete version tuple must be guarded atomically before
an effect for `AtomicIfMatch`; echoing a version after an effect is insufficient.
An advisory offer never grants execution authority.

## P4 knowledge, checkpoints and labeled artifacts

Native composition is `ProcessRuntime::enable_durable_knowledge()` plus
`NativeKnowledgeRuntime` over the native store, artifact broker, selected
installation and mutation fence. Native methods cover reservation, publication,
handle selection, prepared reads, release into a host sink, checkpoint/restore,
copy, export/import, legacy adoption and collection.

`PreparedArtifactRead` intentionally exposes no byte getter or deserialization
API. The native writer commits monotone knowledge and the stable release intent
before a trusted `ArtifactReleaseSink` receives bytes. Lost commit acknowledgement
withholds bytes. A local precheck followed by a local file read bypasses this
contract.

Model contexts bind provider, account, conversation, cache, side-file artifacts
and contract. These are retained local envelopes. Actual provider prompt egress
still requires an independently selected native provider-effect contract. P3's
disabled model channel does not supply one.

Checkpoint restore refuses changed model identities and joins stronger current
native knowledge. Adoption requires `knowledge.adopt`, an original native
reservation and an independently selected exact-content classification
certificate. Legacy bytes stay quarantined until adoption. Archive import checks
the full provenance DAG and original retained records and currently permits only
the same process, tenant and authority. It is not cross-authority handoff.

## Child authority

The bridge's `attenuate()` returns `unsupported_authority_operation`.
`POST /admin/sessions/{existingSession}/credential` only narrows tool names and
lifetime for an existing retained session and replaces its transport credential.
It does not mint a child process or capability or erase its delivery latch.

The native process host exposes pinned `spawn_<template>`, `wait_children`, and
`settle_children` lifecycle tools. `ProcessRegistry.submit_child` persists child
capability, signer, parent relation, budget and original request binding with the
native issuer. `ProcessRuntime.spawn` requires exactly one new signed delegation
hop, narrowed scope/validity and the same issuer/budget family. Cancellation
applies to the subtree. The TypeScript process client has no direct spawn API.

Required delivery prerequisites are a compatible native process host, durable
admission mode `all`, retained parent authority, selected worker templates,
signers outside the guest, a qualified admission store and confined child
launchers. Tool-name filtering is not attenuation. Guest-selected executable
templates and issue-then-revoke delegation are refused.

## Linux and native host service delivery

P5's current verification records `phase_accomplished=false` pending real Linux
cage acceptance. Its bounded profile has model and tool channels disabled. Cage
primitives are not a generic Node/Python/npm/Cargo test sandbox: current profiles
reject writable directories, sockets, descendants and undeclared execution.

Linux recipe confinement can use a separately tested network-isolated bubblewrap
or immutable container job. Whole-Pi confinement also needs restricted access to
exact gateway/model services, without shared unrestricted host networking. A
Linux recipe implementation does not qualify a whole-Pi Linux launcher.

The inspected TypeScript HTTP SDK exposes P1/P2 only. There are no existing
`/v1/knowledge`, `/v1/semantic`, disclosure or adoption routes to call. P3/P4/P5
delivery needs a bounded authenticated native host facade installed with the
writer and process broker, separate control capabilities and actor assignments,
the exact native flow profile, and selected Pi ingestion/archive/model sinks.
Schemas and callback fixtures alone do not establish those native services.

## Provider-specific run limits

The user selected keeping the Codex subscription profile with request, timeout
and response-size limits while exposing its unavailable hard output-token ceiling.
The inspected Pi 1.0.2 Codex provider does not emit `max_output_tokens`; the
[official ChatGPT plan API limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
list that parameter as unsupported. The ordinary OpenAI Responses API supports
an output ceiling including reasoning tokens. Aborting a stream on byte/time
bounds cannot establish the provider's total token consumption or spend.

## Source map

The source contracts above were inspected under
`arc-worktrees/recoverable-agent-runtime-20261002` and `arc-security-pin`:

| Contract | Repository-relative source |
| --- | --- |
| Native resource metadata | `crates/protocol/chio-mcp-adapter/src/transport/utils.rs` |
| Credential latch and ACK | `crates/protocol/chio-mcp-remote/src/remote_mcp/session_credentials.rs` |
| Resource CAS example | `examples/shared-resource-swarm/store.py` |
| P2 client | `sdks/typescript/packages/node-http/src/recovery.ts` |
| P2 signed view | `crates/security/chio-security-types/src/recovery/explanation/result.rs` |
| P2 verification | `crates/security/chio-recovery/src/report.rs` |
| P3 native API | `crates/platform/chio-control-plane/src/semantic.rs` |
| P3 verification | `crates/security/chio-semantic-contracts/src/verification.rs` |
| P4 native API | `crates/platform/chio-control-plane/src/knowledge.rs` |
| P4 sink | `crates/kernel/chio-kernel/src/knowledge.rs` |
| Child lifecycle | `crates/products/chio-cli/src/cli/process_host/lifecycle.rs` |
| Cage profile | `crates/security/chio-cage/README.md` |

These paths are provenance pointers for contributors, not installable dependencies
or a promise that these native services are running.
