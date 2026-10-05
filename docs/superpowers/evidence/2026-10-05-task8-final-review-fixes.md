# Task 8 final review fixes

Fix wave for the whole-range review at `ead477e`. Fixers ran one area at a
time; each section records its findings, changes and commands. Earlier task
evidence and qualification records are unchanged. This is component and
stock-host evidence. It does not qualify a real kernel, P4, P5 or ordinary
Docker defaults.

## Area A2: continuation, Pi Durable, parent proxy and operator

Findings fixed: A2-C1, A2-I1, A2-M1, A2-M2, A2-M3, A2-M4, A2-M8, plus the
Task 7a deferred roadmap workflow items (`deliveredBy`, `flushError`,
`closeErrors`). A2-M5, A2-M6 and A2-M7 remain follow-ups.

### A2-C1: one undelivered intent disabled the whole Durable store

Before: every observation failure was retained as one adapter-wide failure.
After it, every later `execute`, every `afterTools` flush and a reopened
adapter's first flush rejected. The reviewer's three triggers reproduced on
the unchanged build: a second call in one sequential round was refused by the
parent fence before its predecessor's ACK; an approval-pending result no
longer matched its original once `chio_resume` completed it; a failed or
interrupted task stayed fatal after its original was recovered elsewhere.

Now:

- Each terminal task is classified once and the result is persisted in its
  private intent: `acknowledged`, `denied`, `approval-pending`, `superseded`,
  `not-dispatched` or `undelivered`. A marker never clears, replaces or
  establishes a native fence; nothing is acknowledged for `undelivered`.
- A verification or ACK failure stays with its own intent, is observed again
  by a later flush or dispatch, and never disables other intents, later calls
  or a reopened adapter. `flush()` rejects only with failures from its own pass.
- Before each fresh dispatch the adapter observes already-committed results of
  its intents, so a sequential round's second call is not fenced by the first.
  If the joined native inventory still fences fresh effects (shared
  `admitsDispatch` rule, identical to the proxy's), the call returns a
  `not_dispatched` error result without retaining an intent or calling the
  executor. An executor refusal with no parent reservation is recorded as
  `not-dispatched`.
- A committed pending proposal first observed after its mapped explicit
  `chio_resume` completed is recorded as `superseded`, without ACK.
- Preserved: memo before the first executor call, `replay: "unsafe"`, explicit
  recovery never dispatches, ACK only after the exact committed entry is
  verified and its reference retained, and every native fence.

Intent directory listing and writes now share one line. The unchanged build
also showed a listing that observed another write's atomic temporary file
("intent inventory is invalid or interrupted").

### A2-I1: flush cost grew with retained history

Reconciled intents are never observed again; later flushes read only newly
created intent files. `retainHostCommit` performs one native lookup instead of
two, and `acknowledgeCommitted` skips the native call when the exact
completion is already acknowledged and host-delivery-confirmed, recording only
the missing parent mark. Reviewer scale script (12 calls, flush after each,
Homebrew Node v25.5.0, built `dist`): before 1.4 s, 2.6 s, 5.0 s, 9.2 s, 18.4 s; after 0.58 s, 0.81 s, 0.53 s,
0.63 s, 0.67 s. The committed regression counts adapter-to-port native calls
per flush: unchanged build `[6, 9, 12, 15]`, fixed `<= 3` each, and 0 for
further flushes.

### Minor findings

- A2-M1: doctor no longer calls the coding resource and Durable continuation a
  later roadmap task; both read "not exposed by these operator commands" with
  the guide path. The same stale sentence in `TYPED-TOOLS.md` now links
  `CONTINUATION.md`.
- A2-M2: the proxy's pre-reservation refusals (fence, resume without its
  pending proposal, closed proxy) return a native-style `not_dispatched` tool
  result with identity metadata. The guest adapter no longer marks itself
  unresolved for them. Malformed input keeps its JSON-RPC errors.
- A2-M3: a queued call whose guest connection closed is neither reserved nor
  forwarded.
