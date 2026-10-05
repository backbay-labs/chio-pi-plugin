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

## Area B: coding resource participant, ledger, repository and recipes

Findings fixed: B-I1, B-I2, B-I3, B-I4, B-I5, B-M1, B-M2, B-M3, B-M4, B-M7,
plus the Task 7b deferred Seatbelt regression broadening and the four macOS
runtime-closure tests. B-M5 (recipe disk and memory bounds) and B-M6 (scoped
search refusing on a binary or overlong first line) remain follow-ups.

### B-I1: leftover job files fenced the resource

Before: after the recipe process group was proven gone, any failure to remove
the job tree became a post-intent `FatalResourceError`, so the test operation
never completed and every later call closed the transport. Reproduced with real
`sandbox-exec`, the production policy and Homebrew Node 25.5.0: a test leaving
`TMPDIR/fixture` at mode 0500 with a file inside (EACCES), and a test removing
its own TMPDIR (ENOENT). A non-Node executable under the same policy could also
set `uchg` on job output with `chflags`.

Now `removeJob` runs only after proven group absence, as before. It treats an
absent job root as removed, restores owner `rwx` on directories found by `lstat`
(never following links) and retries, and renames a tree that still cannot be
removed to `quarantine-<job>-<uuid>` inside the private job root, then fsyncs
it and completes. A failed quarantine rename still fences. The Seatbelt policy
adds `(deny file-write-flags file-write-acl)`, so job output cannot gain owner
flags or ACLs that the owner could not clear; Node file operations including
`copyFile` (which copies flags and ACLs when allowed) still work. Unproved group
absence is unchanged and still fences.

### B-I2: a crash inside a commit made the ledger unreadable

Before: a hot `ledger.sqlite-journal` made the read-only pre-check of `serve`
fail with SQLite extended code 776 (`SQLITE_READONLY_ROLLBACK`), so serve never
reached the locked read-write open that rolls it back; `inspect` and `export`
failed with "attempt to write a readonly database".

Now a read-only open maps 776 to an explicit error naming the journal and
saying never to delete it. `serve` treats it as rollback needed and continues
to the exclusive owner lock and read-write open, where SQLite rolls back and the
ledger identity and generations are verified as before. `inspect` and `export`
stay read-only and refuse with that message. `CODING-RESOURCE.md` documents
never deleting `ledger.sqlite-journal` and the recovery order (recover a
proven-dead owner lock, then serve).

### B-I4: the ledger became unopenable at 256 MiB

The ledger and its sidecars are now validated by `privateFileIdentity`: no-link
path walk, `lstat`, nonblocking `O_NOFOLLOW` open and `fstat` (type, owner, mode,
link count, device and inode), with no read and no size cap. No growth cap was
added; disk bounds remain the B-M5 follow-up.

### B-I3: results over the 1 MiB canonical limit closed the transport

Tool results, diffs, repository context, read and read_many children and search
matches are now sized with plain JSON byte length (equal to the canonical length)
before canonical encoding, so they return their documented `result_bound`,
`diff_bound`, `context_bound`, `read_many_bound` or truncation outcome. A
candidate whose manifest would exceed the limit is `source_bound` (a patch adding
long paths to a near-limit manifest previously closed the transport too). The
operation binding is guarded the same way.

### B-I5: literal edits stripped a UTF-8 BOM

Source text is decoded with `ignoreBOM: true`; reads, diffs and edits keep a
leading U+FEFF.

### Minor findings

- B-M1: the JSONL reader now accepts lines up to a fixed ceiling of 1 MiB of
  arguments plus the largest request envelope (`MAX_REQUEST_FRAME_BYTES`), which
  covers every argument object Chio's 1 MiB canonical binding admits. Arguments
  whose canonical size plus that envelope exceed `maxInputBytes` receive an
  unledgered `input_bound` tool error, like `invalid_arguments`; exact retained
  replay is checked first. Longer or malformed lines still close the transport.
  The worst-case reader memory is unchanged, since `maxInputBytes` could already
  be 1 MiB.
- B-M2: an unpaired surrogate in a replacement or edit, including an `oldText`
  that splits a pair, is a retained `invalid_patch`.
- B-M3: a missing, replaced or permission-changed pinned executable, runtime
  file or dependency chain is a retained `recipe_pin`; a missing or unsafe
  `sandbox-exec` or `bwrap` is `unsupported_sandbox`.
