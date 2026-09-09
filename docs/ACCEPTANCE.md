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
| Bridge | Final `@chio/bridge@0.3.0` candidate SHA256 `68b5c46638449710e3251f41aa1317f364c24138ae6cba3f45aeea51960ef3ff`; embeds SDK `0.1.1-rc.1` |
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
| I04 Kernel dependency | Partial, real observations | Missing executor, unreachable endpoint and malformed response all stop real host effects; extension omission/crash stock-host tests | Coordinated real kernel kill/restart, timeout after dispatch, runtime plugin failure cases |
| I05 Authority | Partial, real observations | Wrong caller, capability and retained kernel session are rejected before effects; target files absent | Expiry, revocation, aggregate budget exhaustion, pending/rejected approvals |
| I06 Evidence | Partial, real observations | Actual results carry trusted bound receipts; wrong signer causes unknown result, never verified success | Request/result substitution and malformed/forged evidence through full real host matrix |
| I07 Recovery | Partial, real observations | Same Pi session resumes; sibling calls serialize and complete; real cancellation before dispatch; wrong-signer unknown survives host restart and prevents second effect; retained replay contract tests | Post-dispatch interruption/cancellation and real retry/lease-fencing cutpoints |
| I08 Delivery | Partial | Documented direct-host/package install tested in fresh directory with empty cache; installed CLI useful workflow passes | Public accepted artifact combination; kernel session upgrade/recovery/removal and overhead/interventions |

Raw live evidence: [live-no-kernel.json](../evidence/2026-09-09/live-no-kernel.json). It records one real Pi model-selected tool attempt, a tool error, independent protected-file content before/after, and actual model usage. It is not a mock kernel success. The observer was first proved by writing and reading its control content.

`npm test` currently runs nine host dispatcher/client interlock contract tests. Those tests use the published, unmodified Pi `AgentSession` and actual tool dispatcher, but a scripted provider or injected executor. Their result cannot close real host/kernel acceptance. There are no skipped assertions in that suite.

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

## Current blockers

The real shared MCP edge now supplies the execution-evidence projection and retained session context used by this adapter. Complete acceptance still needs the operator-controlled expiry/revocation/budget/approval scenarios and coordinated kernel interruption/fencing cases. The shared endpoint is used by other host workers; it cannot be killed independently by the Pi worker. These required cases remain unresolved rather than skipped as optional.

No claim is made that the client uncertainty interlock is a transactional kernel dispatch ledger, that a verified denial proves absence of an earlier effect, or that a fresh host profile may automatically retry an uncertain operation. These distinctions remain required in the final acceptance matrix.
