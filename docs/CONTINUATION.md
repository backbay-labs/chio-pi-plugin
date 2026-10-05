# Original-operation continuation and Pi Durable

Continuation recovers a verified original operation under the same independently
prepared authority. It never creates a replacement operation, grants authority,
or treats a content digest as a signature. Unknown, pending, denied, missing and
unverifiable originals retain their native fence. This is not cross-authority
P4 adoption or current real coding-kernel qualification.

## Trusted parent transport

The protected launcher starts the bundled native gateway, then a separate
fixed-target parent proxy. The sandbox can reach only the proxy and model relay;
the actual gateway port and credential stay in the trusted parent. The guest
configuration contains the proxy's ephemeral token and port plus public authority
and registry digests. Linux guest routing must preserve this separation.

`startParentGatewayProxy({configPath, binding, native})` accepts the exact public
native gateway handle. `binding.authorityDigest` is the independently prepared
`preparedAuthorityDigest`; `binding.registryDigest` pins the immutable registry.
The handle provides `url`, `port`, `token`, `originals` and `close()`. The native
handle's public `acknowledgeReceivedOutcome` remains available only to the trusted
delivery observer.

The proxy permits initialization, ping, tool inventory/calls, initialized and
cancellation notifications. It preserves the raw JSON-RPC ID and parameters and
the native MCP session header. URL, route, Host and authentication are fixed;
Origin, redirects, arbitrary targets, admin/model routes and every guest
`chio/acknowledge` are refused. Initialization is attempted once. An ambiguous or
failed result never silently initializes another session.

Before a tool request opens its native transport, its private reservation and
containing directory are fsynced. Records live under
`journalDir/pi-parent-mappings`; root `.json` files remain native operations.
Each reservation binds the complete immutable logical KernelRequest, argument
digest, public authority/registry digests and original native transport IDs.
Existing logical identity never forwards again, including after restart.
Reservation without a native operation is unknown; it is not proof of
non-dispatch. Storage failure forwards zero effect bytes.

The native gateway's private `gateway.lock` owns the cross-process lease. Its
installed format is exactly `{pid, hostname, sessionId}`. The proxy verifies the
actual current-process owner before every forward and uses one in-process proxy
lease per mapping directory. All parent mapping handles in that process share a
read/mutation line keyed by the canonical private directory, including separately
opened original-operation ports. The first committed entry proof stays immutable
under concurrent receiving hosts. No additional persistent lock is stranded after a
parent crash. Closure or changed ownership refuses forwarding; read-only
original lookup remains available. Use the existing native operator dead-owner
recovery contract, preserving all unresolved operations.

These operation identities are distinct:

| Contract | Original identity |
| --- | --- |
| HTTP RPC body `id` | The string `JSON.stringify([request.sessionId, request.toolCallId])` |
| Native gateway call | `nativeMcpSession + ':' + JSON.stringify(rpcId)` |
| Native ordinary HTTP request | `config.sessionId + ':' + sha256(canonicalJson({id: gatewayCallId}))` |
| `chio_resume` | Its retained `arguments.requestId` |
| Direct SDK request | `'pi:' + sha256(JSON.stringify([sessionId, toolCallId]))` |
| Native resource operation | The separate native resource's 64-character operation ID |

A restarted connection cannot reconstruct an older native identity. The parent
may return public `chio.pi.original-identity.v1` metadata bound to the retained
logical request and independently pinned digests. The guest checks that metadata
and the full signed outcome. Metadata never substitutes for native verification.
The trusted delivery observer resolves its private mapping rather than accepting
a guest-supplied native ID.

## Read-only original lookup and private handoff

`createNativeOriginalOperationPort({configPath, binding})` exposes `lookup` and
`inventory` without an execute fallback. Lookup takes the complete original
KernelRequest. It validates the full native root journal and authority binding,
joins every operation with the parent mappings, and invokes the pinned bundled
operator's public status contract. Unmapped native uncertainty also fences fresh
work. Concurrent changes trigger a bounded read-only retry or refusal.

Completed and denied originals are verified through the public native verifier.
Approved operations use the private native retained request, including its
approval metadata. Reconstructing a stripped public request would produce the
wrong delivery request hash. Exact signed outcome, receipt, result and delivery
fields are retained; an unsigned resource ledger cannot clear kernel uncertainty.

```ts
import {
  createNativeOriginalOperationPort, exportContinuation,
  importContinuation, recoverOriginalOperation,
} from "@chio/pi-plugin";

const originals = await createNativeOriginalOperationPort({configPath, binding});
await exportContinuation(handoffPath, {
  binding, originals, requests: [originalRequest],
  context: {note: "Continue reviewing the retained result"},
});

// The receiving operator chooses binding independently of this file.
const handoff = await importContinuation(handoffPath, {binding, originals});
const originalOutcome = await recoverOriginalOperation(
  handoff.originals[0].request, originals,
);
```

`chio.pi.continuation.v1` includes public digests, original requests/native IDs,
their retained states, exact verified completed or denied outcomes, bounded JSON
context and a content digest. Context is never executed. Import independently
looks up every original and compares signed outcomes. A denied handoff preserves
its denial; `recoverOriginalOperation` returns only a verified completion.

