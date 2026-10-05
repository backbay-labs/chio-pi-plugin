# Parent run limits and Linux whole-Pi confinement

The protected launcher keeps model accounting in the trusted parent, under
`<native-journal>/pi-run-limits/<sha256-of-absolute-profile>/run.json`. The native
journal root's `.json` operation namespace is unchanged. Guest mounts never
include this directory. The record binds prepared authority, immutable registry,
absolute profile identity, governance selection, versioned fixed provider profile,
all operator limits and the original absolute deadline. An integrity digest detects
corruption of the retained counters and deadline. Counts and the absolute deadline survive restart.

A new dedicated, empty profile explicitly creates its record once. The profile's
ownership marker is published only after that record exists, through a private
temporary file, file fsync, exclusive link and directory fsync, so a refusal or
crash between the two never leaves a marker without its record. An empty profile
whose record already exists (an interrupted first launch, or a guest that emptied
its profile) resumes that record with its counts and deadline; it is never
recreated or reset. Existing profiles require the original record, including
launches without `--resume`. The launcher reads an existing marker as guest
output: private, single-link, bounded and without following links.
Missing, corrupt, differently bound or concurrently owned state refuses launch.
Do not delete accounting to make a resume work. Diagnose or recover the original
operation through `chio-pi doctor|status|inspect|recover`; these commands start no
model and remain available after quota or deadline exhaustion. Historical profiles
without accounting require a separately prepared new run, not an implicit upgrade.