- B-M4: Linux recipes run with bubblewrap `--disable-userns` (supported by the
  pinned 0.8.0), and the recipe seccomp filter also denies `unshare` (arm64 97,
  x64 272) and `io_uring_setup`/`enter`/`register` (425 to 427 on both).
- B-M7: `serverInfo.version` is read from the installed `package.json`.
- Task 7b: the Seatbelt regression parses the policy and requires a filter list
  in every `allow` (including multi-operation rules) and a nonempty
  `require-any`/`require-all`/`require-not`; it checks the checker against
  filterless and empty forms and, on macOS, the actual policy for the running
  Node. The four macOS closure tests now skip with a reason when the running Node
  lacks the non-system dylibs they need (`extra` needs none and still runs).
- `RUN-LIMITS-LINUX.md` no longer calls the recipe filter "unchanged"; it links
  the recipe confinement section.

### Existing tests changed

The framing test now writes `MAX_REQUEST_FRAME_BYTES + 1` bytes, since a line
just over `maxInputBytes` is now read and answered. The Seatbelt regex test was
replaced by the structural check above. The closure tests no longer assert a
closure inside the test body. The fixture helper accepts an executable and argv
and caches macOS runtime pins per executable.

### RED and GREEN

RED, unchanged `src` at `ddfac37` with the new tests, Homebrew Node v25.5.0:
`node --test --test-name-pattern "B-I|B-M|Seatbelt|macOS runtime closure|macOS
recipe policy|bounded framing|x32" test/coding-resource.test.mjs
test/coding-confinement.test.mjs` ran 26 tests: 20 failed, 5 passed (the four
closure fixtures on this Homebrew Node and the original x32 test), 1 skipped
(Linux only). Each new regression failed for its finding: closed transports for
B-I1, B-I3, B-M1 and B-M3; "attempt to write a readonly database" instead of a
named journal (B-I2); inspect exit 1 on the 300 MiB ledger (B-I4); the BOM lost
(B-I5); surrogate patches applied (B-M2); syscall 425 allowed (B-M4); version
"0.1.0" (B-M7); no flags rule and `chflags uchg` succeeding under the policy.

GREEN, Homebrew Node v25.5.0 (npm 11.8.0), macOS arm64:

- Same selection: 25 passed, 1 skipped.
- `node --test test/coding-resource.test.mjs test/coding-confinement.test.mjs`:
  103 tests, 102 passed, 1 skipped (the Linux-only unshare probe).
- System-only Node v26.7.0 (no non-system dylibs),
  `node --test test/coding-confinement.test.mjs`: 15 passed, 4 skipped (three
  closure fixtures with their reason, plus the Linux probe), 0 failed.
- `npm run typecheck`: clean. `npm test`: 442 tests, 441 passed, 1 skipped,
  0 failed, no flake.

### Linux

Pinned image
`sha256:6d5bbc54ae9fd29177042755c41667006b708874c7ed6d489d543e931e33fe23`
(Node 22.23.1, bubblewrap 0.8.0, arm64), disposable
`docker run --rm --privileged --network none` with the worktree mounted
read-only at `/input`. The privileged outer container is needed for nested
namespaces on this VM; it does not qualify ordinary Docker defaults or P5. The
shared Docker VM was heavily loaded by other work (load average up to about 200,
3.8 GiB nearly full), so suites ran one file at a time.

- Bubblewrap layer alone, no seccomp: `bwrap --unshare-all --unshare-user
  --disable-userns ... /usr/bin/unshare --user /nonexistent-probe` printed
  "unshare failed: No space left on device"; the same command without
  `--disable-userns` created the namespace and failed only to execute the absent
  command (exit 127).
- `node test/helpers/coding-linux-runner.mjs test/coding-confinement.test.mjs`:
  15 tests, 12 passed, 2 skipped (macOS only), 1 failed. Both B-I1 triggers, the
  publication `diff_bound` and the real B-M4 probe (a `/usr/bin/unshare` recipe
  under the full sandbox reports "unshare failed: Operation not permitted")
  passed. The failure is the known `real recipe output bounds` flake (`timeout`
  instead of `output`, 300 ms recipe timeout).
- `node test/helpers/coding-linux-runner.mjs test/coding-resource.test.mjs`:
  85 tests, 84 passed, 1 failed: the unchanged FIFO sidecar test's `inspect`
  exceeded its 1 s kill timeout under that load. A rerun of it passed.
