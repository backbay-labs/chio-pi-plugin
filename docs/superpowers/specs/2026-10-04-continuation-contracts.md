# Trusted original-operation continuation contracts

This specifies Task 4 of the authorized full roadmap. It uses the bundled
bridge's public APIs and Pi Durable 1.0.2. These are adapter custody and delivery
contracts, not a replacement for native authority or outcome verification.

## Before-dispatch mapping

The public `startGatewayHttp` API has no before-dispatch callback. Its native
operation identity includes a randomly initialized MCP session. A trusted,
fixed-target parent proxy must retain the mapping before it forwards a tool
call. The guest receives a separate ephemeral proxy credential and may connect
only to the proxy port. The native gateway port and credential stay inaccessible.

For an ordinary HTTP call, retain these exact identities:

```ts
const rpcId = JSON.stringify([request.sessionId, request.toolCallId]);
const gatewayCallId = `${nativeMcpSession}:${JSON.stringify(rpcId)}`;
const nativeRequestId = `${config.sessionId}:${sha256(canonicalJson({id: gatewayCallId}))}`;
```

The JSON-RPC `id` is the string `rpcId`, not a reparsed array. A `chio_resume`
call retains `arguments.requestId` as the original native identity. The direct
SDK executor has a different identity, `pi:` followed by the SHA256 of the
logical tuple. The resource's 64-character native operation ID is different
again. Never substitute any of these identities for another.

Store bounded, private, durable mapping records under a dedicated subdirectory
of the native journal, such as `pi-parent-mappings`. Root-level `.json` files
are reserved for native operations. Bind the independently prepared authority
digest, immutable registry digest, complete original KernelRequest and canonical
argument digest, exact native MCP/RPC/request IDs, and delivery provenance.
Fsync the record and containing directory before forwarding. A storage failure
forwards no bytes. Existing logical identity never dispatches again, including
after restart or transport initialization. Changed arguments, binding, registry
or malformed state refuse. A retained reservation with no native journal record
remains unresolved; absence does not establish authoritative non-dispatch.

The proxy preserves the native initialization, exact session header, raw RPC
ID and parameters. It fixes the native URL, Host header and authentication,
rejects redirects and arbitrary targets, and exposes only initialization, ping,
tools listing/calls, initialized notification and cancellation. Bound frame
sizes, pending work, responses, and request lifetimes. Failed or ambiguous
initialization never silently creates a replacement transport.

Reject guest `chio/acknowledge` requests. The frozen native HTTP route passes
their delivery proof to `acknowledgeDelivery`, which sets
`hostDeliveryConfirmed`. Receiving a proof in the guest is insufficient evidence
of a native committed host-history entry. Only trusted parent observation can
invoke the public gateway acknowledgement API.

## Original lookup and handoff

A trusted original-operation port looks up a complete immutable KernelRequest;
it has no execute fallback. Join mapping records with the complete native
journal, including operations not represented by a host mapping. Any unresolved
native operation still fences further effects. Do not use a context envelope or
mapping phase as authoritative operation state. Concurrent changes must refuse
or repeat a read-only inspection, never infer completion.

Verify completed outcomes with the native public verifier against the native
retained request. An approved native request includes private approval metadata;
do not reconstruct its request hash from a stripped public request. Full signed
outcomes and delivery proofs retain their exact fields. A public handoff carries
original logical requests, public binding digests, exact verified outcomes,
bounded non-executable context, unresolved identity/state and a content digest.
It contains no capability, bearer, session, provider or approval credentials.
The file has private ownership and modes, bounded reads and atomic durable
creation. Reject special files, links, changed binding, bad signatures and
tampering. A content hash alone does not establish native trust.

Import uses independently pinned receiving authority and trusted native lookup.
Unknown, denied, approval-pending, missing or unverifiable original evidence
does not dispatch a replacement operation or clear a fence. A new host can
recover a verified original completion without creating a new grant. This is
same-authority continuation; it is not cross-authority labeled-artifact adoption.

## Pi Durable 1.0.2

Pin Durable 1.0.2 as an optional exact peer and a development dependency. Expose
it through `./durable`; the base runtime and base declarations must not import
the optional package. Register actual native ToolRegistration definitions with
the immutable registry schemas, sequential execution and `replay: "unsafe"`.

Persist the immutable conversation/task/call-to-KernelRequest mapping with the
native durable memo before executor dispatch. Bind the host store identity so
numeric task IDs from another store cannot alias an operation. Explicit recovery
uses original lookup and native verification, never a freshly generated ID.
Native unsafe recovery may produce an interruption entry; that generic entry
does not acknowledge an external operation.

Neither tool execution nor `afterTool` runs after the native tool-result entry
has committed. Do not ACK from those callbacks or wait there for their own
future entry. The tool-result model content must contain the complete retained
native outcome needed for verification; a details field alone is insufficient.

Use native committed-session observation. `subscribeCommits` is synchronous;
its callback may enqueue bounded work only, without blocking, throwing or calling
Session methods. After the callback, inspect the public committed snapshot/task/
entry contracts. A committed `pi.tool-result` entry and terminal task result
entry ID must match the original conversation, task, call, tool, arguments and
complete outcome in model content. Verify through the trusted original port.
Persist the exact committed entry reference before calling native
`acknowledgeReceivedOutcome`. A truncated result, fake outcome, memo, context
claim, details-only value or generic interruption cannot prove delivery.

On restart, scan committed references and safely repeat only verified original
ACKs. Test crashes after native completion, after history commit before ACK,
and after ACK before the parent mapping mark. None may redispatch an effect.

## Required evidence

Use two actual host instances, the native HTTP gateway protocol, native signed
completion fixtures and actual Durable storage/tool-task/session contracts.
Test pre-forward storage failure, response loss, mapping tampering, changed
connection, unknown and unmapped native fences, special handoff files, approved
request verification, guest ACK refusal, post-commit delivery observation and
restart scanning. Count effects independently of host and ledger claims.
Keep these component and stock-host results distinct from current real-kernel
qualification and cross-authority adoption acceptance.
