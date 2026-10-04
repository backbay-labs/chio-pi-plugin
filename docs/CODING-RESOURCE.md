# Kernel-owned coding resource

`chio-coding-resource` is a separate MCP resource owner. Chio launches it on an
exclusively kernel-owned stdio connection. Pi and its executor do not launch it
or repeat its repository effects after an authorization precheck. The resource
owns immutable source generations, confined test jobs and artifact publication.
Chio owns admission, capabilities, approval, receipts, signatures and delivery.

## Operator preparation

Use Node with `node:sqlite` support. This implementation was measured on Node
25.5.0 on macOS and Node 22.23.1 in the Linux qualification image. Node currently
prints its experimental SQLite warning to stderr. The JSONL protocol uses stdout.

Create four absolute, canonical, disjoint private roots: a source import root,
resource state, artifacts and temporary jobs. Roots must be owned by the resource
owner with mode `0700`. Source directories also require `0700`; source files and
the operator JSON require `0600`, one link, the current uid and regular file
type. Symlinks, hardlinks, special files and path aliases are refused before
opening. On macOS, use resolved `/private/...` paths instead of `/tmp` aliases.
Keep the private operator JSON outside those roots. Provision only the source
that this resource may expose to admitted callers and recipes. Normal Pi profiles
and provider credentials are not inputs to this program.

The complete closed configuration has this structure. Replace the illustrative
paths and hashes with independently selected real values:

```json
{
  "schema": "chio.coding-resource.v1",
  "resourceOwnerId": "coding-owner",
  "workspaceId": "selected-workspace",
  "repositoryRoot": "/absolute/private/import",
  "stateRoot": "/absolute/private/state",
  "artifactRoot": "/absolute/private/artifacts",
  "jobRoot": "/absolute/private/jobs",
  "allowedCallerCapabilitySha256": ["64 lowercase hex characters"],
  "bounds": {
    "maxFileBytes": 262144,
    "maxRepositoryBytes": 1048576,
    "maxFiles": 128,
    "maxReadBytes": 65536,
    "maxSearchMatches": 50,
    "maxReadMany": 8,
    "maxPatchBytes": 65536,
    "maxInputBytes": 131072,
    "maxQueuedCalls": 8,
    "maxOutputBytes": 131072
  },
  "recipes": [{
    "name": "unit",
    "executable": "/absolute/canonical/node",
    "executableSha256": "64 lowercase hex characters",
    "argv": ["fixture-test.mjs"],
    "timeoutMs": 2000,
    "outputBytes": 16384,
    "graceMs": 100,
    "runtimeFiles": [{
      "path": "/absolute/canonical/selected-runtime.dylib",
      "sha256": "64 lowercase hex characters"
    }],
    "recipeSha256": "64 lowercase hex characters"
  }]
}
```

`recipeSha256` is SHA256 of `canonicalJson(recipe without recipeSha256)`, using
the existing registry canonicalizer. After building this checkout, the same
calculation is available as `recipeDigest` from
`dist/coding-resource/config.js`. Pin the executable's complete file hash. Its
path must resolve to an owned, regular executable without symlinks or hardlinks
and without group/other write permission. Commands, environment assignments,
shells, Git hooks, filters, fsmonitor and executable discovery are not model
parameters. Each recipe has fixed operator-selected argv.

Recipe output capacity includes both JSON encodings: stdout/stderr become part
of the test-result JSON, which becomes MCP `content.text`. One NUL output byte
requires seven wire bytes. Configuration requires
`outputBytes * 7 + 8192 + 3108 <= maxOutputBytes`, reserving test metadata and
the largest permitted serialized JSON-RPC ID plus response envelope. For example,
20,480 output bytes require at least 154,660 output-frame bytes; 131,072 is refused
before import or jobs. Exact prepared results also use the complete envelope
reserve before effects. Retained replay uses the same capacity rule and preserves
the original result; an original record that cannot fit remains available for
unsigned forensic export rather than being replaced or reexecuted.

