# Pi integration acceptance record

Status: **not accepted**. No entire I01-I08 gate is closed. All six program integrations remain independently required.

## Qualified baseline

| Item | Identity |
| --- | --- |
| Host | `@earendil-works/pi-coding-agent@0.85.1` |
| Upstream repository | `https://github.com/earendil-works/pi` |
| Upstream tag / source | `v0.85.1`, `d981de1229ef899957bbe968bc8dcda02a21f477` |
| Host npm tarball | `https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-0.85.1.tgz` |
| Host npm integrity | `sha512-FGRN+OHbWaefBPGaTggAdLjrIHW+s2PzLyglz/5dfLzb9of7uuXMXYC0fJIeZTw+shS32o2cuQ9jF7YSDuL/oQ==` |
| Plugin | `@chio/pi-plugin@0.1.0`, new dedicated repository, candidate only |
| OS / Node | Darwin 25.4.0 arm64 / v25.5.0 |
| Selected host mode | Native Pi SDK, one inline native extension, explicit registry allowlist |
| Model observation | Actual OpenAI `gpt-4.1-mini` through Pi's provider runtime |
| Bridge observed here | `@chio/bridge@0.3.0` candidate SHA256 `68b5c46638449710e3251f41aa1317f364c24138ae6cba3f45aeea51960ef3ff`; embeds SDK `0.1.1-rc.1`; superseded for delivery pending credential update |
| Final kernel | Source `04b7d366d62c886c39bc202f58ef0d44e8f5aee7`, binary SHA256 `e7539855906bd5eb7b4eb2e5a12ca0533889cf61ced3bf4adf5850b792aa6447`, MCP edge port 58483 |
| Final policy | SHA256 `8c2c732d9115799b13150f7924da0e68fc1f9b2d42a2618912511d407035cc66` |
| Resource image | `sha256:0106edcb15a1c0d12d914ea0504f0e63ec85f5e6fdd3825b4d7a0d1367af3991`, isolated volume `chio-required-agents-final-20260909` |
| Normal profile | Unmodified; all tests use separate temporary workspaces/profiles |

Initial discovery found no dedicated integration under the six Chio repositories searched, and no `pi` executable on PATH. That search is bounded; it does not prove absence everywhere. Host installed locally from npm with lifecycle scripts disabled. npm lockfile records dependency integrity. No unpublished sibling package is needed for the host or host-only contract tests.

## Results

| Gate | Status | Executed evidence | Remaining required work |
| --- | --- | --- | --- |
| I01 Installation | Partial | Actual packaged plugin cold install and real host execution, direct pinned Pi peer installation, final bridge pinned | Full published kernel/plugin combination and independent operator installation |
| I02 Useful work | Observed in selected profile | Actual OpenAI-backed Pi writes/reads files through kernel; two sibling writes and two sibling reads from cold-installed CLI; independently observed bytes match | Final accepted release identities and broader promised coding workflow remain subject to full program gate |
| I03 Denial/bypass | Partial, real observations | Actual host forbidden write/read denied; independent forbidden-file hashes unchanged; native shell alias unavailable; legitimate work then succeeds; config write outside resource mount returns tool error | Remaining alternate resource paths, descendant/network controls at resource boundary and full action matrix |
| I04 Kernel dependency | Partial, real observations | Missing executor, unreachable endpoint and malformed response all stop real host effects; lost response after upstream effect times out and remains unknown; extension omission/crash stock-host tests | Coordinated real kernel kill/restart, runtime plugin failure cases |
| I05 Authority | Partial, real observations | Wrong caller, capability and retained kernel session rejected before effects; actual revoked-capability call denied and target absent | Expiry, aggregate budget crossing, pending/rejected approvals, final session-scoped credential qualification |
| I06 Evidence | Partial, real observations | Actual results carry trusted bound receipts; wrong signer, substituted request and substituted output rejected as unknown by actual host | Remaining malformed/forged evidence through full real host matrix |
| I07 Recovery | Partial, real observations | Same Pi session resumes; sibling calls serialize and complete; real cancellation before dispatch; unknown signer/reply substitution/response loss survives host restart with one upstream dispatch; retained replay contract tests | Post-dispatch interruption/cancellation and real retry/lease-fencing cutpoints |
| I08 Delivery | Partial | Documented direct-host/package install tested in fresh directory with empty cache; installed CLI useful workflow passes | Public accepted artifact combination; kernel session upgrade/recovery/removal and overhead/interventions |

