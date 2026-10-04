# Task 3 coding resource evidence

Date: 2026-10-04. Implementation began from code baseline `6e26dce` in the
isolated `feat/pi-full-roadmap-20261004` worktree. Root documentation commits made
during this work were preserved. The frozen bridge archive and qualification
evidence were not changed.

## TDD observations

Before production files were added:

```sh
npm run build
node --test test/coding-resource.test.mjs test/coding-confinement.test.mjs
```

Build exited 0. The initial feature fixtures reported 25 tests, 0 passed,
25 failed because the coding resource entrypoint/participant did not exist.
Fixtures drove actual bounded JSONL subprocess dispatch with native metadata,
not a mocked executor. The generic configuration refusal fixture was strengthened
so absent implementation could not pass it merely by returning any nonzero code.

Self-review added four observed RED regressions, then their fixes:

```sh
node --test --test-name-pattern='original durable binding|overlapping literal|SQLite rejects|conflicting redelivery' test/coding-resource.test.mjs
```

All four initially failed: the binding did not include original source, an
overlapping literal edit was accepted, SQLite inspection blocked on a FIFO
sidecar, and conflicting redelivery of an incomplete intent returned an ordinary
terminal conflict. After the changes, all four passed. SQLite now validates its
possible sidecars before database open, and any incomplete original operation
closes stdio even when its redelivery binding conflicts.

Two more RED regressions were observed for source bundles exceeding the registry's
1 MiB argument encoding bound and a private JSON parse error echoing an input
snippet. Artifact encoding now has a selected source-derived storage bound,
separate from MCP framing; private config parsing suppresses input snippets.
Both passed after the fixes.

Two final RED regressions covered graceful SIGTERM owner-lock release and recipe
output pins that exceeded framing capacity after worst-case JSON escaping.
The signal handler now aborts work and closes the owned resource gracefully;
configuration requires space for escaped recipe output and result metadata.
Both passed after their fixes.

Final self-review observed three more RED cases: malformed arguments, missing
caller metadata and extra outer `tools/call` parameters each returned an ordinary
terminal error on redelivery of an incomplete operation. All three passed after
checking unresolved intent before argument validation, closing on malformed
metadata while a durable fence exists and closing on malformed outer call
parameters. The six selected regression/control cases also passed, including
exact historical replay and valid fresh metadata refusal.

## Independent spec review fixes

The independent review of `b873af9` found three missing invariants despite its
passing checks: macOS allowed the discovered non-system runtime closure without
requiring its operator hash inventory; serving checked ledger identity but not
the required initial/current source contents; and literal edit entries matched
progressively modified text rather than pairwise disjoint original ranges.

Observed RED before these production fixes:

```sh
npm run build
node --test --test-name-pattern='macOS runtime closure|real confined recipe passes|startup validates|literal patch' \
  test/coding-resource.test.mjs test/coding-confinement.test.mjs
```

Build exited 0. Eleven selected tests reported 8 failed and 3 passed. Missing
runtime pins still produced a successful job; a complete natural Homebrew pin
inventory was rejected by Linux-only mount-path rules. Missing initial/current
files and corrupt current content still advertised tools. The exact `abcdef`
overlap (`bcd -> bcD`, `bc -> xx`) and an introduced-text edit were accepted;
valid disjoint original edits with replacement-induced matches were refused.
The incomplete/wrong-hash/extra pin refusal cases already passed because earlier
pin/path validation rejected those particular inputs.

After the scoped fixes, the same eleven tests all passed. macOS now compares
the complete selected non-system dependency path set with the operator inventory,
then verifies every hash before recipe jobs. Natural canonical Homebrew paths are
accepted without Linux mount aliases. Filesystem observers saw zero job creation
events for missing/incomplete/wrong/extra pins; their admitted known-error results
were durably completed and replayed exactly, with unchanged generation and
artifact directories. The positive Node recipe passed with the complete pins.
System OS runtime trees remain separately measured, not individually hash-pinned.

Startup checks initial/current immutable generations while holding its own lock
before any MCP initialize/list reply. Damaged snapshots refused startup; unsigned
inspection and export remained available, including an existing incomplete intent.
Only the newly acquired owner lock was released, and no candidate was promoted.
Literal edits now resolve every unique range against original content, reject
pairwise overlaps and apply descending offsets. Both orderings of disjoint
length-changing/replacement-induced-match edits produced the expected bytes.

Raw selected RED/GREEN logs are retained locally at
`/tmp/chio-task3-spec-fixes-red.txt` and `/tmp/chio-task3-spec-fixes-green.txt`.

## Verified behavior

The fixtures observe actual generation/publication directory counts, imported
original bytes, retained original outcomes, attempts, current-head state and
transport closure. They cover missing/invalid caller metadata; exact operation
reuse conflicts; source/full-file CAS and all-or-none edits; traversal/aliases;
symlink, hardlink and FIFO inputs; stale source; exact replay after later source
and new native attempts; crash after intent; storage failure after generation,
before commit and after publication; atomic head/outcome; completed-before-reply
crash; read-many partial truth; bounded literal search; private modes and disjoint
roots; exclusive lock and proven-dead recovery; bounded framing before newline;
unsigned read-only inspection/export; failed-test publication refusal; and exact
successful test/recipe/source/artifact lineage.

Fault injection exists only in an explicit trusted API test seam and the test
driver. There is no production CLI, config, model argument or environment switch.

