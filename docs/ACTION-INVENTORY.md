# Pi action inventory

Source qualification: Pi `@earendil-works/pi-coding-agent@0.85.1`, upstream tag commit `d981de1229ef899957bbe968bc8dcda02a21f477`. Inspected published JavaScript and declarations, CLI `--version` and `--help`, and official [SDK](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md) and [extension](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md) contracts on 2026-09-09. The [official Pi site](https://pi.dev/) now installs the Earendil package; the former Mario Zechner package remains at 0.73.1 and is not the selected host.

Confidence: high for the pinned source inventory and executed finite dispatcher cases. Complete integration acceptance remains unresolved.

## Mode and owner

The proposed protected mode embeds the stock Pi SDK with the native `chio_execute` extension. Pi owns model reasoning and session records. The Chio MCP edge owns protected execution. The adapter has no local effect callback. The host process, its package tree, model credentials, and operator profile are trusted components outside the agent-writable resource domain.

The SDK's explicit tool allowlist filters its complete registry, including subsequent `setActiveToolsByName` attempts. No project or global extension discovery runs. Loading the extension into an ordinary unrestricted Pi CLI session does not establish this mode.

| Surface in selected Pi release | Ordinary Pi behavior / resource owner | Protected-mode disposition | Current evidence |
| --- | --- | --- | --- |
| `read` | Host process reads local files, including sensitive content | Absent from tool registry | Stock dispatcher rejects forced call; file baseline unchanged |
| `write`, `edit` | Host process mutates files | Absent from registry; use kernel-owned file tools when qualified | Forced `write` rejects; kernel useful writes unresolved |
| `grep`, `find`, `ls` | Host reads paths and may use search subprocesses | Absent from registry | Activation attempts leave them unavailable |
| `bash`, `powershell` | Host spawns shell; descendants inherit local resource access | Absent from registry | Forced shell/Node descendant call rejected before execution |
| Shell indirection, `curl`, git, tmux | Available through ordinary shell, with network/credential implications | No shell dispatch path | Dispatcher absence tested; real kernel-side shell isolation remains outside this host adapter |
| Model network | Pi provider implementation uses operator-selected model authentication | Fixed operator-selected provider/model; model cannot set endpoint | OpenAI live-model call executed; credential values not retained |
| Agent-chosen network | Usually shell or custom extension tool | Only explicitly kernel-owned tools | Local shell/custom tool route blocked; external network-tool acceptance unresolved |
| Custom tools | Native extension or SDK `customTools` registration | Only `chio_execute` is allowed | Filtered from registry even on later activation |
| MCP | Supplied through extensions rather than a native built-in MCP client | Only Chio bridge MCP execution | Real write/read and forbidden-path denial through bridge 0.3.0 |
| Delegation / subagents | User-installed extensions or shell-spawned Pi processes | No third-party extensions, shell, or delegation tool | Forced `delegate` call rejected |
| Background work | Ordinary shell/tmux or extension-created jobs | No local background job surface | Underlying shell/custom routes absent; no independent background promise |
| Project/global extensions | Arbitrary trusted JavaScript at load time | Discovery disabled; one in-memory factory only | Malicious `.pi/extensions` and settings injection did not execute |
| Skills, prompts, AGENTS/context files | Local reads can expose context; extensions can augment discovery | Discovery disabled in this profile | Sensitive AGENTS content not present in system prompt |
| User `!` / `!!` shell | Interactive mode executes user bash | Interactive mode not exposed by protected runner | Source inventory only; unsupported mode cannot be selected by runner |
| RPC `bash`, credentials, extension commands | Operator-facing RPC can invoke paths outside LLM tool registry | Raw Pi RPC is not exposed | Protected runner accepts only prompt/config/resume options |
| File attachments (`@path`) | CLI expands local file content | Raw CLI argument parser is not exposed; prompts remain literal strings | SDK surface selection; attachment probes pending |
| Session resume / retry | Pi persists messages, models, and tool results | Same tool allowlist reapplied; client operation interlock retained in dedicated profile | Real same-ID resume and unknown-outcome host restart observed; full cutpoint matrix pending |
| Operator configuration | Trusted operator selects model, resource authority, endpoint, signer, profile | Outside agent resource scope | Tampering through local agent tools unavailable; resource-side profile exclusion must be tested |
| Tool cancellation | Pi supplies AbortSignal | Propagated to bridge; uncertain dispatch locks profile | Real host pre-dispatch cancellation observed; response-loss cutpoint exercised separately |

Model-emitted sibling calls use Pi's supported sequential tool-execution mode, preserving the one-operation client interlock without rejecting useful batches. A real model emitted two writes in one assistant message and two reads in its next message; all completed through the kernel.

Consequential kernel tools must have their own scoped resource and authority enforcement. A remote shell that can edit this profile, obtain credentials, or reach a second route to the protected resource invalidates the proposed mode. The current host tests do not establish that resource-side boundary.
