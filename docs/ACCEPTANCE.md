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
| Kernel / bridge | Shared 0.3.0 execution-evidence contract candidate pending real combination |
| Normal profile | Unmodified; all tests use separate temporary workspaces/profiles |

Initial discovery found no dedicated integration under the six Chio repositories searched, and no `pi` executable on PATH. That search is bounded; it does not prove absence everywhere. Host installed locally from npm with lifecycle scripts disabled. npm lockfile records dependency integrity. No unpublished sibling package is needed for the host or host-only contract tests.

## Results

| Gate | Status | Executed evidence | Remaining required work |
| --- | --- | --- | --- |
| I01 Installation | Partial | Exact published Pi host installed locally; CLI version verified; plugin builds | Packaged plugin/bridge/kernel cold install and discovery with final pins |
| I02 Useful work | Unresolved | None through kernel | Representative real-host resource workflow and results |
| I03 Denial/bypass | Partial, contract evidence | Actual stock dispatcher with scripted model refuses native write/read/shell/custom/delegate; protected file remains unchanged; discovered malicious extension does not run | Live model + real kernel denials, sensitive reads, alternate tool/descendant/network controls, resource-side config isolation |
| I04 Kernel dependency | Partial, bounded live observation | Actual OpenAI-backed Pi emits one tool call with missing executor; no file mutation; native extension omission/crash tests | Real kernel absent/killed/timeout/malformed/drop-response cases, plugin runtime faults |
| I05 Authority | Unresolved | No real authority cases | Principal/session binding, expiry, revocation, escalation, budgets, approvals |
| I06 Evidence | Unresolved | Adapter consumes verified bridge outcomes; no local unsigned success fallback | Real trusted receipt binding and substitution cases |
| I07 Recovery | Partial, contract evidence | Durable unknown interlock survives client recreation and blocks new dispatch | Live retry/cancellation/parallel/resume/restart cases and exact cutpoints |
| I08 Delivery | Unresolved | Installation/operation procedure being authored | Published compatible artifact combination, cold upgrade/recovery/removal and overhead |

Raw live evidence: [live-no-kernel.json](../evidence/2026-09-09/live-no-kernel.json). It records one real Pi model-selected tool attempt, a tool error, independent protected-file content before/after, and actual model usage. It is not a mock kernel success. The observer was first proved by writing and reading its control content.

`npm test` currently runs host dispatcher and client interlock contract tests. Those tests use the published, unmodified Pi `AgentSession` and actual tool dispatcher, but a scripted provider or injected executor. Their result cannot close real host/kernel acceptance. There are no skipped assertions in that suite.

## Current blockers

The shared MCP edge must supply the agreed execution-evidence projection with trusted signer, actual caller, capability, resource/server, parameters, request identity, and output binding. A bearer precheck followed by local native execution is expressly excluded. The bridge owner is implementing this shared adapter while the kernel owner qualifies its real route.

No claim is made that the client uncertainty interlock is a transactional kernel dispatch ledger, that a verified denial proves absence of an earlier effect, or that a fresh host profile may automatically retry an uncertain operation. These distinctions remain required in the final acceptance matrix.