Raw live evidence: [live-no-kernel.json](../evidence/2026-09-09/live-no-kernel.json). It records one real Pi model-selected tool attempt, a tool error, independent protected-file content before/after, and actual model usage. It is not a mock kernel success. The observer was first proved by writing and reading its control content.

`npm test` currently runs nine host dispatcher/client interlock contract tests, two terminal-status invariant tests and two model-relay validation tests. Host tests use the published, unmodified Pi `AgentSession` and actual tool dispatcher, but a scripted provider or injected executor. Their result cannot close real host/kernel acceptance. There are no skipped assertions in that suite.

## Real host evidence and negative results

- `live-kernel-useful.jsonl` and `live-kernel-useful-observer.json`: write/read through Pi, real kernel, actual filesystem server, independent read-only Docker observer.
- `live-kernel-denied-write.jsonl`, `live-kernel-denied-read.jsonl`, `denied-*-record.json`, and `forbidden-before/after.jsonl`: forbidden host attempts, retained signed deny receipts, unchanged independent hashes.
- `live-kernel-resume.jsonl`: original Pi session ID survives resume and reads the existing result.
- `live-kernel-cases-summary.json`, matching raw JSONL and `live-kernel-cases-observer.jsonl`: wrong authority/session and malformed/unreachable service observations.
- `live-wrong-signer.jsonl`: one allowed kernel write occurs, but its result fails the deliberately wrong trust root. The operation is unknown to the configured verifier. `live-wrong-signer-restart.jsonl` and observer confirm a later operation is fenced after restart. This is evidence rejection and conservative recovery, not proof that the original effect was prevented.
- `live-native-bypass.jsonl` and observer: shell alias refusal, then successful legitimate write. `live-config-tamper.jsonl` reports the filesystem server's outside-root error as an actual Pi tool error.
- `live-cancel.json`: real model selected a call; actual Pi event subscriber cancelled before dispatch. `live-cold-observer.jsonl` records absent cancelled target and the successful cold-install sibling-call resources.
- `cold-install.txt`: retained **failed** first packaging path. npm exited zero after omitting Pi transitive dependencies; running the installed CLI caught missing `chalk`. The corrected direct-host peer procedure appears in `cold-direct-host-install.txt`, `cold-peer-plugin-install.txt`, `cold-peer-cli-help.txt`, and `live-cold-installed.jsonl`.

The first actual kernel runs used bridge artifact `2e45e7f0371763365aea6d02eac0f7fe7faa50405889e23236f6d1d515be04e7`. Cold-install peer candidate `4f373e8842775b65531ca720f3ecfc2a377f4ad65cab2fc36bbbafbde6b56a12` contains that bridge. The port-58482 kernel's binary hash was not recorded before a rebuild replaced its file, so those observations have an explicit artifact identity gap and cannot be assigned the final binary hash.

Bridge-only reruns against that earlier kernel are in `final-bridge68b5c466/`. The completely pinned combination is separately recorded in `final-kernel04b7-bridge68b5c466/`, including `kernel-provenance.json`. Earlier observations and failed proxy attempts are preserved. In one bridge-only run the model requested the forbidden read before its useful read; the denial correctly fenced subsequent reads. That mixed run does not prove a completed write/read workflow; the separate useful-only run does.

Proxy evidence substitution and response loss operate on real kernel replies after a harmless resource write. They test refusal to report verified success and retention of unknown outcomes. They do not prove prevention of the original authorized write. Independent resource observers are required alongside each raw host trace.

