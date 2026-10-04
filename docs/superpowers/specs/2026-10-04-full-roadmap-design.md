# Chio Pi development-agent roadmap

The user authorized the full roadmap, including new coding resource participants
and cross-host continuation, and requested planning, execution, review, fixes,
a final review, fixes, and an open PR. This design does not replace that scope
with a four-tool adapter refresh.

## Product outcome

A developer can inspect scope and operation state, locate a bug, apply a change
against known source, run a pinned test recipe in confinement, review the change,
and publish a content-addressed artifact through kernel execution. Interruption
preserves the original operation. A second host can inspect or recover that
operation without creating replacement authority or redispatching uncertain work.

The PR must distinguish implemented component behavior, stock-host behavior,
native-kernel acceptance, and unavailable native service prerequisites. The frozen
0.85.1 qualification remains an immutable historical record. A passing local
fixture does not qualify a new kernel, host version, confinement backend, or
semantic-policy profile.

## Ownership

* Pi owns conversation and presentation. The adapter uses Pi's extension, SDK,
  and Durable contracts, disables executable discovery, and exposes only the
  operator-pinned registry.
* The trusted parent owns model credentials, delivery observation, run limits,
  the gateway journal, and operator commands. Model disclosure admission belongs
  at this parent transport boundary because Pi catches provider-hook exceptions.
* Chio owns authority, admission, caller/resource binding, approval, revocation,
  budgets, and signed effect evidence. No local effect may follow a precheck.
* A new coding MCP participant owns repository effects. Its stdio is exclusively
  kernel-owned. Native dispatch metadata supplies operation and caller identity;
  a participant outcome ledger supplies resource-specific replay and CAS.
* Test recipes run arbitrary repository code in a separate filesystem/process/
  network boundary. A recipe allowlist alone is insufficient.

## 1. Current host and typed tools

Pin coding-agent and pi-ai to 1.0.2, record the complete npm lock graph, and retain
the old qualification identity. The registry provides native parameters instead
of a second generic invocation embedded in tool arguments. Retain an explicitly
selected legacy wrapper for comparisons. Standard aliases are `chio_read`,
`chio_write`, `chio_edit`, and `chio_list`; other aliases are deterministic and
collision checked. Schema, name, description, exposure, and mapping are part of
the session binding. The relay validates declarations, choices, calls, and output
history against this same immutable registry. Results keep the complete verified
gateway representation required by delivery ACK.

Native MCP, deferred tools, extensions, skills, user settings, codemode model
services, file/shell tools, and discovery are not implicitly enabled by the
upgrade. Stock-host tests must inspect the actual dispatcher and callable tools.

## 2. Trusted operator surface

Add `chio-pi doctor`, `status`, `inspect`, and `recover`, with readable text and
explicit JSON output. These commands inspect the prepared configuration and
native gateway status without opening a model session. They identify original
request IDs, dispatched unknown effects, approval wait, retained completion,
pending delivery, and safe undispatch. Show invocation/expiry counters only if
the native source exposes them; report unknown otherwise. Never print credentials.

Approval and delivery recovery delegate to the installed bridge's trusted
operator CLI. `recover` describes or executes one explicit native recovery action;
it never deletes a fence, changes a session ID, retries an unknown effect, or
acknowledges merely because an operator listed a result. The bundled bridge does
not include owner-result import; that action requires a compatible separately
qualified native utility and must report unavailable without pretending success.

## 3. Coding resource participant

Ship a separate `chio-coding-resource` stdio MCP entrypoint. It is launched by
Chio as the protected resource owner, never by Pi or its executor. Operator
configuration pins absolute private state, repository root, artifact root, owner
identity, allowed caller-capability digests, bounds, and test recipes.

Implement `read_range`, `search`, `repo_status`, `repo_diff`, `apply_patch`,
`test_recipe`, `publish_artifact`, `repo_context`, and bounded `read_many`.
Arguments have closed schemas. Paths are relative, reject traversal and symlinks,
and stay inside the pinned repository. Search is bounded literal search with
explicit match/truncation limits. Diff/status avoid external Git hooks and
credentials. Patch uses exact expected source digests and all-or-none preparation;
the receipt includes before/after digests. Publication requires the exact
successful test result and source digest, writes an immutable content-addressed
deliverable, and returns its digest and lineage. Publication remains a separate
kernel tool with separate capability scope.

The native `_meta` contract contains `chioRequestId`, `chioOperationId`,
`chioAttemptId`, `chioTransportKeyEpoch`, and `chioCallerCapabilitySha256`.
The operation ID is the kernel's resource dispatch ID, not Pi's logical call ID.
Missing/malformed identities fail before effects. The ledger binds owner, caller,
operation, tool, and canonical arguments. Source generations are immutable;
materialize and fsync a candidate, then commit the current-generation pointer and
terminal outcome in one SQLite transaction. Persist intent before effects, persist
the original result before replying, and replay exact completed results. A crash
after durable intent with no terminal record is unknown and remains fenced.
Conflicting reuse fails. Ledger storage failures never permit a fresh effect.
An unresolved post-intent operation closes the stdio transport without a terminal
MCP response; an ordinary completed tool error would be ACK-able and would lose
the native unknown-outcome distinction. Pre-effect validation refusals can be
retained as known terminal tool errors.
Provide read-only outcome inspection/export for native reconciliation, without
inventing kernel signatures.

