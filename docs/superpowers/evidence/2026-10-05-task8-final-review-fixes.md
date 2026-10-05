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
