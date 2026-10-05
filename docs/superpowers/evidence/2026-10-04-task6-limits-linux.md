# Task 6: Trusted parent limits and whole-Pi Linux confinement

Implementation scope: Task 6 of the authorized full roadmap, on
`feat/pi-full-roadmap-20261004`, starting from reviewed `7d971e8`. The primary
checkout, frozen bridge/operator/qualification artifacts, Task 3 recipe filter,
Task 4 original mappings/committed-history ACK semantics, and Task 5 native-owned
provider release are preserved. Task 7 release/workflow and Task 8 PR work are
outside this change.

Confidence: high for the listed component checks and this measured local arm64
boundary. Native coding/P5 acceptance, actual x64 runtime, ordinary Docker defaults
and live provider/kernel acceptance remain open.

## Behavior and verification

Durable parent accounting explicitly creates once under a dedicated journal
subdirectory outside the native root `.json` namespace. Authority, registry,
absolute profile identity, mode, fixed versioned provider profile, operator
limits and original absolute deadline bind resume. Counter integrity, private
owner/regular/single-link checks, bounded NOFOLLOW reads, exclusive owner and
exclusive stale-lock recovery, and atomic file/directory fsync protect state.
Host/boot/PID-namespace binding precedes local dead-PID recovery. Missing, corrupt,
changed or foreign ownership refuses, with no implicit recreation or reset.

Before egress, reserve one request and the final supported OpenAI API ceiling.
Concurrent calls serialize and uncertain reservations stay spent. API minimum
16/safe-integer bounds, total remaining-token clamping and native frozen identity
are tested. Codex retains its fixed endpoint with request, timeout, response-byte
and wall bounds; hard output-token ceiling/remaining token budget are null. It
receives no unsupported cap and no token estimate from visible bytes. Governed
provider effects remain on the exact native committed-release path.

Timeout/disconnect/overflow cancel upstream, streaming readers and late responses.
Early upstream failure yields a generic bounded HTTP error; a partial failed stream
is terminated without acknowledging native delivery. Native post-dispatch fence,
request identity and reservations survive. Operator commands bypass model limits.
Native codemode, hosted and deferred tools remain refused before reservation or
submission; bounded `read_many` is unchanged.

The parent waits for observed guest exit, signals the isolated group and escalates
only while actual exit remains absent. A real ignoring child with `killed === true`
and a descendant proves that sending a signal is not exit evidence. Independent
process-state inspection distinguishes a dead zombie from an executing survivor.
The Linux wrapper's graceful exit additionally tears down its PID namespace through
bubblewrap; a separate real ignoring parent/descendant verifies SIGKILL escalation.
No journal, native fence, original mapping or reservation is cleared by termination.

Whole-guest bubblewrap uses all required namespaces, immutable selected runtime/
installed tree, isolated writable profile/tmp/proc/dev/cwd and exactly two selected
parent Unix leaves. Closure audit rejects escaping links and special/service files.
Fixed loopback/Unix relays preserve Host/session bytes, enforce connection/queue
bounds, backpressure, private leaf identity and cleanup. No arbitrary destination
or shared-network/unconfined fallback exists. A distinct architecture-pinned FD3
seccomp profile admits qualified stream sockets and Node threads while denying
process creation, namespace changes/clone flags, io_uring setup and x32 variants.
The production bootstrap starts both relays and actual Pi SDK in one Node process.

Commands on the final implementation bytes:

```sh
npm run typecheck
npm test
node scripts/qualify-linux-guest.mjs > /tmp/chio-pi-task6-linux-final.log 2>&1
git diff --check
```

Typecheck/build passed. All **372 tests passed**, zero failures, skips or
cancellations, including 36 new Task 6 cases. The final full suite took 69.268 s.
Independent compiled BPF evaluation covers arm64 and x64, 1,024 x32-number
variants, Unix/IPv4 stream admission, thread fallback and process/namespace denial.
These x64 component checks do not claim actual x64 runtime acceptance.

## Actual Linux evidence

The [machine-readable result](2026-10-04-task6-linux-result.json) retains selected
runtime/build images, Node/bubblewrap/loader/library pins, lock and installed-tree
hashes, namespace observations, request counts and process/deadline outcomes.

Runtime: original image
`sha256:6d5bbc54ae9fd29177042755c41667006b708874c7ed6d489d543e931e33fe23`,
Linux arm64 6.8.0-64-generic, Node 22.23.1, bubblewrap 0.8.0-2+deb12u1,
libc 2.36-9+deb12u14, libstdc++ 12.2.0-14+deb12u1. Node SHA-256:
`d8fa08f79c8198c5a5ccc9faa5a69803052703fc9513f99e7200e0ab42e1d799`.
Bubblewrap SHA-256:
`ff5add553bea12a45c18ebe6c67d3ed637052b869a1ca2fc5d74a6a2e8c5cce6`.
All seven loader/library files are individually recorded and asserted before launch.
The source lock SHA-256 is
`066a7a6cee4724322e72b64eea80fe391a744590d1884a8bc105077db6ce9fdf`.

Compiled whole-guest BPF hashes:

- arm64: `9b1c9a8f90090d090d2b71f93cab11a176b036b9153030a35f819455beae4f4a`.
- x64 component: `0ed82883d3d3d44d09bac7ada0ba83d6f1bfd1f06dd8ac528a6c83cb5ada3364`.

