# Task 4 implementation evidence

Scope: original-operation custody, fixed-target trusted parent transport,
same-authority private handoff and native Pi Durable registration/committed
delivery. This is component and stock-host evidence. It does not qualify a
current real coding kernel, cross-authority P4 adoption, native owner-outcome
import, provider authority or whole-guest Linux confinement. Fresh independent
spec and quality reviews follow this implementation commit.

## RED observed

* The first continuation suite failed all 28 tests because the required trusted
  APIs were absent. Record that API RED separately from later fixture fixes.
* The first Durable suite failed all 10 tests because the optional adapter was
  absent. The completed suite uses actual Durable contracts, not fake memo APIs.
* Integration RED exposed the guest reconstructing an old native ID from a new
  connection, missing trusted stock-history provenance and a transient atomic
  mapping temporary being inspected concurrently with its own writer. Retained
  parent-produced identity metadata and serialized mapping reads close these.
* Self-review RED exposed an additional persistent parent lock with no native
  crash recovery path. The implementation now uses the native gateway's exact
  durable owner lock and one in-process proxy lease. A separate RED showed a
  changed native owner still receiving an effect; every forward rechecks it.
* A malformed UTF-8 byte in an unsigned outer native custody field was accepted
  by the old operator reader. The focused regression failed with missing expected
  rejection. The bounded reader now uses fatal UTF-8 decoding, descriptor and
  final-path revalidation. Growth after initial admission is refused with bounded
  allocation. All four existing FIFO regressions remain present.
  A final reader RED made the leaf public after the final descriptor check and
  was accepted. Final-path revalidation now also checks regular type, mode,
  ownership, link count, size and timestamps, and that regression is retained.
* Eight self-review cases initially passed one and failed seven: exact signed
  denial retention, three normalized credential fields, owner changes, delivery
  provenance schema and native observation state schema. All now pass. The
  already-supported authorization field was the passing control case.
* The final bounded-export RED reached native lookup before refusing 257
  original requests. Export now checks the bound before its first native lookup.
* The two-store already-delivered RED passed four negative controls and failed
  its valid receiving-store case because the first parent hostCommit is
  immutable. The authorized narrow path validates the actual receiving entry,
  retains its reference separately, then refreshes native original delivery.
  It accepts only exact verified completion with acknowledged and
  hostDeliveryConfirmed, without ACK or replacing the first proof. Unconfirmed,
  stale first-lookup flags, forged details/parent claims and conflicting outcome
  controls continue to refuse.

Fixture corrections were independent of those API failures. A raw HTTP client
was required to send the intended spoofed Host header because Fetch normalized
it. Credential scanning was corrected to preserve public IDs inside credential
containers while retaining actual secret-material rejection. One recovered
outcome assertion now compares exact JSON fields rather than incidental property
serialization order. No security requirement was relaxed by these corrections.
A final fixture-only RED separated a signed denial's native invocation from an
effect: the independent counter initially counted both. It now records zero
effects and one native invocation for denial, with the assertion retained.

## Implemented custody and delivery

`pi-parent-mappings` is a dedicated private nested journal. Fsynced immutable
reservations precede every protected forward. Records bind logical requests,
argument digests, prepared authority/registry digests, original native MCP/RPC/
request IDs, native observations and delivery/ACK provenance. Root native JSON
layout and the frozen native authority binding remain unchanged. Existing
logical identities never forward again after reconnect or restart. Missing
native originals and unmapped uncertainty retain fences.

The trusted proxy fixes the native URL, route, Host and credential, preserves
raw JSON-RPC IDs/parameters and exact MCP sessions, and refuses guest ACK and
all privileged routes. The sandbox receives only its separate ephemeral proxy
credential and port. The installed native lock is exactly
`{pid, hostname, sessionId}`; ownership and proxy closure are checked before
forwarding. Failed initialization cannot silently create a replacement session.

Read-only original lookup validates the complete journal and invokes the exact
installed operator's public status contract. Signed completion verification uses
the private retained native request, including approval metadata. Exact retained
outcome and delivery fields are compared independently of the handoff digest.
The stripped approved-request control fails native verification. Signed denied
outcomes remain exact in handoff without ACK or fence clearing. Private readers
reject nonregular files, hardlinks, public permissions, malformed UTF-8, growth
and oversized files.

