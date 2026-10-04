# Parent limits and Linux guest contracts

This specifies Task 6. The user selected keeping Codex available with honest
limits. Resource recipe confinement and whole-Pi guest confinement are separate
boundaries. Neither substitutes for native P5 qualification.

## Fixed provider profiles and durable limits

Keep explicit, versioned profiles for `openai/gpt-4.1-mini` and
`openai-codex/gpt-5.5`, with their existing fixed destinations and no fallback.
The OpenAI API profile supports and enforces `max_output_tokens`, including
reasoning and visible output. The Codex subscription profile does not support
that ceiling. Show its hard output-token limit and remaining token budget as
unavailable, while enforcing request count, request timeout, wall deadline and
response-size bounds. Do not reject Codex solely for the missing token ceiling,
send the unsupported parameter, estimate provider tokens from visible bytes,
or advertise a provider-compute or spending ceiling from a stream byte limit.

Persist conservative parent reservations outside the guest and outside the
native journal's root-level `.json` namespace. Bind authority, registry, profile
version and limits. Resume must retain the existing counts and absolute deadline;
changed limits or profile cannot reset them. Protect the state with private
ownership, regular-file checks, bounded reads, exclusive ownership, atomic writes
and file/directory fsync. Refuse a corrupt, mismatched or missing required record.
First use creates it explicitly; resume does not silently recreate lost state.

Reserve the request count and supported output tokens durably before provider
submission. Storage failure produces zero outbound requests. A reservation whose
submission or result is uncertain remains spent. Reserve the actual final API
ceiling, not a caller's stale pre-normalization value. A finite token budget cannot
be exceeded by concurrent requests or restart. Validate safe integer bounds and
the provider's minimum supported ceiling.

Normalize the request and apply final profile/token limits before freezing the
bytes for Task 5 native committed release. Subsequent serialization, model/account
changes or limit changes cannot alter those bytes. Governed egress must still
pass through native committed release; adding a local reservation does not
authorize a separate relay fetch.

Enforce provider timeout and bound the streaming response while reading it,
before buffering an unbounded body. Cancel upstream on timeout, disconnect or
overflow. Errors must not print provider credentials, account tokens or raw
private request bodies. Keep diagnostic and original-operation recovery commands
available after the model deadline or quota expires.

## Parent termination

Start one confined guest and enforce the absolute wall deadline in the trusted
parent. Interrupt or terminate gracefully, then use a bounded hard-kill deadline
if actual process exit has not occurred. `ChildProcess.killed` reports that a
signal was sent; it cannot prove exit. Wait for observed exit and test a child
that ignores the first signal. Clean up the process group or native confinement
subtree rather than leaving descendants. Interruption never establishes native
non-dispatch, deletes an operation, clears a fence or resets a reservation.

## Linux whole-Pi boundary

Use bubblewrap with `--unshare-all`, explicit `--unshare-user`,
`--die-with-parent` and `--new-session`. Require working user, mount, network,
PID and IPC namespaces. Refuse missing binary, unsupported namespaces or setup
failure; never fall back to shared host networking or unconfined Node.

Mount the independently selected installed Node/runtime and Pi/plugin dependency
tree read-only. Provide an isolated writable profile, private temporary storage,
private proc/dev mounts and exactly two parent-owned Unix sockets. One socket
connects only to Task 4's trusted gateway proxy; the other connects only to the
fixed model relay. The native gateway's own port and credential are not a guest
endpoint. Do not expose prepared operator configuration, native journal,
resource source/state/artifacts, provider credentials, home profile, Docker socket
or other host services.

`createUnixRelay(socketPath, fixedLoopbackPort)` connects to exactly one parent
loopback service. `createLoopbackRelay(socketPath, expectedPort)` runs inside
the isolated guest and preserves the service's expected HTTP Host port. Do not
accept a guest-selected host, port, socket, CONNECT destination or redirect.
Unix socket parents and leaves require private ownership and link/type checks.
Bound active connections, queued bytes, disconnect handling and cleanup. A socket
path should be short enough for platform Unix-address bounds; do not truncate
paths into collisions.

If enforcing the no-fork contract with seccomp, pin the actual architecture and
measured BPF profile. Allow required Node threads; deny process creation,
`setns` and later namespace changes. `clone3` may need a qualified `ENOSYS`
response to permit the libc thread fallback. Install the filter at the intended
stage after namespace setup, not where it prevents bubblewrap itself from
constructing the boundary. Missing or mismatched profiles refuse launch.

## Evidence

Test two allowed service routes, correct Host/session handling, forbidden general
network/Unix sockets, forbidden journal/config/credential/source reads, denied
writes to installed code, namespace identities, process creation and termination.
Use an independent observer for request counts and surviving processes.

The prepared local image is
`sha256:6d5bbc54ae9fd29177042755c41667006b708874c7ed6d489d543e931e33fe23`,
built from Node image digest
`sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3`.
The measured VM uses Linux arm64 6.8.0-64-generic, Node 22.23.1 and bubblewrap
0.8.0-2+deb12u1. Its disposable outer container requires `--privileged` and
`--network none` to permit inner namespaces. Report that requirement explicitly;
these probes do not qualify ordinary Docker defaults, another Linux installation,
or the native P5 process profile. Ship reproducible qualification instructions
and preserve exact dependency and runtime identities with the results.