- Control for the output-bounds test: the same test against a `ddfac37` build
  (no `--disable-userns`, original filter) failed identically twice in the same
  VM. A direct timing probe of the production bubblewrap argv measured the same
  first-output latency with and without `--disable-userns` (median 30 ms, 8 runs
  each). A participant probe showed the sandboxed Node sometimes not starting
  within 300 ms right after the pre-launch executable hash, so this is the
  existing load-sensitive flake, not a change from this area.

## Area C: protected launcher, run limits, Linux guest, relays, termination and release tooling

Findings fixed: C-I1, C-I2, C-M1, C-M2, C-M3, C-M4, C-M5, C-M7, C-M8, plus the
Task 6 and Task 7b deferred items in scope (bounded marker read, guide wording,
lock integrity, CI evidence upload, release ordering sentence). C-M6 is
documented. The remaining Task 7b items stay follow-ups.

### C-I1: the Linux model relay bearer was in bubblewrap argv

Before: `prepareLinuxGuest` turned every guest environment entry into
`--setenv KEY VALUE`, including `CHIO_PI_MODEL_TOKEN`, so the bearer for the
parent model relay was in the long-lived bubblewrap process's world-readable
`/proc/<pid>/cmdline`.

Now the launcher passes the bearer only as `secrets`. `prepareLinuxGuest`
refuses credential-like names (`CHIO_PI_MODEL_TOKEN`, `CHIO_PI_SECRET_FD`, and
names containing TOKEN, SECRET, PASSWORD, CREDENTIAL or API_KEY) as bubblewrap
environment, adds only `--setenv CHIO_PI_SECRET_FD 4`, and returns a bounded
JSON payload. The launcher spawns bubblewrap with that payload on an inherited
pipe at descriptor 4 and an environment without the bearer. The guest bootstrap
(`dist/linux-guest.js`) requires a socket or FIFO there, reads it to end of file
(4 KiB bound), closes it, sets the value in its own process environment and only
then imports the Pi CLI. Its error text never echoes values. The macOS guest
keeps the bearer in its owner-only environment, as before. The gateway proxy
bearer stays in the private transport file.

### C-I2: a macOS guest outlived a parent ending by anything but SIGINT/SIGTERM

- `superviseGuest` treats SIGHUP and SIGQUIT like SIGTERM and adds an `exit`
  hook that sends group SIGKILL while the guest runs, which covers an uncaught
  exception in the parent. An optional `abort` signal stops the guest.
- After spawning, the launcher records the guest process group in the run owner
  lock (`owner.json`, `guestProcessGroup`). Stale-owner recovery now refuses
  while that group exists or cannot be proven gone (ESRCH required, EPERM
  refuses), both before and inside the exclusive recovery section. A failure to
  record stops the guest and refuses the run.
- Best effort for a parent killed by SIGKILL on macOS: the guest's stdin is a
  pipe held only by the parent and `CHIO_PI_PARENT_LIFELINE_GRACE_MS` carries the
  graceful-kill interval. The guest CLI arms `exitWithParent` first; when the
  pipe closes it stops as on SIGTERM and exits 143 after the interval even if
  it ignores that request. The handle is unreferenced, so it never keeps a
  finished guest alive. Linux keeps bubblewrap's `--die-with-parent`.

### Minor findings

