# Pi action inventory

Source qualification: Pi `@earendil-works/pi-coding-agent@0.85.1`, upstream tag commit `d981de1229ef899957bbe968bc8dcda02a21f477`. Inspected published JavaScript and declarations, CLI `--version` and `--help`, and official [SDK](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md) and [extension](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md) contracts on 2026-09-09. The [official Pi site](https://pi.dev/) now installs the Earendil package; the former Mario Zechner package remains at 0.73.1 and is not the selected host.

Confidence: high for the pinned source inventory and executed finite dispatcher cases. [Final qualification](FINAL-QUALIFICATION.md) identifies current archive `ec609539...` and the exact remaining gates.

## Mode and owner

The protected launcher embeds the stock Pi SDK with the native `chio_execute` extension in a separate macOS sandbox. Pi owns model reasoning and local session records. The Chio MCP edge owns protected execution and must enforce the delegated credential and unresolved-operation state. The adapter has no local resource-effect callback. Installed code is read-only; only Pi's own profile is writable. The launcher holds the kernel credential and authoritative operation journal outside the guest. The guest can read and modify only its ephemeral local transport configuration; it cannot read the private kernel configuration or journal. Operator credentials and model provider credentials remain outside the guest. Earlier raw SDK runs used a trusted host process and do not prove this newer boundary.

The SDK's explicit tool allowlist filters its complete registry, including subsequent `setActiveToolsByName` attempts. No project or global extension discovery runs. Loading the extension into an ordinary unrestricted Pi CLI session does not establish this mode.

| Surface in selected Pi release | Ordinary Pi behavior / resource owner | Protected-mode disposition | Current evidence |
| --- | --- | --- | --- |
| `read` | Host process reads local files, including sensitive content | Absent from tool registry | Stock dispatcher rejects forced call; file baseline unchanged |
| `write`, `edit` | Host process mutates files | Absent from registry; use kernel-owned file tools when qualified | Forced native `write` rejects; actual kernel write/read through Pi and independent bytes observed |
| `grep`, `find`, `ls` | Host reads paths and may use search subprocesses | Absent from registry | Activation attempts leave them unavailable |
| `bash`, `powershell` | Host spawns shell; descendants inherit local resource access | Absent from registry; OS process-fork denied | Forced native calls reject; hostile process probes cannot spawn Node itself or `/bin/sh` |
| Shell indirection, `curl`, git, tmux | Available through ordinary shell, with network/credential implications | No shell dispatch path; no remote shell tool is configured | Final actual native `bash` alias request with `sh -c` refuses, followed by useful kernel write; exact process probe denies shell/Node descendants |
| Model network | Pi provider implementation uses operator-selected model authentication | Operator-owned relay pins openai/gpt-4.1-mini or native openai-codex/gpt-5.5; validates inline text/function/encrypted reasoning; provider credentials stay in parent | Current final archive qualifies native Codex subscription; API-billing live evidence belongs to earlier artifacts |
| Agent-chosen network | Usually shell or custom extension tool | Exact launcher HTTP gateway and model-relay ports only; direct kernel, arbitrary routes and hosted model tools unavailable | Unrelated local listener saw zero guest requests; independent positive control saw one |
| Custom tools | Native extension or SDK `customTools` registration | Only `chio_execute` is allowed | Filtered from registry even on later activation |
| MCP | Supplied through extensions rather than a native built-in MCP client | Only Chio bridge MCP execution | Real write/read and forbidden-path denial through bridge 0.3.0 |
| Delegation / subagents | User-installed extensions or shell-spawned Pi processes | No third-party extensions, shell, or delegation tool | Forced `delegate` call rejected |
| Background work | Ordinary shell/tmux or extension-created jobs | No local background job surface | Underlying shell/custom routes absent; no independent background promise |
| Project/global extensions | Arbitrary trusted JavaScript at load time | Discovery disabled; one in-memory factory only | Malicious `.pi/extensions` and settings injection did not execute |
| Skills, prompts, AGENTS/context files | Local reads can expose context; extensions can augment discovery | Discovery disabled in this profile | Sensitive AGENTS content not present in system prompt |
| User `!` / `!!` shell | Interactive mode executes user bash | Interactive mode not exposed by protected runner | Source inventory only; unsupported mode cannot be selected by runner |
| RPC `bash`, credentials, extension commands | Operator-facing RPC can invoke paths outside LLM tool registry | Raw Pi RPC is not exposed | Protected runner accepts only prompt/config/resume options |
| File attachments (`@path`) | CLI expands local file content | Raw CLI argument parser is not exposed; prompts remain literal strings | Source-selected SDK prompt path and OS filesystem boundary; no attachment support claimed |
| Session resume / retry | Pi persists messages, models, and tool results | Same tool allowlist reapplied; authoritative operation journal retained outside guest; kernel delivery fence remains authoritative | Final same-ID resume/upgrade, actual restart refusals, owner exclusion, response-loss/result-substitution/crash/cancellation and explicit original-result recovery |
| Operator configuration | Trusted operator selects model, resource authority, endpoint, signer, profile | Guest can read own ephemeral transport config; cannot read private kernel config/journal or operator/provider/cross-host credentials; installed code is immutable | Actual kernel outside-root config write rejected; exact OS policy also denied direct writes, hardlinks, cross-host/operator reads and Data-volume/symlink aliases |
| Tool cancellation | Pi supplies AbortSignal | Propagated to bridge; uncertain dispatch locks profile | Final held native call cancelled before dispatch, plus cancellation after actual resource effect; restart fence retains original authority |

The final relay sends `parallel_tool_calls: false`; stock Pi is configured for
sequential execution. Earlier artifacts observed two sibling writes and reads,
but those historical observations do not qualify batching in the final delivery
acknowledgement mode. That mode confirms the first result through native history
before allowing another protected operation. Final forced multi-call response
qualification is recorded separately from ordinary serial useful work.

Consequential kernel tools must have their own scoped resource and authority enforcement. A remote shell that can obtain operator credentials or reach a second route to the protected resource invalidates the mode. Guest-local profile state is mutable, so the kernel's delegated credential and durable dispatch state remain authoritative. The final cold collection records the exact current OS process controls; [process qualification](SANDBOX-QUALIFICATION.md) preserves earlier boundary observations.