## Platform observations

macOS 26.4 arm64, Node 25.5.0, `/usr/bin/sandbox-exec`: real confined Node test
scripts pass; outside/state/artifact/fixture credential reads and file metadata,
original/snapshot writes, hardlinks, symlink creation, process creation and
outbound network are refused. Artifact probes inspect an actual retained bundle
file and directory listing. The networking fixture requires an explicit `EPERM`/`EACCES` error
and has no success-on-timeout path. Hang/flood jobs hit runtime/output bounds and
leave no job directories after observed group termination. Failed test lineage
does not publish; successful publication replays with one actual immutable bundle.

The initial negative environment fixture incorrectly passed `NODE_OPTIONS` to the
owner's Node startup. It was corrected to poison the inherited environment after
trusted fixture-driver startup and then test that a fresh recipe environment
excludes it. No production exception was added.

The first symlink probe found that Seatbelt `file-link` denial alone did not deny
symlink creation inside the writable job. The tested rule now additionally uses
`(deny file-write-create (vnode-type SYMLINK))`, also present in the platform's
own profiles and [WebKit's source profile](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/WebProcess/com.apple.WebProcess.sb.in).

A forbidden `stat` regression exposed overly broad metadata permission in an
early profile. Removing it first caused the positive Node control to abort in
the dynamic loader. The final measured profile allows metadata only on exact
selected dylib aliases, their intermediate symlink paths, directory-only selected
ancestors and the explicitly readable runtime/source paths. File data permission
remains restricted to resolved runtime files and selected trees. Both positive
Node controls and forbidden file stat/read probes passed with this final profile;
the earlier permissive metadata profile is not the qualified profile.

Linux probes use the existing immutable image
`sha256:6d5bbc54ae9fd29177042755c41667006b708874c7ed6d489d543e931e33fe23`,
Node 22.23.1, bubblewrap 0.8.0, Linux arm64 inside the existing Colima VM. A
disposable privileged outer container is needed for nested namespace mounts on
this VM. The outer container has no network; the inner recipe additionally has
unshared network/PID/user namespaces, exact read-only runtime bindings and
seccomp socket/process/link denials. No existing service or VM was changed.

```sh
docker run --rm --privileged --network none \
  --mount type=bind,source=/Users/connor/.config/superpowers/worktrees/chio-pi-plugin/full-roadmap-20261004,target=/opt/chio-plugin,readonly \
  --workdir /opt/chio-plugin \
  sha256:6d5bbc54ae9fd29177042755c41667006b708874c7ed6d489d543e931e33fe23 \
  node test/helpers/coding-linux-runner.mjs
```

This helper fixes the measured image architecture, Node and bwrap versions and
builds public library hashes from explicit known paths. It performs no executable
discovery or credential reads. The x64 seccomp implementation is present but was
not measured by this arm64 VM run.

The invocation retains bubblewrap's private PID-namespace init/reaper rather
than selecting `--as-pid-1`. Bubblewrap 0.8.0 installs parent-death termination on
that init and keeps its standard streams open while reaping children. The owner
waits for observed subprocess/stream closure and verifies the outer process
group is absent before cleaning the job. See the selected
[bubblewrap source](https://github.com/containers/bubblewrap/blob/v0.8.0/bubblewrap.c).

## Final verification

Fresh checks on the final implementation before commit:

```sh
npm run typecheck
npm test
node dist/coding-resource-cli.js --help
```

The real binary smoke initialized a fresh private fixture, negotiated MCP
`2025-06-18`, listed nine tools and returned 11 exact source bytes through
`read_range`. The source digest was
`c5caa8eeffc8ec8f5fb60d27513d919b66c7edc744e651648170fb5743291f4f`.
The updated guide's actual macOS provisioning command generated all 21 selected
non-executable dependency hash pins. The smoke used that generated recipe and
passed a real confined `test_recipe` call through the binary as well.
The SQLite experimental notice on stderr is a Node runtime property, not stdout
protocol output.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Exit 0. |
| `npm test` on macOS 26.4 arm64 / Node 25.5.0 | Exit 0; 134 tests passed, 0 failed/cancelled/skipped. This includes all seven real macOS confinement/publication probes and four observed zero-job runtime-pin refusal cases. |
| Pinned disposable Linux arm64 / Node 22.23.1 / bwrap 0.8.0 command above | Exit 0; 42 focused resource/confinement tests passed, 0 failed/cancelled/skipped, including all seven real Linux probes. macOS pin cases are registered only on macOS. |
| Actual CLI `--help` and fresh JSONL MCP subprocess smoke | Exit 0; explicit init, initialize, exact nine-tool inventory, exact read bytes and the complete generated macOS recipe passed. |
| `git diff --check` | Exit 0. |

Full-suite duration was 30.052 seconds; Linux focused-suite duration was 37.919
seconds. Final raw command logs were retained locally at
`/tmp/chio-task3-spec-fixes-fullsuite.txt` and
`/tmp/chio-task3-spec-fixes-linux.txt`. These temporary paths are diagnostic
logs, not native signed acceptance evidence.

## Qualification boundary

These are real participant, filesystem, stdio and local recipe-confinement
observations. Public native metadata in the fixtures is fabricated. No real
kernel capability, approval, signature, receipt, ACK or P5 qualification was
created or accepted. Unsigned owner records cannot clear kernel fences. The
separate native kernel acceptance and production deployment remain outstanding.