- A2-M4: the proxy refuses a prepared native execution `timeoutMs` above 30000
  (its own and the guest's fixed 40 s deadlines). `CODING-RESOURCE.md` and
  `CONTINUATION.md` document the bound for recipe timeouts.
- A2-M8: a native operator child that ignores SIGTERM receives SIGKILL after
  2 s; settlement still waits for the observed close.

### Roadmap workflow (Task 7a deferred)

The workflow test now requires every step to report
`deliveredBy: "commit-observer"`, and the qualification command has a matching
check. The first host's lost publication is pinned: task `failed`,
`flushError` null, reconciliation `undelivered`, native original unacknowledged
and fenced. Both scenarios assert empty `closeErrors`. The uncertain scenario
records the parent's definite `not_dispatched` replacement refusal.

### RED and GREEN

RED, unchanged `ead477e` build, Homebrew Node v25.5.0:
`node --test --test-name-pattern "A2-" test/durable.test.mjs
test/continuation.test.mjs test/operator.test.mjs` failed 10 of 10, and the
extended doctor assertion failed on "later roadmap task". The M8 case timed
out at 20 s.

GREEN, Homebrew Node v25.5.0 (npm 11.8.0), macOS arm64:

- Same selection plus the doctor test: 11 of 11.
- `node --test test/durable.test.mjs test/continuation.test.mjs
  test/operator.test.mjs test/http-executor.test.mjs`: 161 of 161.
- `node --test test/roadmap-workflow.test.mjs` (real Seatbelt confinement):
  5 of 5; every step reported `commit-observer`.
- `npm run typecheck`: clean. `npm test`: 405 of 405, no skips, no flake.
- The reviewer's four repro scripts and a faux-model two-call generation run:
  every later call and reopened flush succeed, with one effect and one ACK per
  dispatched original.

Linux: pinned image
`sha256:6d5bbc54ae9fd29177042755c41667006b708874c7ed6d489d543e931e33fe23`
(Node 22.23.1, bubblewrap 0.8.0, arm64), disposable
`docker run --rm --privileged --network none` with the worktree mounted
read-only, `node test/helpers/coding-linux-runner.mjs
test/roadmap-workflow.test.mjs test/durable.test.mjs test/continuation.test.mjs`:
128 of 128. The privileged outer container is needed for nested namespaces on
this VM; it does not qualify ordinary Docker defaults or P5.

Remaining limitation: concurrent conversations in one store can receive a
definite `not_dispatched` result while another original awaits its committed
delivery. It is safe and documented, not queued.

## Area A1: typed host, relay, governance, host delivery and configured path

Findings fixed: A1-I1, A1-M1, A1-M3, A1-M4, A1-M5, A1-M6, A1-M7. A1-M2 is
documented only (no reconcile API exists). The Task 7a schema recompilation
per native lookup remains a performance follow-up.

### A1-I1: one rejected model call broke the session permanently

Before: the relay resolved every historical `function_call` against the
pinned registry and threw on any failure. Pi 1.0.2 keeps a call it refused
before dispatch in history and continues the loop, so every later request
carried that call and the relay answered 502 forever, including after resume.
The reviewer's probe reproduced on the unchanged build with the installed Pi
1.0.2, the built relay and a scripted first turn: for `chio_read {path: 7}`
(Pi coerces the number, the Chio binding guard blocks it) and for the unknown
alias `read_file`, zero dispatches and zero upstream requests; the automatic
follow-up and a later prompt both ended `OpenAI API error (502)`. A valid-call
control reached upstream.

Now `validateModelRequest` records a call that does not resolve (unknown
alias, invalid JSON, schema-invalid or normalized arguments, legacy wrapper
naming a tool outside the inventory) as undispatchable instead of throwing.
Its output must not parse as any Chio outcome representation (completed,
denied, the prefixed tool-error form, or any other JSON), and it is never
handed to the delivery observer. The function returns the outcomes to observe,
taken only from calls that resolve, and the relay passes exactly those to
`onToolResults`. Preserved for every call: duplicate call identities, an output
without its call and a second output for one call still refuse. Preserved for
calls that resolve: exact declarations and tool choices, and the full outcome
binding (receipt tool, canonical arguments, request ID, `chio_resume` original
and request identity).

The regression runs real Pi 1.0.2 turns: only the first model turn is
scripted, then Pi's own OpenAI Responses provider sends the follow-up through
the built relay to a stubbed upstream, the session is prompted again, then
resumed from its retained file and prompted once more. Typed cases: coerced
argument blocked by the binding guard, unknown alias, schema-invalid arguments,
and a call salvaged from a truncated (`length`) message. Legacy cases: wrapper
naming a tool outside the inventory, wrapper with schema-invalid inner
arguments, unknown alias. Each asserts zero dispatches, Pi's refusal text in
history, three upstream requests and no delivery observation. Typed and legacy
valid-call controls assert one dispatch and the exact observed outcome on all
three requests. Unit cases cover forged completed, denied, prefixed, pending
and `null` outputs on undispatchable calls (refused before observation or
egress) and the unchanged call identity rules.

### Minor findings

- A1-M1: the host delivery observer keeps serializing confirmations, but a
  failed ACK or denial verification fails only its own request. A later
  request re-checks its outcomes instead of inheriting the old rejection.
- A1-M2 (documented): `NATIVE-COMPATIBILITY.md` states which native results
  leave the in-process release interlock set and that the embedding and relay
  must be recreated after native reconciliation of the original release.
  Recreation never establishes native non-dispatch.
- A1-M3: a required relay refuses to start without both its trusted native
  embedding and its durable run budget, so every governed release carries the
  enforced profile and limits identities. Previously it started without an
  embedding and answered 502 to every request, or without a budget and left
  those identities unchecked.
- A1-M4: `pi-host.binding` and `authority.binding` are published through a
  private exclusive temporary, file fsync, `link` and directory fsync. An
  interrupted write leaves no binding (previously an empty file that refused
  every later launch with `EEXIST` or a JSON parse error).
- A1-M5: the direct prepared-config executor refuses an `approval`
  configuration. It has no gateway journal, retained proposal or explicit
  resume contract, so `chio_resume` was declared but always "outside operator
  allowlist". Approval stays with the protected launcher's gateway.
- A1-M6: `chioExtension(executor, registry)` requires an operator-pinned
  registry and throws when it is omitted or forged, instead of registering no
  tools.
- A1-M7: runtime replacement sessions preflight only their
  `runtime_replacement` target. The stale startup target is dropped from the
  replacement options, and the factory's own check is consumed once rather than
  repeated (startup previously checked the startup target twice).

### Existing tests changed

`test/governance.test.mjs` and `test/governance-lifecycle.test.mjs` started
required relays without a budget. Their fixtures now open a durable
`required` run budget and pin its profile and limits identities in the
embedding. The two tests that started a required relay without an embedding
now assert the startup refusal with zero provider bytes; the caller-mutation
test uses a complete composition and asserts the native release path is still
taken after the caller mutates its governance object.

### RED and GREEN

RED, unchanged build, Homebrew Node v25.5.0:
`node --test test/typed-relay.test.mjs` failed 10 of 16 (every undispatchable
case; both real-Pi valid-call controls passed). Each new A1-M1, A1-M3, A1-M4,
A1-M5, A1-M6 and A1-M7 test failed on the unchanged code (stuck confirmation
chain, relay started, empty `authority.binding` left, missing approval
refusal, no exception, startup target checked twice).

GREEN, Homebrew Node v25.5.0 (npm 11.8.0), macOS arm64:

- `node --test test/configured.test.mjs test/host-contract.test.mjs
  test/governance-lifecycle.test.mjs test/governance.test.mjs
  test/host-delivery.test.mjs test/typed-relay.test.mjs test/model-relay.test.mjs
  test/model-limits.test.mjs test/tool-registry.test.mjs
  test/governance-cli.test.mjs`: 129 of 129.
- The reviewer's probes on the fixed build: the malformed and unknown-alias
  sessions reach upstream on the follow-up and the later prompt, exactly like
  the valid-call control.
- `npm run typecheck`: clean. `npm test`: 423 of 423, no skips, no flake.

Linux: pinned image
`sha256:6d5bbc54ae9fd29177042755c41667006b708874c7ed6d489d543e931e33fe23`
(Node 22.23.1, arm64), disposable `docker run --rm --network none` with the
worktree mounted read-only at `/input`. No namespaces are needed for these
suites, so the container is not privileged. The shared Docker VM was under
heavy memory pressure from other long-running services during this run;
module loading took many minutes per process, so suites ran in-process:

- `node test/configured.test.mjs`: 6 of 6, including both new A1 tests
  (atomic binding publication and the approval refusal).
- `node --test --experimental-test-isolation=none test/typed-relay.test.mjs
  test/host-delivery.test.mjs test/governance.test.mjs
  test/governance-lifecycle.test.mjs test/model-relay.test.mjs
  test/model-limits.test.mjs test/tool-registry.test.mjs`: 100 of 101. Every
  A1 test passed, including all nine real Pi 1.0.2 follow-up cases. The one
  failure is the unchanged doctor test (`governance.test.mjs:155`): its native
  operator child hit the operator's fixed 45 s deadline while the VM was
  thrashing (`native_operator_refused` after 1160 s). It passes in the host
  full suite and is outside this area's changes.
- An earlier serial `node --test --test-concurrency=1` attempt reported
  `configured.test.mjs` failed at file level after 1174 s with no subtest
  output; the direct rerun above passed 6 of 6.

`test/host-contract.test.mjs` (the A1-M6 argument check) and
`test/governance-cli.test.mjs` were not run on Linux; both changes they cover
are platform-neutral and pass on the host.