On Linux, `runtimeFiles` must list exact canonical loader/library files with
SHA256 hashes. An optional `mountPath` supplies an exact `/lib/`, `/lib64/`,
`/usr/lib/` or `/usr/local/lib/` loader alias. No host library directory is mounted.
On macOS, `runtimeFiles` must contain the complete resolved non-system dependency
closure selected by the executable's recursive `otool -L` declarations. The
executable has its own separate pin. Each dependency requires its canonical
resolved path and SHA256, including actual Homebrew Cellar paths; macOS does not
accept `mountPath` aliases. The illustrative JSON above abbreviates this list.
Missing, extra, changed or mismatched dependencies refuse before any recipe job
is created. Admitted proven no-effect refusals remain durable terminal outcomes
and replay exactly, even if the dependency is later repaired. The selected system
OS runtime trees remain a separately measured boundary; they are not claimed to
be individually hash-pinned.

This trusted macOS provisioning command prints an actual complete recipe for the
Node executable running it. Run it from the built checkout, inspect the selected
paths, then place the resulting recipe in the private operator configuration:

```sh
node --input-type=module <<'CODING_RECIPE'
import {readFile, realpath} from 'node:fs/promises';
import {runtimeLibraries} from './dist/sandbox.js';
import {recipeDigest, sha256} from './dist/coding-resource/config.js';
const executable = await realpath(process.execPath);
const runtimeFiles = [];
for (const path of (await runtimeLibraries(executable)).sort()) {
  if (path !== executable) runtimeFiles.push({path, sha256: sha256(await readFile(path))});
}
const recipe = {
  name: 'unit', executable, executableSha256: sha256(await readFile(executable)),
  argv: ['fixture-test.mjs'], timeoutMs: 2000, outputBytes: 16384, graceMs: 100,
  runtimeFiles
};
console.log(JSON.stringify({...recipe, recipeSha256: recipeDigest(recipe)}, null, 2));
CODING_RECIPE
```

This reads only the selected executable and its declared runtime closure during
operator provisioning. The model supplies no dependency paths or discovery
commands. The sandbox grants metadata access to the exact
declared dylib aliases and intermediate symlink paths needed by the loader,
with directory-only metadata access to their selected ancestors. File data
access remains limited to the exact resolved runtime files, selected system
runtime trees and the selected source generation.

Explicit import is separate from serving:

```sh
node dist/coding-resource-cli.js init --config /absolute/private/operator.json
node dist/coding-resource-cli.js inspect --config /absolute/private/operator.json
```

`init` requires empty state, artifact and job roots. It imports regular source
files into fresh immutable inodes and records an initial manifest. `.git` is
excluded without reading its contents. It never changes the import originals.
An interrupted init leaves operator-visible partial private state and refuses
automatic reuse; use a fresh empty resource deployment after inspecting it.

Source paths use a fixed portable namespace during import, reads, patches and
generation verification. Names must be well-formed NFC Unicode, with assigned
Unicode 15.1 letters, marks, numbers, punctuation, symbols or space separators.
Controls, format characters, private-use characters, line/paragraph separators,
default-ignorable characters, unpaired surrogates and scalars not assigned in
15.1 are refused. Ordinary NFC Unicode names, including accented letters, Greek,
Japanese and single-scalar emoji, remain supported. Noncanonical spellings are
refused instead of rewriting import originals or model arguments.

Each component may use at most 255 UTF-8 bytes and each relative path at most
1,024 bytes. The complete destination
`stateRoot/generations/<64-character digest>/<relative path>` must also fit
1,023 bytes on macOS or 4,095 bytes on Linux. The complete file inventory retains
one spelling and one file/directory type for every prefix under the pinned
default full Unicode case fold. Thus `source.txt`/`SOURCE.txt`,
`Straße.txt`/`STRASSE.txt`, `Dir/a.txt`/`dir/b.txt` and any file/ancestor-directory
conflict are refused, including either order within one patch. This intentionally
restricts names even on case-sensitive filesystems; it does not claim equality
with every host filesystem's alias rules. New immutable generations must reload
and match their prepared manifest before the head and terminal result commit.
Unexpected materialization or verification failures preserve the prior head and
unresolved intent.