`final-kernel04b7-bridge68b5c466/faults-with-restart/` retains the original SSE replies and six actual Pi process transcripts. For each substituted-output, substituted-request and lost-response case, the proxy observed exactly one upstream tool dispatch across the first process and restart. The first authorized file exists; the distinct restart target is absent. The earlier proxy versions failed before dispatch and remain identified as failed attempts.

The same pinned folder retains forbidden read/write receipts and unchanged before/after hashes, a real pre-dispatch cancellation, and same-session resume. Its observed read tool interval was 811.012417 ms in one run, including bridge, kernel, resource, verification and fsync. This is not isolated incremental overhead versus native Pi.

`authority/` records a real revoked-capability call and absent target. Its budget setup made 63 verified direct kernel reads outside Pi, explicitly preparation rather than host acceptance. Pi's next call encountered a kernel handshake failure and the setup could not prepare fresh authority afterward. The 64th/65th crossing and fresh restoration therefore remain unresolved in that run; no resource effects were observed for their targets.

The CLI now emits an explicit terminal outcome. `live-provider-error.jsonl` uses an intentionally invalid, non-secret test key: the actual provider returned 401, the terminal outcome is `failed`, and process exit is 1. `live-terminal-cancel.jsonl` and its observer record show an actual provider-generation interruption with SIGINT, `cancelled`, exit 130 and no tool calls. This checks terminal status, separately from tool cancellation. Signed denial/uncertain execution retains its fence and produces exit 2 even when the model subsequently writes an ordinary explanation.

## Current blockers

The real shared MCP edge now supplies the execution-evidence projection and retained session context used by this adapter. Complete acceptance still needs expiry, aggregate budget crossing, approval scenarios and coordinated kernel interruption/fencing cases. The shared endpoint is used by other host workers; it cannot be killed independently by the Pi worker. Its operator preparation is being changed to deliver a credential restricted to the retained session, so the earlier bridge and artifacts remain intermediate evidence. These required cases remain unresolved rather than skipped as optional.

Earlier SDK host runs trusted the process and had no OS sandbox. The new protected launcher adds a default-deny macOS process boundary and operator-owned model relay. [Process qualification](SANDBOX-QUALIFICATION.md) records an actual model completion and exact-policy hostile-process probes: operator/cross-host file reads and aliases, immutable config/code writes and hardlinks, Node/shell subprocesses and unrelated network access were denied, with independent positive controls. That probe used a deliberately non-authorizing kernel bearer and cannot close the final kernel gates. The guest's own journal remains mutable, so acceptance requires the shared resource-owner completed-unacknowledged/acknowledgement contract and authenticated delegated-credential validation.

No claim is made that the client uncertainty interlock is a transactional kernel dispatch ledger, that a verified denial proves absence of an earlier effect, or that a fresh host profile may automatically retry an uncertain operation. These distinctions remain required in the final acceptance matrix.


## Launcher-owned HTTP transport candidate

Artifact `8ef1de6bcb55e5c96ace55d1c56d0ede4d01e2c5d6cf8dda9d44c4d517b00812`
installed through an empty-cache public npm path with bundled Chio dependencies.
The actual Pi 0.85.1 AgentSession and OpenAI gpt-4.1-mini completed write, edit,
read and list against kernel `33dd1dea21a4...`. An independent Docker observer
found `Pi kernel verified` and exactly those four dispatches. The guest had
only ephemeral launcher transport authority. The exact launched Seatbelt policy
also denied direct operator/config/cross-host reads, aliases, writes, hardlinks,
Node/shell descendants, the kernel port and an unrelated live local listener.
Independent read/listener controls succeeded outside the sandbox. These are
separate real host and injected OS process observations, not a model bypass claim.
Thirteen component tests passed. Raw evidence is in `evidence/2026-09-09/http-transport`.

The previous worker's `scoped-preack-25d5717` evidence remains historical and
explicitly cannot establish downstream response-loss protection. Current real
negative actions, delivery loss across all transport stages, approval, budget,
revocation, restart and remaining I01-I08 gates are still open. No host acceptance
or publication is claimed.