- C-M1: two defects, not one. The relay disconnected when a read plus the
  peer's queue exceeded the bound, and a cleanly ended side's `close` destroyed
  its peer while bytes were still queued, losing the tail of every large
  transfer. Now the queue bound is the pause threshold (the source resumes in
  the flushed write's callback, so a queue stays under the bound plus one read),
  only a queue already over the bound disconnects, and a cleanly ended side
  closes after its peer finishes. The idle timeout is configurable; the
  launcher uses the larger of 120,000 ms and the provider timeout plus
  10,000 ms on both relay ends.
- C-M2: `superviseGuest` swallows EPERM as well as ESRCH inside its timer,
  signal and exit callbacks and arms escalation before signalling. EPERM is
  what macOS reports for a group of unreaped zombies; it previously escaped as
  an uncaught exception from the trusted parent and skipped escalation and
  cleanup. This is the cause of the recurring guest-termination EPERM flake.
- C-M3: the whole-guest filter also denies `ptrace`, `process_vm_readv`,
  `process_vm_writev` and `pidfd_getfd` (arm64 117, 270, 271, 438; x64 101,
  310, 311, 438), so a guest cannot drive bubblewrap's unfiltered PID 1. The
  x32 refusal still precedes the list.
- C-M4: the run record is opened first and the ownership marker is then
  published through `writePrivateJson` (exclusive temporary, file fsync, link,
  directory fsync). A refusal or crash between them leaves no marker without a
  record. An empty profile whose record exists resumes that record and is not
  recreated (previously a raw EEXIST forever). An existing marker is read with
  the bounded private reader (4 KiB, single link, no follow).
- C-M5: `--limits` and `--linux-runtime` files inside the profile, the
  disposable workspace or the installed tree refuse before any profile write.
- C-M6 (documented): `OPERATOR.md` gives the manual stale run-limits lock
  procedure, linked from `RUN-LIMITS-LINUX.md`.
- C-M7: the launcher removes its control directory after the guest exits; the
  macOS runtime record carries the exact policy text, and
  `scripts/probe-sandbox.mjs` uses it (hash checked) instead of the removed
  file. `scripts/qualify-linux-guest.mjs` removes its scratch directory and its
  probe image tag on every path.
- C-M8: a Linux-only test pins the actual `prepareLinuxGuest` argument vector
  (option vocabulary, exact bind list, exactly two socket sources, environment
  keys, no secret). The Linux runtime record reports `seccompSha256` and a
  `profileSha256` over the launcher, complete argument vector and BPF hash. The
  guest bootstrap reports its bounded failure reason.
- Deferred items: `RUN-LIMITS-LINUX.md` says "before any parent write into the
  profile" and the long line is rewrapped; `qualify-release.mjs` fails a
  consumer lock without integrity (`consumerLockProblems`); the CI and release
  consumer evidence upload fails only when qualification succeeded without
  evidence; `RELEASE-QUALIFICATION.md` states the release job ordering.

### Existing tests and harness changed

`test/unix-relay.test.mjs`, `test/guest-profile.test.mjs`,
`test/qualify-release.test.mjs` and the others only gained cases; the
launcher test's `launch` helper accepts alternative pins and environment. The
Linux runner (`scripts/linux-guest/runner.mjs`) now delivers the SDK session's
bearer on descriptor 4 with a random value, records the model request's
Authorization header, samples every `/proc/<pid>/cmdline` and `environ` during
each launch, adds the four cross-process syscall probes, and runs the installed
`chio-pi` launcher's Linux branch against the scripted kernel fixture from
`test/helpers/continuation-fixture.mjs` with an unreachable provider. Its
non-termination guest walls are 600 s and the hung-guest wall is 5 s
(previously 10 s and 500 ms): at a VM load average near 140, guest launches
were killed at a 10 s wall twice and at a 120 s wall once before producing
output. The termination assertions are unchanged.

### RED and GREEN

RED, unchanged `04b1e0d` code with the new tests, Homebrew Node v25.5.0, macOS
arm64:

- `node --test test/guest-termination.test.mjs`: 7 of 10 failed. The EPERM case
  threw `kill EPERM` out of the supervisor; guests survived parents ending by
  SIGHUP, SIGQUIT and an uncaught exception; `exitWithParent` was missing; the
  shipped guest CLI kept running after its parent was SIGKILLed.
- `node --test --test-name-pattern "C-I2" test/run-limits.test.mjs`: 2 of 2
  failed (recovery admitted a second owner beside a live recorded guest group;
  no `recordGuest`).
- `node --test test/linux-sandbox.test.mjs`: the C-M3 case failed on arm64
  `ptrace`; the descriptor case failed (module missing).
- `node --test test/guest-profile.test.mjs`: 7 of 16 failed: guest-writable
  limits accepted, a marker left without a record after an early refusal, raw
  `EEXIST` after a guest emptied its profile, oversized and hardlinked markers
  accepted, and a `cp-*` control directory left in `TMPDIR`.
- `node --test test/unix-relay.test.mjs`: the small-bound transfer received 0
  of 1 MiB, the default-bound transfers each lost the final 65,536 bytes, and
  `relayBounds` was missing.
- `node --test --test-name-pattern integrity test/qualify-release.test.mjs`:
  failed (no lock check helper; absent integrity passed).
- Pinned Linux image, `docker run --rm --network none`, read-only worktree at
  `/input`: the argument-vector test failed with an AssertionError on the
  unchanged code.

GREEN, Homebrew Node v25.5.0 (npm 11.8.0), macOS arm64:

- `npm run typecheck`: clean. `actionlint` 1.7.12 on both workflows: clean.
- Focused: `node --test test/run-limits.test.mjs test/model-limits.test.mjs
  test/unix-relay.test.mjs test/linux-sandbox.test.mjs
  test/guest-termination.test.mjs test/governance-cli.test.mjs
  test/guest-profile.test.mjs`: 72 tests, 71 passed, 1 skipped (Linux only).
- A control probe under the real Seatbelt policy kept a lifeline guest running
  for 3 s, then on lifeline close saw its SIGTERM request and exited 143 after
  212 ms.
- `npm test`: first run 465 tests, 462 passed, 2 skipped, 1 failed: the known
  `real recipe output bounds` flake (`timeout` instead of `output`) in
  `coding-confinement`, outside this area. Rerun: 465 tests, 463 passed,
  2 skipped (both Linux only), 0 failed. A third run without rebuild (same
  `dist`) also passed 463 with 2 skipped. No guest-termination EPERM appeared
  in any run.

Linux, pinned image
`sha256:6d5bbc54ae9fd29177042755c41667006b708874c7ed6d489d543e931e33fe23`
(Node 22.23.1, bubblewrap 0.8.0-2+deb12u1, arm64, kernel 6.8.0-64-generic):

- Unit suites, disposable `docker run --rm --network none`, read-only worktree
  at `/input`, `--workdir /input`, no privilege (no namespaces needed):
  `node --test test/run-limits.test.mjs test/model-limits.test.mjs
  test/unix-relay.test.mjs test/linux-sandbox.test.mjs
  test/guest-termination.test.mjs test/governance-cli.test.mjs
  test/guest-profile.test.mjs`: 73 tests, 72 passed, 1 skipped (Seatbelt
  only), 0 failed, in 1,417 s. This includes the actual `prepareLinuxGuest`
  argument-vector test and the three Linux `C-M5` cases.
- Whole-guest acceptance in disposable `--rm --privileged --network none`
  containers. `node scripts/qualify-linux-guest.mjs` started, but its
  `docker build` of the probe image stalled for 30 minutes on registry
  metadata while the VM was saturated (load average about 140, under 200 MB
  available, the user's long-running containers left untouched), so it was
  cancelled. That exercised the script's new failure path: its scratch
  directory was removed. The same steps then ran by hand with the existing
  Task 6 probe image
  `sha256:8ea000bcc1b93efd77f20fdf059eab1e9950b6210c0837124c3d5d3cb5099c82`
  (unchanged `probe.c` SHA-256 `0d61377b...6dad8`, addon SHA-256
  `b9ba696a...32de3`, both equal to the Task 6 record): extract the addon with
  `--network none`, then `node /input/scripts/linux-guest/runner.mjs` in the
  pinned image with the worktree and addon mounted read-only. Three earlier
  attempts failed only at a guest wall (10 s twice, 120 s once; the SDK attempt
  had already received the session prompt); a diagnostic copy with a 60 s SDK
  wall then passed every stage on the same product code, with the SDK session
  completing in 13.9 s. The committed runner then passed every assertion
  (exit 0). The
  [machine-readable result](2026-10-05-task8-area-c-linux-result.json) records
  it. Highlights: the whole-guest probe saw all five namespaces differ, both
  routes, and EPERM for `ptrace`, `process_vm_readv`, `process_vm_writev` and
  `pidfd_getfd` in addition to the earlier denials; the SDK session completed
  with three gateway and two model requests and the model request carried the
  FD4 bearer, while 492 samples of every process command line and environment
  (980 bubblewrap command lines) never contained it; the installed launcher's
  Linux branch reported `seccompSha256` equal to the compiled arm64 filter,
  reserved exactly one request (the relay checks the bearer first), released
  its owner lock and left no `cp-*` directory, with no bearer name in 465
  samples; the confined wrapper exited by SIGTERM, the raw ignoring child by
  SIGKILL, and the observer found no survivors and no zombies.

Compiled whole-guest BPF, superseding the Task 6 hashes for the current code
(the Task 6 record is unchanged):

- arm64, 47 instructions:
  `d00965ae3ff6ab335a5821438e016df5ce92233eebb51eb2503f7aa7808c4119`
  (Task 6: `9b1c9a8f...e4f4a`). Measured in the guest above.
- x64 component, 53 instructions:
  `2d9d366003bb02e85c53eefa20da39339fbb45f381756c8d125d2c3f15820a5f`
  (Task 6: `0ed82883...a3364`). Evaluated by the unit tests only; actual x64
  runtime remains unmeasured.

The privileged outer container is needed for nested namespaces on this VM; it
does not qualify ordinary Docker defaults, another installation or native P5.
No provider, native kernel or credential was used. Eight `chio-pi-task6-probe`
tags leaked by earlier Task 6 runs and one Task 6 scratch directory beside the
worktree remain; they predate this fix and were left in place.