The namespace data is generated from pinned official
[UnicodeData 15.1](https://www.unicode.org/Public/15.1.0/ucd/UnicodeData.txt),
[CaseFolding 15.1](https://www.unicode.org/Public/15.1.0/ucd/CaseFolding.txt) and
[DerivedCoreProperties 15.1](https://www.unicode.org/Public/15.1.0/ucd/DerivedCoreProperties.txt).
The shipped generated module includes complete Unicode License V3 and source
hashes. The trusted maintenance generator verifies every download's hash before
generating 149,374 supported scalars and 1,530 default full-fold entries. Runtime
requests perform no data downloads, locale selection or guest callbacks. Source
URLs, exact hashes and regeneration evidence are retained in the
[Task 3 evidence](superpowers/evidence/2026-10-04-task3-coding-resource.md#portable-namespace-extension).

Configure the trusted Chio launcher to execute:

```sh
node dist/coding-resource-cli.js serve --config /absolute/private/operator.json
```

The launcher must supply a trusted minimal startup environment as well as the
kernel-owned pipe. Node can interpret `NODE_OPTIONS` before application code
runs. Recipe isolation supplies its own fresh environment independently.
`serve` refuses missing initialized state. It does not import or discover a
repository, load a Pi profile, select a provider or obtain authentication.
Before advertising tools, it validates both initial and current retained source
manifests and every immutable generation file under the exclusive owner lock.
Missing or corrupt generations refuse startup without repairing files, adopting
orphan generations or changing unresolved operation intent. Read-only unsigned
inspection/export remain available for forensic investigation of ledger records.

## Native connection and operation binding

Every admitted `tools/call` requires exactly these native `_meta` fields:

```json
{
  "chioRequestId": "1111111111111111111111111111111111111111111111111111111111111111",
  "chioOperationId": "1111111111111111111111111111111111111111111111111111111111111111",
  "chioAttemptId": "native-provider-attempt",
  "chioTransportKeyEpoch": 1,
  "chioCallerCapabilitySha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

Request and operation IDs are the same lowercase SHA256 kernel admission ID.
They are not Pi or bridge logical call IDs. Attempt IDs are nonempty, at most
512 characters; the transport epoch is a positive safe integer. The caller hash
must be selected from the operator-pinned allowset. The native process descriptor
derives it from the canonical signed capability, not a bearer token. An older
kernel that omits caller binding is refused. See
[the inspected native contract](NATIVE-PREREQUISITES.md#resource-participant-binding).

These bytes are connection binding on the trusted pipe. They are not a signed
wire credential. Sending a fabricated matching JSON object to an arbitrary
process cannot establish Chio authority. Local tests fabricate public metadata
only to exercise this participant's behavior.

## Closed tools

| Tool | Exact source and bounded behavior |
| --- | --- |
| `read_range` | `sourceDigest`, canonical relative `path`, inclusive `startLine`/`endLine`; returns text and full-file hash. |
| `search` | `sourceDigest`, literal string, optional paths and bounded `maxMatches`; no regular expressions or executable search. |
| `repo_status` | Empty arguments; changed file hashes relative to the initial manifest. |
| `repo_diff` | `sourceDigest`; bounded before/after UTF-8 content computed internally. |
| `apply_patch` | `sourceDigest`, bounded unique file changes with complete `expectedFileSha256` and exactly replacement or unique literal edits. |
| `test_recipe` | `sourceDigest`, an operator-pinned recipe name. |
| `publish_artifact` | Exact source, successful retained `testOperationId`, `testResultSha256`, `recipeSha256`, and the closed approved destination `review`. |
| `repo_context` | `sourceDigest`; requested structure, manifest provenance and recipe digests as unsigned content. |
| `read_many` | `sourceDigest`, bounded ordered line-range reads; preserves individual errors and partial truth. |

New exact-source calls use the current generation. Exact completed historical
replay is checked first and remains available after later patches or provider
attempts. An absent new file uses `expectedFileSha256: null` and a replacement.
Literal edits require exactly one match in the original full-file content,
including detection of overlapping occurrences. Every entry's original range
must be pairwise disjoint; edits apply from the highest offset downward, so
replacement lengths or introduced text cannot change another precondition.
Every file precondition is checked before building a new generation; a stale
source or file refuses the whole patch. The complete final file inventory also
refuses any file that would be another file's ancestor directory, including new
paths in either batch order. These deterministic namespace conflicts are retained
`invalid_patch` outcomes and create no candidate, staging directory or unresolved
intent fence. No shell or Git process applies changes. Read-only tools
are still ordinary admitted operations; `read_many` is not native arbitrary
codemode and context is not authority.

## Durability and reconciliation

One exclusive private owner lock protects a SQLite ledger using DELETE journal
mode, `synchronous=FULL`, a busy timeout and Darwin `fullfsync` settings. Bindings
include owner, workspace, config digest, caller, native operation, tool, canonical
arguments and original source. Native attempt metadata is retained separately.
An exact completed lookup returns the original MCP result before checking the
current source. Changed caller, tool, arguments or configuration conflicts.

Before effects, the resource commits and fsyncs intent. A patch writes and fsyncs
fresh immutable files and directories, renames the complete generation and
fsyncs its parent. It then reloads and verifies the complete immutable generation
against its prepared manifest. A single final SQLite transaction commits the current source
pointer and original terminal result. A crash before that transaction preserves
the old head and unresolved intent; an orphan generation is not completion.
A crash after commit but before reply preserves the exact replayable result.

Incomplete intent fences fresh work. Post-intent storage, publication, launch or
unproved descendant/cleanup failure closes stdio without an ordinary terminal
MCP `isError`. Such a result would otherwise become a signed completed native
outcome and could ACK away uncertainty. Proven pre-effect refusals may be retained
terminal tool errors. Failed tests are retained failed test results and cannot
authorize publication.

Incomplete operations are checked before argument validation. Malformed native
metadata while a durable fence exists, and malformed outer call parameters,
close the transport instead of substituting a terminal error for unresolved work.

These operator commands do not dispatch repository effects:

```sh
node dist/coding-resource-cli.js inspect --config /absolute/private/operator.json
node dist/coding-resource-cli.js export --config /absolute/private/operator.json --operation NATIVE_SHA256_ID
node dist/coding-resource-cli.js recover-lock --config /absolute/private/operator.json
```

Inspection/export are read-only and explicitly **unsigned**. They cannot clear a
kernel fence or stand in for original kernel-signed outcome and delivery proof.
Lock recovery requires an exact same-host pid proved dead and removes only that
lock. It preserves all operation intent and results. Graceful close releases only
the lock belonging to this resource instance. Use the separately qualified native
reconciliation path for kernel state; never delete intent or infer completion
from files, a generation count or this unsigned ledger.

## Recipe and publication confinement

Each job receives only the exact read-only generation and a fresh private temp
directory. Its environment contains selected executable-directory PATH, `LANG=C`,
job-only HOME/TMPDIR and `OPENSSL_CONF=/dev/null`. It inherits no loader, Git,
provider, Chio or model secrets. Stdin is ignored; combined stdout/stderr, runtime
and termination grace are bounded. Process groups receive TERM then KILL based
on observed exit and group existence. Unproved absence or cleanup remains fenced.

macOS uses real `sandbox-exec` with deny default, necessary hardware/kernel
sysctls, exact Node/dylibs and source, job-only writes, no network, no process
fork, no hardlinks and no symlink creation. Linux uses `/usr/bin/bwrap` with all
namespaces unshared, a new user/PID/network namespace, parent-death termination,
private proc/dev/tmp, exact read-only runtime files and source, and a trusted
architecture-selected seccomp filter denying processes, sockets and links while
allowing Node threads. The x64 filter refuses the x32 syscall-number bit before
matching native syscall numbers, because the two ABIs share their audit
architecture. See [seccomp(2)](https://man7.org/linux/man-pages/man2/seccomp.2.html).
Unsupported platforms/architectures and missing runtime
pins fail closed. This is an OS boundary; an executable allowlist alone would
not confine repository code.

For macOS, a single-process Node script importing `node:test` works. Node's
default `--test` subprocess mode is not an implicitly qualified recipe. Operator
recipes must be measured with their actual dependencies and runtime.

Publication is a separate Chio tool/capability and must carry exact retained
successful test, source and recipe lineage. It produces an immutable
content-addressed JSON bundle under the pinned artifact root, including source,
manifest, internal diff and test-result digests. Larger bundles remain artifact
bytes; the MCP reply stays bounded. Exact replay returns the original artifact
without another publication. No local approval flag, signature or receipt is
minted by this participant.

The measured macOS and disposable Linux VM fixtures establish resource behavior
and local confinement. They do not establish exact native kernel acceptance,
P5 acceptance, whole-Pi Linux confinement or production deployment. Reproduce the
platform commands and read the limits in
[Task 3 evidence](superpowers/evidence/2026-10-04-task3-coding-resource.md).