Actual Durable prepareArguments runs before native coercion. Eventual execution
and committed assistant arguments are checked again. A native durable memo and
complete private parent task provenance precede the executor. Registrations are
sequential and unsafe. The independent trusted store identity binds the exact
selected live Storage/Session handles and an immutable private owner binding.
The persistent backend association remains the trusted owner's obligation because
the public Storage API does not expose backend identity. A different actual
store reusing numeric task IDs cannot borrow the old operation or commit proof.

Execute and afterTool never ACK. The synchronous commit listener does bounded
enqueue only; an asynchronous observer validates actual terminal tasks, committed
result entries, assistant arguments and complete original model content against
the selected actual store and native original. Exact entry reference and commit
sequence are retained before native ACK. The receiving-host recovery path binds
an unscheduled actual ToolTask to the verified original and commits its complete
outcome without invoking an executor. Generic native unsafe interruption entries
remain unacknowledged.
An already-delivered original can be consumed by a different actual store only
after actual receiving commit verification and a fresh authoritative native
delivery check. Its reference remains in its existing store intent; the first
parent proof stays immutable. This case observes one effect, one native call,
one original ACK and zero receiving transport ACK calls.

Independent synthetic resource counters show exactly one effect, one native tool
call and one ACK for the two-host receiving case and ACK-before-mark restart.
Response-loss and parent-restart cases retain one effect and one native call
without ACK until correct history delivery. Pre-forward storage failure and
changed-owner cases show zero effect bytes. Invalid committed history, unknown
originals, missing native journal state and unmapped uncertainty never permit a
replacement effect or trusted delivery ACK.

## Dependency and public source identities

Runtime for these checks: Node `v25.5.0`, npm `11.8.0`, macOS arm64.
`npm ls --all --json` exits zero. `package-lock.json` records the entire exact
resolved graph, including platform optionals. Its SHA-256 is
`066a7a6cee4724322e72b64eea80fe391a744590d1884a8bc105077db6ce9fdf`.

| Dependency | Resolved version |
| --- | --- |
| Optional peer and dev `@earendil-works/pi-durable` | `1.0.2` |
| Durable `@earendil-works/chord` | `1.0.2` |
| Chord `esbuild` and installed Darwin arm64 binary | `0.28.2` |
| Durable and root `@earendil-works/pi-ai` | `1.0.2` |
| Durable `diff` | `8.0.4` |
| Durable nested `typebox` | `1.3.27` |
| Root registry `typebox` | `1.3.7` |

Durable 1.0.2 npm integrity:
`sha512-pDh8eMSSFIVOTh0H53KhtjaS/XFrulEVREN8wnY8vtbYY0srioZ2impajvkXwoZcG6pRgbPz/WVatZLyk5TIbg==`.

Verified installed public-source SHA-256 identities:

| Artifact | SHA-256 |
| --- | --- |
| Frozen bridge tarball | `7d9e34f7408a316e35125982a23faaecfd2f31f4da6b50ca8eab287c2c918f67` |
| Bridge `dist/gateway-operator.js` | `84602a3f626ecf47283f0ada72fd4d2116104b167adc16eedd02e45d23306ac8` |
| Bridge `dist/gateway.js` | `33e7054cef3eae53400fc63de8586e65b23f041455d0471a4b6df932d136c876` |
| Bridge `dist/gateway-http.js` | `4c3edf80163a5108b054c743b062ad74051fdf8360579cbaed3bf01e2586d622` |
| Durable `dist/harness/tool.js` | `0ac5bd2649b6cec01387da78f3e3803c2c89328dee40e1459ab0808cb7fc5d2b` |
| Durable `dist/session/session.js` | `cab0d448e74369526690c05765b7f99aedd4c63313f275e3a7ed56fe05594a92` |
| Durable `dist/storage/jsonl/node.js` | `43d84046347fd4a54ebc4bfc5ddcbc9f00742cc9cc0c0996ec955d5b697a3fc3` |
| Durable `dist/storage/jsonl/storage.js` | `fce3f914489cbca9ee3862e4cb190bfb0e88ad8475388db9c8900792fef4fc69` |