The prepared runtime has no compiler or ps utility. A separate task-owned addon
build image is
`sha256:8ea000bcc1b93efd77f20fdf059eab1e9950b6210c0837124c3d5d3cb5099c82`.
Native syscall probe source SHA-256:
`0d61377bad2a4ba418f0082aa9a3d4a91d4e102975482fd9edbcaca52e06dad8`.
Addon SHA-256:
`b9ba696aa07cca66a1ae827871a79e5a32eded68c2f250c7408fc15919b32de3`.
Only that addon enters the selected fixture installation. No compiler enters the
guest and there is no production compiler dependency. Runtime pins are checked
independently of the build image. The process observer reads parent `/proc` directly.

Positive observations: both fixed routes preserve expected Host and MCP session;
actual Pi 1.0.2 completes its synthetic prompt through the shipped bootstrap and
selected relay ports. Independent parent services observe three gateway requests
(one direct route plus SDK initialize/inventory) and two model requests (direct
route plus SDK stream). No protected tool effect or actual provider is invoked.
Parent Linux budget create/resume retains deadline and consumes exactly two requests
and 48 reserved API output tokens, ending with zero remaining requests/tokens.

Negative observations: forbidden configuration/journal/provider credential/resource
source/home/Docker socket reads, installed-code writes, extra Unix socket and general
network paths, process creation and namespace syscalls refuse. All five relevant
namespace identities differ from the parent. The confined wrapper exits by SIGTERM;
the raw ignoring parent/descendant exits by SIGKILL. Independent observer finds zero
executing survivors and zero retained zombies in the final run.

Acceptance used **only disposable task-owned `--rm --privileged --network none`
outer containers**. Running Colima/Docker services were preserved. Ordinary container
privileges do not supply this boundary on the measured VM. The reproducible runner,
Dockerfiles and exact runtime assertions live in `scripts/linux-guest/` and
`scripts/qualify-linux-guest.mjs`, with operation instructions in
[RUN-LIMITS-LINUX](../../RUN-LIMITS-LINUX.md). Cold rebuilds can select an explicit
immutable runtime image; exact runtime hashes must still match before launch.

## RED/GREEN and self-review record

Initial missing-implementation tests failed for budgets, Unix routes, whole-guest
filter/closure audit and termination before their implementations were written.
Focused relay tests initially demonstrated missing caps/Codex normalization and
provider timeout. Subsequent RED/GREEN regressions cover foreign registry/mode,
late responses, early stream failure, immutable native envelope shape, deadline/
counter integrity and foreign-host dead-PID recovery.

Initial full verification exposed an early-stream regression: sending upstream
headers before observing its first byte caused a fetch-level disconnect, changing
Task 5's existing response-loss fixture. Deferring headers preserves its bounded
error response and original fence; existing and new focused cases pass. A separate
required-budget fixture initially constructed an execution-only relay, correctly
refused by the new mode binding; the fixture now composes only the selected native
relay. A transient descendant-reaping observation was addressed by checking actual
executing state independently, while retaining hard-kill assertions and adding the
explicit misleading `ChildProcess.killed` condition. No recipe test/filter change
was made to hide a failure.

Linux probe corrections concerned fixture setup: compiler absence, copied symlink
rewriting, native addon CommonJS loading, synchronous Node spawn EPERM, actual Pi
terminal outcome `completed`, wrapper versus guest termination semantics and absent
ps. Production guest setup remained fail closed. The final runner uses the correct
native contracts, separate build stage and independent `/proc` observer. All final
acceptance assertions pass on the recorded runtime.

Self-review checked scope, selected mounts, unsupported Codex parameters, exact
native byte/profile/limits identity, streaming memory bounds, stale-owner races,
actual-exit/group cleanup, original uncertainty, credentials and artifact boundaries.
No selected service, provider or journal credential is mounted or printed. This
closes implementation/component/measured local Task 6 evidence, subject to root's
independent specification and quality reviews. Native service/P5 qualification and
release/PR acceptance are not implied.

## Specification review correction

The independent review of `c879b4e` found one obsolete stock-host test
expectation: the execution-only default launch test expected the macOS-only
platform refusal on every non-Darwin host. Supported Linux instead correctly
refuses missing operator-selected `--linux-runtime` pins before credential access.
Only that test and this evidence file changed. Production behavior is unchanged.

The expectation now distinguishes Darwin's missing API credential, Linux's
missing runtime pins, and the explicit unsupported-platform refusal. Both default
and explicit `--governance execution-only` invocations retain those expectations.

Fresh verification used the same pinned runtime image recorded above, with
`docker run --rm --network none`, a read-only worktree mount at `/input`, and
`--workdir /input`. No privileged container or guest namespace setup was needed
for this CLI refusal regression. Commands inside that container:

```sh
node --test --test-name-pattern='execution-only default' test/governance-cli.test.mjs
node --test test/run-limits.test.mjs test/model-limits.test.mjs test/unix-relay.test.mjs test/linux-sandbox.test.mjs test/guest-termination.test.mjs test/governance-cli.test.mjs
```

The focused Linux command first reproduced RED (0 pass, 1 fail, missing runtime
pins reported), then passed GREEN (1 pass, 0 fail). The six Linux suites passed
41 tests, with zero failures, cancellations or skips. On the Darwin host,
`node --test test/governance-cli.test.mjs` passed all 7 tests, including missing
API credential refusal. A separate credential-free subprocess probe overrode
`process.platform` to `freebsd` with a Node data-URL preload and checked both
default and explicit execution-only launches: 2 assertions passed for
`Protected candidate requires macOS sandbox-exec or Linux bubblewrap`. This is
branch verification through a simulated platform value, not an actual FreeBSD
runtime qualification. `git diff --check` also passed.

The earlier full 372-test and measured Linux guest acceptance records remain
separate evidence. They were not rerun for this test-only expectation correction.