Files require an owned private directory, a private regular owned leaf, one link,
strict UTF-8, bounded reads and durable exclusive atomic creation. Links, special
files, FIFOs, changed state and oversized inputs refuse before dispatch or ACK.
The reader revalidates the admitted directory's identity, ownership, mode and
type along with the final leaf before accepting a read.
Handoffs contain no capability, bearer, session, provider or approval credentials.
Known actual credential material is rejected even inside ordinary text; public
session/capability IDs and digests remain permitted. Delivery proof fields remain
exact because they are part of the independently verified original outcome.
The same retained-material and Bearer checks apply to JSON member names and
values. A fresh native original port seeds its credential inventory from the
selected private configuration and every already-read retained native request,
including private approval signature material. Import validates the envelope's
binding, digest and bounds first, verifies listed originals, then refreshes the
selected inventory and repeats exclusion before returning. Empty exports also
refresh that inventory before publication because they perform no original
lookup. These refreshes are read-only and do not execute or acknowledge effects.
Nested standard credential fields are refused after case/separator normalization,
including `authToken`, `providerToken`, `client_secret` and `access_key`. This
bounded structural rule and selected nontrivial credential strings (at least
three characters) do not classify unknown secret values in unlabeled prose.

## Native Pi Durable tools

Pi Durable is an optional exact peer and development dependency at `1.0.2`.
Install `@earendil-works/pi-durable@1.0.2` exactly, beside Pi 1.0.2 and before
the plugin archive, when using this adapter. Import `createChioDurableTools`
only from `@chio/pi-plugin/durable`. The base runtime and root declarations do
not load that optional package; importing the Durable entrypoint without it
fails with a missing-module error.

The trusted backend owner must prepare a stable 64-hex `storeId` and associate it
with the exact selected persistent backend and Storage/Session handles. Durable's
public Storage API exposes no persistent identity or backend path. Keep that
owner association across restart; never assign its identity to another backend.
The adapter retains an immutable private `store-owner.binding`, checks actual
selected-store tasks and entries, and rejects substitution by another live
handle. The identity label or parent provenance file alone never proves delivery.
`adapter.close()` shuts down only the adapter observer and its registrations.
It retains the actual backend association and public `Session.subscribeClose`
listener. An observer may reattach only to the exact same still-live handles,
private directory and binding. The synchronous close listener marks and enqueues
only; asynchronous confirmation awaits public `Session.close`, whose resolved
promise establishes that admitted work settled and Storage closed. Only then may
the identity bind newly opened handles for that same backend. Failed or unresolved
close retains custody; reattachment waits at most one second for confirmation
before refusing. The trusted owner must still preserve backend identity across
process restart.

```ts
import {createChioDurableTools} from "@chio/pi-plugin/durable";

const adapter = await createChioDurableTools({
  storeId, storage, session, provenanceDir, binding, registry,
  executor, originals, transport: nativeGateway, context,
});
durableRegistry.install(adapter.extension);
// Shut down this observer before closing its selected Session/Storage.
```

The actual native ToolRegistrations carry the pinned schemas, sequential
execution and `replay: "unsafe"`. `prepareArguments` checks raw arguments before
native coercion. Execution validates eventual arguments and the actual committed
assistant call again, including changes made by hooks. The native memo binds
store/conversation/task/call to the immutable original request before executor
dispatch. Complete private parent provenance is also persisted before dispatch
because native terminal tasks intentionally discard memos.

The tool renders the full retained outcome in model content and structured
details. Neither execute nor `afterTool` ACKs or waits for its future result
commit. The synchronous `subscribeCommits` callback performs bounded enqueue
only. An asynchronous observer inspects the actual committed native snapshot,
terminal task `result.entryId`, assistant-call arguments and `pi.tool-result`
model content against the selected Storage and independently verified original.
Truncation, details-only values, substituted outcomes, generic interruptions,
context claims and memos do not prove delivery.

Before native `acknowledgeReceivedOutcome`, the observer durably stores the exact
entry reference, commit sequence and entry digest. `adapter.flush()` scans
retained intents and waits for committed-result observation; the extension also
flushes after the generation's tool phase. Restart scans reconcile crashes after
history commit before ACK or after ACK before the mapping mark. Recovery repeats
only the independently verified original ACK and never replays an effect.

For explicit continuation into another actual host, create its pending native
ToolTask and committed assistant call with the exact original tool arguments.
Before scheduling that task, the trusted owner calls:

```ts
await receivingAdapter.bindRecovery({
  taskId, conversationId, callId, request: handoff.originals[0].request,
});
```

This persists the receiving task's original-operation binding. Execution writes
its native memo and reads the verified original, without calling its executor.
Its actual result commit then supplies delivery evidence. Native unsafe recovery
may instead create a generic interrupted result; that result never ACKs. Inspect
the original and use explicit receiving-task recovery to deliver a completion.

An already-delivered original may also be consumed by a different actual store.
The receiving observer verifies its own actual entry and immutable assistant
arguments/full outcome, retains that entry reference in its private intent, then
refreshes the independently verified native original. Only native
`acknowledged === true` and `hostDeliveryConfirmed === true` for that exact
completion permit acceptance without another ACK. The first immutable parent
hostCommit remains unchanged. Unconfirmed, stale or forged delivery claims and
conflicting outcomes retain the conservative refusal; no proof list is appended.

## Bounds and acceptance

Private JSON and transport frames/responses are at most 1 MiB. Handoffs admit at
most 256 originals and 32 KiB of context. Parent and Durable provenance inventories
admit at most 4096 records. The proxy admits 32 pending requests, bounds inbound
framing to 10 seconds and native requests to 40 seconds. Durable committed
observation admits 64 queued tasks and bounded publications; full outcomes are
limited to 256 KiB to fit native entry framing. Exceeding a bound retains native
uncertainty rather than inferring safe retry.

The tests use actual public gateway, signed local fixtures, Durable ToolTask,
memo, Session/Harness, MemoryStorage and fsynced JSONL contracts with two host
instances. Independent counters verify one effect across response loss, imported
continuation and ACK reconciliation. These are component and stock-host checks.
They do not establish current real coding-kernel execution, native owner-result
import, P4 adoption, provider access or whole-guest Linux confinement. See
[Task 4 evidence](superpowers/evidence/2026-10-04-task4-continuation.md).