The installed public tool source confirms prepareArguments precedes coercion,
beforeTool/execute/afterTool precede settle, and settle appends the result entry
with the terminal task's result.entryId in one commit. Public Session documents
subscribeCommits as synchronous and forbids Session operations in its listener.
Tests use exported registration, extension, hook, Harness, ToolTask, Session,
MemoryStorage and fsynced node JSONL contracts. No installed native source,
vendor artifact, historical qualification evidence, real credentials, kernel
services, resource implementation or normal Pi profile was modified.

## Verification

The focused continuation, Durable and operator suite passed 98/98 tests with zero
failures or skips before the final bounded-export regression. That breakdown was
56 continuation, 13 Durable and 29 operator tests. The bounded-export regression
then passed independently after its observed RED.

The initial full `npm run typecheck && npm test` exited zero and passed all 240 tests, with
zero failures, cancellations or skips. This retains all 170 baseline tests and
adds 57 continuation plus 13 Durable tests. The 29 operator tests include all
four FIFO cases; malformed UTF-8 and growth are focused continuation regressions
against that same trusted operator reader. The full run also covers the bounded
export and corrected independent denial counter. `git diff --check` exits zero.

The five already-delivered receiving-store regressions and one final reader
regression follow that initial full run. The receiving-store command
`npm run build && node --test --test-name-pattern='current native proof' test/durable.test.mjs`
passes 5/5 after its observed 4/5 RED. Final verification of the resulting
246-test suite is GREEN: fresh `npm run typecheck && npm test` exits zero and
passes all 246 tests, with zero failures, cancellations or skips. This preserves
all 170 baseline tests and adds 58 continuation plus 18 Durable tests. The final
public-leaf race regression passes, and all four existing operator FIFO cases
remain green. `git diff --check` also exits zero.

Final verification log: `/tmp/chio-task4-final-verification.log`; the earlier
240-test log is `/tmp/chio-task4-full-verification.log`. Initial focused
RED/GREEN and integration logs are private development artifacts under
`/tmp/chio-task4-*`; assertions and synthetic fixture construction remain in the
committed test sources. The full suite runs local fixtures and does not contact
a real provider or kernel service.

## Implementation self-review

The final self-review checked the distinct logical, MCP, native and resource
identities; reservation-before-forward ordering; missing/unmapped fences; exact
approved private request verification; native owner/closure refusal; bounded
private reads and atomic publication; guest route restrictions; and no optional
Durable import in the base runtime or root declarations. It checked the native
memo/terminal-memo distinction, strict raw/final/assistant arguments, full model
outcome, asynchronous actual committed-entry observation, persistence before
ACK and restart reconciliation. The already-delivered path refreshes native
evidence after receiving entry validation, retains separate receiving provenance,
preserves the first immutable proof and performs no additional ACK.

Only Task 4-owned source, tests, manifests, guide and evidence are staged. Root
plan/spec refinements, Task 3 resources, frozen native artifacts, earlier evidence
and the dirty primary checkout are preserved. This self-review is not the
required independent spec or fresh quality review.

## Practical gates

Private bounds are 1 MiB per file/frame/response, 256 handoff originals, 32 KiB
context, 4096 provenance records, 32 proxy requests, 64 delivery queue tasks and
256 KiB full Durable outcomes. Inbound framing is bounded to 10 seconds and
native forwarding to 40 seconds. Refusal preserves uncertainty.

Stock/component tests exercise actual native gateway protocol and ephemeral
signed completion fixtures with actual Durable storage and host contracts. They
do not establish current real coding-kernel lifecycle, resource-commit-before-
signed-completion recovery, live provider behavior, native unsafe approval
decision/ID retention, owner-outcome import, semantic recovery, native child
authority, cross-authority P4 adoption or whole-Pi Linux confinement. Task 2's
approval-decide parse gate remains intact. The separately reviewed Task 3 Linux
resource results are not reclassified as continuation qualification.
