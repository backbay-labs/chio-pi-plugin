# Trusted native embedding contracts

This refines Task 5 using the inspected Rust and P2 HTTP contracts. The interfaces
below are proposed trusted TypeScript embedding seams, not new native wire
schemas or evidence that the corresponding host services are installed. The
default CLI cannot activate missing services through prepared JSON.

## Custody and activation

An operator-created native embedding selects ports programmatically. Prepared
JSON cannot select callbacks, modules, executables, verifier functions or sinks.
Its expected binding independently pins authority domain, tenant, process,
runtime, lineage, isolation epoch, policy/contract identity and installation
generation. Native operations resolve and recheck the current installation.

Prepared requests, child/template handles, adoption reservations and provider
sinks are opaque native custody references. They expose no serializable permit
or byte getter. TypeScript branding or private ownership rejects accidental
substitution; it does not establish authority. DTOs and signed certificates are
data, with native verification and retained-state checks still required.

Absent compatible ports are unavailable. Required profiles refuse before egress
or child submission. Callback fixtures qualify adapter ordering and binding only.
The current bridge and P5 profile do not supply the missing services.

## Model release

Use one native `releaseFrozenRequest(request, selectedSink, signal)` operation
whose implementation owns publication, knowledge join, retained release intent,
commit acknowledgement and actual provider submission. Never return a permit or
prepared bytes for the relay to send with its own independent fetch.

The request includes stable original identity, the final serialized JSON string,
exact UTF-8 size/digest, selected fixed provider route/profile/model/purpose,
native process/model-context references, complete available history artifact
references and limits identity. Produce the immutable string after normalization
and provider-specific caps. A readonly typed-array view is insufficient because
its backing buffer remains mutable. Do not reserialize after admission.

The native implementation resolves current authority and knowledge, publishes
or prepares the exact payload, rechecks recipient/context/credential assignment,
commits the knowledge join and original release intent, receives acknowledgement
of that commit, and submits those bytes through the independently installed sink
and provider-effect contract. Lost commit acknowledgement supplies zero bytes to
the sink. Post-submission failure preserves original uncertainty and cannot
authorize replacement submission. Outcomes distinguish completed, proven
undispatched, refused and unresolved; missing responses prove no non-dispatch.

Account identity is provider specific. Codex uses its actual operator-held native
account ID, never the guest's `chio-local-relay` claim. OpenAI API authority in
this adapter contains only an API key. Its actual account remains unknown unless
the native installation independently verifies a mapping. A key hash or local
credential-profile label is not a provider-account ID. Account-specific native
contracts refuse while that mapping is absent. The native sink pins its credential
profile and generation. P4's local model envelope does not supply the missing
outbound provider-effect contract.

## Knowledge and artifacts

Keep proposed methods close to native operations:

| Embedding operation | Native custody requirement |
| --- | --- |
| Reserve/adopt legacy content | `knowledge.adopt`, original reservation, independently selected classifier root, exact content/schema/dependency/configuration/policy/generation/freshness checks |
| Save checkpoint | Native revision CAS and monotone knowledge |
| Restore checkpoint into selected sink | Current knowledge join and acknowledged release before delivery; exact provider/account/conversation/cache/side-file/contract identity |
| Copy artifact | New retained provenance edge without removing restrictions |
| Export archive into selected sink | Native archive signer and committed release |
| Import archive | Selected archive root, exact framing, complete DAG and original native records |

Do not accept local classifier callbacks, expose adopted bytes for independent
release, or fall back to raw blobs/files/SQLite. Current archive transfer requires
the same native process, tenant, authority and retained provenance inventory.
A changed Pi session ID does not establish compatible native process custody.

## Child authority

Use native submission, reconciliation, cancellation and optional wait/settlement
operations with original request identity and opaque installed template handles.
The native process host resolves retained parent authority, invokes its issuer,
persists child capability/signer/parent/request/budget binding, verifies one signed
delegation hop with narrower scope/validity in the same issuer/budget family, and
launches through its installed confined launcher.

The adapter never spawns locally after a successful precheck. Transport tool
filtering is not delegation. Request data cannot select executables, environment,
packages or confinement overrides. Native observations require independently
checked retained registry/accounting, not `verified: true` or a signed token alone.
Reconciliation cannot relaunch unknown children. Cancellation targets the original
subtree and preserves effects, uncertainty, budgets and accounting.

## Explanation and remedy

P2 has an existing bounded HTTP contract at `/v1/recovery/explain`, using the
operator-held inspection capability. Independently verify the exact selected
Ed25519 signer, domain, issuer, recipient and time before rendering the closed
public view. Its public signature does not bind workflow ID or private graph.
The complete profile is recorded in [native prerequisites](../../NATIVE-PREREQUISITES.md).

Optional remedy operations use existing native commands or opaque semantic-step
custody. Pending work resumes the exact original; frozen denial requires an
authorized linked continuation; unknown effects require original reconciliation.
The native host owns installation, plan acceptance, framing, physical capture,
proof acquisition and `invoke_known_only`. Advisory candidates cannot authorize
local effects. No invented signed remedy-grant message is introduced.

## Contract acceptance

Observe provider deliveries and native launch seams independently. Missing ports,
verification failure, stale authority, changed identities/context/purpose/credential
generation and expired evidence deliver no bytes. Lost commit acknowledgement
delivers none. The sink receives the exact final capped/normalized bytes despite
later caller mutation. Sink failure retains original uncertainty. Account unknown
stays unknown. Checkpoint restores join stronger native knowledge and failed
mediation cancels compaction/fork/tree operations explicitly. Foreign adoption or
archive custody causes no publication. Child widening, wrong issuer/budget family,
missing accounting and substituted templates cause no launch. P2 tests use real
Ed25519 signatures, including re-signed incorrect audience/domain/issuer and
closed-schema/time/order failures.

These are component acceptance conditions. Native service acceptance additionally
requires the exact facade, writer/broker, installation, actor assignments, selected
sinks, restart/accounting evidence and applicable Linux qualification.