The owner lock binds the hostname, boot identity and parent PID namespace before
considering a dead PID. Foreign-host or foreign-namespace ownership refuses.
The owner lock refuses a live PID. After spawning the guest, the parent records the
guest's isolated process group in the lock. A recorded dead local PID permits
exclusive recovery of the same state only when its recorded guest process group no
longer exists, so a second launch never runs beside a surviving guest. PID or group
reuse conservatively refuses. An interrupted owner recovery can leave its lock for
operator inspection; it cannot authorize a reset. A lock that cannot be recovered
automatically, for example after a reboot or a hostname change, follows the manual
procedure in [OPERATOR.md](OPERATOR.md#recover-a-stale-parent-run-limits-owner-lock).
All records require private current-user directories and regular, single-link,
private files, bounded NOFOLLOW reads, exclusive ownership, atomic publication,
file fsync and directory fsync. Storage failure fences provider submission.

## Fixed profiles and default bounds

| Selection | Fixed destination | Hard output-token accounting |
| --- | --- | --- |
| `openai/gpt-4.1-mini`, `chio.pi.provider.openai.gpt-4.1-mini.v1` | `https://api.openai.com/v1/responses` | Final supported `max_output_tokens` is reserved before submission, including reasoning and visible output. |
| `openai-codex/gpt-5.5`, `chio.pi.provider.openai-codex.gpt-5.5.v1` | `https://chatgpt.com/backend-api/codex/responses` | Hard output-token limit and remaining output-token budget are unavailable and reported as `null`. No unsupported `max_output_tokens` is sent. |

There is no route fallback. Codex remains available with request count, provider
request timeout, response-byte and absolute wall bounds. Stream bytes are neither
provider-token measurements nor a spending or provider-compute ceiling.

Defaults are 32 requests, 4,096 API output tokens per request, 131,072 API output
tokens reserved across the run, 120,000 ms provider timeout, 8,388,608 response
bytes per request, 1,800,000 ms absolute wall duration and 1,000 ms graceful-kill
interval. An operator can select a private JSON file using `--limits`:

```json
{
  "maxRequests": 32,
  "maxOutputTokens": 4096,
  "maxTotalOutputTokens": 131072,
  "providerTimeoutMs": 120000,
  "maxResponseBytes": 8388608,
  "wallMs": 1800000,
  "killGraceMs": 1000
}
```

All members are required positive safe integers. API output ceilings are at least
16 and at most 32,768. Reservations use the final normalized ceiling, clamped to
the per-request and remaining total budget. Less than 16 remaining refuses an API
request. A request's ceiling is spent conservatively even if submission, stream
completion or native release is uncertain. Parallel reservations serialize;
concurrent owners refuse. No refund infers provider token usage from visible text.
Provider timeout, disconnect and streaming overflow abort upstream and cancel
available response streams before unbounded buffering. A late response from a
transport ignoring abort is also cancelled. Diagnostics never include provider
credentials or raw private request bodies.

The default CLI `--governance execution-only` remains available. Explicit
`required` refuses before credentials when the native host facade is unavailable.
SDK hosts can pass a durable `RunBudget` as the sixth argument to
`startModelRelay`; its registry, fixed profile and governance selection must match.
Required SDK governance must pass one: the relay refuses to start without it.
The native embedding's independently selected `providerProfile` and
`limitsIdentity` must equal the budget's versioned profile and durable identity.
Normalization and reservations precede immutable JSON freezing; native committed
release still owns the provider effect. No adapter
fetch follows a native authorization precheck. Native post-dispatch uncertainty
and its original fence survive interruption.

## Linux installed runtime

Use an installed package and exact Pi 1.0.2 dependency tree, a dedicated private
profile, and a disposable cwd outside source, operator configuration and journal.
The `--limits` and `--linux-runtime` files must be outside the profile, the
disposable cwd and the installed tree; a guest-writable pin refuses before launch.
Linux additionally requires `--linux-runtime /absolute/private/runtime.json`.
The manifest contains the independently selected real Node executable and exact
runtime files, with SHA-256 hashes and explicit loader aliases:

```json
{
  "schema": "chio.pi.linux-runtime.v1",
  "architecture": "arm64",
  "node": "/usr/local/bin/node",
  "nodeSha256": "<64 lowercase hex digits>",
  "runtimeFiles": [
    {
      "path": "/usr/lib/aarch64-linux-gnu/ld-linux-aarch64.so.1",
      "mountPath": "/lib/ld-linux-aarch64.so.1",
      "sha256": "<64 lowercase hex digits>"
    }
  ]
}
```

The example is a schema illustration, not a complete library inventory. Pin every
selected executable dependency, including libc, libstdc++, libm, libgcc, libdl,
libpthread and the loader where required by that installation. The qualification
runner emits the actual complete inventory for its pinned image. The launcher
checks actual architecture and bounded regular-file hashes; omitted dependencies
fail at confined startup, with no unconfined fallback. macOS `otool` discovery is
not used for Linux. Never select a home directory or an operator state tree as
installed code. The operator owns the installed tree and runtime throughout launch.

Bubblewrap must support working user, mount, network, PID and IPC namespaces.
The profile requires `--unshare-all --unshare-user --die-with-parent --new-session`,
clears the guest environment, drops capabilities, mounts installed code and the
selected runtime read-only, constructs private proc/dev/tmp and a disposable cwd,
and mounts only two individual parent-owned Unix socket leaves. The private profile
is writable. The installed/runtime closures refuse sockets, special files and
escaping symlinks. A guest can create links in its profile, so on Linux and macOS
the launcher refuses, before any parent write into the profile, a linked profile
root, profile links that escape it, special files, a link or multiply linked file
at the published transport name, and a workspace inside the profile. The transport
configuration is published through an exclusive temporary file and atomic rename.
Treat a refused profile as untrusted guest output; do not repair it by following
its links. The native gateway, provider credentials, prepared operator
configuration, journal and protected resource source are absent.

Bubblewrap arguments, including `--setenv` values, are world-readable in `/proc`
for the guest's lifetime. The guest environment therefore carries no secret: the
model relay bearer reaches the guest only on inherited descriptor 4, which the
bootstrap reads to end of file (bounded) and closes before it loads the Pi CLI.
Credential-like names are refused as bubblewrap environment. The gateway proxy
bearer stays in the private transport file. The launcher's runtime record reports
`seccompSha256` for the BPF program and a `profileSha256` covering the complete
bubblewrap argument vector together with that BPF hash. Its private control
directory (relay sockets, BPF file or macOS policy file) is removed after the
guest exits; the macOS record carries the exact policy text.

The sockets lead only to the parent gateway proxy and the fixed model relay.
The guest loopback servers use the services' expected ports, preserving exact HTTP
Host and MCP session bytes. No guest selector supplies destinations or arbitrary
sockets. Parent service route/method/Host/authentication checks also refuse CONNECT
and alternate routes. Relays bound connections and queued bytes and pause a source
whenever its peer's queue reaches the bound, so ordinary backpressure never
disconnects. A side that ends cleanly closes only after its peer has flushed every
queued byte. Both directions are cleaned on disconnect, and relays pin private
socket ownership/type/link/identity. The relay idle timeout is the larger of
120,000 ms and the provider timeout plus 10,000 ms. Socket paths exceeding 100
bytes refuse rather than truncate.

`chio.pi.linux-whole-guest.v1` uses a separate architecture-pinned seccomp program,
installed from FD3 at bubblewrap's final exec stage. It permits qualified Unix and
IPv4 TCP stream sockets and Node threads. It denies process creation, later namespace
changes, namespace clone flags, io_uring setup, `ptrace`, `process_vm_readv`,
`process_vm_writev`, `pidfd_getfd` and x32 syscall variants. Bubblewrap's own PID 1
runs without this filter, so the guest must not be able to drive it. `clone3`
returns ENOSYS for libc's qualified thread fallback. Both local relays and Pi SDK
start in one Node bootstrap. The coding-resource recipe has its own socket-denying
filter ([CODING-RESOURCE.md](CODING-RESOURCE.md#recipe-and-publication-confinement));
recipe qualification does not qualify this guest boundary.

Parent supervision waits for actual observed exit, sends a graceful signal and
escalates to group SIGKILL after its bounded interval if exit is still absent.
SIGINT, SIGTERM, SIGHUP, SIGQUIT and the wall deadline all start this sequence. A
parent that exits while the guest runs, including by an uncaught exception, sends
group SIGKILL from its exit hook. `ChildProcess.killed` is not evidence. Any
remaining isolated group is cleaned after wrapper exit. On Linux, bubblewrap's
die-with-parent and PID namespace settle the guest even when the parent is killed.
On macOS, as a best effort for a parent killed by SIGKILL, the guest's stdin is a
lifeline held only by the parent: when it closes, the guest stops as on SIGTERM and
exits after the graceful-kill interval. The recorded guest process group still
blocks stale-owner recovery until the group is gone. Signals never remove native
operations, fences, original mappings or conservative model reservations.

## Reproduce measured Linux acceptance

```sh
npm run build
node scripts/qualify-linux-guest.mjs > /tmp/chio-pi-linux-guest.log 2>&1
```

The runtime image must be present as
`sha256:6d5bbc54ae9fd29177042755c41667006b708874c7ed6d489d543e931e33fe23`.
Its rebuild reference is `scripts/linux-guest/Dockerfile`, based on Node digest
`sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3`.
A rebuilt image can be selected explicitly with `--image sha256:DIGEST`; the runner
requires the exact measured Node, bubblewrap, loader and library hashes before any
guest launch, and records the selected image. This supports cold reproduction
without the original temporary fixture. The runner builds a separate task-owned image for its independent native syscall
addon. It records source/addon/image hashes, copies only the addon into the selected
fixture installation, and never mounts a compiler into the guest. The actual
runtime retains and measures the original Node, bubblewrap and library pins.

Only task-owned disposable `--rm` outer containers are used. Acceptance requires
`--privileged --network none` in this measured Colima VM to permit inner user
namespaces. It starts private synthetic services, imports actual Pi 1.0.2, runs
both positive routes and a native SDK session, checks forbidden reads/writes,
network/Unix routes, namespaces, process creation and the cross-process syscalls,
and independently observes requests and `/proc` survivors. The SDK session receives
its model bearer on descriptor 4 while an observer samples every process command
line and environment for it. The runner also starts the installed `chio-pi`
launcher's Linux branch against a scripted kernel fixture with an unreachable
provider, and checks its runtime record, one authenticated reservation, the
released owner lock and the removed control directory. No actual provider or
native kernel is called. Guest launches use generous walls so a heavily loaded
VM does not time out Pi's import; the termination cases keep short deadlines.

Measured: Linux arm64 6.8.0-64-generic, Node 22.23.1, bubblewrap 0.8.0-2+deb12u1,
libc 2.36-9+deb12u14 and libstdc++ 12.2.0-14+deb12u1. Actual Linux x64 runtime,
ordinary Docker defaults, another installation and native coding/P5 acceptance
remain open. Compiled x64/x32 BPF component checks are separate from real x64 runtime
acceptance. Exact results are in the Task 6 evidence record and, for the Task 8
filter, relay secret and launcher changes, the Task 8 final review fixes record.