Recipes pin executable/argv, source digest, timeout, output bounds, and recipe
digest. On macOS use an actual sandbox-exec child; on Linux use bubblewrap with
unshared network/PID and a private snapshot. Refuse unsupported or missing
confinement. No normal user profile, host credentials, or writable source tree
is exposed to test code. Timeouts kill the process group and preserve uncertainty
where resource effects cannot be proven absent.

## 4. Host-independent continuation and Pi Durable

A handoff file is bounded, private, non-executable context plus original-operation
references and verified outcomes. It carries immutable authority/inventory
identity, exact request/arguments/result digests, and unresolved-operation state.
It contains no capability token, session credential, provider credential, or grant.
Import validates shape, digest, provenance and native outcome binding against the
receiving operator's pinned authority. Different authority refuses adoption.
Unknown work stays fenced; completed work can be delivered as its original result.
Context never authorizes an effect or erases a fence.

Implement native Pi Durable ToolRegistration definitions on version 1.0.2. Map
conversation/task/call identity immutably to the existing KernelRequest identity,
using Durable's persisted memo before execution. Keep replay `unsafe` and provide
explicit original-operation recovery. Recovered completion is verified and never
redispatched. Approval stays pending. Unknown effects remain unknown. Native
history delivery must occur before ACK. Tests exercise the real Durable tool
contract and a second host, with independent effect counts.

## 5. Semantic recovery, disclosure, and delegation

P2 explanation is read-only, scoped, signed advisory information. Verify its
audience, signer, trust domain, issuer and expiry independently before rendering.
Its public view has no workflow ID or private graph digest; current workflow and
source checks belong to the native protected-report path. P3
remedy offers are not grants. A pending proposal resumes the exact original;
frozen denials require an authorized linked continuation; unknown effects
require original-operation reconciliation. Stale/forged offers refuse execution.

Define trusted native-host ports for explanation/remedy, disclosure admission,
artifact adoption, and child submission/cancellation. These ports must consume
native verified authority, never a guest predicate or locally minted permit.
The current bundled bridge cannot attenuate authority; transport tool filtering
is not child capability issuance. Delegation requires the native process runtime
to return independently scoped authority and durable child accounting before the
parent launches an isolated child. Refuse widening and unresolved-child reuse.

Disclosure admission binds exact outbound bytes, provider/account/model, purpose,
labels and lineage. The trusted relay requires verified admission before network
egress when governance is selected, including resumed/compacted history. No
extension hook alone enforces this. Checkpoints and derived artifacts cannot
discard native monotone knowledge. Current P4 archive transfer refuses changed
process/tenant/authority; do not claim cross-authority adoption. P5 real Linux
acceptance remains a native qualification prerequisite. Unavailable native
profiles fail closed and appear explicitly in doctor and qualification documents.

## 6. Context, aggregation, limits, and portability

Repository context is an explicitly requested resource tool result with digest,
provenance and recipe information. It does not load executable discovery or grant
authority. Bounded read aggregation is one admitted participant operation, returns
ordered per-child results and digests, and retains partial truth on failure.
Arbitrary effecting scripts and hidden nested delivery are refused. Pi's native
codemode is not enabled until every partial effect has a compatible ACK contract.

Add parent-enforced wall-clock deadline, provider-request cap, conservative output
token reservations, and provider request timeout. Parent termination never proves
non-dispatch. Enforce limits before forwarding; uncertain reservations remain
spent. Persist limits across resume and pin them in session identity. Provider
profiles are explicit and versioned, preserve fixed routes, and do not silently
switch models after a refusal.

Resource-test Linux confinement is implemented separately from whole-Pi Linux
confinement. Add a whole-Pi bubblewrap backend with unshared network, PID, user,
IPC and mount namespaces, read-only installed runtime, private writable profile,
and only two host Unix sockets. The parent forwards those sockets to the fixed
gateway/model services; guest loopback forwarders use the mounted sockets.
Never expose the operator config, journal, filesystem resource, Docker socket,
or general host network. Unsupported kernels or missing bubblewrap refuse
launch. Record implementation and actual backend probes separately from P5.

## Acceptance and review

Every task gets a failing boundary test, implementation, spec review, quality
review, fixes and a conventional commit. Then run a full independent review,
fix its findings, a final review, fix remaining findings, and fresh typecheck,
tests, package and clean-consumer checks. Include a reproducible vertical coding
fixture: bug reproduction, forbidden path attempt, CAS patch, successful test,
diff, publication, response loss, original result recovery through another host.
Keep fixture/component evidence separate from real kernel and whole-host probes.

No source change in this PR requalifies the frozen candidate. A coverage table
must list all twelve roadmap ideas, implemented entrypoints, evidence commands,
and any concrete external prerequisite. Open the PR from origin/main and preserve
the dirty primary checkout and all historical evidence.
